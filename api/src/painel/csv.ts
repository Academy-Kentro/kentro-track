/**
 * CSV para abrir no Excel em português: ponto e vírgula e BOM (sem ele, o Excel erra os acentos).
 * Nome de lead vem do WhatsApp: célula começando com = + - @ viraria fórmula, então leva um apóstrofo.
 */
function celula(valor: string | number | null | undefined): string {
  if (valor == null) return '';
  let t = String(valor);
  if (typeof valor === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function montarCsv(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  return `﻿${[cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
}

/** O Google Ads só importa o modelo dele: vírgula, sem BOM. As células não têm texto livre do lead. */
export function montarCsvGoogle(cabecalho: string[], linhas: (string | number | null)[][]): string {
  const campo = (v: string | number | null) => (v == null ? '' : /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `${[cabecalho, ...linhas].map((l) => l.map(campo).join(',')).join('\r\n')}\r\n`;
}

/** 3000 → "3000,00": o Excel em português lê como número. */
export const valorCsv = (v: unknown): string | null => (v == null ? null : Number(v).toFixed(2).replace('.', ','));
