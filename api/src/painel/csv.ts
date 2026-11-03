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

/** 3000 → "3000,00": o Excel em português lê como número. */
export const valorCsv = (v: unknown): string | null => (v == null ? null : Number(v).toFixed(2).replace('.', ','));
