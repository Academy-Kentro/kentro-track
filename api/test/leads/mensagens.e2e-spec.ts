import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { etapaDaFrase, valorDaMensagem } from '../../src/leads/frases';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from '../meta/apoio';

const prisma = new PrismaClient();
const dia = (d: Date) => d.toISOString().slice(0, 10);
// Os leads nascem com o relógio de agora: o período acompanha.
const PERIODO = `de=${dia(new Date(Date.now() - 30 * 86_400_000))}&ate=${dia(new Date(Date.now() + 86_400_000))}`;

describe('valor escrito na mensagem', () => {
  it.each([
    ['Parabéns pela sua compra de R$ 297', 297],
    ['compra de R$297,90 confirmada', 297.9],
    ['total 297.90', 297.9],
    ['fechou por 297,90!', 297.9],
    ['ficou em 297', 297],
    ['total de R$ 1.234,50', 1234.5],
    ['total de $1,234.50', 1234.5],
    ['1.234 reais', 1234],
    // Mais de um valor: o maior.
    ['duas parcelas de R$ 50, total R$ 100', 100],
    // O número com R$ vale mais que os soltos, e centavos valem mais que número solto.
    ['pedido 12345 de R$ 50', 50],
    ['pedido 12345 por 50,00', 50],
  ])('%s → %s', (texto, valor) => {
    expect(valorDaMensagem(texto)).toBe(valor);
  });

  it.each([['Parabéns pela compra!'], ['Vence em 03/11/2026'], ['ligue 38999990000'], ['CPF 12345678901'], ['']])('sem valor: %s', (texto) => {
    expect(valorDaMensagem(texto)).toBeNull();
  });
});

describe('frase gatilho', () => {
  const etapa = (ordem: number, frases: string[], ativa = true) => ({ ordem, frases, ativa });

  it('acha sem diferenciar caixa, acento nem espaços', () => {
    const e = etapa(1, ['Orçamento   enviado']);
    expect(etapaDaFrase('segue o ORCAMENTO enviado, ok?', [e])).toBe(e);
    expect(etapaDaFrase('segue o orçamento', [e])).toBeNull();
  });

  it('duas frases na mesma mensagem: a etapa mais adiantada; etapa desativada não conta', () => {
    const [a, b, c] = [etapa(1, ['orcamento']), etapa(2, ['parabens']), etapa(3, ['boleto'], false)];
    expect(etapaDaFrase('orçamento e parabéns e boleto', [a, b, c])).toBe(b);
  });

  it('frase em branco não casa com tudo', () => {
    expect(etapaDaFrase('qualquer coisa', [etapa(1, ['  '])])).toBeNull();
  });
});

