import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { LeadsService } from '../src/leads/leads.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';

const prisma = new PrismaClient();
// Endereço de documentação: é público para a validação e não resolve para a rede interna.
const DESTINO = 'https://203.0.113.10/leads';
const OUTRO_DESTINO = 'https://203.0.113.20/leads';
const ANUNCIO = { anuncio: { titulo: 'Promo' } };

describe('webhook de leads', () => {
  let app: INestApplication;
  let r: Registro;
  let url: string;
  let status = 200;
  let recebidos: { url: string; corpo: string; assinatura: string; redirect?: string }[] = [];
  const http = () => request(app.getHttpServer());
  const admin = (req: request.Test) => comChave(req, r.chaveAdmin);
  const fila = () => app.get(WebhooksService);
  const salvar = async (destino: string | null = DESTINO) => (await admin(http().put('/v1/webhooks')).send({ url: destino })).body;
  const evento = (corpo: object) => http().post(new URL(url).pathname).send({ chatId: '700', telefone: '5538999990000', nome: 'Maria', ...corpo });
  const formulario = (leadgenId = 'L1') =>
    app.get(LeadsService).registrarFormulario(
      r.contaId,
      {
        leadgenId,
        formularioIdMeta: 'F1',
        formularioNome: 'Cadastro',
        criadoEm: new Date(),
        nome: 'Joana',
        telefone: '5531988880000',
        email: 'joana@exemplo.com.br',
        respostas: [{ chave: 'Qual a cidade?', pergunta: 'Qual a cidade?', resposta: 'Montes Claros' }],
      },
      false,
    );

  beforeAll(async () => {
    app = await criarAppDeTeste(
      { urlPublica: 'https://tracks.teste' },
      {
        fetch: (async (u: string, opcoes: RequestInit) => {
          recebidos.push({ url: String(u), corpo: String(opcoes.body), assinatura: new Headers(opcoes.headers).get('X-Kentro-Track-Assinatura') ?? '', redirect: opcoes.redirect });
          return new Response('{}', { status });
        }) as unknown as typeof fetch,
      },
    );
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    status = 200;
    recebidos = [];
    r = await registrarConta(app);
    url = (await admin(http().get('/v1/kentro/integracao'))).body.url;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('cadastro', () => {
    it('só o admin mexe; um endereço por conta; vazio remove; o segredo não muda', async () => {
      expect((await comChave(http().get('/v1/webhooks'), r.chaveGestor)).status).toBe(403);
      expect((await comChave(http().put('/v1/webhooks'), r.chaveGestor).send({ url: DESTINO })).status).toBe(403);
      const primeiro = await salvar();
      expect(primeiro).toMatchObject({ url: DESTINO, envios: [] });
      expect(primeiro.segredo).toHaveLength(22);
      expect(await salvar(OUTRO_DESTINO)).toMatchObject({ url: OUTRO_DESTINO, segredo: primeiro.segredo });
      expect(await prisma.webhookSaida.count({ where: { contaId: r.contaId } })).toBe(1);
      expect(await salvar(null)).toMatchObject({ url: null, segredo: primeiro.segredo });
      expect(await prisma.webhookSaida.count({ where: { contaId: r.contaId } })).toBe(0);
    });

    it.each([
      ['http://exemplo.com/a'],
      ['https://localhost/a'],
      ['https://127.0.0.1/a'],
      ['https://10.0.0.5/a'],
      ['https://192.168.0.1/a'],
      ['https://169.254.169.254/latest/meta-data'],
      ['https://[::1]/a'],
      ['https://usuario:senha@exemplo.com/a'],
      ['https://servico.internal/a'],
      ['nao é url'],
    ])('recusa %s, ao salvar e ao testar', async (destino) => {
      const res = await admin(http().put('/v1/webhooks')).send({ url: destino });
      expect(res.status).toBe(400);
      expect(res.body.erro.codigo).toBe('URL_INVALIDA');
      expect((await admin(http().post('/v1/webhooks/testar')).send({ url: destino })).body.erro.codigo).toBe('URL_INVALIDA');
      expect(recebidos).toHaveLength(0);
    });

    it('o endereço de uma conta não recebe o lead de outra', async () => {
      await salvar();
      const outra = await registrarConta(app, 'Outra');
      const urlOutra = (await comChave(http().get('/v1/kentro/integracao'), outra.chaveAdmin)).body.url;
      await http().post(new URL(urlOutra).pathname).send({ evento: 'chat_iniciado', chatId: '1', telefone: '5538999990000', ...ANUNCIO });
      expect(await fila().enviarPendentes()).toBe(0);
      expect((await comChave(http().get('/v1/webhooks'), outra.chaveAdmin)).body).toMatchObject({ url: null, envios: [] });
    });
  });

  describe('lead de teste', () => {
    it('vai para o endereço digitado, assinado, sem salvar nada e sem entrar na fila', async () => {
      const { segredo } = (await admin(http().get('/v1/webhooks'))).body;
      const res = await admin(http().post('/v1/webhooks/testar')).send({ url: DESTINO });
      expect(res.status).toBe(200);
      expect(recebidos).toHaveLength(1);
      expect(JSON.parse(recebidos[0].corpo)).toMatchObject({ evento: 'teste', campanha: 'Campanha de teste', resposta_city: 'São Paulo' });
      expect(recebidos[0].assinatura).toBe(`sha256=${createHmac('sha256', segredo).update(recebidos[0].corpo).digest('hex')}`);
      expect((await admin(http().get('/v1/webhooks'))).body).toMatchObject({ url: null, envios: [] });
    });

    it('sem endereço pede um; destino que recusa mostra o motivo', async () => {
      expect((await admin(http().post('/v1/webhooks/testar')).send({})).body.erro.codigo).toBe('URL_OBRIGATORIA');
      status = 500;
      const res = await admin(http().post('/v1/webhooks/testar')).send({ url: DESTINO });
      expect(res.status).toBe(502);
      expect(res.body.erro).toMatchObject({ codigo: 'WEBHOOK_RECUSOU', mensagem: 'O destino respondeu 500.' });
    });
  });

  describe('envio', () => {
    it('lead de anúncio sai plano, assinado e sem seguir redirecionamento', async () => {
      const { segredo } = await salvar();
      await evento({ evento: 'chat_iniciado', ...ANUNCIO });
      expect(await fila().enviarPendentes()).toBe(1);
      expect(recebidos[0].url).toBe(DESTINO);
      expect(JSON.parse(recebidos[0].corpo)).toMatchObject({ evento: 'lead_campanha', origem: 'ctwa', nome: 'Maria', telefone: '5538999990000', chat_id: '700', anuncio: 'Promo' });
      expect(recebidos[0].assinatura).toBe(`sha256=${createHmac('sha256', segredo).update(recebidos[0].corpo).digest('hex')}`);
      expect(recebidos[0].redirect).toBe('manual');
      expect(await fila().enviarPendentes()).toBe(0);
    });

    it('lead de formulário sai com as respostas', async () => {
      await salvar();
      await formulario();
      await fila().enviarPendentes();
      expect(JSON.parse(recebidos[0].corpo)).toMatchObject({ origem: 'formulario', nome: 'Joana', email: 'joana@exemplo.com.br', respostas_texto: 'Qual a cidade?: Montes Claros', resposta_qual_a_cidade: 'Montes Claros' });
    });

    it('conversa sem campanha, mudança de etapa e mensagem não saem; o texto da mensagem nunca sai', async () => {
      await salvar();
      await evento({ evento: 'chat_iniciado' });
      await evento({ evento: 'venda', valor: '10' });
      await evento({ evento: 'mensagem', direcao: 'in', texto: 'SEGREDO-XYZ' });
      expect(await fila().enviarPendentes()).toBe(0);
      expect(recebidos).toHaveLength(0);
      expect(await prisma.envioWebhook.count()).toBe(0);
    });

    it('conversa que depois se descobre de anúncio sai nessa hora, e cada lead sai uma vez só', async () => {
      await salvar();
      await evento({ evento: 'chat_iniciado' });
      await evento({ evento: 'chat_iniciado', ...ANUNCIO });
      await evento({ evento: 'chat_iniciado', ...ANUNCIO });
      await fila().enviarPendentes();
      expect(recebidos).toHaveLength(1);
      const lead = await prisma.lead.findFirstOrThrow({ where: { contaId: r.contaId } });
      await fila().emitir(lead);
      expect(await prisma.envioWebhook.count()).toBe(1);
    });

    it('lead que chegou antes de cadastrar o endereço não é enviado', async () => {
      await evento({ evento: 'chat_iniciado', ...ANUNCIO });
      await salvar();
      expect(await fila().enviarPendentes()).toBe(0);
    });

    it('destino fora do ar: tenta 6 vezes, fica com erro, os leads seguintes continuam na fila e o reenvio vai para o endereço corrigido', async () => {
      await salvar();
      status = 500;
      await evento({ evento: 'chat_iniciado', ...ANUNCIO });
      const agora = Date.now();
      await fila().enviarPendentes(new Date(agora));
      // Antes da espera de 1 minuto, não tenta de novo.
      expect(await fila().enviarPendentes(new Date(agora + 30_000))).toBe(0);
      let passado = 0;
      for (const min of [1, 5, 30, 120, 720]) {
        passado += min * 60_000 + 1000;
        await fila().enviarPendentes(new Date(agora + passado));
      }
      expect(recebidos).toHaveLength(6);
      const lista = (await admin(http().get('/v1/webhooks'))).body;
      expect(lista.envios[0]).toMatchObject({ status: 'erro', tentativas: 6, respostaStatus: 500, erro: 'O destino respondeu 500.', nome: 'Maria', telefone: expect.stringContaining('*') });

      // O webhook não desliga: o lead seguinte entra na fila.
      await evento({ evento: 'chat_iniciado', chatId: '701', telefone: '5531988880000', ...ANUNCIO });
      expect(await prisma.envioWebhook.count()).toBe(2);

      status = 200;
      recebidos = [];
      await salvar(OUTRO_DESTINO);
      expect((await admin(http().post(`/v1/webhooks/envios/${lista.envios[0].id}/reenviar`))).status).toBe(200);
      await fila().enviarPendentes(new Date(Date.now() + 60_000));
      expect(recebidos.map((x) => x.url)).toEqual([OUTRO_DESTINO, OUTRO_DESTINO]);
      expect((await admin(http().post(`/v1/webhooks/envios/${lista.envios[0].id}/reenviar`))).status).toBe(404);
    });

    it('envio de outra conta não é reenviado', async () => {
      await salvar();
      await evento({ evento: 'chat_iniciado', ...ANUNCIO });
      const envio = await prisma.envioWebhook.findFirstOrThrow();
      await prisma.envioWebhook.update({ where: { id: envio.id }, data: { status: 'erro' } });
      const outra = await registrarConta(app, 'Outra');
      expect((await comChave(http().post(`/v1/webhooks/envios/${envio.id}/reenviar`), outra.chaveAdmin)).status).toBe(404);
    });
  });
});

describe('API aberta', () => {
  let app: INestApplication;
  let r: Registro;
  let chave: string;
  const http = () => request(app.getHttpServer());
  const usar = (req: request.Test, k = chave) => comChave(req, k);

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    r = await registrarConta(app);
    chave = (await comChave(http().post('/v1/conta/chaves/api/rotacionar'), r.chaveAdmin)).body.chave;
    await prisma.lead.create({ data: { contaId: r.contaId, origem: 'organico', nome: 'Maria', telefone: '5538999990000', telefoneChave: '3899990000', chatId: '700', utmSource: 'meta' } });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('a chave de integração lê os leads com telefone completo; as outras chaves não entram aqui', async () => {
    expect(chave).toMatch(/^ktx_/);
    const res = await usar(http().get('/v1/api/leads'));
    expect(res.body.itens[0]).toMatchObject({ nome: 'Maria', telefone: '5538999990000', utmSource: 'meta' });
    expect((await usar(http().get('/v1/api/leads'), r.chaveAdmin)).status).toBe(403);
    expect((await http().get('/v1/api/leads')).status).toBe(401);
  });

  it('a chave de integração não entra no painel nem na configuração', async () => {
    expect((await usar(http().get('/v1/painel/filtros'))).status).toBe(403);
    expect((await usar(http().get('/v1/webhooks'))).status).toBe(403);
    expect((await usar(http().post('/v1/conta/chaves/admin/rotacionar'))).status).toBe(403);
  });

  it('muda a etapa por telefone ou por atendimento, e registra quem fez', async () => {
    const res = await usar(http().post('/v1/api/leads/etapa')).send({ telefone: '38 9999-0000', etapa: 'venda', valor: 50 });
    expect(res.status).toBe(200);
    const lead = await prisma.lead.findFirstOrThrow({ where: { contaId: r.contaId } });
    expect(lead.etapa).toBe('venda');
    expect(await prisma.eventoLead.findFirstOrThrow({ where: { leadId: lead.id, tipo: 'venda' } })).toMatchObject({ autor: 'sistema', autorNome: 'API' });
    expect((await usar(http().post('/v1/api/leads/etapa')).send({ chatId: '700', etapa: 'em_atendimento' })).status).toBe(200);
  });

  it('sem lead informado, ou lead de outra conta: erro claro', async () => {
    expect((await usar(http().post('/v1/api/leads/etapa')).send({ etapa: 'venda' })).body.erro.codigo).toBe('LEAD_NAO_INFORMADO');
    const outra = await registrarConta(app, 'Outra');
    const dela = (await comChave(http().post('/v1/conta/chaves/api/rotacionar'), outra.chaveAdmin)).body.chave;
    expect((await usar(http().post('/v1/api/leads/etapa'), dela).send({ chatId: '700', etapa: 'venda', valor: 1 })).status).toBe(404);
  });

  it('gerar nova chave invalida a anterior', async () => {
    const nova = (await comChave(http().post('/v1/conta/chaves/api/rotacionar'), r.chaveAdmin)).body.chave;
    expect((await usar(http().get('/v1/api/etapas'))).status).toBe(401);
    expect((await usar(http().get('/v1/api/etapas'), nova)).status).toBe(200);
  });
});

describe('eventos do Meta: extras e conversas sem anúncio', () => {
  let app: INestApplication;
  let r: Registro;
  let url: string;
  const http = () => request(app.getHttpServer());
  const admin = (req: request.Test) => comChave(req, r.chaveAdmin);
  const evento = (corpo: object) => http().post(new URL(url).pathname).send({ chatId: '700', telefone: '5538999990000', ...corpo });
  const enviados = async () => (await prisma.envioCapi.findMany({ where: { contaId: r.contaId } })).map((e) => e.eventName);

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    r = await registrarConta(app);
    url = (await admin(http().get('/v1/kentro/integracao'))).body.url;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('sem anúncio, nada sai até o admin pedir; pedindo, sai', async () => {
    await prisma.configCapi.create({ data: { contaId: r.contaId, ativo: true, datasetId: 'D1' } });
    await evento({ evento: 'chat_iniciado' });
    expect(await enviados()).toEqual([]);
    expect((await admin(http().put('/v1/eventos/configuracao')).send({ enviarOrganicos: true })).body.enviarOrganicos).toBe(true);
    await evento({ evento: 'chat_iniciado', chatId: '701', telefone: '5531988880000' });
    expect(await enviados()).toEqual(['Lead']);
  });

  it('a etapa manda o evento principal e os extras, cada um com o próprio id', async () => {
    await prisma.configCapi.create({ data: { contaId: r.contaId, ativo: true, datasetId: 'D1', enviarOrganicos: true } });
    const { body } = await admin(http().get('/v1/etapas'));
    await admin(http().put('/v1/etapas')).send({ etapas: body.etapas.map((e: { tipo: string }) => (e.tipo === 'venda' ? { ...e, eventosExtras: ['Subscribe', 'Purchase'] } : e)) });
    await evento({ evento: 'venda', valor: '10' });
    const nomes = await enviados();
    expect(nomes.filter((n) => n === 'Purchase')).toHaveLength(1);
    expect(nomes).toContain('Subscribe');
    const ids = (await prisma.envioCapi.findMany({ where: { contaId: r.contaId } })).map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
