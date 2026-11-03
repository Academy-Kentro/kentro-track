import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EnvioWebhook, Lead, OrigemLead, Prisma } from '@prisma/client';
import { assinar } from '../comum/assinatura';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { Fetch, FETCH } from '../comum/fetch';
import { PrismaService } from '../comum/prisma.service';
import { instanteUtc } from '../comum/sql';
import { chaveVariavel } from '../formularios/leitura';
import { mascararTelefone } from '../leads/telefone';

/** Lead de campanha: veio de anúncio, de formulário ou de link rastreável. Conversa sem origem não sai. */
const ORIGENS_DE_CAMPANHA: OrigemLead[] = ['ctwa', 'formulario', 'link'];
/** Esperas entre tentativas (min), as mesmas da captura da Kentro: passada a última, fica com erro e o admin reenvia. */
const ESPERAS_MIN = [1, 5, 30, 120, 720];
const POR_CICLO = 50;
const TRAVA_MIN = 5;
const TEMPO_LIMITE_MS = 10_000;

type DadosDoCorpo = Pick<
  Lead,
  'id' | 'origem' | 'nome' | 'telefone' | 'email' | 'chatId' | 'recebidoEm' | 'campanhaIdMeta' | 'conjuntoIdMeta' | 'anuncioIdMeta' | 'formularioIdMeta' | 'ctwaClid' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'utmTerm' | 'gclid' | 'gbraid' | 'wbraid' | 'fbclid'
> & { respostas: unknown };

interface NomesDoLead {
  campanha?: string | null;
  conjunto?: string | null;
  anuncio?: string | null;
  formulario?: string | null;
  link?: string | null;
}

const LEAD_DE_TESTE: DadosDoCorpo = {
  id: 'teste',
  origem: 'formulario',
  nome: 'Lead de teste (Kentro Track)',
  telefone: '5511999990000',
  email: 'teste@exemplo.com.br',
  chatId: null,
  recebidoEm: new Date(0),
  campanhaIdMeta: 'teste',
  conjuntoIdMeta: 'teste',
  anuncioIdMeta: 'teste',
  formularioIdMeta: 'teste',
  ctwaClid: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  respostas: [{ chave: 'city', pergunta: 'Cidade', resposta: 'São Paulo' }],
};

