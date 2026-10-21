import { INestApplication } from '@nestjs/common';
import { Lead, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { hash, lerMapeamento, MAPEAMENTO_PADRAO, montarEvento } from '../../src/capi/evento';
import { CapiService } from '../../src/capi/capi.service';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from '../meta/apoio';
import { comUsuarioDoSistema, erroMeta, metaFalso, Requisicao, TOKEN_FALSO } from '../meta/meta-falso';

const prisma = new PrismaClient();

describe('montarEvento', () => {
  const lead = (l: Partial<Lead>) =>
    ({ id: 'lead-1', contaId: 'c', origem: 'ctwa', telefone: '5538999990000', nome: 'José da Silva', email: null, valorVenda: null, leadgenId: null, ctwaClid: null, ...l }) as Lead;
  const ctx = { moeda: 'BRL', wabaId: null, quando: new Date('2026-10-23T12:00:00Z') };

  it('clique para WhatsApp sem ctwa_clid: "chat" com telefone, nome e país em hash', () => {
    const { eventId, payload } = montarEvento(lead({}), 'lead_recebido', 'Lead', ctx);
    expect(eventId).toBe('kt-lead-1-lead_recebido');
    expect(payload).toEqual({
      event_name: 'Lead',
      event_time: Date.parse('2026-10-23T12:00:00Z') / 1000,
      event_id: 'kt-lead-1-lead_recebido',
      action_source: 'chat',
      user_data: { external_id: [hash('lead-1')], ph: [hash('5538999990000')], country: [hash('br')], fn: [hash('jose')], ln: [hash('silva')] },
    });
    expect(JSON.stringify(payload)).not.toContain('99999');
  });

  it('com ctwa_clid e a conta do WhatsApp Business: mensageria comercial', () => {
    const { payload } = montarEvento(lead({ ctwaClid: 'ARAkLk' }), 'qualificado', 'QualifiedLead', { ...ctx, wabaId: '1234567' });
    expect(payload).toMatchObject({
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: 'ARAkLk', whatsapp_business_account_id: '1234567' },
    });
  });

  it('formulário: integração de leads de CRM pelo lead_id', () => {
    const { payload } = montarEvento(lead({ origem: 'formulario', leadgenId: '9876543210' }), 'qualificado', 'QualifiedLead', ctx);
    expect(payload).toMatchObject({
      action_source: 'system_generated',
      user_data: { lead_id: '9876543210' },
      custom_data: { event_source: 'crm', lead_event_source: 'Kentro Track' },
    });
  });

  it('venda leva valor e moeda', () => {
    const { payload } = montarEvento(lead({ valorVenda: 1234.5 as never }), 'venda', 'Purchase', ctx);
    expect(payload.custom_data).toEqual({ value: 1234.5, currency: 'BRL' });
  });

  it('mapeamento: aceita nome de evento válido e null; ignora o resto', () => {
    expect(lerMapeamento(undefined)).toEqual(MAPEAMENTO_PADRAO);
    expect(lerMapeamento({ venda: 'CompraKentro', descartado: null, qualificado: 'com espaço', lead_recebido: 42 })).toEqual({
      lead_recebido: 'Lead',
      qualificado: 'QualifiedLead',
      venda: 'CompraKentro',
      descartado: null,
    });
  });
});

