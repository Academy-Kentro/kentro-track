import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { mascararTelefone, normalizarTelefone } from '../../src/leads/telefone';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from '../meta/apoio';

const prisma = new PrismaClient();

describe('telefone', () => {
  it.each([
    ['+55 (38) 99999-0000', '5538999990000', '3899990000'],
    ['5538999990000', '5538999990000', '3899990000'],
    ['553899990000', '553899990000', '3899990000'], // sem o nono dígito: mesma chave
    ['38 99999-0000', '5538999990000', '3899990000'],
    ['0055 11 3222-1111', '551132221111', '1132221111'],
    ['+1 415 555 0100', '14155550100', '4155550100'],
  ])('%s → %s (chave %s)', (bruto, telefone, chave) => {
    expect(normalizarTelefone(bruto)).toEqual({ telefone, chave });
  });

  it('lixo vira null', () => {
    expect(normalizarTelefone('abc')).toBeNull();
    expect(normalizarTelefone('123')).toBeNull();
    expect(normalizarTelefone(undefined)).toBeNull();
  });

  it('máscara para o gestor', () => {
    expect(mascararTelefone('5538999990000')).toBe('(38) 9****-0000');
    expect(mascararTelefone('14155550100')).toBe('****0100');
  });
});

/** Conta de anúncio com uma campanha, um conjunto e dois anúncios sincronizados. */
async function semearMeta(r: Registro) {
  const ca = await prisma.contaAnuncio.create({
    data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true, cargaConcluidaEm: new Date() },
  });
  const base = { contaId: r.contaId, contaAnuncioId: ca.id };
  await prisma.campanha.create({ data: { ...base, idMeta: '100', nome: 'Black Friday', statusEfetivo: 'ACTIVE' } });
  await prisma.conjunto.create({ data: { ...base, idMeta: '200', campanhaIdMeta: '100', nome: 'Público quente' } });
  await prisma.anuncio.create({
    data: {
      ...base,
      idMeta: '300',
      conjuntoIdMeta: '200',
      campanhaIdMeta: '100',
      nome: 'Vídeo depoimento',
      titulo: 'Promoção de Outubro',
      texto: 'Chame no WhatsApp e ganhe frete grátis',
      miniaturaUrl: 'https://scontent.example/a.jpg',
      objectStoryId: '111222_987654321',
      statusEfetivo: 'ACTIVE',
    },
  });
  await prisma.anuncio.create({
    data: { ...base, idMeta: '301', conjuntoIdMeta: '200', campanhaIdMeta: '100', nome: 'Reels', permalink: 'https://www.instagram.com/p/ABC123/' },
  });
  return ca;
}

