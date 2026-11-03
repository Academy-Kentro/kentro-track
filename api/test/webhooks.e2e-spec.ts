import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';

const prisma = new PrismaClient();
// Endereço de documentação: é público para a validação e não resolve para a rede interna.
const DESTINO = 'https://203.0.113.10';

describe('webhooks de saída', () => {
  let app: INestApplication;
  let r: Registro;
  let url: string;
  let status = 200;
  let recebidos: { url: string; corpo: string; assinatura: string; redirect?: string }[] = [];
  const http = () => request(app.getHttpServer());
  const admin = (req: request.Test) => comChave(req, r.chaveAdmin);
  const fila = () => app.get(WebhooksService);
  const criar = async (d: object = {}) => (await admin(http().post('/v1/webhooks')).send({ nome: 'Planilha', urlCriada: `${DESTINO}/criada`, urlAlterada: `${DESTINO}/alterada`, ...d })).body;
  const evento = (corpo: object) => http().post(new URL(url).pathname).send({ chatId: '700', telefone: '5538999990000', nome: 'Maria', ...corpo });
  const esperarRecebidos = async (n: number) => {
    for (let i = 0; i < 50 && recebidos.length < n; i++) await new Promise((res) => setTimeout(res, 20));
  };

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
    it('só o admin mexe, com no máximo 3, e o segredo vem na resposta', async () => {
      expect((await comChave(http().get('/v1/webhooks'), r.chaveGestor)).status).toBe(403);
      const w = await criar();
      expect(w.segredo).toHaveLength(22);
      await criar();
      await criar();
      const quarto = await admin(http().post('/v1/webhooks')).send({ nome: 'x', urlCriada: `${DESTINO}/x` });
      expect(quarto.body.erro.codigo).toBe('WEBHOOKS_DEMAIS');
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
    ])('recusa %s', async (destino) => {
      const res = await admin(http().post('/v1/webhooks')).send({ nome: 'x', urlCriada: destino });
      expect(res.status).toBe(400);
      expect(res.body.erro.codigo).toBe('URL_INVALIDA');
    });

    it('precisa de pelo menos uma URL; origem desconhecida é recusada', async () => {
      expect((await admin(http().post('/v1/webhooks')).send({ nome: 'x' })).body.erro.codigo).toBe('URL_OBRIGATORIA');
      expect((await admin(http().post('/v1/webhooks')).send({ nome: 'x', urlCriada: `${DESTINO}/a`, origens: ['outra'] })).status).toBe(400);
    });

    it('webhook de outra conta não é alcançado', async () => {
      const w = await criar();
      const outra = await registrarConta(app, 'Outra');
      expect((await comChave(http().delete(`/v1/webhooks/${w.id}`), outra.chaveAdmin)).status).toBe(404);
    });
  });

  describe('envio', () => {
    it('conversa criada e etapa alterada vão com os dados do lead, assinados e sem seguir redirecionamento', async () => {
      const w = await criar();
      await evento({ evento: 'chat_iniciado' });
      await evento({ evento: 'venda', valor: '1.234,50' });
      expect(await fila().enviarPendentes()).toBe(2);
      expect(recebidos.map((x) => x.url)).toEqual([`${DESTINO}/criada`, `${DESTINO}/alterada`]);
      const corpo = JSON.parse(recebidos[1].corpo);
      expect(corpo).toMatchObject({ evento: 'lead_update', contaId: r.contaId, lead: { nome: 'Maria', telefone: '5538999990000', chatId: '700', etapa: 'venda', valorVenda: 1234.5, etapaNome: 'Venda' } });
      const esperada = createHmac('sha256', w.segredo).update(recebidos[1].corpo).digest('hex');
      expect(recebidos[1].assinatura).toBe(`sha256=${esperada}`);
      expect(recebidos[1].redirect).toBe('manual');
      expect(await fila().enviarPendentes()).toBe(0);
    });

    it('sem URL para o evento, ou com outra origem, não entra na fila', async () => {
      await criar({ urlAlterada: null });
      await criar({ nome: 'Só anúncio', origens: ['ctwa'] });
      await evento({ evento: 'chat_iniciado' });
      await fila().enviarPendentes();
      expect(recebidos).toHaveLength(1);
    });

    it('a origem mudar dispara o evento de origem', async () => {
      await criar({ urlOrigem: `${DESTINO}/origem` });
      await evento({ evento: 'chat_iniciado' });
      await evento({ evento: 'chat_iniciado', anuncio: { titulo: 'Promo' } });
      await fila().enviarPendentes();
      expect(recebidos.map((x) => x.url)).toContain(`${DESTINO}/origem`);
    });

    it('destino fora do ar: tenta 4 vezes, desliga o webhook com o motivo e dá para reenviar', async () => {
      const w = await criar();
      status = 500;
      await evento({ evento: 'chat_iniciado' });
      const agora = Date.now();
      await fila().enviarPendentes(new Date(agora));
      // Antes da espera de 1 minuto, não tenta de novo.
      expect(await fila().enviarPendentes(new Date(agora + 30_000))).toBe(0);
      await fila().enviarPendentes(new Date(agora + 2 * 60_000));
      await fila().enviarPendentes(new Date(agora + 5 * 60_000));
      await fila().enviarPendentes(new Date(agora + 11 * 60_000));
      expect(recebidos).toHaveLength(4);
      const lista = (await admin(http().get('/v1/webhooks'))).body;
      expect(lista.webhooks[0]).toMatchObject({ ativo: false, motivoDesativado: expect.stringContaining('respondeu 500') });
      expect(lista.envios[0]).toMatchObject({ status: 'erro', tentativas: 4, respostaStatus: 500 });

      // Desligado: novos eventos não entram na fila.
      await evento({ evento: 'chat_iniciado', chatId: '701', telefone: '5531988880000' });
      expect(await prisma.envioWebhook.count()).toBe(1);

      status = 200;
      await admin(http().put(`/v1/webhooks/${w.id}`)).send({ nome: 'Planilha', urlCriada: `${DESTINO}/criada`, ativo: true });
      expect((await admin(http().post(`/v1/webhooks/envios/${lista.envios[0].id}/reenviar`))).status).toBe(200);
      await fila().enviarPendentes(new Date(Date.now() + 60_000));
      expect((await admin(http().get('/v1/webhooks'))).body.envios[0]).toMatchObject({ status: 'enviado' });
    });

    it('mensagem nova sai com o texto, sem passar pela fila', async () => {
      await criar({ urlCriada: null, urlAlterada: null, urlMensagem: `${DESTINO}/mensagem` });
      await evento({ evento: 'mensagem', direcao: 'in', texto: 'SEGREDO-XYZ' });
      await esperarRecebidos(1);
      expect(recebidos).toHaveLength(1);
      expect(JSON.parse(recebidos[0].corpo)).toMatchObject({ evento: 'message_create', mensagem: { direcao: 'in', texto: 'SEGREDO-XYZ' } });
      expect(await prisma.envioWebhook.count()).toBe(0);
    });

    it('falha do webhook não derruba o evento da automação', async () => {
      await criar({ urlMensagem: `${DESTINO}/mensagem` });
      status = 500;
      const res = await evento({ evento: 'mensagem', direcao: 'in', texto: 'Olá' });
      expect(res.status).toBe(200);
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
