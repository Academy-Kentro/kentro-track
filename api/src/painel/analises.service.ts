import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cadaDia, comoDia } from '../comum/datas';
import { PrismaService } from '../comum/prisma.service';
import { ufDoDdd } from '../leads/ddd';
import { Filtro, PainelService } from './painel.service';

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const dinheiro = (n: number) => Math.round(n * 100) / 100;
const TOP = 8;

type Nivel = 'campanha' | 'conjunto' | 'anuncio';
const COLUNA: Record<Nivel, string> = { campanha: 'campanha_id_meta', conjunto: 'conjunto_id_meta', anuncio: 'anuncio_id_meta' };

/** Faixas do tempo entre o lead chegar e alguém abrir o painel da conversa. */
const FAIXAS_ATENDIMENTO = [
  { id: 'ate5', rotulo: 'Até 5 min', max: 5 * 60 },
  { id: 'ate15', rotulo: '5 a 15 min', max: 15 * 60 },
  { id: 'ate60', rotulo: '15 min a 1 h', max: 60 * 60 },
  { id: 'ate240', rotulo: '1 a 4 h', max: 4 * 3600 },
  { id: 'mais', rotulo: 'Mais de 4 h', max: Infinity },
] as const;

/**
 * Aba Análises: o que o Tintim mostra (origens, % rastreado, vendas e faturamento, o que mais vende,
 * jornada e gargalos, estado do lead) e o que os nossos dados permitem a mais (hora de chegada,
 * tempo até atender, motivos de descarte). Tudo numa chamada, por causa do limite de 30/min.
 */
