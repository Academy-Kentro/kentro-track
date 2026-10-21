/** Somas do período, já como números (o Postgres devolve SUM de numeric/bigint como Decimal/BigInt). */
export interface Somas {
  investimento: number;
  impressoes: number;
  cliques: number;
  cliquesLink: number;
  leads: number;
  conversas: number;
  // Do atendimento (leads de anúncio no período): entradas, qualificados, vendas e receita.
  entradas: number;
  qualificados: number;
  vendas: number;
  receita: number;
}

/** Somas + taxas. Taxa sem denominador é null ("—" na tela), nunca 0 nem Infinity. */
export interface Metricas extends Somas {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  custoPorConversa: number | null;
  roas: number | null;
  custoPorVenda: number | null;
  /** Vendas ÷ entradas, em %. */
  taxaVenda: number | null;
}

export const ZERO: Somas = {
  investimento: 0,
  impressoes: 0,
  cliques: 0,
  cliquesLink: 0,
  leads: 0,
  conversas: 0,
  entradas: 0,
  qualificados: 0,
  vendas: 0,
  receita: 0,
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const divisao = (a: number, b: number, fator = 1) => (b > 0 ? Math.round(((a * fator) / b) * 10_000) / 10_000 : null);
const dinheiro = (n: number) => Math.round(n * 100) / 100;

export function somasDe(linha: Record<string, unknown> | undefined): Somas {
  if (!linha) return { ...ZERO };
  return {
    investimento: dinheiro(num(linha.investimento)),
    impressoes: num(linha.impressoes),
    cliques: num(linha.cliques),
    cliquesLink: num(linha.cliques_link ?? linha.cliquesLink),
    leads: num(linha.leads),
    conversas: num(linha.conversas),
    entradas: num(linha.entradas),
    qualificados: num(linha.qualificados),
    vendas: num(linha.vendas),
    receita: dinheiro(num(linha.receita)),
  };
}

export function somar(a: Somas, b: Somas): Somas {
  const r = { ...ZERO };
  for (const k of Object.keys(ZERO) as (keyof Somas)[]) r[k] = a[k] + b[k];
  r.investimento = dinheiro(r.investimento);
  r.receita = dinheiro(r.receita);
  return r;
}

export function calcular(s: Somas): Metricas {
  return {
    ...s,
    // CTR do clique no link, como o Gerenciador mostra por padrão.
    ctr: divisao(s.cliquesLink, s.impressoes, 100),
    cpc: divisao(s.investimento, s.cliquesLink),
    cpm: divisao(s.investimento, s.impressoes, 1000),
    cpl: divisao(s.investimento, s.leads),
    custoPorConversa: divisao(s.investimento, s.conversas),
    roas: divisao(s.receita, s.investimento),
    custoPorVenda: divisao(s.investimento, s.vendas),
    taxaVenda: divisao(s.vendas, s.entradas, 100),
  };
}
