import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { aplicarMigracoes } from '../src/comum/migracoes';
import { limparBanco } from './limpar';

const novaConta = (sufixo = '') => ({ chaveAdminHash: `a${sufixo}`, chaveGestorHash: `g${sufixo}`, chaveAtendimentoHash: `k${sufixo}` });

describe('migrações e tabela contas', () => {
  const prisma = new PrismaClient();

  beforeEach(() => limparBanco(prisma));
  afterAll(() => prisma.$disconnect());

  it('reaplicar as migrações num banco já migrado não falha', () => {
    expect(() => aplicarMigracoes(process.env.DATABASE_URL!, path.join(__dirname, '..', 'prisma', 'schema.prisma'))).not.toThrow();
  });

  it('conta nasce pendente de conexão, no plano grátis, em BRL e no fuso de São Paulo', async () => {
    const conta = await prisma.conta.create({ data: novaConta() });
    expect(conta).toMatchObject({ status: 'pendente_conexao', plano: 'gratis', limites: {}, moeda: 'BRL', fuso: 'America/Sao_Paulo' });
  });

  it.each(['chaveAdminHash', 'chaveGestorHash', 'chaveAtendimentoHash'] as const)('não aceita duas contas com o mesmo %s', async (campo) => {
    await prisma.conta.create({ data: novaConta() });
    await expect(prisma.conta.create({ data: { ...novaConta('2'), [campo]: novaConta()[campo] } })).rejects.toMatchObject({
      code: 'P2002',
    } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });
});