@Injectable()
export class AnalisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly painel: PainelService,
  ) {}

  async analises(contaId: string, filtro: Filtro) {
    const escopo = await this.painel.escopo(contaId, filtro);
    const { filtroLeads, ondeLeads, horaLocal } = escopo;
    const todos = ondeLeads(filtro.de, filtro.ate, true);
    const vendaNoPeriodo = Prisma.sql`${filtroLeads(true)} AND l.etapa = 'venda' AND ${horaLocal('venda_em')}::date BETWEEN ${filtro.de}::date AND ${filtro.ate}::date`;

    const [origens, entradasPorDia, vendasPorDia, etapas, motivos, ddds, horario, atendimento, campanhas, conjuntos, anuncios] = await Promise.all([
      this.prisma.$queryRaw<{ origem: string; leads: bigint; vendas: bigint; receita: unknown }[]>`
        SELECT l.origem, COUNT(*) AS leads, COUNT(*) FILTER (WHERE l.etapa = 'venda') AS vendas,
               COALESCE(SUM(l.valor_venda) FILTER (WHERE l.etapa = 'venda'), 0) AS receita
        FROM leads l WHERE ${todos} GROUP BY 1`,
      this.prisma.$queryRaw<{ dia: Date; n: bigint }[]>`
        SELECT ${horaLocal('recebido_em')}::date AS dia, COUNT(*) AS n FROM leads l WHERE ${todos} GROUP BY 1`,
      // Vendas e faturamento pelo dia em que a venda foi registrada (não pelo dia em que o lead chegou).
      this.prisma.$queryRaw<{ dia: Date; n: bigint; receita: unknown }[]>`
        SELECT ${horaLocal('venda_em')}::date AS dia, COUNT(*) AS n, COALESCE(SUM(l.valor_venda), 0) AS receita
        FROM leads l WHERE ${vendaNoPeriodo} GROUP BY 1`,
      this.prisma.$queryRaw<{ etapa: string; n: bigint }[]>`SELECT l.etapa, COUNT(*) AS n FROM leads l WHERE ${todos} GROUP BY 1`,
      this.prisma.$queryRaw<{ motivo: string; n: bigint }[]>`
        SELECT l.motivo_descarte AS motivo, COUNT(*) AS n FROM leads l
        WHERE ${todos} AND l.etapa = 'descartado' AND l.motivo_descarte IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      this.prisma.$queryRaw<{ ddd: string; leads: bigint; vendas: bigint }[]>`
        SELECT substring(l.telefone FROM 3 FOR 2) AS ddd, COUNT(*) AS leads, COUNT(*) FILTER (WHERE l.etapa = 'venda') AS vendas
        FROM leads l WHERE ${todos} AND l.telefone LIKE '55%' AND length(l.telefone) IN (12, 13)
        GROUP BY 1`,
      this.prisma.$queryRaw<{ dia_semana: number; hora: number; n: bigint }[]>`
        SELECT EXTRACT(ISODOW FROM ${horaLocal('recebido_em')})::int AS dia_semana, EXTRACT(HOUR FROM ${horaLocal('recebido_em')})::int AS hora, COUNT(*) AS n
        FROM leads l WHERE ${todos} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ segundos: unknown }[]>`
        SELECT EXTRACT(EPOCH FROM (l.atendido_em - l.recebido_em)) AS segundos FROM leads l
        WHERE ${todos} AND l.atendido_em IS NOT NULL`,
      this.ranking(contaId, escopo, filtro, 'campanha'),
      this.ranking(contaId, escopo, filtro, 'conjunto'),
      this.ranking(contaId, escopo, filtro, 'anuncio'),
    ]);

    // Origens: o "rastreado" é tudo que não é orgânico (o Tintim mostra a mesma porcentagem).
    const totalLeads = origens.reduce((a, o) => a + num(o.leads), 0);
    const rastreados = origens.filter((o) => o.origem !== 'organico').reduce((a, o) => a + num(o.leads), 0);

    const mapaEntradas = new Map(entradasPorDia.map((l) => [comoDia(l.dia), num(l.n)]));
    const mapaVendas = new Map(vendasPorDia.map((l) => [comoDia(l.dia), { vendas: num(l.n), receita: dinheiro(num(l.receita)) }]));

    const porUf = new Map<string, { leads: number; vendas: number }>();
    let semEstado = 0;
    for (const d of ddds) {
      const uf = ufDoDdd(d.ddd);
      if (!uf) {
        semEstado += num(d.leads);
        continue;
      }
      const atual = porUf.get(uf) ?? { leads: 0, vendas: 0 };
      porUf.set(uf, { leads: atual.leads + num(d.leads), vendas: atual.vendas + num(d.vendas) });
    }

    const faixas = FAIXAS_ATENDIMENTO.map((f) => ({ id: f.id, rotulo: f.rotulo, leads: 0 }));
    for (const a of atendimento) {
      const s = Math.max(0, num(a.segundos));
      faixas[FAIXAS_ATENDIMENTO.findIndex((f) => s <= f.max)].leads += 1;
    }
    const naoAtendidos = totalLeads - atendimento.length;

    return {
      moeda: escopo.moeda,
      periodo: { de: filtro.de, ate: filtro.ate },
      origens: {
        total: totalLeads,
        percentualRastreado: totalLeads ? Math.round((rastreados / totalLeads) * 1000) / 10 : null,
        itens: origens
          .map((o) => ({ origem: o.origem, leads: num(o.leads), vendas: num(o.vendas), receita: dinheiro(num(o.receita)) }))
          .sort((a, b) => b.leads - a.leads),
      },
      porDia: cadaDia(filtro.de, filtro.ate).map((dia) => ({ data: dia, entradas: mapaEntradas.get(dia) ?? 0, ...(mapaVendas.get(dia) ?? { vendas: 0, receita: 0 }) })),
      etapas: Object.fromEntries(etapas.map((e) => [e.etapa, num(e.n)])),
      motivosDescarte: motivos.map((m) => ({ motivo: m.motivo, leads: num(m.n) })),
      estados: {
        itens: [...porUf.entries()].map(([uf, v]) => ({ uf, ...v })).sort((a, b) => b.leads - a.leads),
        semEstado,
      },
      horario: horario.map((h) => ({ diaSemana: num(h.dia_semana), hora: num(h.hora), leads: num(h.n) })),
      tempoAtendimento: { faixas, naoAtendidos: Math.max(0, naoAtendidos) },
      ranking: { campanhas, conjuntos, anuncios },
    };
  }

  /** O que mais vende em cada nível: vendas e receita dos leads + investimento do Meta no período. */
  private async ranking(contaId: string, escopo: Awaited<ReturnType<PainelService['escopo']>>, filtro: Filtro, nivel: Nivel) {
    const coluna = Prisma.raw(COLUNA[nivel]);
    const ids = escopo.contas.map((c) => c.id);
    const [leads, gasto] = await Promise.all([
      this.prisma.$queryRaw<{ ca: string; id: string; entradas: bigint; vendas: bigint; receita: unknown }[]>`
        SELECT l.conta_anuncio_id AS ca, l.${coluna} AS id, COUNT(*) AS entradas,
               COUNT(*) FILTER (WHERE l.etapa = 'venda') AS vendas,
               COALESCE(SUM(l.valor_venda) FILTER (WHERE l.etapa = 'venda'), 0) AS receita
        FROM leads l
        WHERE ${escopo.ondeLeads(filtro.de, filtro.ate)} AND l.conta_anuncio_id = ANY(${ids}::uuid[]) AND l.${coluna} IS NOT NULL
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ ca: string; id: string; investimento: unknown }[]>`
        SELECT i.conta_anuncio_id AS ca, i.${coluna} AS id, SUM(i.investimento) AS investimento
        FROM insights_diarios i JOIN contas_anuncio ca ON ca.id = i.conta_anuncio_id
        WHERE ${escopo.onde(filtro.de, filtro.ate)}
        GROUP BY 1, 2`,
    ]);
    const chave = (ca: string, id: string) => `${ca}|${id}`;
    const linhas = new Map<string, { ca: string; id: string; investimento: number; entradas: number; vendas: number; receita: number }>();
    const pegar = (ca: string, id: string) => {
      const k = chave(ca, id);
      let l = linhas.get(k);
      if (!l) linhas.set(k, (l = { ca, id, investimento: 0, entradas: 0, vendas: 0, receita: 0 }));
      return l;
    };
    for (const g of gasto) pegar(g.ca, g.id).investimento = dinheiro(num(g.investimento));
    for (const l of leads) Object.assign(pegar(l.ca, l.id), { entradas: num(l.entradas), vendas: num(l.vendas), receita: dinheiro(num(l.receita)) });

    const top = [...linhas.values()]
      .filter((l) => l.vendas > 0 || l.entradas > 0 || l.investimento > 0)
      .sort((a, b) => b.receita - a.receita || b.vendas - a.vendas || b.entradas - a.entradas || b.investimento - a.investimento)
      .slice(0, TOP);
    const tabela = nivel === 'campanha' ? this.prisma.campanha : nivel === 'conjunto' ? this.prisma.conjunto : this.prisma.anuncio;
    const entidades = await (tabela as typeof this.prisma.campanha).findMany({
      where: { contaId, OR: top.map((l) => ({ contaAnuncioId: l.ca, idMeta: l.id })) },
      select: { contaAnuncioId: true, idMeta: true, nome: true },
    });
    const nomes = new Map(entidades.map((e) => [chave(e.contaAnuncioId, e.idMeta), e.nome]));
    return top.map((l) => ({
      idMeta: l.id,
      nome: nomes.get(chave(l.ca, l.id)) ?? `#${l.id}`,
      investimento: l.investimento,
      entradas: l.entradas,
      vendas: l.vendas,
      receita: l.receita,
      roas: l.investimento > 0 ? Math.round((l.receita / l.investimento) * 100) / 100 : null,
      custoPorVenda: l.vendas > 0 ? dinheiro(l.investimento / l.vendas) : null,
    }));
  }
}
