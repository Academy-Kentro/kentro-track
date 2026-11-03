import { Inject, Injectable } from '@nestjs/common';
import { ContaAnuncio, Prisma } from '@prisma/client';
import { assinar, conferirAssinatura } from '../comum/assinatura';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cadaDia, comoDia, diasEntre, ehDia, somarDias } from '../comum/datas';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { etapaPublica, EtapasService } from '../etapas/etapas.service';
import { mascararTelefone, normalizarTelefone, telefoneParaPlanilha } from '../leads/telefone';
import { montarCsv, valorCsv } from './csv';
import { calcular, Metricas, Somas, somar, somasDe, ZERO } from './metricas';

export interface Filtro {
  de: string;
  ate: string;
  contaAnuncio?: string;
  campanha?: string;
}

export interface FiltroLeads extends Filtro {
  origem?: string;
  etapa?: string;
  pagina?: number;
  busca?: string;
  conjunto?: string;
  anuncio?: string;
  /** Id do atendente na Kentro, ou "sem". */
  atendente?: string;
  vendaDe?: string;
  vendaAte?: string;
  ordem?: string;
  aguardando?: string;
}

export type TipoExportacao = 'leads' | 'vendas' | 'jornada';

const MAX_DIAS = 400;
const MAX_ANUNCIOS = 2000;
const MAX_CRIATIVOS = 60;
/** Leads sem atendente que a tela consulta na Kentro de uma vez. */
export const MAX_ATENDENTES_POR_VEZ = 100;
/** Cartões por coluna do quadro de leads. */
const CARTOES_POR_COLUNA = 30;
const MAX_OPCOES_FILTRO = 200;
const ULTIMAS_ATUALIZACOES = 10;
/** O omni.http.request corta a resposta em 5 MB: este teto fica bem abaixo disso. */
const MAX_LINHAS_EXPORTACAO = 5000;

const ORDENS_LEADS: Record<string, Prisma.Sql> = {
  recentes: Prisma.sql`l.recebido_em DESC`,
  antigos: Prisma.sql`l.recebido_em ASC`,
  maior_venda: Prisma.sql`l.valor_venda DESC NULLS LAST, l.recebido_em DESC`,
  nome: Prisma.sql`l.nome ASC NULLS LAST, l.recebido_em DESC`,
  ultima_mensagem: Prisma.sql`l.ultima_mensagem_em DESC NULLS LAST, l.recebido_em DESC`,
};

