/**
 * Telefone como o Meta e a Kentro entregam, em qualquer formato ("+55 (38) 99999-0000", "5538999990000",
 * "38 9999-0000"). No Brasil o WhatsApp entrega o mesmo celular com e sem o nono dígito, então a
 * comparação usa a CHAVE (DDD + 8 últimos dígitos), nunca o número inteiro.
 */
export function normalizarTelefone(bruto: string | null | undefined): { telefone: string; chave: string } | null {
  const texto = String(bruto ?? '').trim();
  let d = texto.replace(/\D/g, '');
  // "+" ou "00" na frente: o DDI veio junto e vale como está.
  const comDdi = texto.startsWith('+') || d.startsWith('00');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length < 8 || d.length > 15) return null;
  // Brasileiro sem DDI (DDD + 8 ou 9 dígitos): acrescenta o 55.
  if (!comDdi && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    return { telefone: d, chave: `${ddd}${d.slice(-8)}` };
  }
  return { telefone: d, chave: d.slice(-10) };
}

/** "5538999990000" → "(38) 9****-0000": o gestor identifica o lead sem ver o número inteiro. */
export function mascararTelefone(telefone: string | null | undefined): string | null {
  if (!telefone) return null;
  const d = telefone.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) return `(${d.slice(2, 4)}) ${d.slice(4, 5)}****-${d.slice(-4)}`;
  return `****${d.slice(-4)}`;
}
