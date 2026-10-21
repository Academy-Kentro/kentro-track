import { PrismaClient } from '@prisma/client';

/**
 * O registro de chamadas ao Meta é gravado em segundo plano: um INSERT do teste anterior pode disputar
 * a trava com o TRUNCATE. Tenta de novo em vez de falhar o teste seguinte.
 */
export async function limparBanco(prisma: PrismaClient): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await prisma.$executeRawUnsafe('TRUNCATE contas, chamadas_meta CASCADE');
      return;
    } catch (erro) {
      if (tentativa >= 5) throw erro;
      await new Promise((r) => setTimeout(r, 100 * tentativa));
    }
  }
}