/** Plano, como o da captura da Kentro: cada campo vira uma variável capture_<campo> se o destino for uma captura. */
function montarCorpo(evento: 'lead_campanha' | 'teste', l: DadosDoCorpo, nomes: NomesDoLead, fuso: string): Record<string, string> {
  const respostas = (Array.isArray(l.respostas) ? l.respostas : []) as { chave?: string; pergunta: string; resposta: string }[];
  const corpo: Record<string, string> = {
    evento,
    lead_id: l.id,
    origem: l.origem,
    nome: l.nome ?? '',
    telefone: l.telefone ?? '',
    email: l.email ?? '',
    chat_id: l.chatId ?? '',
    recebido_em: l.recebidoEm.toLocaleString('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    recebido_em_iso: l.recebidoEm.toISOString(),
    campanha: nomes.campanha ?? '',
    campanha_id: l.campanhaIdMeta ?? '',
    conjunto: nomes.conjunto ?? '',
    conjunto_id: l.conjuntoIdMeta ?? '',
    anuncio: nomes.anuncio ?? '',
    anuncio_id: l.anuncioIdMeta ?? '',
    formulario: nomes.formulario ?? '',
    formulario_id: l.formularioIdMeta ?? '',
    link: nomes.link ?? '',
    ctwa_clid: l.ctwaClid ?? '',
    utm_source: l.utmSource ?? '',
    utm_medium: l.utmMedium ?? '',
    utm_campaign: l.utmCampaign ?? '',
    utm_content: l.utmContent ?? '',
    utm_term: l.utmTerm ?? '',
    gclid: l.gclid ?? '',
    gbraid: l.gbraid ?? '',
    wbraid: l.wbraid ?? '',
    fbclid: l.fbclid ?? '',
    respostas_texto: respostas.map((r) => `${r.pergunta}: ${r.resposta}`).join('\n'),
  };
  for (const r of respostas) {
    const chave = chaveVariavel(r.chave ?? r.pergunta);
    if (chave) corpo[`resposta_${chave}`] = r.resposta;
  }
  return corpo;
}

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

  /** Quem recebe confere a assinatura com este segredo (derivado da conta: não fica gravado e não muda com o endereço). */
  private segredo(contaId: string): string {
    return assinar(this.config.chaveMestra, `webhook:${contaId}`);
  }

  async listar(contaId: string) {
    const [webhook, envios] = await Promise.all([
      this.prisma.webhookSaida.findUnique({ where: { contaId } }),
      this.prisma.envioWebhook.findMany({ where: { contaId }, orderBy: { id: 'desc' }, take: 20, include: { lead: { select: { nome: true, telefone: true } } } }),
    ]);
    return {
      url: webhook?.url ?? null,
      segredo: this.segredo(contaId),
      envios: envios.map((e) => ({
        id: String(e.id),
        nome: e.lead?.nome ?? null,
        telefone: mascararTelefone(e.lead?.telefone),
        status: e.status,
        tentativas: e.tentativas,
        respostaStatus: e.respostaStatus,
        erro: e.erro,
        criadoEm: e.criadoEm,
        enviadoEm: e.enviadoEm,
      })),
    };
  }

  /** Salva o endereço; vazio remove o webhook e a fila dele. */
  async salvar(contaId: string, url: string | null | undefined) {
    if (url?.trim()) {
      const destino = validarUrl(url);
      await this.prisma.webhookSaida.upsert({ where: { contaId }, create: { contaId, url: destino }, update: { url: destino } });
    } else {
      await this.prisma.webhookSaida.deleteMany({ where: { contaId } });
    }
    return this.listar(contaId);
  }

  /** Lead de exemplo direto no endereço: confere o destino sem esperar um lead de verdade. */
  async testar(contaId: string, url?: string) {
    const conta = await this.prisma.conta.findUniqueOrThrow({ where: { id: contaId }, select: { fuso: true, webhook: { select: { url: true } } } });
    const bruta = url?.trim() || conta.webhook?.url;
    if (!bruta) throw new ErroApi(400, 'URL_OBRIGATORIA', 'Informe o endereço do webhook.');
    const corpo = montarCorpo(
      'teste',
      { ...LEAD_DE_TESTE, recebidoEm: new Date() },
      { campanha: 'Campanha de teste', conjunto: 'Conjunto de teste', anuncio: 'Anúncio de teste', formulario: 'Formulário de teste' },
      conta.fuso,
    );
    const erro = await this.postar(contaId, validarUrl(bruta), corpo).then(
      (status) => (status >= 200 && status < 300 ? null : `O destino respondeu ${status}.`),
      (e) => this.motivo(e),
    );
    if (erro) throw new ErroApi(502, 'WEBHOOK_RECUSOU', erro);
    return { ok: true, corpo };
  }

  async reenviar(contaId: string, id: bigint) {
    const r = await this.prisma.envioWebhook.updateMany({
      where: { id, contaId, status: 'erro' },
      data: { status: 'pendente', tentativas: 0, proximaTentativaEm: new Date(), emEnvioAte: null, erro: null },
    });
    if (r.count === 0) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Envio não encontrado ou já entregue.');
    return { ok: true };
  }

  private async corpoDoLead(lead: Lead) {
    const contaId = lead.contaId;
    const [conta, campanha, conjunto, anuncio, formulario, link] = await Promise.all([
      this.prisma.conta.findUniqueOrThrow({ where: { id: contaId }, select: { fuso: true } }),
      lead.campanhaIdMeta ? this.prisma.campanha.findFirst({ where: { contaId, idMeta: lead.campanhaIdMeta }, select: { nome: true } }) : null,
      lead.conjuntoIdMeta ? this.prisma.conjunto.findFirst({ where: { contaId, idMeta: lead.conjuntoIdMeta }, select: { nome: true } }) : null,
      lead.anuncioIdMeta ? this.prisma.anuncio.findFirst({ where: { contaId, idMeta: lead.anuncioIdMeta }, select: { nome: true } }) : null,
      lead.formularioIdMeta ? this.prisma.formularioMeta.findUnique({ where: { contaId_idMeta: { contaId, idMeta: lead.formularioIdMeta } }, select: { nome: true } }) : null,
      lead.linkId ? this.prisma.linkRastreavel.findUnique({ where: { id: lead.linkId }, select: { nome: true } }) : null,
    ]);
    return montarCorpo(
      'lead_campanha',
      lead,
      { campanha: campanha?.nome, conjunto: conjunto?.nome, anuncio: anuncio?.nome ?? lead.anuncioTitulo, formulario: formulario?.nome, link: link?.nome },
      conta.fuso,
    );
  }

  /** Lead de campanha na fila. Cada lead sai uma vez: se a origem dele mudar depois, o índice único segura. */
  async emitir(lead: Lead): Promise<void> {
    if (!ORIGENS_DE_CAMPANHA.includes(lead.origem)) return;
    const webhook = await this.prisma.webhookSaida.findUnique({ where: { contaId: lead.contaId }, select: { id: true } });
    if (!webhook) return;
    const payload = (await this.corpoDoLead(lead)) as Prisma.InputJsonValue;
    await this.prisma.envioWebhook.createMany({ data: [{ contaId: lead.contaId, webhookId: webhook.id, leadId: lead.id, payload }], skipDuplicates: true });
  }

  private motivo(e: unknown): string {
    return e instanceof Error ? e.message.slice(0, 200) : 'Falha ao enviar.';
  }

  private async postar(contaId: string, url: string, corpo: unknown): Promise<number> {
    const { hostname } = new URL(url);
    // Olhado de novo na hora do envio: o nome pode ter passado a apontar para a rede interna.
    const enderecos = await lookup(hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (enderecos.some((e) => ipInterno(e.address))) throw new Error('O endereço aponta para uma rede interna.');
    const texto = JSON.stringify(corpo);
    const assinatura = createHmac('sha256', this.segredo(contaId)).update(texto).digest('hex');
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
    const envios = await this.prisma.envioWebhook.findMany({ where: { id: { in: ids.map((i) => i.id) } }, orderBy: { id: 'asc' }, include: { webhook: { select: { url: true } } } });
    for (const envio of envios) await this.enviar(envio, envio.webhook.url, agora);
    return envios.length;
  }

  /** Vai para o endereço atual: quem corrige o endereço e reenvia não manda de novo para o errado. */
  private async enviar(envio: EnvioWebhook, url: string, agora: Date): Promise<void> {
    const gravar = (dados: Prisma.EnvioWebhookUpdateInput) => this.prisma.envioWebhook.update({ where: { id: envio.id }, data: { emEnvioAte: null, ...dados } });
    let status: number | null = null;
    let erro: string;
    try {
      status = await this.postar(envio.contaId, url, envio.payload);
      if (status >= 200 && status < 300) {
        await gravar({ status: 'enviado', respostaStatus: status, enviadoEm: agora, erro: null, tentativas: envio.tentativas + 1 });
        return;
      }
      erro = `O destino respondeu ${status}.`;
    } catch (e) {
      erro = this.motivo(e);
    }
    const tentativas = envio.tentativas + 1;
    if (tentativas <= ESPERAS_MIN.length) {
      await gravar({ tentativas, erro, respostaStatus: status, proximaTentativaEm: new Date(agora.getTime() + ESPERAS_MIN[tentativas - 1] * 60_000) });
      return;
    }
    await gravar({ tentativas, erro, respostaStatus: status, status: 'erro' });
    this.logger.warn(`Envio ${envio.id} do webhook ${envio.webhookId} ficou com erro: ${erro}`);
  }
}
