import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { lerCodigo, mensagemComCodigo } from '../src/links/codigo';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';

const prisma = new PrismaClient();
const CELULAR = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
const COMPUTADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
const dia = (d: Date) => d.toISOString().slice(0, 10);
const PERIODO = `de=${dia(new Date(Date.now() - 30 * 86_400_000))}&ate=${dia(new Date(Date.now() + 86_400_000))}`;

describe('código da visita', () => {
  it('invisível: não aparece no texto e volta igual', () => {
    const com = mensagemComCodigo('Olá!', 'abcd2345', false);
    expect(com.replace(/[​‌⁠]/g, '')).toBe('Olá!');
    expect(lerCodigo(com)).toBe('abcd2345');
    expect(lerCodigo(`${com} e mais texto que o cliente escreveu`)).toBe('abcd2345');
  });

  it('visível: para quando o canal remove caracteres invisíveis', () => {
    expect(lerCodigo(mensagemComCodigo('Olá!', 'abcd2345', true))).toBe('abcd2345');
    expect(lerCodigo('Olá! (REF ABCD2345)')).toBe('abcd2345');
  });

  it('mensagem comum não tem código', () => {
    expect(lerCodigo('Quero uma referência de preço')).toBeNull();
    expect(lerCodigo('')).toBeNull();
  });
});

