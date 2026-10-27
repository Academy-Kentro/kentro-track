import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { ufDoDdd } from '../../src/leads/ddd';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from '../meta/apoio';

const prisma = new PrismaClient();

describe('DDD → estado', () => {
  it.each([
    [11, 'SP'],
    [38, 'MG'],
    [61, 'DF'],
    [85, 'CE'],
    [99, 'MA'],
    ['21', 'RJ'],
  ])('%s → %s', (ddd, uf) => expect(ufDoDdd(ddd)).toBe(uf));

  it.each([10, 20, 23, 50, null])('%s não é DDD válido', (ddd) => expect(ufDoDdd(ddd)).toBeNull());
});

describe('aba Análises', () => {
  let app: INestApplication;
  let r: Registro;
  const analises = (q = 'de=2026-10-10&ate=2026-10-16', chave?: string) => comChave(request(app.getHttpServer()).get(`/v1/painel/analises?${q}`), chave ?? r.chaveGestor);

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    r = await registrarConta(app);
    const ca = await prisma.contaAnuncio.create({
      data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true, cargaConcluidaEm: new Date() },
    });
    const base = { contaId: r.contaId, contaAnuncioId: ca.id };
    await prisma.campanha.createMany({ data: [{ ...base, idMeta: '100', nome: 'Black Friday' }, { ...base, idMeta: '101', nome: 'Remarketing' }] });
    await prisma.conjunto.create({ data: { ...base, idMeta: '200', campanhaIdMeta: '100', nome: 'Quente' } });
    await prisma.anuncio.create({ data: { ...base, idMeta: '300', conjuntoIdMeta: '200', campanhaIdMeta: '100', nome: 'Vídeo' } });
    await prisma.insightDiario.createMany({
      data: [
        { ...base, data: new Date('2026-10-10T00:00:00Z'), anuncioIdMeta: '300', conjuntoIdMeta: '200', campanhaIdMeta: '100', investimento: 600 },
        { ...base, data: new Date('2026-10-11T00:00:00Z'), anuncioIdMeta: '301', conjuntoIdMeta: '201', campanhaIdMeta: '101', investimento: 400 },
      ],
    });
    const doAnuncio = { contaAnuncioId: ca.id, campanhaIdMeta: '100', conjuntoIdMeta: '200', anuncioIdMeta: '300' };
    // Segunda-feira, 12/10/2026, 14h em São Paulo = 17h UTC.
    const seg14h = new Date('2026-10-12T17:00:00Z');
    await prisma.lead.createMany({
      data: [
        { contaId: r.contaId, chatId: '1', origem: 'ctwa', etapa: 'venda', valorVenda: 3000, telefone: '5538999990001', recebidoEm: seg14h, atendidoEm: new Date(seg14h.getTime() + 3 * 60000), vendaEm: new Date('2026-10-13T15:00:00Z'), ...doAnuncio },
        { contaId: r.contaId, chatId: '2', origem: 'ctwa', etapa: 'venda', valorVenda: 1000, telefone: '5511999990002', recebidoEm: seg14h, atendidoEm: new Date(seg14h.getTime() + 2 * 3600000), vendaEm: new Date('2026-10-13T16:00:00Z'), ...doAnuncio },
        { contaId: r.contaId, chatId: '3', origem: 'formulario', etapa: 'descartado', motivoDescarte: 'Sem orçamento', telefone: '553899990003', recebidoEm: new Date('2026-10-10T13:00:00Z'), ...doAnuncio },
        { contaId: r.contaId, chatId: '4', origem: 'ctwa', etapa: 'descartado', motivoDescarte: 'Sem orçamento', telefone: '14155550100', recebidoEm: new Date('2026-10-11T13:00:00Z'), contaAnuncioId: ca.id, campanhaIdMeta: '101' },
        { contaId: r.contaId, chatId: '5', origem: 'organico', etapa: 'novo', telefone: '5521988887777', recebidoEm: new Date('2026-10-11T13:00:00Z') },
        // Venda registrada no período, mas o lead chegou antes dele: conta em vendas por dia, não em leads por dia.
        { contaId: r.contaId, chatId: '6', origem: 'ctwa', etapa: 'venda', valorVenda: 500, recebidoEm: new Date('2026-10-01T13:00:00Z'), vendaEm: new Date('2026-10-14T13:00:00Z'), ...doAnuncio },
      ],
    });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('origens com o percentual rastreado (tudo que não é orgânico)', async () => {
    const { body } = await analises();
    expect(body.origens).toEqual({
      total: 5,
      percentualRastreado: 80,
      itens: [
        { origem: 'ctwa', leads: 3, vendas: 2, receita: 4000 },
        { origem: 'formulario', leads: 1, vendas: 0, receita: 0 },
        { origem: 'organico', leads: 1, vendas: 0, receita: 0 },
      ],
    });
  });

  it('por dia: leads pelo dia em que chegaram; vendas e faturamento pelo dia da venda', async () => {
    const { body } = await analises();
    expect(body.porDia).toHaveLength(7);
    const dia = (d: string) => body.porDia.find((x: { data: string }) => x.data === d);
    expect(dia('2026-10-12')).toEqual({ data: '2026-10-12', entradas: 2, vendas: 0, receita: 0 });
    expect(dia('2026-10-13')).toEqual({ data: '2026-10-13', entradas: 0, vendas: 2, receita: 4000 });
    expect(dia('2026-10-14')).toMatchObject({ entradas: 0, vendas: 1, receita: 500 });
  });

  it('jornada (etapa atual) e motivos de descarte', async () => {
    const { body } = await analises();
    expect(body.etapas).toEqual({ venda: 2, descartado: 2, novo: 1 });
    expect(body.motivosDescarte).toEqual([{ motivo: 'Sem orçamento', leads: 2 }]);
  });

  it('estado pelo DDD (com e sem o nono dígito); número estrangeiro fica fora', async () => {
    const { body } = await analises();
    expect(body.estados.itens).toEqual([
      { uf: 'MG', leads: 2, vendas: 1 },
      { uf: 'SP', leads: 1, vendas: 1 },
      { uf: 'RJ', leads: 1, vendas: 0 },
    ]);
    expect(body.estados.ddds).toEqual([
      { ddd: '38', cidade: 'Montes Claros', uf: 'MG', leads: 2, vendas: 1 },
      { ddd: '11', cidade: 'São Paulo', uf: 'SP', leads: 1, vendas: 1 },
      { ddd: '21', cidade: 'Rio de Janeiro', uf: 'RJ', leads: 1, vendas: 0 },
    ]);
  });

  it('hora de chegada no fuso da conta (segunda = 1) e tempo até atender por faixa', async () => {
    const { body } = await analises();
    expect(body.horario).toEqual(expect.arrayContaining([{ diaSemana: 1, hora: 14, leads: 2 }]));
    expect(body.tempoAtendimento.faixas.map((f: { leads: number }) => f.leads)).toEqual([1, 0, 0, 1, 0]);
    expect(body.tempoAtendimento.naoAtendidos).toBe(3);
  });

  it('o que mais vende: campanha, conjunto e anúncio com investimento, receita e ROAS', async () => {
    const { body } = await analises();
    expect(body.ranking.campanhas[0]).toEqual({ idMeta: '100', nome: 'Black Friday', investimento: 600, entradas: 3, vendas: 2, receita: 4000, roas: 6.67, custoPorVenda: 300 });
    expect(body.ranking.campanhas[1]).toMatchObject({ idMeta: '101', nome: 'Remarketing', investimento: 400, entradas: 1, vendas: 0, roas: 0 });
    expect(body.ranking.conjuntos[0]).toMatchObject({ nome: 'Quente', vendas: 2 });
    expect(body.ranking.anuncios[0]).toMatchObject({ nome: 'Vídeo', receita: 4000 });
  });

  it('filtrar a campanha recorta tudo (orgânicos saem)', async () => {
    const { body } = await analises('de=2026-10-10&ate=2026-10-16&campanha=101');
    expect(body.origens).toMatchObject({ total: 1, percentualRastreado: 100 });
    expect(body.ranking.campanhas).toHaveLength(1);
  });

  it('a chave de atendimento não lê as análises', async () => {
    expect((await analises(undefined, r.chaveAtendimento)).status).toBe(403);
  });
});