describe('API de Conversões', () => {
  const meta = metaFalso();
  let app: INestApplication;
  let capi: CapiService;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const config = (corpo: object, chave = r.chaveAdmin) => comChave(http().put('/v1/eventos/configuracao'), chave).send(corpo);
  const vincular = (corpo: object) => comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).send(corpo);
  const etapa = (id: string, corpo: object) => comChave(http().post(`/v1/atendimento/leads/${id}/etapa`), r.chaveAtendimento).send(corpo);
  const eventosEnviados = () => meta.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '555666777/events');

  // O fake guarda o corpo das requisições para conferir o que foi ao Meta.
  const corpos: unknown[] = [];
  const fetchComCorpo: typeof fetch = async (url, init) => {
    if (init?.body) corpos.push(JSON.parse(String(init.body)));
    return meta.fetch(url, init);
  };

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' }, { fetch: fetchComCorpo });
    capi = app.get(CapiService);
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    meta.limpar();
    corpos.length = 0;
    r = await registrarConta(app);
    comUsuarioDoSistema(meta);
    await comChave(http().put('/v1/meta/token-manual'), r.chaveAdmin).send({ token: TOKEN_FALSO });
    meta.post('555666777/events', { corpo: { events_received: 1, fbtrace_id: 'TRACE-OK' } });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function ligar(extra: object = {}) {
    const res = await config({ ativo: true, datasetId: '555666777', datasetNome: 'Pixel Loja', ...extra });
    expect(res.status).toBe(200);
    return res.body;
  }

  it('configuração: só o admin; ligar exige pixel; o token próprio nunca volta', async () => {
    expect((await comChave(http().get('/v1/eventos/configuracao'), r.chaveGestor)).status).toBe(403);
    expect((await config({ ativo: true })).body.erro.codigo).toBe('PIXEL_OBRIGATORIO');
    const salvo = await ligar({ token: 'EAAPIXEL' + 'z'.repeat(30), wabaId: '1234567', mapeamento: { descartado: 'LeadPerdido' } });
    expect(salvo).toEqual({
      ativo: true,
      datasetId: '555666777',
      datasetNome: 'Pixel Loja',
      tokenProprio: true,
      wabaId: '1234567',
      codigoTeste: null,
      mapeamento: { lead_recebido: 'Lead', qualificado: 'QualifiedLead', venda: 'Purchase', descartado: 'LeadPerdido' },
    });
    expect(JSON.stringify(salvo)).not.toContain('EAAPIXEL');
    expect((await config({ token: null })).body.tokenProprio).toBe(false);
    expect((await config({ datasetId: 'abc' })).status).toBe(400);
    expect((await config({ mapeamento: { venda: 'com espaço' } })).status).toBe(400);
  });

  it('lista os pixels das contas de anúncio selecionadas', async () => {
    const ca = await prisma.contaAnuncio.findFirstOrThrow({ where: { idMeta: 'act_111' } });
    await prisma.contaAnuncio.update({ where: { id: ca.id }, data: { selecionada: true } });
    meta.get('act_111/adspixels', { corpo: { data: [{ id: '555666777', name: 'Pixel Loja', last_fired_time: '2026-10-22T10:00:00+0000' }] } });
    const res = await comChave(http().get('/v1/eventos/pixels'), r.chaveAdmin);
    expect(res.body.pixels).toEqual([{ id: '555666777', nome: 'Pixel Loja', ultimoDisparo: '2026-10-22T10:00:00+0000', contaAnuncio: 'Loja Principal' }]);
  });

  it('lead de anúncio → "Lead"; venda → "QualifiedLead" e "Purchase" com valor; tudo enviado na fila', async () => {
    await ligar();
    const { body: lead } = await vincular({ chatId: '701', telefone: '5538999990000', nome: 'Maria', anuncio: { titulo: 'Promo' } });
    await etapa(lead.id, { etapa: 'venda', valor: 500 });

    expect(await capi.enviarPendentes()).toBe(3);
    const nomes = corpos.map((c) => (c as { data: { event_name: string }[] }).data[0].event_name);
    expect(nomes).toEqual(['Lead', 'QualifiedLead', 'Purchase']);
    const compra = (corpos[2] as { data: Record<string, unknown>[] }).data[0];
    expect(compra).toMatchObject({ event_id: `kt-${lead.id}-venda`, custom_data: { value: 500, currency: 'BRL' }, action_source: 'chat' });
    // O token vai no cabeçalho; o corpo não leva o telefone em claro.
    expect(eventosEnviados().every((c) => c.autorizacao === `Bearer ${TOKEN_FALSO}`)).toBe(true);
    expect(JSON.stringify(corpos)).not.toContain('5538999990000');

    const envios = await comChave(http().get('/v1/eventos/envios'), r.chaveAdmin);
    expect(envios.body.ultimos30Dias).toEqual({ enviado: 3 });
    expect(envios.body.envios[0]).toMatchObject({ evento: 'Purchase', status: 'enviado', fbtraceId: 'TRACE-OK', lead: 'Maria' });

    // O painel do atendente mostra que o Meta recebeu.
    const painel = await comChave(http().get('/v1/atendimento/chat/701'), r.chaveAtendimento);
    expect(painel.body.eventosMeta).toEqual([
      { gatilho: 'lead_recebido', evento: 'Lead', status: 'enviado' },
      { gatilho: 'qualificado', evento: 'QualifiedLead', status: 'enviado' },
      { gatilho: 'venda', evento: 'Purchase', status: 'enviado' },
    ]);
  });

  it('nada vai ao Meta com o envio desligado, para lead orgânico ou para gatilho sem evento', async () => {
    const { body: organico } = await vincular({ chatId: '702' });
    await etapa(organico.id, { etapa: 'qualificado' });
    expect(await prisma.envioCapi.count()).toBe(0);

    await ligar({ mapeamento: { lead_recebido: null } });
    await etapa(organico.id, { etapa: 'venda', valor: 10 });
    const { body: doAnuncio } = await vincular({ chatId: '703', anuncio: { titulo: 'Promo' } });
    await etapa(doAnuncio.id, { etapa: 'descartado', motivo: 'Sem interesse' });
    expect(await prisma.envioCapi.count()).toBe(0);
  });

  it('o mesmo gatilho não sai duas vezes (vender, reabrir e vender de novo)', async () => {
    await ligar();
    const { body: lead } = await vincular({ chatId: '704', anuncio: { titulo: 'Promo' } });
    await etapa(lead.id, { etapa: 'venda', valor: 10 });
    await etapa(lead.id, { etapa: 'em_atendimento' });
    await etapa(lead.id, { etapa: 'venda', valor: 20 });
    expect(await prisma.envioCapi.count({ where: { gatilho: 'venda' } })).toBe(1);
  });

  it('modo teste: manda o test_event_code junto', async () => {
    await ligar({ codigoTeste: 'TEST123' });
    await vincular({ chatId: '705', anuncio: { titulo: 'Promo' } });
    await capi.enviarPendentes();
    expect(corpos[0]).toMatchObject({ test_event_code: 'TEST123' });
  });

  it('Meta instável: tenta de novo em 1 min, 5 min...; recusa do Meta vira erro sem insistir', async () => {
    await ligar();
    meta.post('555666777/events', erroMeta(2, 'Service unavailable', 503));
    await vincular({ chatId: '706', anuncio: { titulo: 'Promo' } });
    const agora = new Date();
    await capi.enviarPendentes(agora);
    let envio = await prisma.envioCapi.findFirstOrThrow();
    expect(envio).toMatchObject({ status: 'pendente', tentativas: 1, emEnvioAte: null });
    expect(envio.proximaTentativaEm.getTime()).toBe(agora.getTime() + 60_000);
    // Antes do horário, nada sai.
    expect(await capi.enviarPendentes(new Date(agora.getTime() + 30_000))).toBe(0);

    meta.post('555666777/events', erroMeta(100, 'Invalid parameter: event_name'));
    await capi.enviarPendentes(new Date(agora.getTime() + 61_000));
    envio = await prisma.envioCapi.findFirstOrThrow();
    expect(envio).toMatchObject({ status: 'erro', tentativas: 2, erro: 'Invalid parameter: event_name', fbtraceId: 'TRACE' });

    // O admin corrige e reenvia.
    meta.post('555666777/events', { corpo: { events_received: 1 } });
    const reenvio = await comChave(http().post(`/v1/eventos/envios/${envio.id}/reenviar`), r.chaveAdmin);
    expect(reenvio.status).toBe(200);
    await capi.enviarPendentes(new Date(Date.now() + 1000));
    expect((await prisma.envioCapi.findFirstOrThrow()).status).toBe('enviado');
  });

  it('token da conexão recusado: a conta vai para reconectar e o envio espera (não se perde)', async () => {
    await ligar();
    meta.post('555666777/events', erroMeta(190, 'Session has expired'));
    await vincular({ chatId: '707', anuncio: { titulo: 'Promo' } });
    await capi.enviarPendentes();
    expect(await prisma.envioCapi.findFirstOrThrow()).toMatchObject({ status: 'pendente', erro: 'Session has expired' });
    expect((await prisma.conexaoMeta.findUniqueOrThrow({ where: { contaId: r.contaId } })).status).toBe('reconectar');
  });

  it('com token próprio do pixel, usa ele (e o token caído não derruba a conexão)', async () => {
    const proprio = 'EAAPIXEL' + 'p'.repeat(30);
    await ligar({ token: proprio });
    meta.post('555666777/events', erroMeta(190, 'Pixel token expired'));
    await vincular({ chatId: '708', anuncio: { titulo: 'Promo' } });
    await capi.enviarPendentes();
    expect(eventosEnviados()[0].autorizacao).toBe(`Bearer ${proprio}`);
    expect((await prisma.conexaoMeta.findUniqueOrThrow({ where: { contaId: r.contaId } })).status).toBe('ativa');
  });

  it('evento de teste: exige o código; manda com test_event_code e devolve o que o Meta respondeu', async () => {
    await ligar();
    expect((await comChave(http().post('/v1/eventos/testar'), r.chaveAdmin).send({})).body.erro.codigo).toBe('CODIGO_TESTE_OBRIGATORIO');
    const res = await comChave(http().post('/v1/eventos/testar'), r.chaveAdmin).send({ codigoTeste: 'TEST999' });
    expect(res.body).toEqual({ ok: true, eventosRecebidos: 1, fbtraceId: 'TRACE-OK', evento: 'Lead' });
    expect(corpos.at(-1)).toMatchObject({ test_event_code: 'TEST999', data: [{ event_name: 'Lead', action_source: 'chat' }] });

    meta.post('555666777/events', erroMeta(100, 'Invalid dataset'));
    const ruim = await comChave(http().post('/v1/eventos/testar'), r.chaveAdmin).send({ codigoTeste: 'TEST999' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.erro.mensagem).toContain('Invalid dataset');
  });

  it('reenviar: só envio da própria conta e que ainda não foi recebido', async () => {
    await ligar();
    await vincular({ chatId: '709', anuncio: { titulo: 'Promo' } });
    await capi.enviarPendentes();
    const envio = await prisma.envioCapi.findFirstOrThrow();
    expect((await comChave(http().post(`/v1/eventos/envios/${envio.id}/reenviar`), r.chaveAdmin)).body.erro.codigo).toBe('JA_ENVIADO');
    const outra = await registrarConta(app, 'Outra');
    expect((await comChave(http().post(`/v1/eventos/envios/${envio.id}/reenviar`), outra.chaveAdmin)).status).toBe(404);
  });

  it('dois ciclos ao mesmo tempo não mandam o mesmo evento duas vezes', async () => {
    await ligar();
    await vincular({ chatId: '710', anuncio: { titulo: 'Promo' } });
    const [a, b] = await Promise.all([capi.enviarPendentes(), capi.enviarPendentes()]);
    expect(a + b).toBe(1);
    expect(eventosEnviados()).toHaveLength(1);
  });
});

export type { Requisicao };
