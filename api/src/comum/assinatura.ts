import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura curta (22 caracteres base64url, 132 bits) para URLs públicas que não podem levar
 * cabeçalho: miniaturas no <img> e o webhook colado na automação da Kentro.
 */
export function assinar(chaveMestra: Buffer, texto: string): string {
  return createHmac('sha256', chaveMestra).update(texto).digest('base64url').slice(0, 22);
}

export function conferirAssinatura(chaveMestra: Buffer, texto: string, recebida: string): boolean {
  const esperada = Buffer.from(assinar(chaveMestra, texto));
  const dada = Buffer.from(recebida);
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}
