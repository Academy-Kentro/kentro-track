import { Inject, Injectable, Logger } from '@nestjs/common';
import { FormularioMeta, Lead, Prisma } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cifrar, decifrar } from '../comum/cripto';
import { ErroApi } from '../comum/erros';
import { FETCH, Fetch } from '../comum/fetch';
import { PrismaService } from '../comum/prisma.service';
import { instanteUtc } from '../comum/sql';
import { LeadsService } from '../leads/leads.service';
import { mascararTelefone } from '../leads/telefone';
import { ClienteGraph, TokenMeta } from '../meta/cliente/graph';
import { ErroMeta, LimiteMeta, PermissaoFaltando, TokenInvalido } from '../meta/cliente/erros';
import { ConexaoService } from '../meta/conexao/conexao.service';
import { LeadGraph, lerLead, montarPayloadKentro, PayloadKentro, PerguntaGraph, rotulosDasPerguntas } from './leitura';

/** Sem o webhook do Meta (o token é do app do cliente), a leitura periódica é o que traz o lead. */
const INTERVALO_LEITURA_MIN = 2;
const FORMULARIOS_POR_CICLO = 20;
const ENVIOS_POR_CICLO = 50;
const TRAVA_MIN = 5;
/** Esperas entre tentativas de envio à Kentro (min): passada a última, fica com erro e o admin reenvia. */
const ESPERAS_MIN = [1, 5, 30, 120, 720];
/** A leitura volta um pouco no tempo: o lead criado no mesmo segundo da leitura anterior não se perde. */
const SOBREPOSICAO_S = 120;

export const PERMISSOES_FORMULARIO = ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'];

/** Só o endereço de uma captura de webhook da Kentro: a API não faz POST para qualquer lugar. */
const CAPTURA_KENTRO = /^https:\/\/[a-z0-9.-]+(:\d+)?\/webhookcapture\/capture\/[A-Za-z0-9._~-]+$/i;

function formularioPublico(f: FormularioMeta, leads30Dias: number) {
  return {
    id: f.id,
    idMeta: f.idMeta,
    nome: f.nome,
    status: f.status,
    pagina: f.paginaNome,
    selecionado: f.selecionado,
    perguntas: Object.values(f.perguntas as Record<string, string>),
    ultimaLeituraEm: f.ultimaLeituraEm,
    ultimoErro: f.ultimoErro,
    leads30Dias,
  };
}

@Injectable()
export class FormulariosService {
  private readonly logger = new Logger('Formularios');

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: ClienteGraph,
    private readonly conexao: ConexaoService,
    private readonly leads: LeadsService,
    @Inject(FETCH) private readonly fetch: Fetch,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  async listar(contaId: string) {
    const desde = new Date(Date.now() - 30 * 86_400_000);
    const [formularios, conta, conexao, contagem, envios] = await Promise.all([
      this.prisma.formularioMeta.findMany({ where: { contaId }, orderBy: [{ selecionado: 'desc' }, { paginaNome: 'asc' }, { nome: 'asc' }] }),
      this.prisma.conta.findUniqueOrThrow({ where: { id: contaId }, select: { capturaKentroUrl: true } }),
      this.prisma.conexaoMeta.findUnique({ where: { contaId }, select: { escopos: true } }),
      this.prisma.lead.groupBy({ by: ['formularioIdMeta'], where: { contaId, origem: 'formulario', recebidoEm: { gte: desde } }, _count: true }),
      this.prisma.lead.findMany({
        where: { contaId, origem: 'formulario', kentroStatus: { not: null } },
        orderBy: { recebidoEm: 'desc' },
        take: 20,
      }),
    ]);
    const porFormulario = new Map(contagem.map((c) => [c.formularioIdMeta, c._count]));
    const nomes = new Map(formularios.map((f) => [f.idMeta, f.nome]));
    // Sem a lista de permissões (alguns tokens não leem /me/permissions), não dá para afirmar que falta.
    const escopos = conexao?.escopos ?? [];
    return {
      conectado: !!conexao,
      permissoesFaltando: escopos.length ? PERMISSOES_FORMULARIO.filter((p) => !escopos.includes(p)) : [],
      capturaKentroUrl: conta.capturaKentroUrl,
      formularios: formularios.map((f) => formularioPublico(f, porFormulario.get(f.idMeta) ?? 0)),
      envios: envios.map((l) => ({
        leadId: l.id,
        nome: l.nome,
        telefone: mascararTelefone(l.telefone),
        formulario: (l.formularioIdMeta && nomes.get(l.formularioIdMeta)) ?? null,
        recebidoEm: l.recebidoEm,
        status: l.kentroStatus,
        tentativas: l.kentroTentativas,
        erro: l.kentroErro,
        enviadoEm: l.kentroEnviadoEm,
      })),
    };
  }

