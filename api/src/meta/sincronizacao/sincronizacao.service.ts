import { Inject, Injectable, Logger } from '@nestjs/common';
import { ContaAnuncio, Prisma } from '@prisma/client';
import { comoData, comoDia, diaNoFuso, diasEntre, proximaHoraLocal, somarDias } from '../../comum/datas';
import { ESPERAR, Esperar } from '../../comum/fetch';
import { instanteUtc } from '../../comum/sql';
import { PrismaService } from '../../comum/prisma.service';
import { ClienteGraph, TokenMeta } from '../cliente/graph';
import { ErroMeta, LimiteMeta, RecusadoPeloMeta, TokenInvalido } from '../cliente/erros';
import { ConexaoService } from '../conexao/conexao.service';
import { CAMPOS_INSIGHTS, LinhaInsight, normalizarInsight } from './insights';

const MIN = 60_000;
export const DIAS_CARGA = 90;
/**
 * A carga inicial vai em blocos (do mais recente para trás) com o progresso gravado: um bloqueio
 * do Meta no meio não joga fora o que já veio, e cada bloco cabe na consulta síncrona.
 */
export const BLOCO_CARGA_DIAS = 3;
/**
 * Números por anúncio e por dia: o Meta demora a montar, cresce com o número de anúncios e o
 * de dias. Consultas de poucos dias, com tempo de sobra, em vez de um relatório grande.
 */
const DIAS_POR_CONSULTA = 3;
const TEMPO_INSIGHTS_MS = 120_000;
/** Ids que faltam por lote na consulta por ids (o Meta aceita até 50). */
const IDS_POR_CONSULTA = 50;
const MAX_IDS_FALTANDO = 500;
/** O Meta recalcula a atribuição dos últimos dias: o recálculo diário relê esta janela. */
export const DIAS_RECALCULO = 7;
const TRAVA_MIN = 20;
const ESPERA_APOS_ERRO_MIN = 15;
const INTERVALO_HORARIA_MIN = 60;
const INTERVALO_ENTIDADES_MIN = 6 * 60;
const HORA_RECALCULO = 4;

/** Uso da API (o pior dos cabeçalhos do Meta) a partir do qual a conta para antes de levar o bloqueio. */
export const USO_ALTO_PCT = 75;
/** Dentro de uma leitura longa, para ao passar disto (o Meta bloqueia em 100%). */
const USO_PARAR_PCT = 85;
const PAUSA_USO_ALTO_MIN = 10;
const JANELA_USO_MIN = 5;

export const MENSAGEM_LIMITE =
  'O Meta limitou as consultas a esta conta de anúncio por excesso de chamadas. O Kentro Track espera o tempo pedido e tenta de novo sozinho.';

/**
 * A listagem traz só o que está no ar: numa conta antiga, pausados e arquivados são milhares e
 * estouram o limite do Meta. Os que aparecem nos números do período vêm depois, pelos ids.
 */
const ATIVOS = ['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES'];
const ATIVOS_ANUNCIO = [...ATIVOS, 'PENDING_REVIEW', 'PREAPPROVED'];
const soAtivos = (status: string[]) => JSON.stringify([{ field: 'effective_status', operator: 'IN', value: status }]);

interface EntidadeGraph {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
  adset_id?: string;
  creative?: {
    id?: string;
    title?: string;
    body?: string;
    image_url?: string;
    thumbnail_url?: string;
    object_story_id?: string;
    effective_object_story_id?: string;
    instagram_permalink_url?: string;
  };
}

/** Orçamento vem em centavos (unidade mínima da moeda da conta). */
function orcamento(v: string | undefined): Prisma.Decimal | null {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? new Prisma.Decimal((n / 100).toFixed(2)) : null;
}

const texto = (v: string | undefined, max: number) => (v?.trim() ? v.trim().slice(0, max) : null);

