/** Somas do período, já como números (o Postgres devolve SUM de numeric/bigint como Decimal/BigInt). */
export interface Somas {
  investimento: number;
  impressoes: number;
  cliques: number;
  cliquesLink: number;
  leads: number;
  conversas: number;
}

/** Somas + taxas. Taxa sem denominador é null ("—" na tela), nunca 0 nem Infinity. */
export interface Metricas extends Somas {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  custoPorConversa: number | null;
}

export const ZERO: Somas = { investimento: 0, impressoes: 0, cliques: 0, cliquesLink: 0, leads: 0, conversas: 0 };

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
  };
}

export function somar(a: Somas, b: Somas): Somas {
  return {
    investimento: dinheiro(a.investimento + b.investimento),
    impressoes: a.impressoes + b.impressoes,
    cliques: a.cliques + b.cliques,
    cliquesLink: a.cliquesLink + b.cliquesLink,
    leads: a.leads + b.leads,
    conversas: a.conversas + b.conversas,
  };
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
  };
}
