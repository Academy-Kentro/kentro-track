import { Prisma } from '@prisma/client';

/**
 * Instante para comparar com as colunas DateTime do Prisma (timestamp SEM fuso, gravado em UTC).
 * Convertido explicitamente: senão a comparação dependeria do fuso da sessão do Postgres.
 */
export function instanteUtc(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}
