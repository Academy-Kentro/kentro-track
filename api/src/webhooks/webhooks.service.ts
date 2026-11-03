import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EnvioWebhook, Lead, Prisma, WebhookSaida } from '@prisma/client';
import { assinar } from '../comum/assinatura';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { Fetch, FETCH } from '../comum/fetch';
import { PrismaService } from '../comum/prisma.service';
import { instanteUtc } from '../comum/sql';

export type EventoWebhook = 'lead_create' | 'lead_update' | 'lead_source_update';

export interface DadosWebhook {
  nome: string;
  urlCriada?: string | null;
  urlAlterada?: string | null;
  urlMensagem?: string | null;
  urlOrigem?: string | null;
  origens?: string[];
  ativo?: boolean;
}

export const MAX_WEBHOOKS = 3;
export const ORIGENS_WEBHOOK = ['ctwa', 'formulario', 'link', 'organico'];

const CAMPO_DA_URL: Record<EventoWebhook, 'urlCriada' | 'urlAlterada' | 'urlOrigem'> = { lead_create: 'urlCriada', lead_update: 'urlAlterada', lead_source_update: 'urlOrigem' };
/** Esperas entre tentativas (min). Passada a última, o webhook desliga: o destino está fora do ar. */
const ESPERAS_MIN = [1, 2, 5];
const POR_CICLO = 50;
const TRAVA_MIN = 5;
const TEMPO_LIMITE_MS = 10_000;

/** Endereços da própria rede: a API não pode ser usada para alcançar o que está atrás dela. */
function ipInterno(ip: string): boolean {
  const v4 = ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || /^fe[89ab]/.test(v6);
}