export type Tarefa = 'entidades' | 'carga' | 'horaria' | 'recalculo';
type FaseEntidades = 'campanhas' | 'conjuntos' | 'anuncios';
/** Teto de páginas por fase numa rodada: conta gigante continua na próxima. */
const MAX_PAGINAS_ENTIDADES = 100;

/** Quais tarefas a conta de anúncio deve rodar agora. */
export function tarefasDevidas(c: ContaAnuncio, agora: Date): Tarefa[] {
  const venceu = (d: Date | null) => !d || d <= agora;
  const tarefas: Tarefa[] = [];
  // Os números vêm antes da lista de campanhas e anúncios: são o que o painel precisa, e a lista
  // (pesada em conta com muitos anúncios) não pode segurá-los se o Meta bloquear no meio dela.
  if (!c.cargaConcluidaEm) {
    if (venceu(c.proximaHorariaEm)) tarefas.push('carga');
  } else if (venceu(c.proximoRecalculoEm)) tarefas.push('recalculo');
  else if (venceu(c.proximaHorariaEm)) tarefas.push('horaria');
  if (venceu(c.proximaEntidadesEm)) tarefas.push('entidades');
  return tarefas;
}

@Injectable()
export class SincronizacaoService {
  private readonly logger = new Logger('Sincronizacao');

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: ClienteGraph,
    private readonly conexao: ConexaoService,
    @Inject(ESPERAR) private readonly esperar: Esperar,
  ) {}

  /**
   * Reserva uma conta de anúncio com tarefa vencida (trava por tempo, à prova de dois processos)
   * e roda as tarefas dela. Devolve false quando não havia nada a fazer.
   */
  async executarProxima(agora = new Date()): Promise<boolean> {
    const t = instanteUtc(agora);
    const linhas = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE contas_anuncio SET em_execucao_ate = ${instanteUtc(new Date(agora.getTime() + TRAVA_MIN * MIN))}
      WHERE id = (
        SELECT ca.id FROM contas_anuncio ca
        JOIN conexoes_meta cm ON cm.conta_id = ca.conta_id AND cm.status = 'ativa'
        JOIN contas c ON c.id = ca.conta_id AND c.status <> 'bloqueada'
        WHERE ca.selecionada
          AND (ca.em_execucao_ate IS NULL OR ca.em_execucao_ate < ${t})
          AND (ca.proxima_entidades_em IS NULL OR ca.proxima_entidades_em <= ${t}
               OR ca.proxima_horaria_em IS NULL OR ca.proxima_horaria_em <= ${t}
               OR (ca.carga_concluida_em IS NOT NULL AND (ca.proximo_recalculo_em IS NULL OR ca.proximo_recalculo_em <= ${t})))
        ORDER BY ca.carga_concluida_em NULLS FIRST, ca.proxima_horaria_em NULLS FIRST
        LIMIT 1
        FOR UPDATE OF ca SKIP LOCKED
      )
      RETURNING id`;
    if (linhas.length === 0) return false;
    const conta = await this.prisma.contaAnuncio.findUniqueOrThrow({ where: { id: linhas[0].id } });
    await this.executar(conta, agora);
    return true;
  }

  async executar(conta: ContaAnuncio, agora = new Date()): Promise<void> {
    const tarefas = tarefasDevidas(conta, agora);
    const dados: Prisma.ContaAnuncioUpdateInput = { emExecucaoAte: null };
    // O que já terminou nesta rodada não volta para a fila quando a seguinte falha.
    const feitas = new Set<Tarefa>();
    const adiarPendentes = (ate: Date) => {
      dados.proximaHorariaEm = ate;
      if (tarefas.includes('entidades') && !feitas.has('entidades')) dados.proximaEntidadesEm = ate;
      if (tarefas.includes('recalculo') && !feitas.has('recalculo')) dados.proximoRecalculoEm = ate;
    };
    const adiar = (ate: Date) => {
      dados.limitadaAte = ate;
      adiarPendentes(ate);
    };
    try {
      // Uso perto do teto nas últimas chamadas: espera antes de levar o bloqueio do Meta.
      const pausa = await this.pausaPorUsoAlto(conta.contaId);
      if (pausa) {
        adiar(new Date(agora.getTime() + pausa * 1000));
        return;
      }
      const token = await this.conexao.token(conta.contaId);
      if (!token) return;
      const hoje = diaNoFuso(agora, conta.fuso);
      for (const tarefa of tarefas) {
        if (tarefa === 'entidades') {
          await this.sincronizarEntidades(conta, token);
          dados.proximaEntidadesEm = new Date(agora.getTime() + INTERVALO_ENTIDADES_MIN * MIN);
        } else if (tarefa === 'carga') {
          const primeiro = somarDias(hoje, -(DIAS_CARGA - 1));
          const ate = conta.cargaDesde ? somarDias(comoDia(conta.cargaDesde), -1) : hoje;
          if (ate >= primeiro) {
            const de = [primeiro, somarDias(ate, -(BLOCO_CARGA_DIAS - 1))].sort().at(-1)!;
            await this.sincronizarInsights(conta, token, de, ate);
            dados.cargaDesde = comoData(de);
          }
          if (ate < primeiro || (dados.cargaDesde as Date) <= comoData(primeiro)) {
            dados.cargaConcluidaEm = agora;
            dados.proximaHorariaEm = new Date(agora.getTime() + INTERVALO_HORARIA_MIN * MIN);
            dados.proximoRecalculoEm = proximaHoraLocal(agora, conta.fuso, HORA_RECALCULO);
          } else {
            // Próximo bloco já na rodada seguinte; o freio de uso alto segura se o Meta reclamar.
            dados.proximaHorariaEm = agora;
          }
        } else if (tarefa === 'recalculo') {
          await this.sincronizarInsights(conta, token, somarDias(hoje, -(DIAS_RECALCULO - 1)), hoje);
          dados.proximoRecalculoEm = proximaHoraLocal(agora, conta.fuso, HORA_RECALCULO);
          dados.proximaHorariaEm = new Date(agora.getTime() + INTERVALO_HORARIA_MIN * MIN);
        } else {
          await this.sincronizarInsights(conta, token, somarDias(hoje, -1), hoje);
          dados.proximaHorariaEm = new Date(agora.getTime() + INTERVALO_HORARIA_MIN * MIN);
        }
        feitas.add(tarefa);
      }
      dados.ultimaSincronizacaoEm = agora;
      dados.ultimoErro = null;
      dados.limitadaAte = null;
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      dados.ultimoErro = (erro instanceof LimiteMeta ? MENSAGEM_LIMITE : mensagem).slice(0, 500);
      if (erro instanceof TokenInvalido) {
        await this.conexao.marcarReconectar(conta.contaId, mensagem);
      } else if (erro instanceof LimiteMeta) {
        adiar(new Date(agora.getTime() + Math.max(ESPERA_APOS_ERRO_MIN, Math.ceil(erro.esperarSegundos / 60)) * MIN));
      } else {
        adiarPendentes(new Date(agora.getTime() + ESPERA_APOS_ERRO_MIN * MIN));
      }
      if (!(erro instanceof ErroMeta)) this.logger.error(erro instanceof Error ? erro.stack ?? mensagem : mensagem);
    } finally {
      await this.prisma.contaAnuncio.update({ where: { id: conta.id }, data: dados });
    }
  }

  /**
   * Segundos de pausa se a última chamada dos últimos minutos veio com o uso da API acima de
   * USO_ALTO_PCT (o registro da aba Saúde guarda o pior dos cabeçalhos de uso do Meta).
   */
  private async pausaPorUsoAlto(contaId: string): Promise<number | null> {
    const ultima = await this.prisma.chamadaMeta.findFirst({
      where: { contaId, em: { gte: new Date(Date.now() - JANELA_USO_MIN * MIN) }, uso: { not: Prisma.DbNull } },
      orderBy: { em: 'desc' },
    });
    const uso = ultima?.uso as { pct?: number; liberaEmSegundos?: number } | null | undefined;
    if (!uso || (uso.pct ?? 0) < USO_ALTO_PCT) return null;
    return Math.max(PAUSA_USO_ALTO_MIN * 60, Math.ceil(uso.liberaEmSegundos ?? 0));
  }

  /**
   * Campanhas, conjuntos e anúncios, página a página. Cada página é gravada assim que chega e o ponto
   * onde a leitura está fica na conta: um bloqueio do Meta no meio não joga fora o que veio, e a
   * próxima rodada continua dali. Com o uso da API perto do teto, para antes de levar o bloqueio.
   */
  async sincronizarEntidades(conta: ContaAnuncio, token: TokenMeta): Promise<void> {
    try {
      await this.lerEntidades(conta, token);
    } catch (erro) {
      // Cursor guardado que o Meta não aceita mais (venceu): a próxima leitura recomeça do início.
      if (erro instanceof RecusadoPeloMeta && conta.entidadesCursor) {
        await this.prisma.contaAnuncio.update({ where: { id: conta.id }, data: { entidadesCursor: Prisma.DbNull } });
      }
      throw erro;
    }
  }

  private async lerEntidades(conta: ContaAnuncio, token: TokenMeta): Promise<void> {
    const base = { contaId: conta.contaId, contaAnuncioId: conta.id };
    const fases: { fase: FaseEntidades; caminho: string; params: Record<string, string | number>; gravar: (itens: EntidadeGraph[]) => Prisma.PrismaPromise<unknown>[] }[] = [
      {
        fase: 'campanhas',
        caminho: `${conta.idMeta}/campaigns`,
        params: { fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget', filtering: soAtivos(ATIVOS), limit: 500 },
        gravar: (itens) =>
          itens.map((c) => {
            const d = {
              nome: texto(c.name, 300) ?? c.id,
              status: c.status ?? null,
              statusEfetivo: c.effective_status ?? null,
              objetivo: c.objective ?? null,
              orcamentoDiario: orcamento(c.daily_budget),
              orcamentoTotal: orcamento(c.lifetime_budget),
            };
            return this.prisma.campanha.upsert({
              where: { contaAnuncioId_idMeta: { contaAnuncioId: conta.id, idMeta: c.id } },
              create: { ...base, idMeta: c.id, ...d },
              update: d,
            });
          }),
      },
      {
        fase: 'conjuntos',
        caminho: `${conta.idMeta}/adsets`,
        params: { fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget', filtering: soAtivos(ATIVOS), limit: 500 },
        gravar: (itens) =>
          itens.map((c) => {
            const d = {
              nome: texto(c.name, 300) ?? c.id,
              campanhaIdMeta: String(c.campaign_id ?? ''),
              status: c.status ?? null,
              statusEfetivo: c.effective_status ?? null,
              orcamentoDiario: orcamento(c.daily_budget),
              orcamentoTotal: orcamento(c.lifetime_budget),
            };
            return this.prisma.conjunto.upsert({
              where: { contaAnuncioId_idMeta: { contaAnuncioId: conta.id, idMeta: c.id } },
              create: { ...base, idMeta: c.id, ...d },
              update: d,
            });
          }),
      },
      {
        fase: 'anuncios',
        caminho: `${conta.idMeta}/ads`,
        params: {
          fields:
            'id,name,adset_id,campaign_id,status,effective_status,creative{id,title,body,image_url,thumbnail_url,object_story_id,effective_object_story_id,instagram_permalink_url}',
          thumbnail_width: 320,
          thumbnail_height: 320,
          filtering: soAtivos(ATIVOS_ANUNCIO),
          limit: 200,
        },
        gravar: (itens) =>
          itens.map((a) => {
            const criativo = a.creative ?? {};
            const d = {
              nome: texto(a.name, 300) ?? a.id,
              conjuntoIdMeta: String(a.adset_id ?? ''),
              campanhaIdMeta: String(a.campaign_id ?? ''),
              status: a.status ?? null,
              statusEfetivo: a.effective_status ?? null,
              criativoIdMeta: criativo.id ?? null,
              miniaturaUrl: criativo.image_url || criativo.thumbnail_url || null,
              titulo: texto(criativo.title, 300),
              texto: texto(criativo.body, 2000),
              objectStoryId: criativo.effective_object_story_id || criativo.object_story_id || null,
              permalink: criativo.instagram_permalink_url ?? null,
            };
            return this.prisma.anuncio.upsert({
              where: { contaAnuncioId_idMeta: { contaAnuncioId: conta.id, idMeta: a.id } },
              create: { ...base, idMeta: a.id, ...d },
              update: d,
            });
          }),
      },
    ];

    const salvo = conta.entidadesCursor as { fase?: FaseEntidades; after?: string | null; desde?: string } | null;
    const inicio = Math.max(0, fases.findIndex((f) => f.fase === salvo?.fase));
    let after = salvo?.fase ? salvo.after ?? undefined : undefined;
    // Quando a leitura completa começou (ela pode levar várias rodadas): o que não foi visto desde então saiu do ar.
    const desde = salvo?.desde ?? new Date().toISOString();
    for (let i = inicio; i < fases.length; i++) {
      const { fase, caminho, params, gravar } = fases[i];
      for (let pagina = 0; pagina < MAX_PAGINAS_ENTIDADES; pagina++) {
        const { dados, uso } = await this.graph.getComUso<{ data?: EntidadeGraph[]; paging?: { next?: string; cursors?: { after?: string } } }>(
          token,
          caminho,
          after ? { ...params, after } : params,
          { contaId: conta.contaId, operacao: fase },
        );
        const itens = dados.data ?? [];
        for (let j = 0; j < itens.length; j += 200) await this.prisma.$transaction(gravar(itens.slice(j, j + 200)));
        after = dados.paging?.next ? dados.paging.cursors?.after : undefined;
        // Onde continuar se a rodada parar aqui (null: a leitura terminou).
        const proxima = after ? { fase, after, desde } : fases[i + 1] ? { fase: fases[i + 1].fase, after: null, desde } : null;
        await this.prisma.contaAnuncio.update({ where: { id: conta.id }, data: { entidadesCursor: proxima ?? Prisma.DbNull } });
        if (!after) break;
        if (uso && uso.pct >= USO_PARAR_PCT) {
          throw new LimiteMeta(Math.max(PAUSA_USO_ALTO_MIN * 60, Math.ceil(uso.liberaEmSegundos)), 'Uso da API do Meta perto do limite: a leitura pausou antes do bloqueio.');
        }
      }
      after = undefined;
    }
    // Estava no ar e não veio na listagem de agora: foi pausado (ou arquivado). Sai do grupo das ativas.
    for (const tabela of ['campanhas', 'conjuntos', 'anuncios']) {
      await this.prisma.$executeRaw`
        UPDATE ${Prisma.raw(tabela)} SET status_efetivo = 'PAUSED'
        WHERE conta_anuncio_id = ${conta.id}::uuid AND status_efetivo = ANY(${ATIVOS_ANUNCIO}::text[])
          AND atualizado_em < ${instanteUtc(new Date(desde))}`;
    }
    await this.buscarFaltando(conta, token, fases);
  }

  /**
   * Campanhas, conjuntos e anúncios que aparecem nos números do período e não vieram na listagem
   * (arquivados): pelos ids, 50 por consulta, para o painel mostrar o nome em vez do número.
   */
  private async buscarFaltando(
    conta: ContaAnuncio,
    token: TokenMeta,
    fases: { fase: FaseEntidades; params: Record<string, string | number>; gravar: (itens: EntidadeGraph[]) => Prisma.PrismaPromise<unknown>[] }[],
  ): Promise<void> {
    const colunas: Record<FaseEntidades, { coluna: string; tabela: string }> = {
      campanhas: { coluna: 'campanha_id_meta', tabela: 'campanhas' },
      conjuntos: { coluna: 'conjunto_id_meta', tabela: 'conjuntos' },
      anuncios: { coluna: 'anuncio_id_meta', tabela: 'anuncios' },
    };
    for (const { fase, params, gravar } of fases) {
      const { coluna, tabela } = colunas[fase];
      const faltando = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT i.${Prisma.raw(coluna)} AS id FROM insights_diarios i
        WHERE i.conta_anuncio_id = ${conta.id}::uuid AND i.${Prisma.raw(coluna)} <> ''
          AND NOT EXISTS (SELECT 1 FROM ${Prisma.raw(tabela)} e WHERE e.conta_anuncio_id = i.conta_anuncio_id AND e.id_meta = i.${Prisma.raw(coluna)})
        LIMIT ${MAX_IDS_FALTANDO}`;
      const { filtering: _, limit: __, ...campos } = params;
      for (let i = 0; i < faltando.length; i += IDS_POR_CONSULTA) {
        const lote = faltando.slice(i, i + IDS_POR_CONSULTA).map((f) => f.id);
        const { dados, uso } = await this.graph.getComUso<Record<string, EntidadeGraph>>(token, '', { ...campos, ids: lote.join(',') }, { contaId: conta.contaId, operacao: `${fase}-por-id` });
        await this.prisma.$transaction(gravar(Object.values(dados).filter((e) => e && e.id)));
        if (uso && uso.pct >= USO_PARAR_PCT) {
          throw new LimiteMeta(Math.max(PAUSA_USO_ALTO_MIN * 60, Math.ceil(uso.liberaEmSegundos)), 'Uso da API do Meta perto do limite: a leitura pausou antes do bloqueio.');
        }
      }
    }
  }

  /** Relê o intervalo inteiro e substitui o que havia nele (o Meta omite dias sem entrega). */
  async sincronizarInsights(conta: ContaAnuncio, token: TokenMeta, de: string, ate: string): Promise<number> {
    let total = 0;
    for (let inicio = de; inicio <= ate; inicio = somarDias(inicio, DIAS_POR_CONSULTA)) {
      const fim = [ate, somarDias(inicio, DIAS_POR_CONSULTA - 1)].sort()[0];
      total += await this.insightsDoIntervalo(conta, token, inicio, fim);
    }
    return total;
  }

  private async insightsDoIntervalo(conta: ContaAnuncio, token: TokenMeta, de: string, ate: string): Promise<number> {
    const params = {
      level: 'ad',
      time_increment: 1,
      time_range: JSON.stringify({ since: de, until: ate }),
      fields: CAMPOS_INSIGHTS,
      limit: 250,
    };
    const linhas = await this.graph.listar<LinhaInsight>(
      token,
      `${conta.idMeta}/insights`,
      params,
      { contaId: conta.contaId, operacao: 'insights', tempoLimiteMs: TEMPO_INSIGHTS_MS },
      200,
    );
    const ids = { contaId: conta.contaId, contaAnuncioId: conta.id };
    const novas = linhas.filter((l) => l.ad_id && l.date_start).map((l) => normalizarInsight(l, ids));
    await this.prisma.$transaction(
      async (tx) => {
        await tx.insightDiario.deleteMany({ where: { contaAnuncioId: conta.id, data: { gte: comoData(de), lte: comoData(ate) } } });
        for (let i = 0; i < novas.length; i += 1000) await tx.insightDiario.createMany({ data: novas.slice(i, i + 1000) });
      },
      { timeout: 120_000 },
    );
    return novas.length;
  }
}
