import { readFileSync } from 'node:fs';
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

  it('etapas do funil: as etapas de antes viram a lista da conta e os leads acompanham', async () => {
    const conta = await prisma.conta.create({ data: novaConta() });
    const outra = await prisma.conta.create({ data: novaConta('2') });
    // Quem já tinha trocado o evento da venda no pixel continua com o dele.
    await prisma.configCapi.create({ data: { contaId: conta.id, mapeamento: { venda: 'CompraKentro', descartado: 'Perdido' } } });
    const base = { contaId: conta.id, origem: 'ctwa' as const };
    await prisma.lead.createMany({
      data: [
        { ...base, chatId: '1', etapa: 'venda', qualificadoEm: new Date(), valorVenda: 10 },
        { ...base, chatId: '2', etapa: 'qualificado', qualificadoEm: new Date() },
        { ...base, chatId: '3', etapa: 'descartado', qualificadoEm: new Date() },
        { ...base, chatId: '4', etapa: 'descartado' },
        { ...base, chatId: '5', etapa: 'em_atendimento' },
      ],
    });

    // Roda de novo a parte de dados da migração, sobre leads no formato de antes.
    const sql = readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', '20261025120000_etapas_funil', 'migration.sql'), 'utf8');
    const dados = sql.slice(sql.indexOf('-- As etapas de antes'));
    for (const comando of dados.split(/;\s*\n/).map((c) => c.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await prisma.$executeRawUnsafe(comando);

    const etapas = await prisma.etapaFunil.findMany({ where: { contaId: conta.id }, orderBy: { ordem: 'asc' } });
    expect(etapas.map((e) => [e.chave, e.tipo, e.qualificada, e.eventoMeta])).toEqual([
      ['qualificado', 'andamento', true, 'QualifiedLead'],
      ['venda', 'venda', false, 'CompraKentro'],
      ['descartado', 'perda', false, 'Perdido'],
    ]);
    expect((await prisma.etapaFunil.findMany({ where: { contaId: outra.id } })).map((e) => e.eventoMeta)).toEqual(['QualifiedLead', 'Purchase', null]);

    const id = Object.fromEntries(etapas.map((e) => [e.chave, e.id]));
    const leads = await prisma.lead.findMany({ where: { contaId: conta.id }, orderBy: { chatId: 'asc' } });
    expect(leads.map((l) => [l.chatId, l.etapaId, l.etapasAlcancadas])).toEqual([
      ['1', id.venda, [id.venda]],
      ['2', id.qualificado, [id.qualificado]],
      ['3', id.descartado, [id.qualificado]],
      ['4', id.descartado, []],
      ['5', null, []],
    ]);
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