function validarUrl(bruta: string): string {
  const texto = bruta.trim();
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new ErroApi(400, 'URL_INVALIDA', `Endereço inválido: "${texto.slice(0, 100)}".`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const interno = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) > 0 && ipInterno(host));
  if (url.protocol !== 'https:' || url.username || url.password || interno) {
    throw new ErroApi(400, 'URL_INVALIDA', 'Use um endereço público com https, sem usuário e senha.');
  }
  return url.toString();
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    @Inject(FETCH) private readonly fetch: Fetch,
  ) {}

  /** Quem recebe confere a assinatura com este segredo (derivado: não fica gravado). */
  private segredo(id: string): string {
    return assinar(this.config.chaveMestra, `webhook:${id}`);
  }

  private publico(w: WebhookSaida) {
    return {
      id: w.id,
      nome: w.nome,
      urlCriada: w.urlCriada,
      urlAlterada: w.urlAlterada,
      urlMensagem: w.urlMensagem,
      urlOrigem: w.urlOrigem,
      origens: w.origens,
      ativo: w.ativo,
      motivoDesativado: w.motivoDesativado,
      segredo: this.segredo(w.id),
    };
  }

  async listar(contaId: string) {
    const [webhooks, envios] = await Promise.all([
      this.prisma.webhookSaida.findMany({ where: { contaId }, orderBy: { criadoEm: 'asc' } }),
      this.prisma.envioWebhook.findMany({ where: { contaId }, orderBy: { id: 'desc' }, take: 30, include: { webhook: { select: { nome: true } } } }),
    ]);
    return {
      maximo: MAX_WEBHOOKS,
      webhooks: webhooks.map((w) => this.publico(w)),
      envios: envios.map((e) => ({
        id: String(e.id),
        webhook: e.webhook.nome,
        evento: e.evento,
        status: e.status,
        tentativas: e.tentativas,
        respostaStatus: e.respostaStatus,
        erro: e.erro,
        criadoEm: e.criadoEm,
        enviadoEm: e.enviadoEm,
      })),
    };
  }

  private dados(d: DadosWebhook) {
    const url = (v: string | null | undefined) => (v?.trim() ? validarUrl(v) : null);
    const dados = {
      nome: d.nome.trim().slice(0, 80),
      urlCriada: url(d.urlCriada),
      urlAlterada: url(d.urlAlterada),
      urlMensagem: url(d.urlMensagem),
      urlOrigem: url(d.urlOrigem),
      origens: d.origens ?? [],
    };
    if (!dados.urlCriada && !dados.urlAlterada && !dados.urlMensagem && !dados.urlOrigem) throw new ErroApi(400, 'URL_OBRIGATORIA', 'Informe pelo menos uma URL.');
    return dados;
  }

  async criar(contaId: string, d: DadosWebhook) {
    if ((await this.prisma.webhookSaida.count({ where: { contaId } })) >= MAX_WEBHOOKS) throw new ErroApi(400, 'WEBHOOKS_DEMAIS', `No máximo ${MAX_WEBHOOKS} webhooks por conta.`);
    return this.publico(await this.prisma.webhookSaida.create({ data: { ...this.dados(d), contaId } }));
  }

  async atualizar(contaId: string, id: string, d: DadosWebhook) {
    const r = await this.prisma.webhookSaida.updateMany({
      where: { id, contaId },
      // Ligar de novo limpa o motivo: quem ligou diz que o destino voltou.
      data: { ...this.dados(d), ativo: d.ativo ?? true, motivoDesativado: null },
    });
    if (r.count === 0) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Webhook não encontrado.');
    return this.publico(await this.prisma.webhookSaida.findUniqueOrThrow({ where: { id } }));
  }

  async excluir(contaId: string, id: string) {
    const r = await this.prisma.webhookSaida.deleteMany({ where: { id, contaId } });
    if (r.count === 0) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Webhook não encontrado.');
    return { ok: true };
  }

  async reenviar(contaId: string, id: bigint) {
    const r = await this.prisma.envioWebhook.updateMany({
      where: { id, contaId, status: { in: ['erro', 'descartado'] } },
      data: { status: 'pendente', tentativas: 0, proximaTentativaEm: new Date(), erro: null },
    });
    if (r.count === 0) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Envio não encontrado ou já entregue.');
    return { ok: true };
  }

  private async corpo(lead: Lead, evento: string) {
    const nomeDe = async <T extends { nome: string }>(busca: Promise<T | null> | null) => (busca ? ((await busca)?.nome ?? null) : null);
    const na = lead.contaAnuncioId;
    const [etapaNome, campanha, conjunto, anuncio, link] = await Promise.all([
      nomeDe(lead.etapaId ? this.prisma.etapaFunil.findUnique({ where: { id: lead.etapaId }, select: { nome: true } }) : null),
      nomeDe(na && lead.campanhaIdMeta ? this.prisma.campanha.findUnique({ where: { contaAnuncioId_idMeta: { contaAnuncioId: na, idMeta: lead.campanhaIdMeta } }, select: { nome: true } }) : null),
      nomeDe(na && lead.conjuntoIdMeta ? this.prisma.conjunto.findUnique({ where: { contaAnuncioId_idMeta: { contaAnuncioId: na, idMeta: lead.conjuntoIdMeta } }, select: { nome: true } }) : null),
      nomeDe(na && lead.anuncioIdMeta ? this.prisma.anuncio.findUnique({ where: { contaAnuncioId_idMeta: { contaAnuncioId: na, idMeta: lead.anuncioIdMeta } }, select: { nome: true } }) : null),
      nomeDe(lead.linkId ? this.prisma.linkRastreavel.findUnique({ where: { id: lead.linkId }, select: { nome: true } }) : null),
    ]);
    return {
      evento,
      em: new Date().toISOString(),
      contaId: lead.contaId,
      lead: {
        id: lead.id,
        nome: lead.nome,
        telefone: lead.telefone,
        email: lead.email,
        chatId: lead.chatId,
        origem: lead.origem,
        etapa: lead.etapa,
        etapaId: lead.etapaId,
        etapaNome,
        valorVenda: lead.valorVenda == null ? null : Number(lead.valorVenda),
        recebidoEm: lead.recebidoEm,
        atendente: lead.atendenteNome,
        anuncio: { campanhaId: lead.campanhaIdMeta, campanha, conjuntoId: lead.conjuntoIdMeta, conjunto, anuncioId: lead.anuncioIdMeta, anuncio, ctwaClid: lead.ctwaClid },
        visita: {
          link,
          utmSource: lead.utmSource,
          utmMedium: lead.utmMedium,
          utmCampaign: lead.utmCampaign,
          utmContent: lead.utmContent,
          utmTerm: lead.utmTerm,
          gclid: lead.gclid,
          gbraid: lead.gbraid,
          wbraid: lead.wbraid,
          fbclid: lead.fbclid,
        },
      },
    };
  }

  private async doLead(lead: Lead) {
    const webhooks = await this.prisma.webhookSaida.findMany({ where: { contaId: lead.contaId, ativo: true } });
    return webhooks.filter((w) => w.origens.length === 0 || w.origens.includes(lead.origem));
  }

  /** Põe o evento na fila de cada webhook que quer esta origem. */
  async emitir(lead: Lead, evento: EventoWebhook): Promise<void> {
    const webhooks = (await this.doLead(lead)).filter((w) => w[CAMPO_DA_URL[evento]]);
    if (webhooks.length === 0) return;
    const payload = (await this.corpo(lead, evento)) as unknown as Prisma.InputJsonValue;
    await this.prisma.envioWebhook.createMany({
      data: webhooks.map((w) => ({ contaId: lead.contaId, webhookId: w.id, leadId: lead.id, evento, url: w[CAMPO_DA_URL[evento]]!, payload })),
    });
  }

  /**
   * Mensagem nova: sai na hora, uma tentativa só, e não entra na fila, porque a fila guardaria o
   * texto. Quem precisa de garantia de entrega lê a conversa pela Kentro.
   */
  async entregarMensagem(lead: Lead, direcao: string, texto: string): Promise<void> {
    const webhooks = (await this.doLead(lead)).filter((w) => w.urlMensagem);
    if (webhooks.length === 0) return;
    const corpo = { ...(await this.corpo(lead, 'message_create')), mensagem: { direcao, texto } };
    await Promise.all(webhooks.map((w) => this.postar(w.id, w.urlMensagem!, corpo).catch(() => undefined)));
  }

  private async postar(webhookId: string, url: string, corpo: unknown): Promise<number> {
    const { hostname } = new URL(url);
    // Olhado de novo na hora do envio: o nome pode ter passado a apontar para a rede interna.
    const enderecos = await lookup(hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (enderecos.some((e) => ipInterno(e.address))) throw new Error('O endereço aponta para uma rede interna.');
    const texto = JSON.stringify(corpo);
    const assinatura = createHmac('sha256', this.segredo(webhookId)).update(texto).digest('hex');
    const resposta = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'KentroTrack-Webhook', 'X-Kentro-Track-Assinatura': `sha256=${assinatura}` },
      body: texto,
      // Sem seguir redirecionamento: ele poderia levar à rede interna depois da conferência acima.
      redirect: 'manual',
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    return resposta.status;
  }

  /** Um ciclo da fila: reserva os pendentes vencidos (à prova de dois processos) e envia um a um. */
  async enviarPendentes(agora = new Date()): Promise<number> {
    const t = instanteUtc(agora);
    const ids = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE envios_webhook SET em_envio_ate = ${instanteUtc(new Date(agora.getTime() + TRAVA_MIN * 60_000))}
      WHERE id IN (
        SELECT id FROM envios_webhook
        WHERE status = 'pendente' AND proxima_tentativa_em <= ${t}
          AND (em_envio_ate IS NULL OR em_envio_ate < ${t})
        ORDER BY id
        LIMIT ${POR_CICLO}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (ids.length === 0) return 0;
    const envios = await this.prisma.envioWebhook.findMany({ where: { id: { in: ids.map((i) => i.id) } }, orderBy: { id: 'asc' }, include: { webhook: true } });
    for (const envio of envios) await this.enviar(envio, envio.webhook, agora);
    return envios.length;
  }

  private async enviar(envio: EnvioWebhook, webhook: WebhookSaida, agora: Date): Promise<void> {
    const gravar = (dados: Prisma.EnvioWebhookUpdateInput) => this.prisma.envioWebhook.update({ where: { id: envio.id }, data: { emEnvioAte: null, ...dados } });
    if (!webhook.ativo) {
      await gravar({ status: 'descartado', erro: 'O webhook estava desligado.' });
      return;
    }
    let status: number | null = null;
    let erro: string;
    try {
      status = await this.postar(webhook.id, envio.url, envio.payload);
      if (status >= 200 && status < 300) {
        await gravar({ status: 'enviado', respostaStatus: status, enviadoEm: agora, erro: null, tentativas: envio.tentativas + 1 });
        return;
      }
      erro = `O destino respondeu ${status}.`;
    } catch (e) {
      erro = e instanceof Error ? e.message.slice(0, 200) : 'Falha ao enviar.';
    }
    const tentativas = envio.tentativas + 1;
    if (tentativas <= ESPERAS_MIN.length) {
      await gravar({ tentativas, erro, respostaStatus: status, proximaTentativaEm: new Date(agora.getTime() + ESPERAS_MIN[tentativas - 1] * 60_000) });
      return;
    }
    await gravar({ tentativas, erro, respostaStatus: status, status: 'erro' });
    await this.prisma.webhookSaida.update({ where: { id: webhook.id }, data: { ativo: false, motivoDesativado: `Desligado depois de ${tentativas} tentativas: ${erro}` } });
    this.logger.warn(`Webhook ${webhook.id} desligado: ${erro}`);
  }
}