describe('leads no atendimento', () => {
  let app: INestApplication;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const vincular = (corpo: object, chave = r.chaveAtendimento, atendente = { id: '7', nome: 'Ana Lúcia' }) =>
    comChave(http().post('/v1/atendimento/vincular'), chave)
      .set('X-Kentro-Usuario-Id', atendente.id)
      .set('X-Kentro-Usuario-Nome', encodeURIComponent(atendente.nome))
      .send(corpo);
  const etapa = (id: string, corpo: object) => comChave(http().post(`/v1/atendimento/leads/${id}/etapa`), r.chaveAtendimento).send(corpo);

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

  it('anúncio pelo id: ligação exata, com campanha, conjunto, anúncio e miniatura', async () => {
    await semearMeta(r);
    const res = await vincular({ chatId: '501', telefone: '+55 38 99999-0000', nome: 'Maria', contatoId: '9', anuncio: { idAnuncio: '300', titulo: 'Promo' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      origem: 'ctwa',
      etapa: 'em_atendimento',
      nome: 'Maria',
      anuncio: {
        vinculo: 'id',
        campanha: { idMeta: '100', nome: 'Black Friday' },
        conjunto: { nome: 'Público quente' },
        anuncio: { idMeta: '300', nome: 'Vídeo depoimento', titulo: 'Promoção de Outubro' },
        titulo: 'Promo',
      },
    });
    expect(res.body.anuncio.anuncio.miniatura).toMatch(/^https:\/\/tracks\.teste\/m\//);
    const lead = await prisma.lead.findFirstOrThrow();
    expect(lead).toMatchObject({ telefone: '5538999990000', telefoneChave: '3899990000', atendenteId: '7', atendenteNome: 'Ana Lúcia', chatId: '501' });
    expect(res.body.historico.map((h: { tipo: string }) => h.tipo)).toEqual(['recebido']);
  });

  it.each([
    ['link do Instagram (permalink)', { url: 'https://www.instagram.com/p/ABC123/' }, '301', 'url'],
    ['link do post do Facebook (id do post)', { url: 'https://www.facebook.com/loja/posts/987654321' }, '300', 'url'],
    ['título e texto, sem acento e caixa', { titulo: 'promocao de outubro', texto: 'Chame no WhatsApp  e ganhe FRETE grátis' }, '300', 'texto'],
  ])('anúncio pelo %s: ligação aproximada', async (_, anuncio, idMeta, vinculo) => {
    await semearMeta(r);
    const res = await vincular({ chatId: '502', anuncio });
    expect(res.body.anuncio).toMatchObject({ vinculo, anuncio: { idMeta } });
  });

  it('anúncio que não está sincronizado: lead de anúncio sem campanha, guardando o que o cliente viu', async () => {
    await semearMeta(r);
    const res = await vincular({ chatId: '503', anuncio: { titulo: 'Outro anúncio', url: 'https://fb.me/xyz' } });
    expect(res.body).toMatchObject({ origem: 'ctwa', anuncio: { vinculo: null, campanha: null, anuncio: null, titulo: 'Outro anúncio', url: 'https://fb.me/xyz' } });
  });

  it('abrir a mesma conversa de novo não duplica nem repete o histórico', async () => {
    await semearMeta(r);
    await vincular({ chatId: '504', anuncio: { idAnuncio: '300' } });
    const segunda = await vincular({ chatId: '504', anuncio: { idAnuncio: '300' } }, r.chaveAtendimento, { id: '8', nome: 'Bruno' });
    expect(await prisma.lead.count()).toBe(1);
    expect(segunda.body.historico).toHaveLength(1);
    // O primeiro atendente continua sendo o dono do lead.
    expect((await prisma.lead.findFirstOrThrow()).atendenteNome).toBe('Ana Lúcia');
  });

  it('conversa sem anúncio de quem mandou formulário há pouco: continua o lead do formulário', async () => {
    const form = await prisma.lead.create({
      data: { contaId: r.contaId, origem: 'formulario', telefone: '553899990000', telefoneChave: '3899990000', nome: 'Maria', respostas: [{ pergunta: 'Cidade', resposta: 'Montes Claros' }] },
    });
    const res = await vincular({ chatId: '505', telefone: '5538999990000' });
    expect(res.body).toMatchObject({ id: form.id, origem: 'formulario', etapa: 'em_atendimento', respostas: [{ pergunta: 'Cidade', resposta: 'Montes Claros' }] });
    expect(await prisma.lead.count()).toBe(1);
  });

  it('sem anúncio nem formulário: lead orgânico; outras entradas do mesmo número (com e sem nono dígito)', async () => {
    await vincular({ chatId: '506', telefone: '5538999990000' });
    const res = await vincular({ chatId: '507', telefone: '553899990000' });
    expect(res.body).toMatchObject({ origem: 'organico', anuncio: null });
    expect(res.body.outrasEntradas).toHaveLength(1);
  });

  it('venda pede valor, descarte pede motivo; venda conta como qualificado; reabrir volta para em atendimento', async () => {
    const { body: lead } = await vincular({ chatId: '508' });
    expect((await etapa(lead.id, { etapa: 'venda' })).body.erro.codigo).toBe('VALOR_INVALIDO');
    expect((await etapa(lead.id, { etapa: 'descartado' })).body.erro.codigo).toBe('MOTIVO_OBRIGATORIO');

    const venda = await etapa(lead.id, { etapa: 'venda', valor: 1234.5 });
    expect(venda.body).toMatchObject({ etapa: 'venda', valorVenda: 1234.5 });
    const linha = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(linha.qualificadoEm).not.toBeNull();
    expect(linha.vendaEm).not.toBeNull();

    expect((await etapa(lead.id, { etapa: 'em_atendimento' })).body.etapa).toBe('em_atendimento');
    const descarte = await etapa(lead.id, { etapa: 'descartado', motivo: 'Sem orçamento' });
    expect(descarte.body).toMatchObject({ etapa: 'descartado', motivoDescarte: 'Sem orçamento' });
    expect(descarte.body.historico[0].texto).toContain('Sem orçamento');
  });

  it('recusa etapa desconhecida, valor negativo e lead de outra conta', async () => {
    const { body: lead } = await vincular({ chatId: '509' });
    expect((await etapa(lead.id, { etapa: 'ganho' })).status).toBe(400);
    expect((await etapa(lead.id, { etapa: 'venda', valor: -1 })).status).toBe(400);
    const outra = await registrarConta(app, 'Outra');
    const alheio = await comChave(http().post(`/v1/atendimento/leads/${lead.id}/etapa`), outra.chaveAtendimento).send({ etapa: 'qualificado' });
    expect(alheio.status).toBe(404);
  });

  it('a chave de gestor não usa o painel do atendente', async () => {
    expect((await vincular({ chatId: '510' }, r.chaveGestor)).status).toBe(403);
  });

  it('chatId inválido é recusado', async () => {
    expect((await vincular({ chatId: 'abc' })).status).toBe(400);
  });

  it('GET do chat sem lead dá 404 SEM_LEAD; com lead devolve o mesmo do vincular', async () => {
    expect((await comChave(http().get('/v1/atendimento/chat/999'), r.chaveAtendimento)).body.erro.codigo).toBe('SEM_LEAD');
    const { body } = await vincular({ chatId: '511' });
    expect((await comChave(http().get('/v1/atendimento/chat/511'), r.chaveAtendimento)).body.id).toBe(body.id);
  });
});

describe('webhook da automação da Kentro', () => {
  let app: INestApplication;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const integracao = () => comChave(http().get('/v1/kentro/integracao'), r.chaveAdmin);
  const caminho = (url: string) => new URL(url).pathname;

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

  it('só o admin vê a URL; ela vem com os corpos de exemplo das variáveis da Kentro', async () => {
    expect((await comChave(http().get('/v1/kentro/integracao'), r.chaveGestor)).status).toBe(403);
    const res = await integracao();
    expect(res.body.url).toMatch(new RegExp(`^https://tracks\\.teste/v1/kentro/eventos/${r.contaId}\\.[A-Za-z0-9_-]{22}$`));
    expect(res.body.exemplos.chat_iniciado).toMatchObject({ evento: 'chat_iniciado', chatId: '{{chat_id}}', anuncio: { url: '{{message_ad_url}}' } });
  });

  it('atendimento iniciado pela automação e depois aberto no painel: um lead só', async () => {
    await semearMeta(r);
    const { body } = await integracao();
    const res = await http()
      .post(caminho(body.url))
      .send({
        evento: 'chat_iniciado',
        chatId: '601',
        telefone: '5538999990000',
        nome: 'Maria',
        contatoId: '',
        anuncio: { url: '', titulo: 'Promoção de Outubro', texto: 'Chame no WhatsApp e ganhe frete grátis' },
        campoQueAKentroAcrescentou: 'x',
      });
    expect(res.status).toBe(200);
    // Pela automação o lead nasce "novo": pode estar só com a IA.
    expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ origem: 'ctwa', etapa: 'novo', anuncioIdMeta: '300', vinculoAnuncio: 'texto', atendidoEm: null });

    const painel = await comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).send({ chatId: '601' });
    expect(painel.body).toMatchObject({ id: res.body.leadId, etapa: 'em_atendimento' });
    expect(await prisma.lead.count()).toBe(1);
  });

  it('variável da automação que não existia ("{{...}}" ou vazia) é ignorada', async () => {
    const { body } = await integracao();
    await http()
      .post(caminho(body.url))
      .send({ evento: 'chat_iniciado', chatId: '602', telefone: '{{chat_client_number}}', anuncio: { url: '{{message_ad_url}}', titulo: '', texto: '{{message_ad_body}}' } });
    expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ origem: 'organico', telefone: null, anuncioUrl: null });
  });

  it('atendente vem da automação (chat_recent_agent_id) e vale mais que quem abriu o painel', async () => {
    const { body } = await integracao();
    expect(body.exemplos.venda).toMatchObject({ atendenteId: '{{chat_recent_agent_id}}', atendente: '{{chat_agent.agent_full_name}}' });
    // Na entrada ainda não há atendente: a Kentro manda 0 e o nome vazio.
    await http().post(caminho(body.url)).send({ evento: 'chat_iniciado', chatId: '604', atendenteId: '0', atendente: '' });
    expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ atendenteId: null, atendenteNome: null });

    await comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).set('X-Kentro-Usuario-Id', '3').set('X-Kentro-Usuario-Nome', 'Supervisor').send({ chatId: '604' });
    await http().post(caminho(body.url)).send({ evento: 'chat_iniciado', chatId: '604', atendenteId: '7', atendente: 'Ana' });
    expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ atendenteId: '7', atendenteNome: 'Ana' });

    // Sem o nome (chat_agent vazio depois de encerrado), mantém o que já sabia do mesmo atendente.
    await http().post(caminho(body.url)).send({ evento: 'venda', chatId: '604', valor: '100', atendenteId: '7', atendente: '{{chat_agent.agent_full_name}}' });
    expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ etapa: 'venda', atendenteId: '7', atendenteNome: 'Ana' });
  });

  it('venda pela automação com valor em texto brasileiro', async () => {
    const { body } = await integracao();
    await http().post(caminho(body.url)).send({ evento: 'chat_iniciado', chatId: '603' });
    const res = await http().post(caminho(body.url)).send({ evento: 'venda', chatId: '603', valor: '1.234,50' });
    expect(res.status).toBe(200);
    expect(await prisma.lead.findFirstOrThrow()).toMatchObject({ etapa: 'venda' });
    expect(String((await prisma.lead.findFirstOrThrow()).valorVenda)).toBe('1234.5');
  });

  it('evento desconhecido 400; assinatura errada 404; URL antiga para de valer ao gerar outra', async () => {
    const { body } = await integracao();
    expect((await http().post(caminho(body.url)).send({ evento: 'ganhou', chatId: '1' })).body.erro.codigo).toBe('EVENTO_INVALIDO');
    expect((await http().post(`/v1/kentro/eventos/${r.contaId}.AAAAAAAAAAAAAAAAAAAAAA`).send({ evento: 'chat_iniciado', chatId: '1' })).status).toBe(404);

    const nova = await comChave(http().post('/v1/kentro/integracao/rotacionar'), r.chaveAdmin);
    expect(nova.body.url).not.toBe(body.url);
    expect((await http().post(caminho(body.url)).send({ evento: 'chat_iniciado', chatId: '1' })).status).toBe(404);
    expect((await http().post(caminho(nova.body.url)).send({ evento: 'chat_iniciado', chatId: '1' })).status).toBe(200);
  });

  it('conta bloqueada não recebe eventos', async () => {
    const { body } = await integracao();
    await prisma.conta.update({ where: { id: r.contaId }, data: { status: 'bloqueada' } });
    expect((await http().post(caminho(body.url)).send({ evento: 'chat_iniciado', chatId: '1' })).status).toBe(403);
  });
});

