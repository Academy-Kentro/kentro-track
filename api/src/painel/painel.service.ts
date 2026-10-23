import { Inject, Injectable } from '@nestjs/common';
import { ContaAnuncio, Prisma } from '@prisma/client';
import { assinar, conferirAssinatura } from '../comum/assinatura';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cadaDia, comoDia, diasEntre, ehDia, somarDias } from '../comum/datas';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { etapaPublica, EtapasService } from '../etapas/etapas.service';
import { mascararTelefone } from '../leads/telefone';
import { calcular, Metricas, Somas, somar, somasDe, ZERO } from './metricas';

export interface Filtro {
  de: string;
  ate: string;
  contaAnuncio?: string;
  campanha?: string;
}

const MAX_DIAS = 400;
const MAX_ANUNCIOS = 2000;
const MAX_CRIATIVOS = 60;
/** Leads sem atendente que a tela consulta na Kentro de uma vez. */
export const MAX_ATENDENTES_POR_VEZ = 100;

/** Leads conforme a definição de cada conta de anúncio (formulário, conversa, site). */
const SOMAS_SQL = Prisma.sql`
  SUM(i.investimento) AS investimento,
  SUM(i.impressoes) AS impressoes,
  SUM(i.cliques) AS cliques,
  SUM(i.cliques_link) AS cliques_link,
  SUM(CASE WHEN 'formulario' = ANY(ca.definicao_lead) THEN i.leads_formulario ELSE 0 END
    + CASE WHEN 'conversa' = ANY(ca.definicao_lead) THEN i.conversas ELSE 0 END
    + CASE WHEN 'site' = ANY(ca.definicao_lead) THEN i.leads_site ELSE 0 END) AS leads,
  SUM(i.conversas) AS conversas`;

/** O funil do atendimento: leads que chegaram por anúncio (orgânicos ficam fora do ROAS). */
const LEADS_SQL = Prisma.sql`
  COUNT(*) AS entradas,
  COUNT(l.qualificado_em) AS qualificados,
  COUNT(*) FILTER (WHERE l.etapa = 'venda') AS vendas,
  COALESCE(SUM(l.valor_venda) FILTER (WHERE l.etapa = 'venda'), 0) AS receita`;

interface Escopo {
  contas: ContaAnuncio[];
  moeda: string;
  onde: (de: string, ate: string) => Prisma.Sql;
  /** Leads pelo dia em que chegaram, no fuso da conta (recebido_em é timestamp UTC sem fuso). */
  ondeLeads: (de: string, ate: string, incluirOrganicos?: boolean) => Prisma.Sql;
  /** Os mesmos filtros de conta, conta de anúncio e campanha, sem a data (para datar por outra coluna). */
  filtroLeads: (incluirOrganicos?: boolean) => Prisma.Sql;
  /** Instante de uma coluna de leads como hora local da conta (timestamp sem fuso). */
  horaLocal: (coluna: 'recebido_em' | 'venda_em' | 'atendido_em') => Prisma.Sql;
  fuso: string;
}

interface LinhaLead {
  id: string;
  origem: string;
  etapa: string;
  etapa_id: string | null;
  nome: string | null;
  telefone: string | null;
  chat_id: string | null;
  recebido_em: Date;
  atendido_em: Date | null;
  atendente_nome: string | null;
  valor_venda: unknown;
  vinculo_anuncio: string | null;
  campanha: string | null;
  anuncio: string | null;
}

export interface NoCampanha {
  idMeta: string;
  nome: string;
  status: string | null;
  metricas: Metricas;
}