describe('mensagens avisadas pela automação', () => {
  let app: INestApplication;
  let r: Registro;
  let url: string;
  const http = () => request(app.getHttpServer());
  const caminho = (u: string) => new URL(u).pathname;
  const mensagem = (corpo: object) => http().post(caminho(url)).send({ evento: 'mensagem', chatId: '700', telefone: '5538999990000', nome: 'Maria', ...corpo });
  const lead = () => prisma.lead.findFirstOrThrow({ where: { contaId: r.contaId, chatId: '700' } });
  const salvarEtapas = async (mudar: (e: { chave: string; tipo: string; [k: string]: unknown }) => object) => {
    const { body } = await comChave(http().get('/v1/etapas'), r.chaveAdmin);
    return comChave(http().put('/v1/etapas'), r.chaveAdmin).send({ etapas: body.etapas.map((e: { chave: string; tipo: string }) => ({ ...e, ...mudar(e) })) });
  };

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    r = await registrarConta(app);
    url = (await comChave(http().get('/v1/kentro/integracao'), r.chaveAdmin)).body.url;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('a mensagem do cliente abre o lead e não conta como resposta', async () => {
    const res = await mensagem({ direcao: 'in', texto: 'Olá' });
    expect(res.status).toBe(200);
    expect(await lead()).toMatchObject({ etapa: 'novo', primeiraRespostaEm: null, atendidoEm: null, nome: 'Maria' });
    expect((await lead()).ultimaMensagemLeadEm).not.toBeNull();
  });

  it('a primeira e a segunda mensagem do atendente ficam registradas; a terceira não muda nada', async () => {
    await mensagem({ direcao: 'in', texto: 'Olá' });
    await mensagem({ direcao: 'OUT', texto: 'Oi', atendenteId: '7', atendente: 'Ana' });
    const depoisDaPrimeira = await lead();
    expect(depoisDaPrimeira).toMatchObject({ etapa: 'em_atendimento', atendenteId: '7', atendenteNome: 'Ana', segundaRespostaEm: null });
    expect(depoisDaPrimeira.primeiraRespostaEm).not.toBeNull();
    expect(depoisDaPrimeira.atendidoEm).not.toBeNull();

    await mensagem({ direcao: 'out', texto: 'Como posso ajudar?' });
    const depoisDaSegunda = await lead();
    expect(depoisDaSegunda.primeiraRespostaEm).toEqual(depoisDaPrimeira.primeiraRespostaEm);
    expect(depoisDaSegunda.segundaRespostaEm).not.toBeNull();

    await mensagem({ direcao: 'out', texto: 'Mais uma' });
    expect((await lead()).segundaRespostaEm).toEqual(depoisDaSegunda.segundaRespostaEm);
  });

  it('o horário gravado é o de agora em UTC, como as outras colunas', async () => {
    const antes = Date.now();
    await mensagem({ direcao: 'out', texto: 'Oi' });
    const gravado = (await lead()).primeiraRespostaEm!.getTime();
    expect(Math.abs(gravado - antes)).toBeLessThan(60_000);
  });

  it.each([['system-out'], ['info'], [''], ['{{message_direction}}']])('direção "%s" é ignorada: automação e IA não são resposta da equipe', async (direcao) => {
    const res = await mensagem({ direcao, texto: 'Bem-vindo!' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ignorada: true });
    expect(await prisma.lead.count({ where: { contaId: r.contaId } })).toBe(0);
  });

  it('o texto da mensagem não fica guardado em lugar nenhum', async () => {
    await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['parabens pela compra'] } : {}));
    await mensagem({ direcao: 'out', texto: 'Parabéns pela compra SEGREDO-XYZ de R$ 50' });
    const leadGravado = await lead();
    expect(leadGravado.etapa).toBe('venda');
    const eventos = await prisma.eventoLead.findMany({ where: { leadId: leadGravado.id } });
    expect(JSON.stringify([leadGravado, eventos.map((e) => e.texto)])).not.toContain('SEGREDO-XYZ');
  });

  describe('frases gatilho', () => {
    it('etapa de andamento: o atendente manda a frase e o lead avança; o cliente mandando a mesma frase, não', async () => {
      await salvarEtapas((e) => (e.tipo === 'andamento' ? { frases: ['Seu orçamento'] } : {}));
      const etapa = await prisma.etapaFunil.findFirstOrThrow({ where: { contaId: r.contaId, tipo: 'andamento' } });
      await mensagem({ direcao: 'in', texto: 'Quero seu orçamento' });
      expect((await lead()).etapaId).toBeNull();
      await mensagem({ direcao: 'out', texto: 'Segue SEU ORCAMENTO.' });
      expect(await lead()).toMatchObject({ etapaId: etapa.id, etapa: 'qualificado' });
      const evento = await prisma.eventoLead.findFirstOrThrow({ where: { lead: { chatId: '700' }, tipo: etapa.chave } });
      expect(evento).toMatchObject({ autor: 'kentro', autorNome: 'Frase gatilho' });
    });

    it('venda pega o valor da mensagem; sem valor, registra zero em vez de perder a venda', async () => {
      await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['parabens pela compra'] } : {}));
      await mensagem({ direcao: 'out', texto: 'Parabéns pela compra de R$ 1.234,50!' });
      expect(await lead()).toMatchObject({ etapa: 'venda', valorVenda: new Prisma.Decimal('1234.5') });

      await mensagem({ chatId: '701', direcao: 'out', texto: 'Parabéns pela compra!' });
      expect(await prisma.lead.findFirstOrThrow({ where: { chatId: '701' } })).toMatchObject({ etapa: 'venda', valorVenda: new Prisma.Decimal(0) });
    });

    it('o valor padrão da etapa tem prioridade sobre o da mensagem', async () => {
      await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['parabens'], valorPadrao: 500 } : {}));
      await mensagem({ direcao: 'out', texto: 'Parabéns! R$ 99' });
      expect((await lead()).valorVenda).toEqual(new Prisma.Decimal(500));
    });

    it('a frase só leva adiante: depois da venda, a frase de uma etapa anterior não desfaz', async () => {
      await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['parabens'] } : e.tipo === 'andamento' ? { frases: ['orcamento'] } : { frases: ['desistiu'] }));
      await mensagem({ direcao: 'out', texto: 'Parabéns R$ 10' });
      const vendido = await lead();
      await mensagem({ direcao: 'out', texto: 'Segue o orçamento do outro produto' });
      await mensagem({ direcao: 'out', texto: 'desistiu' });
      expect(await lead()).toMatchObject({ etapaId: vendido.etapaId, etapa: 'venda', vendaEm: vendido.vendaEm });
    });

    it('repetir a frase da etapa atual não repete histórico nem refaz a venda', async () => {
      await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['parabens'] } : {}));
      await mensagem({ direcao: 'out', texto: 'Parabéns R$ 10' });
      const vendido = await lead();
      await mensagem({ direcao: 'out', texto: 'Parabéns de novo R$ 999' });
      expect(await lead()).toMatchObject({ valorVenda: vendido.valorVenda, vendaEm: vendido.vendaEm });
    });

    it('perda: registra o motivo; lead perdido pode voltar por frase de outra etapa', async () => {
      await salvarEtapas((e) => (e.tipo === 'perda' ? { frases: ['encerrando'] } : e.tipo === 'andamento' ? { frases: ['orcamento'] } : {}));
      await mensagem({ direcao: 'out', texto: 'Estamos encerrando' });
      expect(await lead()).toMatchObject({ etapa: 'descartado', motivoDescarte: expect.stringContaining('Frase gatilho') });
      await mensagem({ direcao: 'out', texto: 'Segue o orçamento' });
      expect((await lead()).etapa).toBe('qualificado');
    });

    it('sem frase na mensagem, nada muda', async () => {
      await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['parabens'] } : {}));
      await mensagem({ direcao: 'out', texto: 'Bom dia' });
      expect(await lead()).toMatchObject({ etapa: 'em_atendimento', etapaId: null });
    });
  });

  describe('configuração das etapas', () => {
    it('grava, devolve e mantém frases e valor quando a tela antiga não manda os campos', async () => {
      const res = await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: [' parabens ', 'parabens'], valorPadrao: 99.9 } : {}));
      expect(res.status).toBe(200);
      const venda = () => prisma.etapaFunil.findFirstOrThrow({ where: { contaId: r.contaId, tipo: 'venda' } });
      expect(res.body.etapas.find((e: { tipo: string }) => e.tipo === 'venda')).toMatchObject({ frases: ['parabens'], valorPadrao: 99.9 });
      await salvarEtapas(({ frases: _, valorPadrao: __, ...e }) => ({ ...e, frases: undefined, valorPadrao: undefined }));
      expect(await venda()).toMatchObject({ frases: ['parabens'], valorPadrao: new Prisma.Decimal('99.9') });
    });

    it('etapa que não é de venda não guarda valor padrão', async () => {
      await salvarEtapas((e) => (e.tipo === 'andamento' ? { valorPadrao: 10 } : {}));
      expect((await prisma.etapaFunil.findFirstOrThrow({ where: { contaId: r.contaId, tipo: 'andamento' } })).valorPadrao).toBeNull();
    });

    it('recusa frase repetida entre etapas e frase curta demais', async () => {
      const repetida = await salvarEtapas(() => ({ frases: ['mesma frase'] }));
      expect(repetida.status).toBe(400);
      expect(repetida.body.erro.codigo).toBe('FRASE_REPETIDA');
      expect((await salvarEtapas((e) => (e.tipo === 'venda' ? { frases: ['ok'] } : {}))).status).toBe(400);
    });

    it('a integração mostra o corpo do evento de mensagem', async () => {
      const { body } = await comChave(http().get('/v1/kentro/integracao'), r.chaveAdmin);
      expect(body.exemplos.mensagem).toMatchObject({ evento: 'mensagem', direcao: '{{message_direction}}', texto: '{{message_text}}', chatId: '{{chat_id}}' });
    });
  });

  describe('painel', () => {
    const lista = (extra = '') => comChave(http().get(`/v1/painel/leads?${PERIODO}${extra}`), r.chaveGestor);

    beforeEach(async () => {
      await prisma.contaAnuncio.create({ data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true, cargaConcluidaEm: new Date() } });
    });

    it('aguardando 1ª resposta: só quem escreveu e não teve resposta, com a contagem', async () => {
      await mensagem({ direcao: 'in', texto: 'Olá' });
      await mensagem({ chatId: '701', nome: 'João', telefone: '5531988880000', direcao: 'in', texto: 'Oi' });
      await mensagem({ chatId: '701', nome: 'João', telefone: '5531988880000', direcao: 'out', texto: 'Oi, João' });
      // Conversa aberta pela automação, sem mensagem do cliente: não está esperando ninguém.
      await http().post(caminho(url)).send({ evento: 'chat_iniciado', chatId: '702', nome: 'Pedro' });

      const todos = await lista();
      expect(todos.body.aguardandoResposta).toBe(1);
      expect(todos.body.itens).toHaveLength(3);
      const filtrados = await lista('&aguardando=1');
      expect(filtrados.body.itens.map((l: { nome: string }) => l.nome)).toEqual(['Maria']);
      expect(todos.body.itens.find((l: { nome: string }) => l.nome === 'João')).toMatchObject({ primeiraRespostaEm: expect.any(String), ultimaMensagemEm: expect.any(String) });
    });

    it('ordena pela última mensagem, e o CSV traz as colunas novas', async () => {
      await mensagem({ direcao: 'in', texto: 'Olá' });
      await mensagem({ chatId: '701', nome: 'João', telefone: '5531988880000', direcao: 'in', texto: 'Oi' });
      await mensagem({ direcao: 'out', texto: 'Oi, Maria' });
      expect((await lista('&ordem=ultima_mensagem')).body.itens.map((l: { nome: string }) => l.nome)).toEqual(['Maria', 'João']);
      const csv = await comChave(http().get(`/v1/painel/leads/exportar?${PERIODO}&tipo=leads`), r.chaveGestor);
      expect(csv.body.csv.split('\r\n')[0]).toContain(';Primeira resposta;Última mensagem');
    });

    it('análises: tempo médio a partir da primeira e da segunda resposta', async () => {
      await mensagem({ direcao: 'in', texto: 'Olá' });
      const { id } = await lead();
      const chegou = new Date(Date.now() - 3_600_000);
      await prisma.lead.update({
        where: { id },
        data: { recebidoEm: chegou, primeiraRespostaEm: new Date(chegou.getTime() + 5 * 60_000), segundaRespostaEm: new Date(chegou.getTime() + 25 * 60_000) },
      });
      const res = await comChave(http().get(`/v1/painel/analises?${PERIODO}`), r.chaveGestor);
      expect(res.body.tempoResposta).toEqual({ respondidos: 1, aguardando: 0, minutosPrimeira: 5, minutosSegunda: 25 });
    });
  });
});