  /** Lê no Meta as páginas que o token enxerga e os formulários de cada uma (sem mexer na seleção). */
  async buscar(contaId: string) {
    const token = await this.conexao.token(contaId);
    if (!token) throw new ErroApi(400, 'META_NAO_CONECTADO', 'Conecte o Meta antes de buscar os formulários.');
    const ctx = { contaId, operacao: 'formularios' };
    let paginas: { id: string; name?: string; access_token?: string }[];
    try {
      paginas = await this.graph.listar(token, 'me/accounts', { fields: 'id,name,access_token', limit: 100 }, ctx, 10);
    } catch (e) {
      throw this.erroDeBusca(e);
    }
    const avisos: string[] = [];
    if (paginas.length === 0) {
      avisos.push('O token não enxerga nenhuma página. No Business Manager, dê ao usuário do sistema acesso às páginas que recebem os formulários.');
    }
    for (const p of paginas) {
      const nomePagina = p.name?.trim() || p.id;
      if (!p.access_token) {
        avisos.push(`Sem acesso aos formulários da página "${nomePagina}": dê ao usuário do sistema a permissão de gerenciar anúncios ou leads nela.`);
        continue;
      }
      const tokenPagina: TokenMeta = { valor: p.access_token, doNossoApp: token.doNossoApp };
      let formularios: { id: string; name?: string; status?: string; questions?: PerguntaGraph[] }[];
      try {
        formularios = await this.graph.listar(tokenPagina, `${p.id}/leadgen_forms`, { fields: 'id,name,status,questions', limit: 100 }, ctx, 5);
      } catch (e) {
        if (!(e instanceof ErroMeta)) throw e;
        this.logger.warn(`Formulários da página ${p.id} (conta ${contaId}): ${e.codigo} ${e.message}`);
        avisos.push(`Página "${nomePagina}": ${e instanceof PermissaoFaltando ? 'falta a permissão leads_retrieval no token' : e.message}`);
        continue;
      }
      const { cifrado, iv } = cifrar(p.access_token, this.config.chaveMestra);
      for (const f of formularios) {
        const dados = {
          nome: f.name?.trim() || f.id,
          status: f.status ?? null,
          paginaIdMeta: p.id,
          paginaNome: nomePagina,
          paginaTokenCifrado: new Uint8Array(cifrado),
          paginaTokenIv: new Uint8Array(iv),
          perguntas: rotulosDasPerguntas(f.questions),
        };
        await this.prisma.formularioMeta.upsert({
          where: { contaId_idMeta: { contaId, idMeta: f.id } },
          create: { contaId, idMeta: f.id, ...dados },
          // Token novo da página: o erro de leitura por token antigo some.
          update: { ...dados, ultimoErro: null },
        });
      }
    }
    return { ...(await this.listar(contaId)), avisos };
  }

  private erroDeBusca(e: unknown): unknown {
    if (e instanceof TokenInvalido) return new ErroApi(400, 'TOKEN_META_INVALIDO', 'O Meta recusou o token da conexão. Reconecte o Meta em Configurações.');
    if (e instanceof PermissaoFaltando) {
      return new ErroApi(400, 'PERMISSAO_META_FALTANDO', `O token não pode ler as páginas. Ele precisa das permissões ${PERMISSOES_FORMULARIO.join(', ')}. (${e.message})`);
    }
    if (e instanceof ErroMeta) return new ErroApi(502, e.codigo, `O Meta recusou a consulta: ${e.message}`);
    return e;
  }

