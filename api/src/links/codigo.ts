import { randomBytes } from 'node:crypto';

/**
 * O código da visita vai na mensagem pronta do WhatsApp. Por padrão é invisível: cada caractere do
 * código vira 5 bits escritos com dois caracteres de largura zero, entre dois marcadores. Quem apaga
 * ou reescreve a mensagem perde o código, e a conversa fica sem rastreio (não há como evitar).
 */
const ALFABETO = 'abcdefghijklmnopqrstuvwxyz234567';
const ZERO = '​';
const UM = '‌';
const MARCA = '⁠';
const TAMANHO_VISITA = 8;

const INVISIVEL = new RegExp(`${MARCA}([${ZERO}${UM}]{${TAMANHO_VISITA * 5}})${MARCA}`);
const VISIVEL = new RegExp(`\\bref[: ]([${ALFABETO}]{${TAMANHO_VISITA}})\\b`, 'i');

function sorteio(tamanho: number): string {
  return [...randomBytes(tamanho)].map((b) => ALFABETO[b % 32]).join('');
}

export const novoCodigoVisita = () => sorteio(TAMANHO_VISITA);
/** O da URL pública: curto, mas sem dar para adivinhar o de outro cliente. */
export const novoCodigoLink = () => sorteio(10);

function invisivel(codigo: string): string {
  const bits = [...codigo].map((c) => ALFABETO.indexOf(c).toString(2).padStart(5, '0')).join('');
  return `${MARCA}${[...bits].map((b) => (b === '1' ? UM : ZERO)).join('')}${MARCA}`;
}

export function mensagemComCodigo(mensagem: string, codigo: string, visivel: boolean): string {
  return visivel ? `${mensagem} (ref ${codigo})` : `${mensagem}${invisivel(codigo)}`;
}

/** O código da visita dentro do texto de uma mensagem, ou null. */
export function lerCodigo(texto: string): string | null {
  const achado = INVISIVEL.exec(texto);
  if (achado) {
    const bits = [...achado[1]].map((c) => (c === UM ? '1' : '0')).join('');
    return (bits.match(/.{5}/g) ?? []).map((b) => ALFABETO[parseInt(b, 2)]).join('');
  }
  return VISIVEL.exec(texto)?.[1].toLowerCase() ?? null;
}
