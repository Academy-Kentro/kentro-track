import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { chaveDe } from '../src/etapas/etapas.service';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';

const prisma = new PrismaClient();

interface Etapa {
  id: string;
  chave: string;
  nome: string;
  tipo: string;
  qualificada: boolean;
  eventoMeta: string | null;
  botaoAtendente: boolean;
  noPainel: boolean;
  ativa: boolean;
}

describe('etapas do funil', () => {
  let app: INestApplication;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const listar = (chave = r.chaveAdmin) => comChave(http().get('/v1/etapas'), chave);
  const salvar = (etapas: object[], chave = r.chaveAdmin) => comChave(http().put('/v1/etapas'), chave).send({ etapas });
  const vincular = (corpo: object) =>
    comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).set('X-Kentro-Usuario-Id', '7').set('X-Kentro-Usuario-Nome', 'Ana').send(corpo);
  const mover = (id: string, corpo: object) => comChave(http().post(`/v1/atendimento/leads/${id}/etapa`), r.chaveAtendimento).send(corpo);
  const painel = (rota: string) => comChave(http().get(`/v1/painel/${rota}?de=2026-10-01&ate=2026-10-31`), r.chaveGestor);

  /** A lista do cliente: Engajou → Agendou → Visitou → Vendeu, e Desqualificado como saída. */
  async function funilDoCliente(): Promise<Record<string, Etapa>> {
    const atuais: Etapa[] = (await listar()).body.etapas;
    const venda = atuais.find((e) => e.chave === 'venda')!;
    const descartado = atuais.find((e) => e.chave === 'descartado')!;
    const res = await salvar([
      { nome: 'Engajou', tipo: 'andamento', eventoMeta: 'Contact' },
      { nome: 'Agendou', tipo: 'andamento', qualificada: true, eventoMeta: 'Schedule' },
      { nome: 'Visitou', tipo: 'andamento', botaoAtendente: false },
      { id: venda.id, nome: 'Vendeu', tipo: 'venda', eventoMeta: 'Purchase' },
      { id: descartado.id, nome: 'Desqualificado', tipo: 'perda' },
    ]);
    expect(res.status).toBe(200);
    return Object.fromEntries((res.body.etapas as Etapa[]).map((e) => [e.nome, e]));
  }

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    r = await registrarConta(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('conta nova começa com Qualificado, Venda e Descartado; todos leem, só o admin muda', async () => {
    const res = await listar(r.chaveGestor);
    expect(res.body.etapas.map((e: Etapa) => [e.chave, e.tipo, e.qualificada, e.eventoMeta])).toEqual([
      ['qualificado', 'andamento', true, 'QualifiedLead'],
      ['venda', 'venda', false, 'Purchase'],
      ['descartado', 'perda', false, null],
    ]);
    expect((await listar(r.chaveAtendimento)).status).toBe(200);
    expect((await salvar([{ nome: 'X', tipo: 'andamento' }], r.chaveGestor)).status).toBe(403);
  });

  it('cria, renomeia e reordena: a chave nasce do nome e não muda ao renomear', async () => {
    const e = await funilDoCliente();
    expect(Object.values(e).map((x) => [x.nome, x.chave])).toEqual([
      ['Engajou', 'engajou'],
      ['Agendou', 'agendou'],
      ['Visitou', 'visitou'],
      ['Vendeu', 'venda'],
      ['Desqualificado', 'descartado'],
    ]);
    expect(chaveDe('Pós-venda Ágil!')).toBe('pos_venda_agil');
    expect((await salvar([{ nome: 'A', tipo: 'andamento' }, { nome: 'a', tipo: 'venda' }])).body.erro.codigo).toBe('NOME_REPETIDO');
    expect((await salvar([{ nome: 'A', tipo: 'andamento', eventoMeta: 'com espaço' }])).status).toBe(400);
  });

  it('atendente: os botões são as etapas ativas marcadas para ele; a etapa leva o lead e as métricas', async () => {
    const e = await funilDoCliente();
    const { body: lead } = await vincular({ chatId: '801' });
    expect(lead.etapas.map((x: Etapa) => x.nome)).toEqual(['Engajou', 'Agendou', 'Vendeu', 'Desqualificado']);

    // Engajou ainda não qualifica; Agendou sim (e tudo depois dele).
    let res = await mover(lead.id, { etapa: e.Engajou.id });
    expect(res.body).toMatchObject({ etapa: 'em_atendimento', etapaId: e.Engajou.id, etapaNome: 'Engajou' });
    res = await mover(lead.id, { etapa: e.Visitou.id });
    expect(res.body).toMatchObject({ etapa: 'qualificado', etapaNome: 'Visitou' });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).qualificadoEm).not.toBeNull();

    res = await mover(lead.id, { etapa: e.Vendeu.id });
    expect(res.body.erro.codigo).toBe('VALOR_INVALIDO');
    res = await mover(lead.id, { etapa: e.Vendeu.id, valor: 1500 });
    expect(res.body).toMatchObject({ etapa: 'venda', etapaNome: 'Vendeu', valorVenda: 1500 });
    expect(res.body.historico[0].texto).toContain('Venda registrada (Vendeu): R$');

    // Reabrir volta para "em atendimento", fora de qualquer etapa.
    res = await mover(lead.id, { etapa: 'em_atendimento' });
    expect(res.body).toMatchObject({ etapa: 'em_atendimento', etapaId: null });
    res = await mover(lead.id, { etapa: e.Desqualificado.id, motivo: 'Sem orçamento' });
    expect(res.body).toMatchObject({ etapa: 'descartado', etapaNome: 'Desqualificado', motivoDescarte: 'Sem orçamento' });
  });

  it('etapa com leads não é excluída, só desativada; desativada não recebe lead nem vira botão', async () => {
    const e = await funilDoCliente();
    const { body: lead } = await vincular({ chatId: '802' });
    await mover(lead.id, { etapa: e.Engajou.id });

    const semEngajou = Object.values(e).filter((x) => x.nome !== 'Engajou');
    const res = await salvar(semEngajou);
    expect(res.status).toBe(409);
    expect(res.body.erro.codigo).toBe('ETAPA_EM_USO');

    await salvar(Object.values(e).map((x) => (x.nome === 'Engajou' ? { ...x, ativa: false } : x)));
    expect((await mover(lead.id, { etapa: e.Engajou.id })).body.erro.codigo).toBe('ETAPA_DESATIVADA');
    const { body: outro } = await vincular({ chatId: '803' });
    expect(outro.etapas.map((x: Etapa) => x.nome)).not.toContain('Engajou');

    // Etapa sem nenhum lead sai da lista.
    expect((await salvar(Object.values(e).filter((x) => x.nome !== 'Visitou'))).status).toBe(200);
  });

  it('funil e equipe: cada etapa conta quem chegou até ela ou além; perda conta quem está nela; oculta fica fora', async () => {
    const e = await funilDoCliente();
    await salvar(Object.values(e).map((x) => (x.nome === 'Visitou' ? { ...x, noPainel: false } : x)));
    const base = { contaId: r.contaId, origem: 'ctwa' as const, recebidoEm: new Date('2026-10-10T15:00:00Z') };
    await prisma.lead.createMany({
      data: [
        // Marcado direto como Agendou: conta em Engajou também.
        { ...base, chatId: '1', etapaId: e.Agendou.id, etapasAlcancadas: [e.Agendou.id], etapa: 'qualificado', atendenteId: '7', atendenteNome: 'Ana' },
        { ...base, chatId: '2', etapaId: e.Vendeu.id, etapasAlcancadas: [e.Vendeu.id], etapa: 'venda', valorVenda: 900, atendenteId: '7', atendenteNome: 'Ana' },
        { ...base, chatId: '3', etapaId: e.Desqualificado.id, etapasAlcancadas: [e.Engajou.id], etapa: 'descartado', atendenteId: '8', atendenteNome: 'Bruno' },
        { ...base, chatId: '4' },
      ],
    });

    const visao = await painel('visao-geral');
    expect(visao.body.funil.map((x: { nome: string; leads: number }) => [x.nome, x.leads])).toEqual([
      ['Engajou', 3],
      ['Agendou', 2],
      ['Vendeu', 1],
    ]);

    const equipe = await painel('equipe');
    expect(equipe.body.etapas.map((x: Etapa) => x.nome)).toEqual(['Engajou', 'Agendou', 'Vendeu', 'Desqualificado']);
    const ana = equipe.body.atendentes.find((a: { nome: string }) => a.nome === 'Ana');
    expect(ana.porEtapa).toEqual({ [e.Engajou.id]: 2, [e.Agendou.id]: 2, [e.Vendeu.id]: 1 });
    const bruno = equipe.body.atendentes.find((a: { nome: string }) => a.nome === 'Bruno');
    expect(bruno.porEtapa).toEqual({ [e.Engajou.id]: 1, [e.Desqualificado.id]: 1 });

    const leads = await painel('leads');
    expect(leads.body.porEtapa).toMatchObject({ [e.Agendou.id]: 1, [e.Vendeu.id]: 1, [e.Desqualificado.id]: 1, novo: 1 });
    expect(leads.body.itens.find((l: { chatId: string }) => l.chatId === '1')).toMatchObject({ etapaNome: 'Agendou', etapaTipo: 'andamento' });
  });

  it('automação da Kentro: cada etapa é um evento pela chave; os nomes de antes ainda valem', async () => {
    await funilDoCliente();
    const { body } = await comChave(http().get('/v1/kentro/integracao'), r.chaveAdmin);
    expect(Object.keys(body.exemplos)).toEqual(['chat_iniciado', 'engajou', 'agendou', 'visitou', 'venda', 'descartado']);
    expect(body.exemplos.venda).toMatchObject({ evento: 'venda', valor: '{{opportunity_value}}' });
    expect(body.exemplos.descartado).toMatchObject({ evento: 'descartado', motivo: 'Sem interesse' });

    const caminho = new URL(body.url).pathname;
    expect((await http().post(caminho).send({ evento: 'agendou', chatId: '901' })).status).toBe(200);
    expect(await prisma.lead.findFirstOrThrow({ where: { chatId: '901' } })).toMatchObject({ etapa: 'qualificado' });
    // "qualificado" (de antes) cai na primeira etapa que qualifica: Agendou.
    await http().post(caminho).send({ evento: 'qualificado', chatId: '902' });
    const lead = await prisma.lead.findFirstOrThrow({ where: { chatId: '902' }, include: { etapaFunil: true } });
    expect(lead.etapaFunil?.nome).toBe('Agendou');
    const errado = await http().post(caminho).send({ evento: 'ganhou', chatId: '903' });
    expect(errado.body.erro).toMatchObject({ codigo: 'EVENTO_INVALIDO', mensagem: expect.stringContaining('agendou') });
    expect(await prisma.lead.count({ where: { chatId: '903' } })).toBe(0);
  });
});
