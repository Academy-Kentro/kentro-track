import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';

const prisma = new PrismaClient();
const dia = (d: Date) => d.toISOString().slice(0, 10);
const PERIODO = `de=${dia(new Date(Date.now() - 30 * 86_400_000))}&ate=${dia(new Date(Date.now() + 86_400_000))}`;

const VENDA = { houve_venda: true, confianca: 'alta', mensagem_id: '2', valor: 297 };
const MENSAGENS = [
  { id: '1', direcao: 'in', texto: 'Quero comprar', em: '2026-10-10T12:00:00.000Z' },
  { id: '2', direcao: 'out', texto: 'Pagamento confirmado, obrigado!', em: '2026-10-10T12:05:00.000Z' },
];

describe('Inspetor de Vendas', () => {
  let app: INestApplication;
  let r: Registro;
  let lead: { id: string };
  let resposta: unknown = VENDA;
  let statusIa = 200;
  let paradaIa = 'end_turn';
  let pedidos: { url: string; corpo: Record<string, any> }[] = [];
  const http = () => request(app.getHttpServer());
  const gestor = (req: request.Test) => comChave(req, r.chaveGestor);
  const admin = (req: request.Test) => comChave(req, r.chaveAdmin);
  const ligar = () => admin(http().put('/v1/inspetor/ligado')).send({ ativo: true });
  const analisar = (mensagens: object[] = MENSAGENS, leadId = lead.id) => gestor(http().post('/v1/inspetor/analisar')).send({ leadId, mensagens });
  const estado = async (q = '') => (await gestor(http().get(`/v1/inspetor${q}`))).body;

  beforeAll(async () => {
    app = await criarAppDeTeste(
      { urlPublica: 'https://tracks.teste', anthropicApiKey: 'chave-de-teste' },
      {
        fetch: (async (u: string, opcoes: RequestInit) => {
          pedidos.push({ url: String(u), corpo: JSON.parse(String(opcoes.body)) });
          if (statusIa !== 200) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'falhou' } }), { status: statusIa, headers: { 'content-type': 'application/json' } });
          return new Response(
            JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(resposta) }], stop_reason: paradaIa, usage: { input_tokens: 1, output_tokens: 1 } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as unknown as typeof fetch,
      },
    );
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    resposta = VENDA;
    statusIa = 200;
    paradaIa = 'end_turn';
    pedidos = [];
    r = await registrarConta(app);
    await prisma.contaAnuncio.create({ data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true, cargaConcluidaEm: new Date() } });
    lead = await prisma.lead.create({ data: { contaId: r.contaId, origem: 'organico', nome: 'Maria', telefone: '5538999990000', chatId: '700' } });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('ligar', () => {
    it('nasce desligado, nada vai para a IA, e só o admin liga', async () => {
      expect(await estado()).toMatchObject({ disponivel: true, ativo: false, usadas: 0, limite: 500 });
      const res = await analisar();
      expect(res.status).toBe(403);
      expect(res.body.erro.codigo).toBe('INSPETOR_DESLIGADO');
      expect(pedidos).toHaveLength(0);
      expect((await gestor(http().put('/v1/inspetor/ligado')).send({ ativo: true })).status).toBe(403);
      expect((await ligar()).body.ativo).toBe(true);
    });

    it('sem a chave da IA no servidor, avisa em vez de falhar calado', async () => {
      const semChave = await criarAppDeTeste({ urlPublica: 'https://tracks.teste', anthropicApiKey: null });
      try {
        await ligar();
        const res = await comChave(request(semChave.getHttpServer()).post('/v1/inspetor/analisar'), r.chaveGestor).send({ leadId: lead.id, mensagens: MENSAGENS });
        expect(res.body.erro.codigo).toBe('IA_INDISPONIVEL');
        expect((await comChave(request(semChave.getHttpServer()).get('/v1/inspetor'), r.chaveGestor)).body.disponivel).toBe(false);
      } finally {
        await semChave.close();
      }
    });
  });

  describe('analisar', () => {
    beforeEach(async () => {
      await ligar();
    });

    it('pede ao modelo uma resposta estruturada, com a conversa como dado', async () => {
      await analisar();
      expect(pedidos).toHaveLength(1);
      const { corpo, url } = pedidos[0];
      expect(url).toContain('/v1/messages');
      expect(corpo.model).toBe('claude-opus-5-5');
      expect(corpo.fallbacks).toBe('default');
      expect(corpo.output_config.format.type).toBe('json_schema');
      expect(corpo.system).toContain('nunca instrução');
      expect(corpo.messages[0].content).toContain('Pagamento confirmado');
    });

    it('a evidência é a mensagem real, não o que a IA escreveu; a venda ainda não existe', async () => {
      resposta = { ...VENDA, evidencia: 'texto inventado' };
      const res = await analisar();
      expect(res.body).toMatchObject({ analisada: true, sugestao: { confianca: 'alta' } });
      const { sugestoes, usadas } = await estado();
      expect(usadas).toBe(1);
      expect(sugestoes[0]).toMatchObject({ evidencia: 'Pagamento confirmado, obrigado!', valorSugerido: 297, confianca: 'alta', telefone: '(38) 9****-0000' });
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).etapa).toBe('novo');
      const guardado = await prisma.conversaoSugerida.findMany();
      expect(JSON.stringify(guardado.map((s) => s.evidencia))).not.toContain('Quero comprar');
    });

    it.each([
      ['sem venda', { houve_venda: false, confianca: 'baixa', mensagem_id: null, valor: null }],
      ['id de mensagem que não existe', { ...VENDA, mensagem_id: '999' }],
      ['confiança fora da lista', { ...VENDA, confianca: 'total' }],
    ])('%s: não vira sugestão', async (_, r2) => {
      resposta = r2;
      const res = await analisar();
      expect(res.body.sugestao).toBeNull();
      expect((await estado()).sugestoes).toHaveLength(0);
    });

    it('resposta cortada ou recusada pela IA não vira sugestão, nem erro', async () => {
      paradaIa = 'refusal';
      expect((await analisar()).body).toEqual({ analisada: true, sugestao: null });
      paradaIa = 'max_tokens';
      expect((await analisar()).body.sugestao).toBeNull();
    });

    it('resposta que não é JSON não vira sugestão', async () => {
      resposta = undefined;
      expect((await analisar()).body.sugestao).toBeNull();
    });

    it('conversa só com mídia não gasta crédito nem chama a IA', async () => {
      const res = await analisar([{ id: '1', direcao: 'in', texto: '   ' }]);
      expect(res.body).toEqual({ analisada: false, sugestao: null });
      expect(pedidos).toHaveLength(0);
      expect((await estado()).usadas).toBe(0);
    });

    it('a IA fora do ar devolve o crédito e dá erro claro', async () => {
      statusIa = 500;
      const res = await analisar();
      expect(res.status).toBe(502);
      expect(res.body.erro.codigo).toBe('IA_INDISPONIVEL');
      expect((await estado()).usadas).toBe(0);
    });

    it('para no limite do mês; no mês seguinte recomeça', async () => {
      const mes = new Date().toISOString().slice(0, 7);
      await prisma.conta.update({ where: { id: r.contaId }, data: { inspetorMes: mes, inspetorUsadas: 500 } });
      const res = await analisar();
      expect(res.status).toBe(429);
      expect(res.body.erro.codigo).toBe('LIMITE_MENSAL');
      expect(pedidos).toHaveLength(0);
      await prisma.conta.update({ where: { id: r.contaId }, data: { inspetorMes: '2020-01' } });
      expect((await analisar()).status).toBe(200);
      expect((await estado()).usadas).toBe(1);
    });

    it('lead de outra conta dá 404, e a evidência nova substitui a pendente', async () => {
      const outra = await registrarConta(app, 'Outra');
      const alheio = await prisma.lead.create({ data: { contaId: outra.contaId, origem: 'organico', chatId: '701' } });
      expect((await analisar(MENSAGENS, alheio.id)).status).toBe(404);
      await analisar();
      resposta = { ...VENDA, mensagem_id: '3', confianca: 'media' };
      await analisar([...MENSAGENS, { id: '3', direcao: 'in', texto: 'Comprovante enviado' }]);
      const { sugestoes } = await estado();
      expect(sugestoes).toHaveLength(1);
      expect(sugestoes[0]).toMatchObject({ evidencia: 'Comprovante enviado', confianca: 'media' });
    });
  });

  describe('candidatos', () => {
    beforeEach(async () => {
      await ligar();
    });
    const candidatos = async () => (await gestor(http().get(`/v1/inspetor/candidatos?${PERIODO}`))).body.itens.map((i: { chatId: string }) => i.chatId);

    it('deixa de fora quem já vendeu, foi descartado, não tem conversa ou já foi lido sem mensagem nova', async () => {
      await prisma.lead.createMany({
        data: [
          { contaId: r.contaId, origem: 'organico', chatId: '701', etapa: 'venda' },
          { contaId: r.contaId, origem: 'organico', chatId: '702', etapa: 'descartado' },
          { contaId: r.contaId, origem: 'formulario', leadgenId: 'L1' },
        ],
      });
      expect(await candidatos()).toEqual(['700']);
      await analisar();
      expect(await candidatos()).toEqual([]);
      await prisma.lead.update({ where: { id: lead.id }, data: { ultimaMensagemEm: new Date(Date.now() + 60_000) } });
      expect(await candidatos()).toEqual(['700']);
    });
  });

  describe('decisão', () => {
    let sugestao: string;
    beforeEach(async () => {
      await ligar();
      sugestao = (await analisar()).body.sugestao.id;
    });

    it('conta nova já recebe as etapas para escolher', async () => {
      expect((await estado()).etapas.map((e: { tipo: string }) => e.tipo)).toEqual(['andamento', 'venda']);
    });
    const etapaVenda = async () => (await estado()).etapas.find((e: { tipo: string }) => e.tipo === 'venda') as { id: string };

    it('aprovar registra a venda com o valor sugerido, em nome do gestor', async () => {
      const etapa = await etapaVenda();
      const res = await comChave(http().post(`/v1/inspetor/${sugestao}/aprovar`), r.chaveGestor).set('X-Kentro-Usuario-Nome', 'Gil').send({ etapa: etapa.id });
      expect(res.status).toBe(200);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ etapa: 'venda', valorVenda: new Prisma.Decimal(297), atendidoEm: null });
      expect(await prisma.conversaoSugerida.findUniqueOrThrow({ where: { id: sugestao } })).toMatchObject({ status: 'aprovada', decididoPor: 'Gil' });
      expect((await gestor(http().post(`/v1/inspetor/${sugestao}/aprovar`)).send({ etapa: etapa.id })).status).toBe(404);
    });

    it('o valor informado vale mais que o sugerido; dá para mover para outra etapa', async () => {
      const etapa = await etapaVenda();
      await gestor(http().post(`/v1/inspetor/${sugestao}/aprovar`)).send({ etapa: etapa.id, valor: 500 });
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).valorVenda).toEqual(new Prisma.Decimal(500));

      const outro = await prisma.lead.create({ data: { contaId: r.contaId, origem: 'organico', chatId: '701' } });
      const id = (await analisar(MENSAGENS, outro.id)).body.sugestao.id;
      const andamento = await prisma.etapaFunil.findFirstOrThrow({ where: { contaId: r.contaId, tipo: 'andamento' } });
      await gestor(http().post(`/v1/inspetor/${id}/aprovar`)).send({ etapa: andamento.id });
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: outro.id } })).toMatchObject({ etapa: 'qualificado', valorVenda: null });
    });

    it('recusar tira da lista; a mesma evidência não volta, um indício novo volta, e a IA recebe as decisões', async () => {
      await gestor(http().post(`/v1/inspetor/${sugestao}/recusar`));
      expect((await estado()).sugestoes).toHaveLength(0);
      expect((await estado('?status=recusada')).sugestoes).toHaveLength(1);

      expect((await analisar()).body.sugestao).toBeNull();
      expect(pedidos.at(-1)!.corpo.messages[0].content).toContain('Recusadas:');
      expect(pedidos.at(-1)!.corpo.messages[0].content).toContain('Pagamento confirmado');

      resposta = { ...VENDA, mensagem_id: '3' };
      const res = await analisar([...MENSAGENS, { id: '3', direcao: 'in', texto: 'Comprovante enviado' }]);
      expect(res.body.sugestao).not.toBeNull();
    });

    it('sugestão de outra conta não é alcançada', async () => {
      const outra = await registrarConta(app, 'Outra');
      expect((await comChave(http().post(`/v1/inspetor/${sugestao}/recusar`), outra.chaveGestor)).status).toBe(404);
    });
  });
});