describe('links rastreáveis', () => {
  let app: INestApplication;
  let r: Registro;
  let webhook: string;
  const http = () => request(app.getHttpServer());
  const admin = (req: request.Test) => comChave(req, r.chaveAdmin);
  const DADOS = { nome: 'Botão do site', telefone: '38 99999-0000', mensagem: 'Olá! Quero saber mais.' };
  const criar = async (d: object = DADOS) => (await admin(http().post('/v1/links')).send(d)).body;
  const caminho = (u: string) => new URL(u).pathname;
  const visitar = (url: string, navegador = CELULAR) => http().get(new URL(url).pathname + new URL(url).search).set('User-Agent', navegador);
  /** O que o WhatsApp abriria: a mensagem pronta do destino da página. */
  const mensagemDaPagina = (html: string) => decodeURIComponent(/text=([^"&]+)/.exec(html)![1]);
  const mandar = (corpo: object) => http().post(caminho(webhook)).send({ evento: 'mensagem', chatId: '900', telefone: '5531988880000', direcao: 'in', ...corpo });
  const leadDoChat = () => prisma.lead.findFirstOrThrow({ where: { contaId: r.contaId, chatId: '900' } });

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    r = await registrarConta(app);
    webhook = (await comChave(http().get('/v1/kentro/integracao'), r.chaveAdmin)).body.url;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('cadastro', () => {
    it('cria com telefone normalizado e duas URLs; o gestor lê e não cria', async () => {
      const link = await criar();
      expect(link).toMatchObject({ telefone: '5538999990000', ativo: true, url: expect.stringMatching(/^https:\/\/tracks\.teste\/l\/[a-z2-7]{10}$/) });
      expect(link.urlDireta).toBe(`${link.url}?direto=1`);
      expect((await comChave(http().post('/v1/links'), r.chaveGestor).send(DADOS)).status).toBe(403);
      const lista = await comChave(http().get('/v1/links'), r.chaveGestor);
      expect(lista.body.itens).toHaveLength(1);
      expect(lista.body.pixel).toContain(`https://tracks.teste/p/${r.contaId}.js`);
      expect(lista.body.parametrosMeta).toContain('fbid={{ad.id}}');
    });

    it('recusa telefone inválido e não mexe no link de outra conta', async () => {
      expect((await admin(http().post('/v1/links')).send({ ...DADOS, telefone: 'abcdefgh' })).body.erro.codigo).toBe('TELEFONE_INVALIDO');
      const link = await criar();
      const outra = await registrarConta(app, 'Outra');
      const res = await comChave(http().put(`/v1/links/${link.id}`), outra.chaveAdmin).send(DADOS);
      expect(res.status).toBe(404);
    });
  });

  describe('visita', () => {
    it('grava os parâmetros, ignora os desconhecidos e leva ao WhatsApp só o que está no link', async () => {
      const link = await criar();
      const res = await visitar(`${link.url}?utm_source=meta&utm_campaign=BF&gclid=G1&fbclid=F1&fbid=300&destino=https://mal.example`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('https://wa.me/5538999990000?text=');
      expect(res.text).not.toContain('mal.example');
      expect(res.text).toContain('Por favor, aguarde');
      const visita = await prisma.visitaLink.findFirstOrThrow();
      expect(visita).toMatchObject({ utmSource: 'meta', utmCampaign: 'BF', gclid: 'G1', fbclid: 'F1', anuncioIdMeta: '300' });
      expect(lerCodigo(mensagemDaPagina(res.text))).toBe(visita.codigo);
    });

    it('computador vai ao WhatsApp Web, salvo se o link pedir o aplicativo; direto não espera', async () => {
      const web = await criar();
      expect((await visitar(web.url, COMPUTADOR)).text).toContain('https://web.whatsapp.com/send?phone=5538999990000');
      const app2 = await criar({ ...DADOS, computadorWeb: false });
      expect((await visitar(app2.url, COMPUTADOR)).text).toContain('https://wa.me/');
      expect((await visitar(web.urlDireta)).text).toContain('content="0;url=');
      expect((await visitar(web.url)).text).toContain('content="5;url=');
    });

    it('robô de prévia não vira visita; link desativado ou desconhecido dá 404', async () => {
      const link = await criar();
      await visitar(link.url, 'facebookexternalhit/1.1');
      await visitar(link.url, 'WhatsApp/2.23');
      expect(await prisma.visitaLink.count()).toBe(0);
      await admin(http().put(`/v1/links/${link.id}`)).send({ ...DADOS, ativo: false });
      expect((await visitar(link.url)).status).toBe(404);
      expect((await http().get('/l/naoexiste')).status).toBe(404);
    });

    it('texto do admin na página sai escapado', async () => {
      const link = await criar({ ...DADOS, tituloEspera: '<script>alert(1)</script>' });
      const { text } = await visitar(link.url);
      expect(text).not.toContain('<script>alert');
      expect(text).toContain('&lt;script&gt;');
    });

    it('a resposta não fica em cache e não vaza a origem', async () => {
      const link = await criar();
      const res = await visitar(link.url);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });
  });

  describe('ligar a conversa à visita', () => {
    const clicar = async (extra = '') => mensagemDaPagina((await visitar(`${(await criar()).url}${extra}`)).text);

    it('a primeira mensagem do cliente traz a origem, as UTMs e os cliques; o texto não fica', async () => {
      const texto = await clicar('?utm_source=meta&utm_medium=quente&utm_campaign=BF&utm_content=video&utm_term=t&gclid=G1&fbclid=F1');
      await mandar({ texto });
      expect(await leadDoChat()).toMatchObject({ origem: 'link', utmSource: 'meta', utmMedium: 'quente', utmCampaign: 'BF', utmContent: 'video', utmTerm: 't', gclid: 'G1', fbclid: 'F1' });
      const eventos = await prisma.eventoLead.findMany({ where: { lead: { chatId: '900' } } });
      expect(eventos.map((e) => e.texto)).toEqual(expect.arrayContaining([expect.stringContaining('Botão do site')]));
      expect(JSON.stringify(eventos.map((e) => e.texto))).not.toContain('Quero saber');
    });

    it('fbid liga ao anúncio exato; origem que já era de anúncio não vira link', async () => {
      const ca = await prisma.contaAnuncio.create({ data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true } });
      await prisma.anuncio.create({ data: { contaId: r.contaId, contaAnuncioId: ca.id, idMeta: '300', conjuntoIdMeta: '200', campanhaIdMeta: '100', nome: 'Vídeo' } });
      await mandar({ texto: await clicar('?fbid=300') });
      expect(await leadDoChat()).toMatchObject({ origem: 'link', anuncioIdMeta: '300', campanhaIdMeta: '100', vinculoAnuncio: 'id' });
      await mandar({ chatId: '901', telefone: '5531977770000', texto: await clicar(), anuncio: { titulo: 'Promo' } });
      expect((await prisma.lead.findFirstOrThrow({ where: { chatId: '901' } })).origem).toBe('ctwa');
    });

    it('vale a primeira visita: um segundo código não troca a origem', async () => {
      await mandar({ texto: await clicar('?utm_source=primeira') });
      await mandar({ texto: await clicar('?utm_source=segunda') });
      expect((await leadDoChat()).utmSource).toBe('primeira');
    });

    it('código de outra conta não liga nada', async () => {
      const outra = await registrarConta(app, 'Outra');
      const { body: link } = await comChave(http().post('/v1/links'), outra.chaveAdmin).send(DADOS);
      await mandar({ texto: mensagemDaPagina((await visitar(link.url)).text) });
      expect(await leadDoChat()).toMatchObject({ origem: 'organico', linkId: null });
    });

    it('o atendente mandando a mensagem com código não liga: só a do cliente', async () => {
      await mandar({ direcao: 'out', texto: await clicar() });
      expect((await leadDoChat()).linkId).toBeNull();
    });

    it('chat_iniciado da automação e o painel do atendente também ligam', async () => {
      const daAutomacao = await clicar('?utm_source=auto');
      await http().post(caminho(webhook)).send({ evento: 'chat_iniciado', chatId: '902', telefone: '5531966660000', texto: daAutomacao });
      expect((await prisma.lead.findFirstOrThrow({ where: { chatId: '902' } })).utmSource).toBe('auto');
      const doPainel = await clicar('?utm_source=painel');
      const painel = await comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).send({ chatId: '903', telefone: '5531955550000', primeiraMensagem: doPainel });
      expect(painel.body).toMatchObject({ origem: 'link', link: { nome: 'Botão do site', utmSource: 'painel' } });
    });

    it('o evento para o Meta sai com o fbclid e, sem anúncio, a origem link conta como rastreada', async () => {
      await prisma.configCapi.create({ data: { contaId: r.contaId, ativo: true, datasetId: 'D1' } });
      await mandar({ texto: await clicar('?fbclid=F1') });
      const envio = await prisma.envioCapi.findFirstOrThrow({ where: { contaId: r.contaId } });
      const usuario = (envio.payload as { user_data: { fbc: string } }).user_data;
      expect(usuario.fbc).toMatch(/^fb\.1\.\d+\.F1$/);
    });
  });

  describe('painel', () => {
    const lista = (q: string) => comChave(http().get(`/v1/painel/leads?${PERIODO}${q}`), r.chaveGestor);

    beforeEach(async () => {
      await prisma.contaAnuncio.create({ data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true, cargaConcluidaEm: new Date() } });
    });

    it('filtra por link e UTM, mostra o nome do link e conta os resultados de cada link', async () => {
      const link = await criar();
      await mandar({ texto: mensagemDaPagina((await visitar(`${link.url}?utm_source=Meta&utm_campaign=BF`)).text) });
      await visitar(link.url);
      await mandar({ chatId: '901', telefone: '5531977770000', texto: 'Sem link' });

      expect((await lista('')).body.itens).toHaveLength(2);
      const doLink = await lista(`&link=${link.id}`);
      expect(doLink.body.itens.map((l: { link: string }) => l.link)).toEqual(['Botão do site']);
      expect((await lista('&utmSource=meta')).body.itens).toHaveLength(1);
      expect((await lista('&utmCampaign=outra')).body.itens).toHaveLength(0);

      const opcoes = await comChave(http().get(`/v1/painel/leads/opcoes?${PERIODO}`), r.chaveGestor);
      expect(opcoes.body).toMatchObject({ links: [{ id: link.id, nome: 'Botão do site' }], utmSource: ['Meta'], utmCampaign: ['BF'] });

      const { body } = await comChave(http().get('/v1/links'), r.chaveGestor);
      expect(body.itens[0]).toMatchObject({ visitas: 2, conversas: 1, vendas: 0 });
    });

    it('CSV de leads traz link e UTMs; o de conversões offline traz só vendas com clique do Google', async () => {
      const link = await criar();
      await mandar({ texto: mensagemDaPagina((await visitar(`${link.url}?gclid=G1&utm_source=google`)).text) });
      await mandar({ chatId: '901', telefone: '5531977770000', texto: 'Sem clique' });
      const leads = await comChave(http().get(`/v1/painel/leads/exportar?${PERIODO}&tipo=leads`), r.chaveGestor);
      expect(leads.body.csv).toContain(';Botão do site;google;');

      await prisma.lead.updateMany({ where: { contaId: r.contaId }, data: { etapa: 'venda', valorVenda: 120.5, vendaEm: new Date() } });
      const google = await comChave(http().get(`/v1/painel/leads/exportar?${PERIODO}&tipo=google_offline`), r.chaveGestor);
      const linhas = google.body.csv.trim().split('\r\n');
      expect(linhas[0]).toBe('Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency');
      expect(linhas).toHaveLength(2);
      expect(linhas[1]).toMatch(/^G1,,,Venda,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+0000,120\.50,BRL$/);
      expect(google.body.csv.startsWith('﻿')).toBe(false);
    });

    it('primeiros passos acompanham o que já foi configurado', async () => {
      const antes = await comChave(http().get('/v1/painel/primeiros-passos'), r.chaveGestor);
      expect(antes.body).toEqual({ meta: false, mensagens: false, frases: false, primeiraVenda: false, link: false, eventos: false });
      await criar();
      await mandar({ texto: 'Olá' });
      const depois = await comChave(http().get('/v1/painel/primeiros-passos'), r.chaveGestor);
      expect(depois.body).toMatchObject({ link: true, mensagens: true, meta: false });
    });
  });

  describe('pixel', () => {
    it('é público, é JavaScript e só conhece os links do Kentro Track', async () => {
      const res = await http().get(`/p/${r.contaId}.js`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('javascript');
      expect(res.text).toContain('"https://tracks.teste/l/"');
      expect(res.text).toContain('gclid');
    });
  });

  it('as rotas públicas têm limite por IP', async () => {
    const respostas = [];
    for (let i = 0; i < 125; i++) respostas.push((await http().get('/l/naoexiste')).status);
    expect(respostas).toContain(429);
  });
});