const ROTULO_SITUACAO: Record<string, string> = { novo: 'Novo', em_atendimento: 'Em atendimento', qualificado: 'Qualificado', venda: 'Venda', descartado: 'Descartado' };
const ROTULO_ORIGEM: Record<string, string> = { ctwa: 'Anúncio (WhatsApp)', formulario: 'Formulário', link: 'Link rastreável', organico: 'Sem anúncio' };
const ROTULO_AUTOR: Record<string, string> = { atendente: 'Atendente', gestor: 'Gestor', kentro: 'Automação da Kentro', meta: 'Meta', sistema: 'Sistema' };

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
  primeira_resposta_em: Date | null;
  ultima_mensagem_em: Date | null;
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

  /** Os filtros da aba Leads, menos a etapa: as contagens por etapa respeitam todos os outros. */
  private filtrosDeLeads(filtro: FiltroLeads, horaLocal: Escopo['horaLocal']): Prisma.Sql {
    const partes: Prisma.Sql[] = [];
    if (filtro.origem) partes.push(Prisma.sql`AND l.origem = ${filtro.origem}::"OrigemLead"`);
    if (filtro.conjunto) partes.push(Prisma.sql`AND l.conjunto_id_meta = ${filtro.conjunto}`);
    if (filtro.anuncio) partes.push(Prisma.sql`AND l.anuncio_id_meta = ${filtro.anuncio}`);
    if (filtro.atendente) partes.push(filtro.atendente === 'sem' ? Prisma.sql`AND l.atendente_id IS NULL` : Prisma.sql`AND l.atendente_id = ${filtro.atendente}`);
    if (filtro.vendaDe || filtro.vendaAte) {
      partes.push(Prisma.sql`AND l.etapa = 'venda'`);
      if (filtro.vendaDe) partes.push(Prisma.sql`AND ${horaLocal('venda_em')}::date >= ${filtro.vendaDe}::date`);
      if (filtro.vendaAte) partes.push(Prisma.sql`AND ${horaLocal('venda_em')}::date <= ${filtro.vendaAte}::date`);
    }
    if (filtro.aguardando) partes.push(Prisma.sql`AND l.primeira_resposta_em IS NULL AND l.ultima_mensagem_lead_em IS NOT NULL`);
    const busca = filtro.busca?.trim();
    if (busca) {
      const nome = `%${busca.replace(/[\\%_]/g, '\\$&')}%`;
      const digitos = busca.replace(/\D/g, '');
      // Número inteiro casa pela chave (com ou sem o nono dígito); pedaço de número, pelo que está gravado.
      const chave = normalizarTelefone(busca)?.chave;
      partes.push(Prisma.sql`AND (l.nome ILIKE ${nome}
        ${digitos.length >= 4 ? Prisma.sql`OR l.telefone LIKE ${`%${digitos}%`}` : Prisma.empty}
        ${chave ? Prisma.sql`OR l.telefone_chave = ${chave}` : Prisma.empty})`);
    }
    return partes.length ? Prisma.join(partes, ' ') : Prisma.empty;
  }

  /** "novo" e "em_atendimento" são as situações antes de qualquer etapa; o resto é o id da etapa. */
  private filtroDeEtapa(etapa?: string): Prisma.Sql {
    if (!etapa) return Prisma.empty;
    return etapa === 'novo' || etapa === 'em_atendimento'
      ? Prisma.sql`AND l.etapa_id IS NULL AND l.etapa = ${etapa}::"EtapaLead"`
      : Prisma.sql`AND l.etapa_id = ${etapa}::uuid`;
  }

  private itemDeLead(l: LinhaLead, nomes: Map<string, { nome: string; tipo: string }>) {
    return {
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
      primeiraRespostaEm: l.primeira_resposta_em,
      ultimaMensagemEm: l.ultima_mensagem_em,
      atendente: l.atendente_nome,
      valorVenda: l.valor_venda == null ? null : Number(l.valor_venda),
      campanha: l.campanha,
      anuncio: l.anuncio,
      vinculoAproximado: l.vinculo_anuncio === 'url' || l.vinculo_anuncio === 'texto',
    };
  }

  private async contarLeadsPorEtapa(onde: Prisma.Sql) {
    const contagem = await this.prisma.$queryRaw<{ etapa: string; n: bigint }[]>`
      SELECT COALESCE(l.etapa_id::text, l.etapa::text) AS etapa, COUNT(*) AS n FROM leads l WHERE ${onde}
      GROUP BY 1`;
    return Object.fromEntries(contagem.map((e) => [e.etapa, Number(e.n)]));
  }

  private async contarAguardando(onde: Prisma.Sql): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM leads l WHERE ${onde} AND l.primeira_resposta_em IS NULL AND l.ultima_mensagem_lead_em IS NOT NULL`;
    return Number(n);
  }

  /** Lista de leads do período (mais recentes primeiro), com a origem resolvida em nomes. */
  async leads(contaId: string, filtro: FiltroLeads) {
    const { ondeLeads, horaLocal } = await this.escopo(contaId, filtro);
    const porPagina = 50;
    const pagina = Math.max(1, Math.min(200, filtro.pagina ?? 1));
    const filtros = this.filtrosDeLeads(filtro, horaLocal);
    const porEtapa = this.filtroDeEtapa(filtro.etapa);
    const linhas = await this.prisma.$queryRaw<LinhaLead[]>`
      SELECT l.id, l.origem, l.etapa, l.etapa_id::text AS etapa_id, l.nome, l.telefone, l.chat_id, l.recebido_em, l.atendido_em, l.primeira_resposta_em, l.ultima_mensagem_em, l.atendente_nome,
             l.valor_venda, l.vinculo_anuncio, c.nome AS campanha, a.nome AS anuncio
      FROM leads l
      LEFT JOIN campanhas c ON c.conta_anuncio_id = l.conta_anuncio_id AND c.id_meta = l.campanha_id_meta
      LEFT JOIN anuncios a ON a.conta_anuncio_id = l.conta_anuncio_id AND a.id_meta = l.anuncio_id_meta
      WHERE ${ondeLeads(filtro.de, filtro.ate, true)} ${filtros} ${porEtapa}
      ORDER BY ${ORDENS_LEADS[filtro.ordem ?? ''] ?? ORDENS_LEADS.recentes}
      LIMIT ${porPagina + 1} OFFSET ${(pagina - 1) * porPagina}`;
    const etapas = await this.etapas.listar(contaId);
    const nomes = new Map(etapas.map((e) => [e.id, e]));
    return {
      pagina,
      /** Todas as etapas (a tela mostra como filtro as ativas e visíveis; as outras só dão nome ao lead). */
      etapas: etapas.map(etapaPublica),
      temMais: linhas.length > porPagina,
      porEtapa: await this.contarLeadsPorEtapa(Prisma.sql`${ondeLeads(filtro.de, filtro.ate, true)} ${filtros}`),
      aguardandoResposta: await this.contarAguardando(ondeLeads(filtro.de, filtro.ate, true)),
      itens: linhas.slice(0, porPagina).map((l) => this.itemDeLead(l, nomes)),
    };
  }

  /** O quadro de colunas: os leads mais recentes de cada etapa e o total dela, numa chamada só. */
  async quadroDeLeads(contaId: string, filtro: FiltroLeads) {
    const { ondeLeads, horaLocal } = await this.escopo(contaId, filtro);
    const onde = Prisma.sql`${ondeLeads(filtro.de, filtro.ate, true)} ${this.filtrosDeLeads(filtro, horaLocal)}`;
    const linhas = await this.prisma.$queryRaw<LinhaLead[]>`
      WITH numerados AS (
        SELECT l.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(l.etapa_id::text, l.etapa::text) ORDER BY l.recebido_em DESC) AS posicao
        FROM leads l WHERE ${onde}
      )
      SELECT l.id, l.origem, l.etapa, l.etapa_id::text AS etapa_id, l.nome, l.telefone, l.chat_id, l.recebido_em, l.atendido_em, l.primeira_resposta_em, l.ultima_mensagem_em, l.atendente_nome,
             l.valor_venda, l.vinculo_anuncio, c.nome AS campanha, a.nome AS anuncio
      FROM numerados l
      LEFT JOIN campanhas c ON c.conta_anuncio_id = l.conta_anuncio_id AND c.id_meta = l.campanha_id_meta
      LEFT JOIN anuncios a ON a.conta_anuncio_id = l.conta_anuncio_id AND a.id_meta = l.anuncio_id_meta
      WHERE l.posicao <= ${CARTOES_POR_COLUNA}
      ORDER BY l.recebido_em DESC`;
    const etapas = await this.etapas.listar(contaId);
    const nomes = new Map(etapas.map((e) => [e.id, e]));
    return {
      etapas: etapas.map(etapaPublica),
      cartoesPorColuna: CARTOES_POR_COLUNA,
      porEtapa: await this.contarLeadsPorEtapa(onde),
      aguardandoResposta: await this.contarAguardando(ondeLeads(filtro.de, filtro.ate, true)),
      itens: linhas.map((l) => this.itemDeLead(l, nomes)),
    };
  }

  /** O que os filtros da aba Leads oferecem: só conjuntos, anúncios e atendentes que têm lead no período. */
  async opcoesDeLeads(contaId: string, filtro: Filtro) {
    const { ondeLeads } = await this.escopo(contaId, filtro);
    const onde = ondeLeads(filtro.de, filtro.ate, true);
    const [conjuntos, anuncios, atendentes] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; nome: string | null }[]>`
        SELECT l.conjunto_id_meta AS id, MAX(c.nome) AS nome
        FROM leads l LEFT JOIN conjuntos c ON c.conta_anuncio_id = l.conta_anuncio_id AND c.id_meta = l.conjunto_id_meta
        WHERE ${onde} AND l.conjunto_id_meta IS NOT NULL
        GROUP BY 1 ORDER BY 2 NULLS LAST LIMIT ${MAX_OPCOES_FILTRO}`,
      this.prisma.$queryRaw<{ id: string; nome: string | null }[]>`
        SELECT l.anuncio_id_meta AS id, MAX(a.nome) AS nome
        FROM leads l LEFT JOIN anuncios a ON a.conta_anuncio_id = l.conta_anuncio_id AND a.id_meta = l.anuncio_id_meta
        WHERE ${onde} AND l.anuncio_id_meta IS NOT NULL
        GROUP BY 1 ORDER BY 2 NULLS LAST LIMIT ${MAX_OPCOES_FILTRO}`,
      this.prisma.$queryRaw<{ id: string; nome: string | null }[]>`
        SELECT l.atendente_id AS id, MAX(l.atendente_nome) AS nome
        FROM leads l WHERE ${onde} AND l.atendente_id IS NOT NULL
        GROUP BY 1 ORDER BY 2 NULLS LAST LIMIT ${MAX_OPCOES_FILTRO}`,
    ]);
    const comNome = (l: { id: string; nome: string | null }) => ({ id: l.id, nome: l.nome ?? `#${l.id}` });
    return { conjuntos: conjuntos.map(comNome), anuncios: anuncios.map(comNome), atendentes: atendentes.map(comNome) };
  }

  /** As últimas mudanças de etapa da conta, de qualquer período. */
  async atualizacoesDeLeads(contaId: string) {
    const etapas = await this.etapas.listar(contaId);
    const eventos = await this.prisma.eventoLead.findMany({
      where: { lead: { contaId }, tipo: { in: ['em_atendimento', ...etapas.map((e) => e.chave)] } },
      orderBy: [{ em: 'desc' }, { id: 'desc' }],
      take: ULTIMAS_ATUALIZACOES,
      include: { lead: { select: { id: true, nome: true, telefone: true } } },
    });
    return {
      itens: eventos.map((e) => ({
        id: String(e.id),
        leadId: e.lead.id,
        nome: e.lead.nome,
        telefone: mascararTelefone(e.lead.telefone),
        texto: e.texto,
        autor: ROTULO_AUTOR[e.autor] ?? e.autor,
        em: e.em,
      })),
    };
  }

  /** Relatório em CSV, devolvido no corpo: a extensão só fala com a API pelo omni.http.request. */
  async exportarLeads(contaId: string, filtro: FiltroLeads, tipo: TipoExportacao) {
    const { ondeLeads, filtroLeads, horaLocal, fuso } = await this.escopo(contaId, filtro);
    const etapas = await this.etapas.listar(contaId);
    const nomeEtapa = new Map(etapas.map((e) => [e.id, e.nome]));
    const filtros = this.filtrosDeLeads(filtro, horaLocal);
    const porEtapa = this.filtroDeEtapa(filtro.etapa);
    const quando = (coluna: Prisma.Sql) => Prisma.sql`to_char(((${coluna} AT TIME ZONE 'UTC') AT TIME ZONE ${fuso}), 'DD/MM/YYYY HH24:MI')`;
    let cabecalho: string[];
    let linhas: (string | number | null)[][];

    if (tipo === 'jornada') {
      const tipos = ['em_atendimento', ...etapas.map((e) => e.chave)];
      const eventos = await this.prisma.$queryRaw<{ em: string; nome: string | null; telefone: string | null; texto: string; autor: string }[]>`
        SELECT ${quando(Prisma.sql`e.em`)} AS em, l.nome, l.telefone, e.texto, e.autor
        FROM eventos_lead e JOIN leads l ON l.id = e.lead_id
        WHERE ${filtroLeads(true)} ${filtros} ${porEtapa} AND e.tipo = ANY(${tipos}::text[])
          AND ((e.em AT TIME ZONE 'UTC') AT TIME ZONE ${fuso})::date BETWEEN ${filtro.de}::date AND ${filtro.ate}::date
        ORDER BY e.em DESC, e.id DESC
        LIMIT ${MAX_LINHAS_EXPORTACAO + 1}`;
      cabecalho = ['Data', 'Lead', 'Telefone', 'Mudança', 'Quem fez'];
      linhas = eventos.map((e) => [e.em, e.nome, telefoneParaPlanilha(e.telefone), e.texto, ROTULO_AUTOR[e.autor] ?? e.autor]);
    } else {
      // Vendas: pelo dia da venda; leads: pelo dia em que o lead chegou.
      const periodo =
        tipo === 'vendas'
          ? Prisma.sql`${filtroLeads(true)} AND l.etapa = 'venda' AND ${horaLocal('venda_em')}::date BETWEEN ${filtro.de}::date AND ${filtro.ate}::date`
          : ondeLeads(filtro.de, filtro.ate, true);
      const leads = await this.prisma.$queryRaw<Record<string, string | null>[]>`
        SELECT ${quando(Prisma.sql`l.recebido_em`)} AS recebido, ${quando(Prisma.sql`l.venda_em`)} AS venda, ${quando(Prisma.sql`l.primeira_resposta_em`)} AS resposta, ${quando(Prisma.sql`l.ultima_mensagem_em`)} AS mensagem, l.nome, l.telefone, l.origem::text AS origem,
               l.etapa::text AS etapa, l.etapa_id::text AS etapa_id, l.atendente_nome, l.valor_venda, l.motivo_descarte,
               ca.nome AS campanha, co.nome AS conjunto, a.nome AS anuncio
        FROM leads l
        LEFT JOIN campanhas ca ON ca.conta_anuncio_id = l.conta_anuncio_id AND ca.id_meta = l.campanha_id_meta
        LEFT JOIN conjuntos co ON co.conta_anuncio_id = l.conta_anuncio_id AND co.id_meta = l.conjunto_id_meta
        LEFT JOIN anuncios a ON a.conta_anuncio_id = l.conta_anuncio_id AND a.id_meta = l.anuncio_id_meta
        WHERE ${periodo} ${filtros} ${porEtapa}
        ORDER BY ${tipo === 'vendas' ? Prisma.sql`l.venda_em DESC` : ORDENS_LEADS[filtro.ordem ?? ''] ?? ORDENS_LEADS.recentes}
        LIMIT ${MAX_LINHAS_EXPORTACAO + 1}`;
      cabecalho = ['Chegou em', 'Lead', 'Telefone', 'Origem', 'Campanha', 'Conjunto', 'Anúncio', 'Atendente', 'Etapa', 'Venda em', 'Valor da venda', 'Motivo do descarte', 'Primeira resposta', 'Última mensagem'];
      linhas = leads.map((l) => [
        l.recebido,
        l.nome,
        telefoneParaPlanilha(l.telefone),
        ROTULO_ORIGEM[l.origem ?? ''] ?? l.origem,
        l.campanha,
        l.conjunto,
        l.anuncio,
        l.atendente_nome,
        (l.etapa_id && nomeEtapa.get(l.etapa_id)) || ROTULO_SITUACAO[l.etapa ?? ''] || l.etapa,
        l.venda,
        l.etapa === 'venda' ? valorCsv(l.valor_venda) : null,
        l.motivo_descarte,
        l.resposta,
        l.mensagem,
      ]);
    }
    const truncado = linhas.length > MAX_LINHAS_EXPORTACAO;
    const usadas = linhas.slice(0, MAX_LINHAS_EXPORTACAO);
    return { arquivo: `${tipo}-${filtro.de}-a-${filtro.ate}.csv`, csv: montarCsv(cabecalho, usadas), linhas: usadas.length, truncado };
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
