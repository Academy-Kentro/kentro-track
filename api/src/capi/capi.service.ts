import { Inject, Injectable, Logger } from '@nestjs/common';
import { EnvioCapi, EtapaFunil, Lead, Prisma } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cifrar, decifrar } from '../comum/cripto';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { instanteUtc } from '../comum/sql';
import { ClienteGraph, TokenMeta } from '../meta/cliente/graph';
import { ErroMeta, LimiteMeta, MetaIndisponivel, TokenInvalido } from '../meta/cliente/erros';
import { ConexaoService } from '../meta/conexao/conexao.service';
import { Gatilho, GATILHOS, hash, lerMapeamento, Mapeamento, montarEvento } from './evento';

/** Esperas entre tentativas (min): passada a última, o envio fica com erro e o admin reenvia. */
const ESPERAS_MIN = [1, 5, 30, 120, 720];
const POR_CICLO = 100;
const TRAVA_MIN = 5;

export interface DadosConfig {
  ativo?: boolean;
  datasetId?: string | null;
  datasetNome?: string | null;
  /** Token próprio do pixel: texto novo grava; null apaga; ausente mantém. */
  token?: string | null;
  wabaId?: string | null;
  codigoTeste?: string | null;
  mapeamento?: Partial<Mapeamento>;
}

/** Erro de envio que adianta repetir: rede, Meta instável ou limite. Recusa de dado não muda sozinha. */
const passageiro = (e: unknown) => e instanceof MetaIndisponivel || e instanceof LimiteMeta;

@Injectable()
export class CapiService {
  private readonly logger = new Logger('Capi');

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: ClienteGraph,
    private readonly conexao: ConexaoService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  async configuracao(contaId: string) {
    const c = await this.prisma.configCapi.findUnique({ where: { contaId } });
    return {
      ativo: c?.ativo ?? false,
      datasetId: c?.datasetId ?? null,
      datasetNome: c?.datasetNome ?? null,
      tokenProprio: !!c?.tokenCifrado,
      wabaId: c?.wabaId ?? null,
      codigoTeste: c?.codigoTeste ?? null,
      mapeamento: lerMapeamento(c?.mapeamento),
    };
  }

  async salvar(contaId: string, d: DadosConfig) {
    const atual = await this.prisma.configCapi.findUnique({ where: { contaId } });
    const dados: Prisma.ConfigCapiUncheckedCreateInput = { contaId };
    if (d.ativo !== undefined) dados.ativo = d.ativo;
    if (d.datasetId !== undefined) dados.datasetId = d.datasetId?.trim() || null;
    if (d.datasetNome !== undefined) dados.datasetNome = d.datasetNome?.trim().slice(0, 200) || null;
    if (d.wabaId !== undefined) dados.wabaId = d.wabaId?.trim() || null;
    if (d.codigoTeste !== undefined) dados.codigoTeste = d.codigoTeste?.trim() || null;
    if (d.mapeamento !== undefined) dados.mapeamento = lerMapeamento({ ...lerMapeamento(atual?.mapeamento), ...d.mapeamento });
    if (d.token === null) Object.assign(dados, { tokenCifrado: null, iv: null });
    else if (typeof d.token === 'string' && d.token.trim()) {
      const { cifrado, iv } = cifrar(d.token.replace(/\s+/g, ''), this.config.chaveMestra);
      Object.assign(dados, { tokenCifrado: new Uint8Array(cifrado), iv: new Uint8Array(iv) });
    }
    const final = { datasetId: atual?.datasetId ?? null, ...dados };
    if (dados.ativo && !final.datasetId) throw new ErroApi(400, 'PIXEL_OBRIGATORIO', 'Escolha o pixel antes de ligar o envio de eventos.');
    const { contaId: _, ...semConta } = dados;
    await this.prisma.configCapi.upsert({ where: { contaId }, create: dados, update: semConta });
    return this.configuracao(contaId);
  }

