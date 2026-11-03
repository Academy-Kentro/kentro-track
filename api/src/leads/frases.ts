import type { EtapaFunil } from '@prisma/client';

const semAcentoNemCaixa = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** A etapa ativa cuja frase aparece na mensagem. Mais de uma: vale a mais adiantada no funil. */
export function etapaDaFrase<T extends Pick<EtapaFunil, 'ativa' | 'frases' | 'ordem'>>(texto: string, etapas: T[]): T | null {
  const mensagem = semAcentoNemCaixa(texto);
  if (!mensagem) return null;
  let achada: T | null = null;
  for (const e of etapas) {
    if (!e.ativa || (achada && e.ordem < achada.ordem)) continue;
    if (e.frases.some((f) => f.trim() && mensagem.includes(semAcentoNemCaixa(f)))) achada = e;
  }
  return achada;
}

// R$ opcional + 1.234,50 | 1,234.50 | 1234,5 | 1234. Fora o que está colado em "/" ou em outro dígito (datas).
const NUMERO = /(?<![\d/.,-])(r\$|\$)?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d/]|[.,]\d)/gi;
/** Número solto maior que isto é protocolo, CPF ou telefone, não preço. */
const MAX_SEM_MARCA = 9_999_999;

function paraNumero(t: string): number {
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/\.\d{1,2}$/.test(t)) return Number(t.replace(/,/g, ''));
  return Number(t.replace(/[.,]/g, ''));
}

/**
 * O valor da venda escrito na mensagem: o maior com R$; sem R$, o maior com centavos; sem isso, o
 * maior número solto. Assim "pedido 12345 de R$ 50" dá 50, e "em 2x de R$ 50, total R$ 100" dá 100.
 */
export function valorDaMensagem(texto: string): number | null {
  const comMarca: number[] = [];
  const comCentavos: number[] = [];
  const soltos: number[] = [];
  for (const [, marca, numero] of texto.matchAll(NUMERO)) {
    const valor = paraNumero(numero);
    if (!Number.isFinite(valor)) continue;
    if (marca) comMarca.push(valor);
    else if (/[.,]\d{1,2}$/.test(numero)) comCentavos.push(valor);
    else if (valor <= MAX_SEM_MARCA) soltos.push(valor);
  }
  const candidatos = [comMarca, comCentavos, soltos].find((l) => l.length > 0);
  return candidatos ? Math.max(...candidatos) : null;
}