@Injectable()
export class PainelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly etapas: EtapasService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /**
   * Quantos leads (do filtro) cada etapa visível tem. Andamento e venda: chegaram até ela ou além (o
   * lead marcado direto como venda conta nas anteriores). Perda: estão nela agora.
   */
  private async contarPorEtapa(contaId: string, ondeLeads: Prisma.Sql, porAtendente: boolean) {
    const linhas = await this.prisma.$queryRaw<{ atendente_id: string; etapa_id: string; n: bigint }[]>`
      SELECT ${porAtendente ? Prisma.sql`COALESCE(l.atendente_id, '')` : Prisma.sql`''`} AS atendente_id, e.id::text AS etapa_id, COUNT(*) AS n
      FROM leads l JOIN etapas_funil e ON e.conta_id = l.conta_id
      WHERE ${ondeLeads} AND e.conta_id = ${contaId}::uuid AND e.ativa AND e.no_painel
        AND ((e.tipo = 'perda' AND l.etapa_id = e.id)
             OR (e.tipo <> 'perda' AND EXISTS (
                   SELECT 1 FROM etapas_funil a
                   WHERE a.id = ANY(l.etapas_alcancadas) AND a.tipo <> 'perda' AND a.ordem >= e.ordem)))
      GROUP BY 1, 2`;
    return linhas.map((l) => ({ atendenteId: l.atendente_id, etapaId: l.etapa_id, n: Number(l.n) }));
  }

  /** As etapas que entram nos painéis (ativas e marcadas para aparecer), na ordem do funil. */
  private async etapasDoPainel(contaId: string) {
    return (await this.etapas.listar(contaId)).filter((e) => e.ativa && e.noPainel).map(etapaPublica);
  }

  validar(filtro: Filtro): void {
    if (!ehDia(filtro.de) || !ehDia(filtro.ate) || filtro.de > filtro.ate) {
      throw new ErroApi(400, 'PERIODO_INVALIDO', 'Período inválido: use datas AAAA-MM-DD com o início antes do fim.');
    }
    if (diasEntre(filtro.de, filtro.ate) > MAX_DIAS) throw new ErroApi(400, 'PERIODO_INVALIDO', `O período pode ter no máximo ${MAX_DIAS} dias.`);
  }

  /**
   * Contas de anúncio do filtro (só as selecionadas) e a cláusula WHERE comum.
   * Os dias vão como texto: um Date viraria timestamptz e o ::date dependeria do fuso da sessão do Postgres.
   */
  async escopo(contaId: string, filtro: Filtro): Promise<Escopo> {
    this.validar(filtro);
    const contas = await this.prisma.contaAnuncio.findMany({
      where: { contaId, selecionada: true, ...(filtro.contaAnuncio ? { id: filtro.contaAnuncio } : {}) },
      orderBy: { nome: 'asc' },
    });
    if (filtro.contaAnuncio && contas.length === 0) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Conta de anúncio não encontrada ou não selecionada.');
    const moedas = [...new Set(contas.map((c) => c.moeda))];
    if (moedas.length > 1) {
      throw new ErroApi(400, 'MOEDAS_DIFERENTES', 'As contas de anúncio usam moedas diferentes. Escolha uma conta de anúncio no filtro.');
    }
    const ids = contas.map((c) => c.id);
    const onde = (de: string, ate: string) => Prisma.sql`
      i.conta_id = ${contaId}::uuid
      AND i.conta_anuncio_id = ANY(${ids}::uuid[])
      AND i.data BETWEEN ${de}::date AND ${ate}::date
      ${filtro.campanha ? Prisma.sql`AND i.campanha_id_meta = ${filtro.campanha}` : Prisma.empty}`;
    const { fuso } = await this.prisma.conta.findUniqueOrThrow({ where: { id: contaId }, select: { fuso: true } });
    const horaLocal = (coluna: 'recebido_em' | 'venda_em' | 'atendido_em') => Prisma.sql`((${Prisma.raw(`l.${coluna}`)} AT TIME ZONE 'UTC') AT TIME ZONE ${fuso})`;
    const filtroLeads = (incluirOrganicos = false) => Prisma.sql`
      l.conta_id = ${contaId}::uuid
      ${incluirOrganicos ? Prisma.empty : Prisma.sql`AND l.origem <> 'organico'`}
      ${filtro.contaAnuncio ? Prisma.sql`AND l.conta_anuncio_id = ${filtro.contaAnuncio}::uuid` : Prisma.empty}
      ${filtro.campanha ? Prisma.sql`AND l.campanha_id_meta = ${filtro.campanha}` : Prisma.empty}`;
    const ondeLeads = (de: string, ate: string, incluirOrganicos = false) => Prisma.sql`
      ${filtroLeads(incluirOrganicos)}
      AND ${horaLocal('recebido_em')}::date BETWEEN ${de}::date AND ${ate}::date`;
    return { contas, moeda: moedas[0] ?? 'BRL', onde, ondeLeads, filtroLeads, horaLocal, fuso };
  }

  private situacao(contas: ContaAnuncio[]) {
    const datas = contas.map((c) => c.ultimaSincronizacaoEm).filter((d): d is Date => !!d);
    return {
      contasAnuncio: contas.length,
      // Algum dado ainda chegando: a tela mostra "carregando os últimos 90 dias".
      cargaPendente: contas.some((c) => !c.cargaConcluidaEm),
      sincronizadoEm: datas.length ? new Date(Math.min(...datas.map((d) => d.getTime()))) : null,
    };
  }

  async visaoGeral(contaId: string, filtro: Filtro) {
    const { contas, moeda, onde, ondeLeads } = await this.escopo(contaId, filtro);
    const [etapas, porEtapa] = await Promise.all([this.etapasDoPainel(contaId), this.contarPorEtapa(contaId, ondeLeads(filtro.de, filtro.ate), false)]);
    const dias = diasEntre(filtro.de, filtro.ate);
    const anterior = { de: somarDias(filtro.de, -dias), ate: somarDias(filtro.de, -1) };

    const [porDia, [doAnterior], [leadsAtual], [leadsAnterior], [organicos]] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT i.data, ${SOMAS_SQL}
        FROM insights_diarios i JOIN contas_anuncio ca ON ca.id = i.conta_anuncio_id
        WHERE ${onde(filtro.de, filtro.ate)}
        GROUP BY i.data`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${SOMAS_SQL}
        FROM insights_diarios i JOIN contas_anuncio ca ON ca.id = i.conta_anuncio_id
        WHERE ${onde(anterior.de, anterior.ate)}`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`SELECT ${LEADS_SQL} FROM leads l WHERE ${ondeLeads(filtro.de, filtro.ate)}`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`SELECT ${LEADS_SQL} FROM leads l WHERE ${ondeLeads(anterior.de, anterior.ate)}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM leads l WHERE ${ondeLeads(filtro.de, filtro.ate, true)} AND l.origem = 'organico'`,
    ]);

    const mapa = new Map(porDia.map((l) => [comoDia(l.data as Date), somasDe(l)]));
    // Dia sem entrega vem zerado: o gráfico não pula dias.
    const serie = cadaDia(filtro.de, filtro.ate).map((dia) => ({ data: dia, ...(mapa.get(dia) ?? ZERO) }));
    const totais = somar(serie.reduce<Somas>((acc, d) => somar(acc, d), { ...ZERO }), somasDe(leadsAtual));
    const somasAnteriores = somar(somasDe(doAnterior), somasDe(leadsAnterior));
    const semDadosAnteriores = somasAnteriores.impressoes === 0 && somasAnteriores.investimento === 0 && somasAnteriores.entradas === 0;

    return {
      moeda,
      periodo: { de: filtro.de, ate: filtro.ate },
      anterior: semDadosAnteriores ? null : { ...anterior, metricas: calcular(somasAnteriores) },
      metricas: calcular(totais),
      /** Atendimentos sem anúncio no período: fora do funil e do ROAS, mas o gestor vê o volume. */
      organicos: Number(organicos?.n ?? 0),
      serie: serie.map(({ data, investimento, leads, conversas, impressoes, cliquesLink }) => ({ data, investimento, leads, conversas, impressoes, cliquesLink })),
      /** O funil do atendimento nas etapas da conta (as de perda ficam de fora: não são um passo). */
      funil: etapas
        .filter((e) => e.tipo !== 'perda')
        .map((e) => ({ id: e.id, nome: e.nome, tipo: e.tipo, leads: porEtapa.find((p) => p.etapaId === e.id)?.n ?? 0 })),
      ...this.situacao(contas),
    };
  }

  /** Por anúncio no período, já com os nomes (entidade ainda não sincronizada mostra o id). */
  private async porAnuncio(contaId: string, filtro: Filtro) {
    const escopo = await this.escopo(contaId, filtro);
    const linhas = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT i.conta_anuncio_id, i.campanha_id_meta, i.conjunto_id_meta, i.anuncio_id_meta, ${SOMAS_SQL}
      FROM insights_diarios i JOIN contas_anuncio ca ON ca.id = i.conta_anuncio_id
      WHERE ${escopo.onde(filtro.de, filtro.ate)}
      GROUP BY 1, 2, 3, 4
      ORDER BY SUM(i.investimento) DESC
      LIMIT ${MAX_ANUNCIOS}`;
    // Funil por anúncio: só leads com o anúncio identificado entram na árvore.
    const leads = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT l.conta_anuncio_id, l.campanha_id_meta, l.conjunto_id_meta, l.anuncio_id_meta, ${LEADS_SQL}
      FROM leads l
      WHERE ${escopo.ondeLeads(filtro.de, filtro.ate)}
        AND l.conta_anuncio_id = ANY(${escopo.contas.map((c) => c.id)}::uuid[]) AND l.anuncio_id_meta IS NOT NULL
      GROUP BY 1, 2, 3, 4`;
    return { escopo, linhas, leads };
  }

  async campanhas(contaId: string, filtro: Filtro) {
    const { escopo, linhas, leads } = await this.porAnuncio(contaId, filtro);
    const contaIds = escopo.contas.map((c) => c.id);
    const [campanhas, conjuntos, anuncios] = await Promise.all([
      this.prisma.campanha.findMany({ where: { contaId, contaAnuncioId: { in: contaIds } } }),
      this.prisma.conjunto.findMany({ where: { contaId, contaAnuncioId: { in: contaIds } } }),
      this.prisma.anuncio.findMany({ where: { contaId, contaAnuncioId: { in: contaIds } } }),
    ]);
    const chave = (contaAnuncioId: unknown, idMeta: unknown) => `${contaAnuncioId}|${idMeta}`;
    const nomes = new Map<string, { nome: string; status: string | null }>();
    for (const e of [...campanhas, ...conjuntos, ...anuncios]) nomes.set(chave(e.contaAnuncioId, e.idMeta), { nome: e.nome, status: e.statusEfetivo });

    type No = { idMeta: string; somas: Somas; filhos: Map<string, No>; contaAnuncioId: string };
    const raiz = new Map<string, No>();
    const pegar = (mapa: Map<string, No>, contaAnuncioId: string, idMeta: string): No => {
      const k = chave(contaAnuncioId, idMeta);
      let no = mapa.get(k);
      if (!no) mapa.set(k, (no = { idMeta, somas: { ...ZERO }, filhos: new Map(), contaAnuncioId }));
      return no;
    };
    // Métricas do Meta e funil do atendimento entram na mesma árvore: um anúncio com venda e sem
    // investimento no período (a venda veio de um clique antigo) também aparece.
    for (const l of [...linhas, ...leads]) {
      const ca = String(l.conta_anuncio_id);
      const s = somasDe(l);
      const campanha = pegar(raiz, ca, String(l.campanha_id_meta));
      const conjunto = pegar(campanha.filhos, ca, String(l.conjunto_id_meta));
      const anuncio = pegar(conjunto.filhos, ca, String(l.anuncio_id_meta));
      for (const no of [campanha, conjunto, anuncio]) no.somas = somar(no.somas, s);
    }
    const montar = (no: No): NoCampanha => {
      const info = nomes.get(chave(no.contaAnuncioId, no.idMeta));
      return { idMeta: no.idMeta, nome: info?.nome ?? `#${no.idMeta}`, status: info?.status ?? null, metricas: calcular(no.somas) };
    };
    const ordenar = <T extends { metricas: Metricas }>(lista: T[]) => lista.sort((a, b) => b.metricas.investimento - a.metricas.investimento);

    return {
      moeda: escopo.moeda,
      periodo: { de: filtro.de, ate: filtro.ate },
      campanhas: ordenar(
        [...raiz.values()].map((c) => ({
          ...montar(c),
          conjuntos: ordenar([...c.filhos.values()].map((j) => ({ ...montar(j), anuncios: ordenar([...j.filhos.values()].map(montar)) }))),
        })),
      ),
      ...this.situacao(escopo.contas),
    };
  }

  async criativos(contaId: string, filtro: Filtro) {
    const { escopo, linhas, leads } = await this.porAnuncio(contaId, filtro);
    const top = linhas.slice(0, MAX_CRIATIVOS);
    const funil = new Map(leads.map((l) => [`${l.conta_anuncio_id}|${l.anuncio_id_meta}`, somasDe(l)]));
    const anuncios = await this.prisma.anuncio.findMany({
      where: { contaId, OR: top.map((l) => ({ contaAnuncioId: String(l.conta_anuncio_id), idMeta: String(l.anuncio_id_meta) })) },
    });
    const campanhas = await this.prisma.campanha.findMany({
      where: { contaId, idMeta: { in: [...new Set(top.map((l) => String(l.campanha_id_meta)))] } },
      select: { idMeta: true, nome: true },
    });
    const porChave = new Map(anuncios.map((a) => [`${a.contaAnuncioId}|${a.idMeta}`, a]));
    const nomeCampanha = new Map(campanhas.map((c) => [c.idMeta, c.nome]));
    return {
      moeda: escopo.moeda,
      periodo: { de: filtro.de, ate: filtro.ate },
      criativos: top.map((l) => {
        const a = porChave.get(`${l.conta_anuncio_id}|${l.anuncio_id_meta}`);
        return {
          idMeta: String(l.anuncio_id_meta),
          nome: a?.nome ?? `#${l.anuncio_id_meta}`,
          status: a?.statusEfetivo ?? null,
          campanha: nomeCampanha.get(String(l.campanha_id_meta)) ?? null,
          titulo: a?.titulo ?? null,
          texto: a?.texto ?? null,
          miniatura: a?.miniaturaUrl ? this.urlMidia(a.id) : null,
          metricas: calcular(somar(somasDe(l), funil.get(`${l.conta_anuncio_id}|${l.anuncio_id_meta}`) ?? ZERO)),
        };
      }),
      ...this.situacao(escopo.contas),
    };
  }

  /** Lista de leads do período (mais recentes primeiro), com a origem resolvida em nomes. */
  async leads(contaId: string, filtro: Filtro & { origem?: string; etapa?: string; pagina?: number }) {
    const { ondeLeads } = await this.escopo(contaId, filtro);
    const porPagina = 50;
    const pagina = Math.max(1, Math.min(200, filtro.pagina ?? 1));
    const porOrigem = filtro.origem ? Prisma.sql`AND l.origem = ${filtro.origem}::"OrigemLead"` : Prisma.empty;
    // "novo" e "em_atendimento" são as situações antes de qualquer etapa; o resto é o id da etapa.
    const porEtapa = !filtro.etapa
      ? Prisma.empty
      : filtro.etapa === 'novo' || filtro.etapa === 'em_atendimento'
        ? Prisma.sql`AND l.etapa_id IS NULL AND l.etapa = ${filtro.etapa}::"EtapaLead"`
        : Prisma.sql`AND l.etapa_id = ${filtro.etapa}::uuid`;
    const linhas = await this.prisma.$queryRaw<LinhaLead[]>`
      SELECT l.id, l.origem, l.etapa, l.etapa_id::text AS etapa_id, l.nome, l.telefone, l.chat_id, l.recebido_em, l.atendido_em, l.atendente_nome,
             l.valor_venda, l.vinculo_anuncio, c.nome AS campanha, a.nome AS anuncio
      FROM leads l
      LEFT JOIN campanhas c ON c.conta_anuncio_id = l.conta_anuncio_id AND c.id_meta = l.campanha_id_meta
      LEFT JOIN anuncios a ON a.conta_anuncio_id = l.conta_anuncio_id AND a.id_meta = l.anuncio_id_meta
      WHERE ${ondeLeads(filtro.de, filtro.ate, true)} ${porOrigem} ${porEtapa}
      ORDER BY l.recebido_em DESC
      LIMIT ${porPagina + 1} OFFSET ${(pagina - 1) * porPagina}`;
    const contagem = await this.prisma.$queryRaw<{ etapa: string; n: bigint }[]>`
      SELECT COALESCE(l.etapa_id::text, l.etapa::text) AS etapa, COUNT(*) AS n FROM leads l WHERE ${ondeLeads(filtro.de, filtro.ate, true)} ${porOrigem}
      GROUP BY 1`;
    const etapas = await this.etapas.listar(contaId);
    const nomes = new Map(etapas.map((e) => [e.id, e]));
    return {
      pagina,
      /** Todas as etapas (a tela mostra como filtro as ativas e visíveis; as outras só dão nome ao lead). */
      etapas: etapas.map(etapaPublica),
      temMais: linhas.length > porPagina,
      porEtapa: Object.fromEntries(contagem.map((e) => [e.etapa, Number(e.n)])),
      itens: linhas.slice(0, porPagina).map((l) => ({
        id: l.id,
        origem: l.origem,
        etapa: l.etapa,
        etapaId: l.etapa_id,
        etapaNome: l.etapa_id ? nomes.get(l.etapa_id)?.nome ?? null : null,
        etapaTipo: l.etapa_id ? nomes.get(l.etapa_id)?.tipo ?? null : null,
        nome: l.nome,
        telefone: mascararTelefone(l.telefone),
        chatId: l.chat_id,
        recebidoEm: l.recebido_em,
        atendidoEm: l.atendido_em,
        atendente: l.atendente_nome,
        valorVenda: l.valor_venda == null ? null : Number(l.valor_venda),
        campanha: l.campanha,
        anuncio: l.anuncio,
        vinculoAproximado: l.vinculo_anuncio === 'url' || l.vinculo_anuncio === 'texto',
      })),
    };
  }

  /**
   * Atendente que a tela do gestor leu na Kentro (omni.chats.get) para leads que ainda não tinham:
   * só preenche, nunca troca o que o painel do atendente ou a automação já gravaram.
   */
  async registrarAtendentes(contaId: string, itens: { chatId: string; atendenteId: string; atendente: string }[]) {
    let atualizados = 0;
    for (const i of itens.slice(0, MAX_ATENDENTES_POR_VEZ)) {
      const r = await this.prisma.lead.updateMany({
        where: { contaId, chatId: i.chatId, atendenteId: null },
        data: { atendenteId: i.atendenteId, atendenteNome: i.atendente.trim().slice(0, 120) },
      });
      atualizados += r.count;
    }
    return { atualizados };
  }

  /** Por atendente: quem recebeu os leads do período e quanto converteu. */
  async equipe(contaId: string, filtro: Filtro) {
    const { moeda, ondeLeads } = await this.escopo(contaId, filtro);
    const [etapas, porEtapa] = await Promise.all([this.etapasDoPainel(contaId), this.contarPorEtapa(contaId, ondeLeads(filtro.de, filtro.ate, true), true)]);
    const linhas = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COALESCE(l.atendente_id, '') AS atendente_id, MAX(l.atendente_nome) AS atendente_nome, ${LEADS_SQL},
             COUNT(*) FILTER (WHERE l.etapa = 'descartado') AS descartados,
             AVG(EXTRACT(EPOCH FROM (l.atendido_em - l.recebido_em))) FILTER (WHERE l.atendido_em IS NOT NULL) AS segundos_ate_atender
      FROM leads l
      WHERE ${ondeLeads(filtro.de, filtro.ate, true)}
      GROUP BY 1
      ORDER BY COUNT(*) FILTER (WHERE l.etapa = 'venda') DESC, COUNT(*) DESC`;
    // A tela pergunta à Kentro quem está com estes e devolve em registrarAtendentes.
    const semAtendente = await this.prisma.$queryRaw<{ chat_id: string }[]>`
      SELECT l.chat_id FROM leads l
      WHERE ${ondeLeads(filtro.de, filtro.ate, true)} AND l.atendente_id IS NULL AND l.chat_id IS NOT NULL
      ORDER BY l.recebido_em DESC
      LIMIT ${MAX_ATENDENTES_POR_VEZ}`;
    return {
      moeda,
      /** As colunas por etapa da tabela, na ordem do funil. */
      etapas: etapas.map(({ id, nome, tipo }) => ({ id, nome, tipo })),
      semAtendente: semAtendente.map((l) => l.chat_id),
      atendentes: linhas.map((l) => {
        const m = calcular(somasDe(l));
        return {
          id: (l.atendente_id as string) || null,
          nome: (l.atendente_nome as string | null) ?? (l.atendente_id ? `#${l.atendente_id}` : 'Sem atendente'),
          entradas: m.entradas,
          qualificados: m.qualificados,
          vendas: m.vendas,
          descartados: Number(l.descartados ?? 0),
          porEtapa: Object.fromEntries(porEtapa.filter((p) => p.atendenteId === ((l.atendente_id as string) || '')).map((p) => [p.etapaId, p.n])),
          receita: m.receita,
          taxaVenda: m.taxaVenda,
          minutosAteAtender: l.segundos_ate_atender == null ? null : Math.round(Number(l.segundos_ate_atender) / 60),
        };
      }),
    };
  }

  /** O que o filtro do painel oferece: contas de anúncio selecionadas e as campanhas delas. */
  async filtros(contaId: string) {
    const contas = await this.prisma.contaAnuncio.findMany({ where: { contaId, selecionada: true }, orderBy: { nome: 'asc' } });
    const campanhas = await this.prisma.campanha.findMany({
      where: { contaId, contaAnuncioId: { in: contas.map((c) => c.id) } },
      orderBy: { nome: 'asc' },
      select: { idMeta: true, nome: true, contaAnuncioId: true, statusEfetivo: true },
    });
    const { cargaPendente, sincronizadoEm } = this.situacao(contas);
    return {
      contasAnuncio: contas.map((c) => ({ id: c.id, nome: c.nome, moeda: c.moeda, fuso: c.fuso })),
      campanhas: campanhas.map((c) => ({ idMeta: c.idMeta, nome: c.nome, contaAnuncioId: c.contaAnuncioId, ativa: c.statusEfetivo === 'ACTIVE' })),
      cargaPendente,
      sincronizadoEm,
    };
  }

  // ── Miniaturas: o <img> do iframe não manda chave, então a URL leva uma assinatura do anúncio ──

  urlMidia(anuncioId: string): string {
    return `${this.config.urlPublica}/m/${anuncioId}.${assinar(this.config.chaveMestra, `midia:${anuncioId}`)}`;
  }

  /** Id do anúncio se a referência "<uuid>.<assinatura>" é válida; null se não. */
  conferirMidia(referencia: string): string | null {
    const [id, assinatura] = referencia.split('.');
    if (!id || !assinatura || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return conferirAssinatura(this.config.chaveMestra, `midia:${id}`, assinatura) ? id : null;
  }
}