  /** Token do envio: o próprio do pixel, se houver; senão o da conexão. */
  private async tokenDeEnvio(contaId: string): Promise<{ token: TokenMeta; proprio: boolean } | null> {
    const c = await this.prisma.configCapi.findUnique({ where: { contaId } });
    if (c?.tokenCifrado && c.iv) {
      return { token: { valor: decifrar(Buffer.from(c.tokenCifrado), Buffer.from(c.iv), this.config.chaveMestra), doNossoApp: false }, proprio: true };
    }
    const token = await this.conexao.token(contaId);
    return token ? { token, proprio: false } : null;
  }

  /** Pixels das contas de anúncio selecionadas, para o admin escolher (o token precisa enxergá-los). */
  async pixels(contaId: string) {
    const token = await this.conexao.token(contaId);
    if (!token) throw new ErroApi(400, 'META_NAO_CONECTADO', 'Conecte o Meta antes de escolher o pixel.');
    const contas = await this.prisma.contaAnuncio.findMany({ where: { contaId, selecionada: true } });
    const vistos = new Map<string, { id: string; nome: string; ultimoDisparo: string | null; contaAnuncio: string }>();
    for (const ca of contas) {
      try {
        const lista = await this.graph.listar<{ id: string; name?: string; last_fired_time?: string }>(
          token,
          `${ca.idMeta}/adspixels`,
          { fields: 'id,name,last_fired_time', limit: 100 },
          { contaId, operacao: 'pixels' },
          5,
        );
        for (const p of lista) if (!vistos.has(p.id)) vistos.set(p.id, { id: p.id, nome: p.name ?? p.id, ultimoDisparo: p.last_fired_time ?? null, contaAnuncio: ca.nome });
      } catch (e) {
        if (!(e instanceof ErroMeta)) throw e;
        this.logger.warn(`Pixels de ${ca.idMeta} (conta ${contaId}): ${e.codigo} ${e.message}`);
      }
    }
    return { pixels: [...vistos.values()] };
  }

  /**
   * Põe o evento do gatilho na fila, se a conta ligou o envio e o gatilho tem evento. Idempotente:
   * o event_id é fixo por lead e gatilho, e o par (pixel, event_id) é único.
   */
  async enfileirar(lead: Lead, gatilho: Gatilho, quando = new Date()): Promise<void> {
    if (gatilho === 'lead_recebido' && lead.origem === 'formulario') return; // o Meta já contou o formulário
    await this.gravar(lead, gatilho, (config) => lerMapeamento(config.mapeamento)[gatilho], false, quando);
  }

  /**
   * O evento da etapa do funil (o que o admin configurou nela). O event_id usa a chave da etapa:
   * as de antes (qualificado, venda, descartado) continuam com o mesmo id e não saem em dobro.
   */
  async enfileirarEtapa(lead: Lead, etapa: EtapaFunil, quando = new Date()): Promise<void> {
    if (!etapa.eventoMeta) return;
    await this.gravar(lead, etapa.chave, () => etapa.eventoMeta, etapa.tipo === 'venda', quando);
  }