  /**
   * Seleção e endereço da captura. Formulário que passa a ser lido começa agora: os leads de antes não
   * entram (não criam oportunidade velha no CRM).
   */
  async salvar(contaId: string, d: { formularios?: { id: string; selecionado: boolean }[]; capturaKentroUrl?: string | null }) {
    if (d.capturaKentroUrl !== undefined) {
      const url = d.capturaKentroUrl?.trim() || null;
      if (url && !CAPTURA_KENTRO.test(url)) {
        throw new ErroApi(400, 'CAPTURA_INVALIDA', 'Cole o endereço da captura de webhook da Kentro (https://…/webhookcapture/capture/…).');
      }
      await this.prisma.conta.update({ where: { id: contaId }, data: { capturaKentroUrl: url } });
    }
    if (d.formularios?.length) {
      const atuais = await this.prisma.formularioMeta.findMany({ where: { contaId, id: { in: d.formularios.map((f) => f.id) } } });
      if (atuais.length !== new Set(d.formularios.map((f) => f.id)).size) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Formulário não encontrado. Busque de novo.');
      const porId = new Map(atuais.map((f) => [f.id, f]));
      const agora = new Date();
      await this.prisma.$transaction(
        d.formularios.map((s) => {
          const passaASerLido = s.selecionado && !porId.get(s.id)!.selecionado;
          return this.prisma.formularioMeta.update({
            where: { id: s.id },
            data: { selecionado: s.selecionado, ...(passaASerLido ? { lidoAte: agora, proximaLeituraEm: agora, ultimoErro: null } : {}) },
          });
        }),
      );
    }
    return this.listar(contaId);
  }

