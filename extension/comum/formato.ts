// Números e datas no formato brasileiro. Valor ausente (taxa sem denominador) vira "—".

const TRACO = '—';
const cacheMoeda = new Map<string, Intl.NumberFormat>();

export function dinheiro(valor: number | null | undefined, moeda = 'BRL'): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO;
  let f = cacheMoeda.get(moeda);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda });
    cacheMoeda.set(moeda, f);
  }
  return f.format(valor);
}

const inteiroF = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export function inteiro(valor: number | null | undefined): string {
  return valor == null || !Number.isFinite(valor) ? TRACO : inteiroF.format(valor);
}

const compactoF = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
/** 1.284 / 12,9 mil / 4,2 mi: eixos e cartões. */
export function compacto(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO;
  return Math.abs(valor) < 1000 ? inteiroF.format(valor) : compactoF.format(valor);
}

export function dinheiroCompacto(valor: number, moeda = 'BRL'): string {
  if (Math.abs(valor) < 1000) return dinheiro(valor, moeda).replace(/,00$/, '');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda, notation: 'compact', maximumFractionDigits: 1 }).format(valor);
}

export function percentual(valor: number | null | undefined, casas = 2): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO;
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** ROAS: "3,25x". */
export function vezes(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return TRACO;
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}

/** "2026-10-21" → "21/10". */
export function diaCurto(dia: string): string {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

/** "2026-10-21" → "21/10/2026". */
export function diaLongo(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** "há 5 min", "há 2 h", "21/10 14:05". */
export function haQuanto(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return 'nunca';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'nunca';
  const min = Math.max(0, Math.round((agora - t) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Variação contra o período anterior. `melhorQuandoSobe` decide a cor: leads subindo é bom,
 * CPL subindo é ruim. Sem base (anterior zero ou ausente), não há variação.
 */
export function variacao(atual: number | null, anterior: number | null | undefined, melhorQuandoSobe: boolean) {
  if (atual == null || anterior == null || anterior === 0) return null;
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (!Number.isFinite(pct)) return null;
  const direcao = Math.abs(pct) < 0.5 ? 'estavel' : pct > 0 ? 'sobe' : 'desce';
  const bom = direcao === 'estavel' ? null : (direcao === 'sobe') === melhorQuandoSobe;
  return { pct, direcao, bom, texto: `${pct > 0 ? '+' : ''}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` } as const;
}
