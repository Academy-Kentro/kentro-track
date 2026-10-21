import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ContaAnuncio, Prisma } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { cadaDia, comoDia, diasEntre, ehDia, somarDias } from '../comum/datas';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
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

interface Escopo {
  contas: ContaAnuncio[];
  moeda: string;
  onde: (de: string, ate: string) => Prisma.Sql;
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
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

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
  private async escopo(contaId: string, filtro: Filtro): Promise<Escopo> {
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
    return { contas, moeda: moedas[0] ?? 'BRL', onde };
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
    const { contas, moeda, onde } = await this.escopo(contaId, filtro);
    const dias = diasEntre(filtro.de, filtro.ate);
    const anterior = { de: somarDias(filtro.de, -dias), ate: somarDias(filtro.de, -1) };

    const [porDia, [doAnterior]] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT i.data, ${SOMAS_SQL}
        FROM insights_diarios i JOIN contas_anuncio ca ON ca.id = i.conta_anuncio_id
        WHERE ${onde(filtro.de, filtro.ate)}
        GROUP BY i.data`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${SOMAS_SQL}
        FROM insights_diarios i JOIN contas_anuncio ca ON ca.id = i.conta_anuncio_id
        WHERE ${onde(anterior.de, anterior.ate)}`,
    ]);

    const mapa = new Map(porDia.map((l) => [comoDia(l.data as Date), somasDe(l)]));
    // Dia sem entrega vem zerado: o gráfico não pula dias.
    const serie = cadaDia(filtro.de, filtro.ate).map((dia) => ({ data: dia, ...(mapa.get(dia) ?? ZERO) }));
    const totais = serie.reduce<Somas>((acc, d) => somar(acc, d), { ...ZERO });
    const somasAnteriores = somasDe(doAnterior);
    const semDadosAnteriores = somasAnteriores.impressoes === 0 && somasAnteriores.investimento === 0;

    return {
      moeda,
      periodo: { de: filtro.de, ate: filtro.ate },
      anterior: semDadosAnteriores ? null : { ...anterior, metricas: calcular(somasAnteriores) },
      metricas: calcular(totais),
      serie: serie.map(({ data, investimento, leads, conversas, impressoes, cliquesLink }) => ({ data, investimento, leads, conversas, impressoes, cliquesLink })),
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
    return { escopo, linhas };
  }

  async campanhas(contaId: string, filtro: Filtro) {
    const { escopo, linhas } = await this.porAnuncio(contaId, filtro);
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
    for (const l of linhas) {
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
    const { escopo, linhas } = await this.porAnuncio(contaId, filtro);
    const top = linhas.slice(0, MAX_CRIATIVOS);
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
          metricas: calcular(somasDe(l)),
        };
      }),
      ...this.situacao(escopo.contas),
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

  private assinatura(anuncioId: string): string {
    return createHmac('sha256', this.config.chaveMestra).update(`midia:${anuncioId}`).digest('base64url').slice(0, 22);
  }

  urlMidia(anuncioId: string): string {
    return `${this.config.urlPublica}/m/${anuncioId}.${this.assinatura(anuncioId)}`;
  }

  /** Id do anúncio se a referência "<uuid>.<assinatura>" é válida; null se não. */
  conferirMidia(referencia: string): string | null {
    const [id, assinatura] = referencia.split('.');
    if (!id || !assinatura || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const esperada = Buffer.from(this.assinatura(id));
    const recebida = Buffer.from(assinatura);
    return esperada.length === recebida.length && timingSafeEqual(esperada, recebida) ? id : null;
  }
}