  private async gravar(
    lead: Lead,
    gatilho: string,
    nomeDoEvento: (config: { mapeamento: Prisma.JsonValue }) => string | null,
    comValor: boolean,
    quando: Date,
  ): Promise<void> {
    if (lead.origem === 'organico') return; // sem anúncio, o evento não ajuda a otimizar campanha
    const config = await this.prisma.configCapi.findUnique({ where: { contaId: lead.contaId } });
    if (!config?.ativo || !config.datasetId) return;
    const eventName = nomeDoEvento(config);
    if (!eventName) return;
    const { moeda } = await this.prisma.conta.findUniqueOrThrow({ where: { id: lead.contaId }, select: { moeda: true } });
    const { eventId, payload } = montarEvento(lead, gatilho, eventName, { moeda, wabaId: config.wabaId, quando }, comValor);
    try {
      await this.prisma.envioCapi.create({
        data: {
          contaId: lead.contaId,
          leadId: lead.id,
          datasetId: config.datasetId,
          gatilho,
          eventName,
          eventId,
          payload: payload as Prisma.InputJsonValue,
          teste: !!config.codigoTeste,
        },
      });
    } catch (e) {
      // Já enfileirado (venda reaberta e marcada de novo, por exemplo): o Meta não conta duas vezes.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }

  /** Um ciclo da fila: reserva os pendentes vencidos (à prova de dois processos) e envia um a um. */
  async enviarPendentes(agora = new Date()): Promise<number> {
    const t = instanteUtc(agora);
    const ids = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE envios_capi SET em_envio_ate = ${instanteUtc(new Date(agora.getTime() + TRAVA_MIN * 60_000))}
      WHERE id IN (
        SELECT id FROM envios_capi
        WHERE status = 'pendente' AND proxima_tentativa_em <= ${t}
          AND (em_envio_ate IS NULL OR em_envio_ate < ${t})
        ORDER BY id
        LIMIT ${POR_CICLO}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    if (ids.length === 0) return 0;
    const envios = await this.prisma.envioCapi.findMany({ where: { id: { in: ids.map((i) => i.id) } }, orderBy: { id: 'asc' } });
    const configs = new Map<string, Awaited<ReturnType<typeof this.prisma.configCapi.findUnique>>>();
    for (const envio of envios) {
      if (!configs.has(envio.contaId)) configs.set(envio.contaId, await this.prisma.configCapi.findUnique({ where: { contaId: envio.contaId } }));
      await this.enviar(envio, configs.get(envio.contaId) ?? null, agora);
    }
    return envios.length;
  }

  private async enviar(envio: EnvioCapi, config: { codigoTeste: string | null } | null, agora: Date): Promise<void> {
    const tentar = (dados: Prisma.EnvioCapiUpdateInput) => this.prisma.envioCapi.update({ where: { id: envio.id }, data: { emEnvioAte: null, ...dados } });
    const credencial = await this.tokenDeEnvio(envio.contaId);
    if (!credencial) {
      await tentar({ proximaTentativaEm: new Date(agora.getTime() + 60 * 60_000), erro: 'Sem token: conecte o Meta ou informe o token do pixel.' });
      return;
    }
    try {
      const resposta = await this.graph.post<{ events_received?: number; fbtrace_id?: string }>(
        credencial.token,
        `${envio.datasetId}/events`,
        {},
        { contaId: envio.contaId, operacao: 'capi' },
        { data: [envio.payload], ...(envio.teste && config?.codigoTeste ? { test_event_code: config.codigoTeste } : {}) },
      );
      await tentar({ status: 'enviado', enviadoEm: agora, erro: null, fbtraceId: resposta.fbtrace_id ?? null, tentativas: { increment: 1 } });
    } catch (e) {
      const mensagem = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const trace = e instanceof ErroMeta ? e.fbtraceId ?? null : null;
      if (e instanceof TokenInvalido) {
        // Token da conexão caído: a conta inteira vai para "reconectar". O envio espera, não se perde.
        if (!credencial.proprio) await this.conexao.marcarReconectar(envio.contaId, mensagem);
        await tentar({ proximaTentativaEm: new Date(agora.getTime() + 60 * 60_000), erro: mensagem, fbtraceId: trace });
        return;
      }
      const tentativas = envio.tentativas + 1;
      if (passageiro(e) && tentativas <= ESPERAS_MIN.length) {
        const esperaMin = e instanceof LimiteMeta ? Math.max(ESPERAS_MIN[tentativas - 1], Math.ceil(e.esperarSegundos / 60)) : ESPERAS_MIN[tentativas - 1];
        await tentar({ tentativas, proximaTentativaEm: new Date(agora.getTime() + esperaMin * 60_000), erro: mensagem, fbtraceId: trace });
        return;
      }
      if (!(e instanceof ErroMeta)) this.logger.error(e instanceof Error ? e.stack ?? mensagem : mensagem);
      await tentar({ status: 'erro', tentativas, erro: mensagem, fbtraceId: trace });
    }
  }

  /** Evento de teste síncrono: aparece em "Eventos de teste" do Gerenciador de Eventos e não conta. */
  async testar(contaId: string, codigo?: string) {
    const config = await this.prisma.configCapi.findUnique({ where: { contaId } });
    const codigoTeste = codigo?.trim() || config?.codigoTeste;
    if (!config?.datasetId) throw new ErroApi(400, 'PIXEL_OBRIGATORIO', 'Escolha o pixel primeiro.');
    if (!codigoTeste) throw new ErroApi(400, 'CODIGO_TESTE_OBRIGATORIO', 'Informe o código de teste do Gerenciador de Eventos (aba Eventos de teste).');
    const credencial = await this.tokenDeEnvio(contaId);
    if (!credencial) throw new ErroApi(400, 'META_NAO_CONECTADO', 'Conecte o Meta ou informe o token do pixel.');
    const agora = new Date();
    const evento = {
      event_name: lerMapeamento(config.mapeamento).lead_recebido ?? 'Lead',
      event_time: Math.floor(agora.getTime() / 1000),
      event_id: `kt-teste-${agora.getTime()}`,
      action_source: 'chat',
      user_data: { external_id: [hash(`teste-${contaId}`)], country: [hash('br')] },
    };
    try {
      const r = await this.graph.post<{ events_received?: number; fbtrace_id?: string }>(
        credencial.token,
        `${config.datasetId}/events`,
        {},
        { contaId, operacao: 'capi-teste' },
        { data: [evento], test_event_code: codigoTeste },
      );
      return { ok: true, eventosRecebidos: r.events_received ?? 0, fbtraceId: r.fbtrace_id ?? null, evento: evento.event_name };
    } catch (e) {
      if (e instanceof ErroMeta) throw new ErroApi(400, e.codigo, `O Meta recusou o evento de teste: ${e.message}`);
      throw e;
    }
  }

  async envios(contaId: string, status?: string) {
    const desde = new Date(Date.now() - 30 * 86_400_000);
    const [lista, contagem] = await Promise.all([
      this.prisma.envioCapi.findMany({
        where: { contaId, ...(status ? { status: status as EnvioCapi['status'] } : {}) },
        orderBy: { id: 'desc' },
        take: 50,
        include: { lead: { select: { nome: true, chatId: true } } },
      }),
      this.prisma.envioCapi.groupBy({ by: ['status'], where: { contaId, criadoEm: { gte: desde } }, _count: true }),
    ]);
    return {
      ultimos30Dias: Object.fromEntries(contagem.map((c) => [c.status, c._count])),
      envios: lista.map((e) => ({
        id: String(e.id),
        gatilho: e.gatilho,
        evento: e.eventName,
        status: e.status,
        teste: e.teste,
        tentativas: e.tentativas,
        erro: e.erro,
        fbtraceId: e.fbtraceId,
        lead: e.lead?.nome ?? null,
        chatId: e.lead?.chatId ?? null,
        criadoEm: e.criadoEm,
        enviadoEm: e.enviadoEm,
      })),
    };
  }

  async reenviar(contaId: string, id: string) {
    const envio = /^\d{1,18}$/.test(id) ? await this.prisma.envioCapi.findFirst({ where: { id: BigInt(id), contaId } }) : null;
    if (!envio) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Envio não encontrado.');
    if (envio.status === 'enviado') throw new ErroApi(409, 'JA_ENVIADO', 'Este evento já foi recebido pelo Meta.');
    await this.prisma.envioCapi.update({ where: { id: envio.id }, data: { status: 'pendente', tentativas: 0, proximaTentativaEm: new Date(), emEnvioAte: null, erro: null } });
    return this.envios(contaId);
  }

  /** O que o painel do atendente mostra: o evento de cada etapa e se o Meta já recebeu. */
  async doLead(leadId: string) {
    const envios = await this.prisma.envioCapi.findMany({ where: { leadId }, orderBy: { id: 'asc' } });
    return envios.map((e) => ({ gatilho: e.gatilho, evento: e.eventName, status: e.status }));
  }
}

export { GATILHOS };