  /** Um ciclo da leitura: reserva os formulários vencidos (à prova de dois processos) e lê cada um. */
  async lerPendentes(agora = new Date()): Promise<number> {
    const t = instanteUtc(agora);
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE formularios_meta SET em_leitura_ate = ${instanteUtc(new Date(agora.getTime() + TRAVA_MIN * 60_000))}
      WHERE id IN (
        SELECT id FROM formularios_meta
        WHERE selecionado AND proxima_leitura_em <= ${t}
          AND (em_leitura_ate IS NULL OR em_leitura_ate < ${t})
        ORDER BY proxima_leitura_em
        LIMIT ${FORMULARIOS_POR_CICLO}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    for (const { id } of ids) await this.ler(await this.prisma.formularioMeta.findUniqueOrThrow({ where: { id } }), agora);
    return ids.length;
  }

  private async ler(f: FormularioMeta, agora: Date): Promise<void> {
    const proxima = (min: number) => new Date(agora.getTime() + min * 60_000);
    const conta = await this.prisma.conta.findUniqueOrThrow({ where: { id: f.contaId }, select: { status: true, capturaKentroUrl: true } });
    if (conta.status === 'bloqueada') {
      await this.prisma.formularioMeta.update({ where: { id: f.id }, data: { emLeituraAte: null, proximaLeituraEm: proxima(60) } });
      return;
    }
    const token: TokenMeta = {
      valor: decifrar(Buffer.from(f.paginaTokenCifrado), Buffer.from(f.paginaTokenIv), this.config.chaveMestra),
      doNossoApp: (await this.prisma.conexaoMeta.findUnique({ where: { contaId: f.contaId }, select: { tipo: true } }))?.tipo === 'login_empresa',
    };
    const desde = Math.floor((f.lidoAte ?? agora).getTime() / 1000) - SOBREPOSICAO_S;
    const formulario = { idMeta: f.idMeta, nome: f.nome, perguntas: f.perguntas as Record<string, string> };
    let lidoAte = f.lidoAte ?? agora;
    let novos = 0;
    try {
      for await (const l of this.graph.paginar<LeadGraph>(
        token,
        `${f.idMeta}/leads`,
        {
          fields: 'id,created_time,field_data,ad_id,adset_id,campaign_id',
          filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: desde }]),
          limit: 100,
        },
        { contaId: f.contaId, operacao: 'formulario-leads' },
        20,
      )) {
        const lido = lerLead(l, formulario);
        if (Number.isNaN(lido.criadoEm.getTime())) continue;
        if (await this.leads.registrarFormulario(f.contaId, lido, !!conta.capturaKentroUrl)) novos++;
        if (lido.criadoEm > lidoAte) lidoAte = lido.criadoEm;
      }
    } catch (e) {
      if (!(e instanceof ErroMeta)) {
        this.logger.error(e instanceof Error ? e.stack ?? e.message : String(e));
        await this.prisma.formularioMeta.update({ where: { id: f.id }, data: { emLeituraAte: null, proximaLeituraEm: proxima(10) } });
        return;
      }
      const espera = e instanceof LimiteMeta ? Math.max(INTERVALO_LEITURA_MIN, Math.ceil(e.esperarSegundos / 60)) : e instanceof TokenInvalido || e instanceof PermissaoFaltando ? 60 : 10;
      const mensagem =
        e instanceof TokenInvalido
          ? 'O Meta recusou o token da página. Clique em "Buscar formulários" para renovar.'
          : e instanceof PermissaoFaltando
            ? `Sem permissão para ler os leads (leads_retrieval): ${e.message}`
            : e.message;
      this.logger.warn(`Leitura do formulário ${f.idMeta} (conta ${f.contaId}): ${e.codigo} ${e.message}`);
      // O Meta entrega do mais novo para o mais antigo: parar no meio deixa leads mais antigos sem ler.
      // A próxima leitura parte do mesmo ponto; os já gravados não se repetem (leadgen_id único).
      await this.prisma.formularioMeta.update({ where: { id: f.id }, data: { emLeituraAte: null, proximaLeituraEm: proxima(espera), ultimoErro: mensagem.slice(0, 500) } });
      return;
    }
    await this.prisma.formularioMeta.update({
      where: { id: f.id },
      data: { emLeituraAte: null, proximaLeituraEm: proxima(INTERVALO_LEITURA_MIN), ultimaLeituraEm: agora, ultimoErro: null, lidoAte },
    });
    if (novos) this.logger.log(`Formulário ${f.idMeta} (conta ${f.contaId}): ${novos} lead(s) novo(s).`);
  }

  /** Um ciclo da fila da Kentro: reserva os leads pendentes vencidos e envia cada um à captura da conta. */
  async enviarPendentes(agora = new Date()): Promise<number> {
    const t = instanteUtc(agora);
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE leads SET kentro_em_envio_ate = ${instanteUtc(new Date(agora.getTime() + TRAVA_MIN * 60_000))}
      WHERE id IN (
        SELECT id FROM leads
        WHERE kentro_status = 'pendente' AND kentro_proxima_em <= ${t}
          AND (kentro_em_envio_ate IS NULL OR kentro_em_envio_ate < ${t})
        ORDER BY kentro_proxima_em
        LIMIT ${ENVIOS_POR_CICLO}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    for (const { id } of ids) await this.enviar(await this.prisma.lead.findUniqueOrThrow({ where: { id } }), agora);
    return ids.length;
  }

  private async enviar(lead: Lead, agora: Date): Promise<void> {
    const gravar = (dados: Prisma.LeadUpdateInput) => this.prisma.lead.update({ where: { id: lead.id }, data: { kentroEmEnvioAte: null, ...dados } });
    const conta = await this.prisma.conta.findUniqueOrThrow({ where: { id: lead.contaId }, select: { capturaKentroUrl: true, fuso: true } });
    if (!conta.capturaKentroUrl) {
      await gravar({ kentroStatus: 'descartado', kentroErro: 'O endereço da captura da Kentro foi removido.' });
      return;
    }
    const erro = await this.postar(conta.capturaKentroUrl, await this.payloadDoLead(lead, conta.fuso));
    if (!erro) {
      await gravar({ kentroStatus: 'enviado', kentroEnviadoEm: agora, kentroErro: null, kentroTentativas: { increment: 1 } });
      return;
    }
    const tentativas = lead.kentroTentativas + 1;
    if (tentativas <= ESPERAS_MIN.length) {
      await gravar({ kentroTentativas: tentativas, kentroProximaEm: new Date(agora.getTime() + ESPERAS_MIN[tentativas - 1] * 60_000), kentroErro: erro });
      return;
    }
    await gravar({ kentroStatus: 'erro', kentroTentativas: tentativas, kentroErro: erro });
  }

  /** Null quando a Kentro aceitou; senão o motivo (curto, para a tela). */
  private async postar(url: string, payload: PayloadKentro): Promise<string | null> {
    try {
      const resposta = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (resposta.ok) return null;
      return `A Kentro respondeu ${resposta.status}.`;
    } catch {
      return 'Não foi possível falar com a Kentro (rede ou tempo limite).';
    }
  }

  private async payloadDoLead(lead: Lead, fuso: string): Promise<PayloadKentro> {
    const contaId = lead.contaId;
    const [formulario, campanha, conjunto, anuncio] = await Promise.all([
      lead.formularioIdMeta ? this.prisma.formularioMeta.findUnique({ where: { contaId_idMeta: { contaId, idMeta: lead.formularioIdMeta } } }) : null,
      lead.campanhaIdMeta ? this.prisma.campanha.findFirst({ where: { contaId, idMeta: lead.campanhaIdMeta }, select: { nome: true } }) : null,
      lead.conjuntoIdMeta ? this.prisma.conjunto.findFirst({ where: { contaId, idMeta: lead.conjuntoIdMeta }, select: { nome: true } }) : null,
      lead.anuncioIdMeta ? this.prisma.anuncio.findFirst({ where: { contaId, idMeta: lead.anuncioIdMeta }, select: { nome: true } }) : null,
    ]);
    return montarPayloadKentro({
      leadId: lead.id,
      leadgenId: lead.leadgenId ?? '',
      nome: lead.nome,
      telefone: lead.telefone,
      email: lead.email,
      formulario: formulario?.nome ?? 'Formulário',
      formularioId: lead.formularioIdMeta ?? '',
      pagina: formulario?.paginaNome ?? '',
      campanha: campanha?.nome ?? null,
      conjunto: conjunto?.nome ?? null,
      anuncio: anuncio?.nome ?? null,
      recebidoEm: lead.recebidoEm,
      fuso,
      respostas: lead.respostas as { chave?: string; pergunta: string; resposta: string }[],
    });
  }

  /** Lead de exemplo direto na captura: confere o endereço e a automação sem esperar um lead de verdade. */
  async testarEnvio(contaId: string, url?: string) {
    const conta = await this.prisma.conta.findUniqueOrThrow({ where: { id: contaId }, select: { capturaKentroUrl: true, fuso: true } });
    const destino = url?.trim() || conta.capturaKentroUrl;
    if (!destino) throw new ErroApi(400, 'CAPTURA_OBRIGATORIA', 'Cole o endereço da captura da Kentro.');
    if (!CAPTURA_KENTRO.test(destino)) throw new ErroApi(400, 'CAPTURA_INVALIDA', 'Cole o endereço da captura de webhook da Kentro (https://…/webhookcapture/capture/…).');
    const payload = montarPayloadKentro({
      evento: 'teste',
      leadId: 'teste',
      leadgenId: 'teste',
      nome: 'Lead de teste (Kentro Track)',
      telefone: '5511999990000',
      email: 'teste@exemplo.com.br',
      formulario: 'Formulário de teste',
      formularioId: 'teste',
      pagina: 'Página de teste',
      campanha: 'Campanha de teste',
      conjunto: 'Conjunto de teste',
      anuncio: 'Anúncio de teste',
      recebidoEm: new Date(),
      fuso: conta.fuso,
      respostas: [
        { chave: 'qual_o_melhor_horario', pergunta: 'Qual o melhor horário para contato?', resposta: 'Manhã' },
        { chave: 'city', pergunta: 'Cidade', resposta: 'São Paulo' },
      ],
    });
    const erro = await this.postar(destino, payload);
    if (erro) throw new ErroApi(502, 'KENTRO_RECUSOU', erro);
    return { ok: true, payload };
  }

  /** Volta o envio para a fila (depois de corrigir a automação ou o endereço). */
  async reenviar(contaId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, contaId, origem: 'formulario' } });
    if (!lead) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Lead não encontrado.');
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { kentroStatus: 'pendente', kentroTentativas: 0, kentroProximaEm: new Date(), kentroEmEnvioAte: null, kentroErro: null },
    });
    return this.listar(contaId);
  }
}