describe('funil do atendimento no painel do gestor', () => {
  let app: INestApplication;
  let r: Registro;
  const painel = (rota: string, query: string) => comChave(request(app.getHttpServer()).get(`/v1/painel/${rota}?${query}`), r.chaveGestor);

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

  async function semearFunil() {
    const ca = await semearMeta(r);
    await prisma.insightDiario.create({
      data: { contaId: r.contaId, contaAnuncioId: ca.id, data: new Date('2026-10-10T00:00:00Z'), anuncioIdMeta: '300', conjuntoIdMeta: '200', campanhaIdMeta: '100', investimento: 1000, impressoes: 50000, cliquesLink: 500, conversas: 40 },
    });
    const anuncio = { contaAnuncioId: ca.id, campanhaIdMeta: '100', conjuntoIdMeta: '200', anuncioIdMeta: '300', vinculoAnuncio: 'id' };
    // 10/10 13h em São Paulo = 16h UTC; 11/10 01h30 em São Paulo ainda é dia 11 (04h30 UTC).
    const quando = (iso: string) => new Date(iso);
    await prisma.lead.createMany({
      data: [
        { contaId: r.contaId, origem: 'ctwa', etapa: 'venda', valorVenda: 3000, qualificadoEm: new Date(), vendaEm: new Date(), recebidoEm: quando('2026-10-10T16:00:00Z'), atendenteId: '7', atendenteNome: 'Ana', atendidoEm: quando('2026-10-10T16:10:00Z'), telefone: '5538999990000', nome: 'Maria', chatId: '1', ...anuncio },
        { contaId: r.contaId, origem: 'ctwa', etapa: 'qualificado', qualificadoEm: new Date(), recebidoEm: quando('2026-10-10T17:00:00Z'), atendenteId: '7', atendenteNome: 'Ana', atendidoEm: quando('2026-10-10T17:30:00Z'), chatId: '2', ...anuncio },
        { contaId: r.contaId, origem: 'ctwa', etapa: 'descartado', motivoDescarte: 'Sem orçamento', recebidoEm: quando('2026-10-11T04:30:00Z'), atendenteId: '8', atendenteNome: 'Bruno', chatId: '3', ...anuncio },
        { contaId: r.contaId, origem: 'ctwa', etapa: 'novo', recebidoEm: quando('2026-10-12T12:00:00Z'), chatId: '4' },
        { contaId: r.contaId, origem: 'organico', etapa: 'venda', valorVenda: 500, recebidoEm: quando('2026-10-12T12:00:00Z'), chatId: '5' },
        // Fora do período (10/10 00h30 em São Paulo é 09/10 em... não: 03h30 UTC do dia 10 = 00h30 do dia 10). Este é do dia 09.
        { contaId: r.contaId, origem: 'ctwa', etapa: 'venda', valorVenda: 999, recebidoEm: quando('2026-10-10T02:00:00Z'), chatId: '6', ...anuncio },
      ],
    });
  }

  it('visão geral: entradas, qualificados, vendas, receita, ROAS e custo por venda; orgânicos à parte', async () => {
    await semearFunil();
    const res = await painel('visao-geral', 'de=2026-10-10&ate=2026-10-16');
    expect(res.body.metricas).toMatchObject({ investimento: 1000, entradas: 4, qualificados: 2, vendas: 1, receita: 3000, roas: 3, custoPorVenda: 1000, taxaVenda: 25 });
    expect(res.body.organicos).toBe(1);
  });

  it('campanhas e criativos levam as vendas do anúncio', async () => {
    await semearFunil();
    const campanhas = await painel('campanhas', 'de=2026-10-10&ate=2026-10-16');
    expect(campanhas.body.campanhas[0]).toMatchObject({ idMeta: '100', metricas: { investimento: 1000, entradas: 3, vendas: 1, receita: 3000, roas: 3 } });
    expect(campanhas.body.campanhas[0].conjuntos[0].anuncios[0].metricas).toMatchObject({ vendas: 1, receita: 3000 });
    const criativos = await painel('criativos', 'de=2026-10-10&ate=2026-10-16');
    expect(criativos.body.criativos[0].metricas).toMatchObject({ vendas: 1, custoPorVenda: 1000 });
  });

  it('lista de leads com telefone parcial, contagem por etapa e filtros', async () => {
    await semearFunil();
    const res = await painel('leads', 'de=2026-10-10&ate=2026-10-16');
    expect(res.body.itens).toHaveLength(5);
    expect(res.body.porEtapa).toEqual({ venda: 2, qualificado: 1, descartado: 1, novo: 1 });
    const maria = res.body.itens.find((l: { nome: string }) => l.nome === 'Maria');
    expect(maria).toMatchObject({ telefone: '(38) 9****-0000', campanha: 'Black Friday', anuncio: 'Vídeo depoimento', atendente: 'Ana', valorVenda: 3000, chatId: '1' });
    expect((await painel('leads', 'de=2026-10-10&ate=2026-10-16&origem=organico')).body.itens).toHaveLength(1);
    expect((await painel('leads', 'de=2026-10-10&ate=2026-10-16&etapa=venda')).body.itens).toHaveLength(2);
    expect((await painel('leads', 'de=2026-10-10&ate=2026-10-16&origem=nada')).status).toBe(400);
  });

  it('equipe: por atendente, com tempo médio até atender', async () => {
    await semearFunil();
    const res = await painel('equipe', 'de=2026-10-10&ate=2026-10-16');
    const ana = res.body.atendentes.find((a: { nome: string }) => a.nome === 'Ana');
    expect(ana).toMatchObject({ id: '7', entradas: 2, qualificados: 2, vendas: 1, receita: 3000, taxaVenda: 50, minutosAteAtender: 20 });
    expect(res.body.atendentes.find((a: { nome: string }) => a.nome === 'Sem atendente')).toMatchObject({ entradas: 2 });
    expect(res.body.semAtendente.sort()).toEqual(['4', '5']);
  });

  it('a tela do gestor grava o atendente lido na Kentro só onde faltava', async () => {
    await semearFunil();
    const enviar = (itens: unknown) => comChave(request(app.getHttpServer()).post('/v1/painel/atendentes'), r.chaveGestor).send({ itens });
    const res = await enviar([
      { chatId: '4', atendenteId: '9', atendente: 'Carla' },
      // Já tinha atendente gravado: não troca.
      { chatId: '1', atendenteId: '9', atendente: 'Carla' },
    ]);
    expect(res.body).toEqual({ atualizados: 1 });
    expect(await prisma.lead.findFirstOrThrow({ where: { chatId: '4' } })).toMatchObject({ atendenteId: '9', atendenteNome: 'Carla' });
    expect(await prisma.lead.findFirstOrThrow({ where: { chatId: '1' } })).toMatchObject({ atendenteId: '7', atendenteNome: 'Ana' });
    expect((await painel('equipe', 'de=2026-10-10&ate=2026-10-16')).body.semAtendente).toEqual(['5']);

    expect((await enviar([{ chatId: '5', atendenteId: '0', atendente: 'X' }])).status).toBe(400);
    expect((await comChave(request(app.getHttpServer()).post('/v1/painel/atendentes'), r.chaveAtendimento).send({ itens: [] })).status).toBe(403);
  });
});
