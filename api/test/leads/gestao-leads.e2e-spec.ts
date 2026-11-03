import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from '../meta/apoio';
import { metaFalso } from '../meta/meta-falso';

const prisma = new PrismaClient();
const meta = metaFalso();
const PERIODO = 'de=2026-10-10&ate=2026-10-18';

/** Conta de anúncio com dois conjuntos e dois anúncios, e leads gravados direto no banco. */
async function semear(r: Registro) {
  const ca = await prisma.contaAnuncio.create({
    data: { contaId: r.contaId, idMeta: 'act_1', nome: 'Loja', moeda: 'BRL', fuso: 'America/Sao_Paulo', selecionada: true, cargaConcluidaEm: new Date() },
  });
  const base = { contaId: r.contaId, contaAnuncioId: ca.id };
  await prisma.campanha.create({ data: { ...base, idMeta: '100', nome: 'Black Friday', statusEfetivo: 'ACTIVE' } });
  await prisma.conjunto.createMany({
    data: [
      { ...base, idMeta: '200', campanhaIdMeta: '100', nome: 'Quente' },
      { ...base, idMeta: '201', campanhaIdMeta: '100', nome: 'Frio' },
    ],
  });
  await prisma.anuncio.createMany({
    data: [
      { ...base, idMeta: '300', conjuntoIdMeta: '200', campanhaIdMeta: '100', nome: 'Vídeo' },
      { ...base, idMeta: '301', conjuntoIdMeta: '201', campanhaIdMeta: '100', nome: 'Reels' },
    ],
  });
  const anuncio = (conjunto: string, id: string) => ({ origem: 'ctwa' as const, contaAnuncioId: ca.id, campanhaIdMeta: '100', conjuntoIdMeta: conjunto, anuncioIdMeta: id });
  const lead = (d: Omit<Prisma.LeadUncheckedCreateInput, 'contaId'>) => prisma.lead.create({ data: { contaId: r.contaId, ...d } });
  const maria = await lead({ ...anuncio('200', '300'), nome: 'Maria Souza', telefone: '5538999990000', telefoneChave: '3899990000', atendenteId: '7', atendenteNome: 'Ana', recebidoEm: new Date('2026-10-12T15:00:00Z') });
  const joao = await lead({ ...anuncio('201', '301'), nome: 'João 100%', telefone: '5531988880000', telefoneChave: '3188880000', etapa: 'em_atendimento', recebidoEm: new Date('2026-10-13T15:00:00Z') });
  const organico = await lead({ origem: 'organico', nome: '=HYPERLINK("http://x")', telefone: '5511977770000', telefoneChave: '1177770000', recebidoEm: new Date('2026-10-14T15:00:00Z') });
  return { ca, maria, joao, organico };
}

describe('leads no painel de gestão', () => {
  let app: INestApplication;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const pegar = (rota: string, chave = r.chaveGestor) => comChave(http().get(`/v1/painel/${rota}`), chave);
  const postar = (rota: string, corpo: object, chave = r.chaveGestor) => comChave(http().post(`/v1/painel/leads/${rota}`), chave).set('X-Kentro-Usuario-Nome', 'Gil').send(corpo);
  const etapas = async () => (await prisma.etapaFunil.findMany({ where: { contaId: r.contaId }, orderBy: { ordem: 'asc' } }));
  const etapaDoTipo = async (tipo: 'andamento' | 'venda' | 'perda') => (await etapas()).find((e) => e.tipo === tipo)!;

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' }, { fetch: meta.fetch });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    meta.limpar();
    r = await registrarConta(app);
    // As etapas padrão nascem na primeira leitura.
    await comChave(http().get('/v1/etapas'), r.chaveGestor);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const nomes = (res: request.Response) => res.body.itens.map((l: { nome: string }) => l.nome);

  describe('filtros', () => {
    it('busca por nome, por pedaço de telefone e por número com ou sem o nono dígito', async () => {
      await semear(r);
      expect(nomes(await pegar(`leads?${PERIODO}&busca=maria`))).toEqual(['Maria Souza']);
      expect(nomes(await pegar(`leads?${PERIODO}&busca=98888`))).toEqual(['João 100%']);
      expect(nomes(await pegar(`leads?${PERIODO}&busca=${encodeURIComponent('(38) 9999-0000')}`))).toEqual(['Maria Souza']);
    });

    it('% e _ na busca valem como texto, não como curinga', async () => {
      await semear(r);
      expect(nomes(await pegar(`leads?${PERIODO}&busca=${encodeURIComponent('100%')}`))).toEqual(['João 100%']);
      expect(nomes(await pegar(`leads?${PERIODO}&busca=${encodeURIComponent('%')}`))).toEqual(['João 100%']);
      expect(nomes(await pegar(`leads?${PERIODO}&busca=_`))).toEqual([]);
    });

    it('conjunto, anúncio e atendente; as contagens por etapa respeitam o filtro', async () => {
      await semear(r);
      const conjunto = await pegar(`leads?${PERIODO}&conjunto=201`);
      expect(nomes(conjunto)).toEqual(['João 100%']);
      expect(conjunto.body.porEtapa).toEqual({ em_atendimento: 1 });
      expect(nomes(await pegar(`leads?${PERIODO}&anuncio=300`))).toEqual(['Maria Souza']);
      expect(nomes(await pegar(`leads?${PERIODO}&atendente=7`))).toEqual(['Maria Souza']);
      expect(nomes(await pegar(`leads?${PERIODO}&atendente=sem`)).sort()).toEqual(['=HYPERLINK("http://x")', 'João 100%'].sort());
    });

    it('data da venda no fuso da conta e ordenação', async () => {
      const { maria, joao } = await semear(r);
      // 01h de 15/10 em UTC ainda é 14/10 em São Paulo.
      await prisma.lead.update({ where: { id: maria.id }, data: { etapa: 'venda', valorVenda: 100, vendaEm: new Date('2026-10-15T01:00:00Z') } });
      await prisma.lead.update({ where: { id: joao.id }, data: { etapa: 'venda', valorVenda: 500, vendaEm: new Date('2026-10-16T12:00:00Z') } });
      expect(nomes(await pegar(`leads?${PERIODO}&vendaDe=2026-10-14&vendaAte=2026-10-14`))).toEqual(['Maria Souza']);
      expect(nomes(await pegar(`leads?${PERIODO}&vendaDe=2026-10-15`))).toEqual(['João 100%']);
      expect(nomes(await pegar(`leads?${PERIODO}&ordem=maior_venda`)).slice(0, 2)).toEqual(['João 100%', 'Maria Souza']);
      expect(nomes(await pegar(`leads?${PERIODO}&ordem=antigos`))[0]).toBe('Maria Souza');
    });

    it('recusa ordem e atendente fora do formato', async () => {
      await semear(r);
      expect((await pegar(`leads?${PERIODO}&ordem=1;DROP`)).status).toBe(400);
      expect((await pegar(`leads?${PERIODO}&atendente=abc`)).status).toBe(400);
    });

    it('opções: só o que tem lead no período, com nomes', async () => {
      await semear(r);
      const res = await pegar(`leads/opcoes?${PERIODO}`);
      expect(res.body.conjuntos).toEqual([{ id: '201', nome: 'Frio' }, { id: '200', nome: 'Quente' }]);
      expect(res.body.anuncios).toEqual([{ id: '301', nome: 'Reels' }, { id: '300', nome: 'Vídeo' }]);
      expect(res.body.atendentes).toEqual([{ id: '7', nome: 'Ana' }]);
      expect((await pegar('leads/opcoes?de=2026-01-01&ate=2026-01-02')).body).toMatchObject({ conjuntos: [], anuncios: [], atendentes: [], links: [], utmSource: [] });
    });
  });

  describe('quadro', () => {
    it('devolve no máximo 30 cartões por coluna e o total real de cada uma', async () => {
      await semear(r);
      await prisma.lead.createMany({
        data: Array.from({ length: 35 }, (_, i) => ({ contaId: r.contaId, origem: 'organico' as const, nome: `Lead ${i}`, recebidoEm: new Date(Date.UTC(2026, 9, 11, 12, i)) })),
      });
      const res = await pegar(`leads/quadro?${PERIODO}`);
      expect(res.status).toBe(200);
      expect(res.body.porEtapa).toEqual({ novo: 37, em_atendimento: 1 });
      const novos = res.body.itens.filter((l: { etapa: string }) => l.etapa === 'novo');
      expect(novos).toHaveLength(30);
      // Os mais recentes ficam: Maria e o orgânico são dos dias 12 e 14.
      expect(novos.map((l: { nome: string }) => l.nome)).toContain('Maria Souza');
      expect(novos.map((l: { nome: string }) => l.nome)).not.toContain('Lead 0');
      expect(res.body.itens.find((l: { nome: string }) => l.nome === 'Maria Souza').telefone).toBe('(38) 9****-0000');
    });
  });

  describe('mover pelo gestor', () => {
    it('muda a etapa sem marcar como atendido nem assumir o atendente, e registra quem fez como gestor', async () => {
      const { organico } = await semear(r);
      const etapa = await etapaDoTipo('andamento');
      const res = await postar(`${organico.id}/etapa`, { etapa: etapa.id });
      expect(res.status).toBe(200);
      expect(res.body.etapaId).toBe(etapa.id);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: organico.id } });
      expect(lead).toMatchObject({ etapaId: etapa.id, atendidoEm: null, atendenteId: null });
      const evento = await prisma.eventoLead.findFirstOrThrow({ where: { leadId: organico.id, tipo: etapa.chave } });
      expect(evento).toMatchObject({ autor: 'gestor', autorNome: 'Gil' });
    });

    it('venda pede valor e perda pede motivo', async () => {
      const { maria } = await semear(r);
      const venda = await etapaDoTipo('venda');
      const perda = await etapaDoTipo('perda');
      expect((await postar(`${maria.id}/etapa`, { etapa: venda.id })).body.erro.codigo).toBe('VALOR_INVALIDO');
      expect((await postar(`${maria.id}/etapa`, { etapa: perda.id })).body.erro.codigo).toBe('MOTIVO_OBRIGATORIO');
      expect((await postar(`${maria.id}/etapa`, { etapa: venda.id, valor: 250.5 })).status).toBe(200);
      expect(await prisma.lead.findUniqueOrThrow({ where: { id: maria.id } })).toMatchObject({ etapa: 'venda', valorVenda: new Prisma.Decimal('250.5') });
    });

    it('lead de outra conta dá 404, e a chave de atendimento não entra', async () => {
      const { maria } = await semear(r);
      const outra = await registrarConta(app, 'Outra');
      await comChave(http().get('/v1/etapas'), outra.chaveGestor);
      expect((await postar(`${maria.id}/etapa`, { etapa: 'em_atendimento' }, outra.chaveGestor)).status).toBe(404);
      expect((await postar(`${maria.id}/etapa`, { etapa: 'em_atendimento' }, r.chaveAtendimento)).status).toBe(403);
    });
  });

  describe('troca em lote', () => {
    it('conferir não muda nada: acha com ou sem o nono dígito, usa a entrada mais recente e separa o resto', async () => {
      const { maria } = await semear(r);
      const repetida = await prisma.lead.create({
        data: { contaId: r.contaId, origem: 'organico', nome: 'Maria de novo', telefone: '553899990000', telefoneChave: '3899990000', recebidoEm: new Date('2026-10-17T15:00:00Z') },
      });
      const res = await postar('lote/conferir', { telefones: ['(38) 9 9999-0000', '38 9999-0000', '11966660000', 'abc'] });
      expect(res.status).toBe(200);
      expect(res.body.encontrados).toEqual([expect.objectContaining({ id: repetida.id, nome: 'Maria de novo', entradas: 2 })]);
      expect(res.body.naoEncontrados).toEqual(['11966660000']);
      expect(res.body.invalidos).toEqual(['abc']);
      expect(res.body.encontrados[0].telefone).toContain('****');
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: maria.id } })).etapa).toBe('novo');
    });

    it('aplica a etapa, pula quem já está nela e ignora lead de outra conta', async () => {
      const { maria, joao } = await semear(r);
      const outra = await registrarConta(app, 'Outra');
      const alheio = await prisma.lead.create({ data: { contaId: outra.contaId, origem: 'organico', nome: 'Alheio' } });
      const etapa = await etapaDoTipo('andamento');
      await prisma.lead.update({ where: { id: joao.id }, data: { etapaId: etapa.id } });

      const res = await postar('lote/etapa', { leads: [maria.id, joao.id, alheio.id], etapa: etapa.id });
      expect(res.body).toEqual({ alterados: 1, jaNaEtapa: 1, naoEncontrados: 1, erros: [] });
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: maria.id } })).etapaId).toBe(etapa.id);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: alheio.id } })).etapaId).toBeNull();
      // Quem já estava lá não ganha histórico repetido.
      expect(await prisma.eventoLead.count({ where: { leadId: joao.id } })).toBe(0);
    });

    it('venda sem valor falha antes de tocar em qualquer lead; com valor, grava em todos', async () => {
      const { maria, joao } = await semear(r);
      const venda = await etapaDoTipo('venda');
      const semValor = await postar('lote/etapa', { leads: [maria.id, joao.id], etapa: venda.id });
      expect(semValor.status).toBe(400);
      expect(semValor.body.erro.codigo).toBe('VALOR_INVALIDO');
      expect(await prisma.lead.count({ where: { contaId: r.contaId, etapa: 'venda' } })).toBe(0);

      const res = await postar('lote/etapa', { leads: [maria.id, joao.id], etapa: venda.id, valor: 100 });
      expect(res.body.alterados).toBe(2);
      expect(await prisma.lead.count({ where: { contaId: r.contaId, etapa: 'venda', valorVenda: 100 } })).toBe(2);
    });

    it('respeita os limites por chamada e recusa etapa desconhecida', async () => {
      const { maria } = await semear(r);
      const muitos = Array.from({ length: 51 }, () => maria.id);
      expect((await postar('lote/etapa', { leads: muitos, etapa: 'em_atendimento' })).status).toBe(400);
      expect((await postar('lote/etapa', { leads: [], etapa: 'em_atendimento' })).status).toBe(400);
      expect((await postar('lote/conferir', { telefones: Array.from({ length: 501 }, () => '38999990000') })).status).toBe(400);
      expect((await postar('lote/etapa', { leads: [maria.id], etapa: 'nao-existe' })).body.erro.codigo).toBe('ETAPA_DESCONHECIDA');
    });
  });

  describe('últimas atualizações', () => {
    it('só mudanças de etapa, da conta, as 10 mais recentes, com telefone mascarado', async () => {
      const { maria } = await semear(r);
      const etapa = await etapaDoTipo('andamento');
      await prisma.eventoLead.create({ data: { leadId: maria.id, tipo: 'recebido', texto: 'Chegou.', autor: 'sistema' } });
      const outra = await registrarConta(app, 'Outra');
      const alheio = await prisma.lead.create({ data: { contaId: outra.contaId, origem: 'organico', nome: 'Alheio' } });
      await prisma.eventoLead.create({ data: { leadId: alheio.id, tipo: etapa.chave, texto: 'De outra conta.', autor: 'sistema' } });
      await prisma.eventoLead.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({ leadId: maria.id, tipo: etapa.chave, texto: `Mudança ${i}`, autor: 'gestor', em: new Date(Date.UTC(2026, 9, 12, 12, i)) })),
      });
      const res = await pegar('leads/atualizacoes');
      expect(res.body.itens).toHaveLength(10);
      expect(res.body.itens[0]).toMatchObject({ texto: 'Mudança 11', autor: 'Gestor', nome: 'Maria Souza', telefone: '(38) 9****-0000' });
      expect(res.body.itens.map((i: { texto: string }) => i.texto)).not.toContain('Chegou.');
      expect(res.body.itens.map((i: { texto: string }) => i.texto)).not.toContain('De outra conta.');
    });
  });

  describe('exportar', () => {
    const linhasDe = (csv: string) => csv.replace(/^﻿/, '').trim().split('\r\n');

    it('leads: BOM, ponto e vírgula, telefone completo em texto, datas no fuso da conta e fórmula neutralizada', async () => {
      await semear(r);
      const res = await pegar(`leads/exportar?${PERIODO}&tipo=leads`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ arquivo: 'leads-2026-10-10-a-2026-10-18.csv', linhas: 3, truncado: false });
      expect(res.body.csv.startsWith('﻿')).toBe(true);
      const linhas = linhasDe(res.body.csv);
      expect(linhas[0]).toBe('Chegou em;Lead;Telefone;Origem;Campanha;Conjunto;Anúncio;Atendente;Etapa;Venda em;Valor da venda;Motivo do descarte;Primeira resposta;Última mensagem;Link rastreável;utm_source;utm_medium;utm_campaign;utm_content;utm_term;gclid;fbclid;ctwa_clid');
      // A aspa dobra porque a célula tem aspas; o apóstrofo impede o Excel de executar.
      expect(linhas[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
      expect(linhas[3]).toBe('12/10/2026 12:00;Maria Souza;55 38 99999-0000;Anúncio (WhatsApp);Black Friday;Quente;Vídeo;Ana;Novo;;;;;;;;;;;;;;');
    });

    it('o telefone do CSV colado na troca em lote acha o mesmo lead', async () => {
      const { maria } = await semear(r);
      const conferido = await postar('lote/conferir', { telefones: ['55 38 99999-0000'] });
      expect(conferido.body.encontrados.map((l: { id: string }) => l.id)).toEqual([maria.id]);
    });

    it('leads: respeita os filtros da tela', async () => {
      await semear(r);
      const res = await pegar(`leads/exportar?${PERIODO}&tipo=leads&conjunto=201`);
      expect(res.body.linhas).toBe(1);
      expect(linhasDe(res.body.csv)[1]).toContain('João 100%');
    });

    it('vendas: pelo dia da venda, mesmo com o lead tendo chegado antes do período', async () => {
      const { maria } = await semear(r);
      await prisma.lead.update({
        where: { id: maria.id },
        data: { etapa: 'venda', valorVenda: 1234.5, recebidoEm: new Date('2026-09-01T15:00:00Z'), vendaEm: new Date('2026-10-15T15:00:00Z') },
      });
      const res = await pegar(`leads/exportar?${PERIODO}&tipo=vendas`);
      expect(res.body.linhas).toBe(1);
      expect(linhasDe(res.body.csv)[1]).toContain(';15/10/2026 12:00;1234,50;');
    });

    it('jornada: mudanças de etapa do período com quem fez', async () => {
      const { maria } = await semear(r);
      const etapa = await etapaDoTipo('andamento');
      await postar(`${maria.id}/etapa`, { etapa: etapa.id });
      await prisma.eventoLead.updateMany({ where: { leadId: maria.id }, data: { em: new Date('2026-10-15T15:00:00Z') } });
      const res = await pegar(`leads/exportar?${PERIODO}&tipo=jornada`);
      expect(res.body.linhas).toBe(1);
      expect(linhasDe(res.body.csv)[1]).toMatch(/^15\/10\/2026 12:00;Maria Souza;55 38 99999-0000;.*\(Gil\);Gestor$/);
    });

    it('sem tipo, ou com tipo desconhecido, é recusado; a chave de atendimento não exporta', async () => {
      await semear(r);
      expect((await pegar(`leads/exportar?${PERIODO}`)).status).toBe(400);
      expect((await pegar(`leads/exportar?${PERIODO}&tipo=tudo`)).status).toBe(400);
      expect((await pegar(`leads/exportar?${PERIODO}&tipo=leads`, r.chaveAtendimento)).status).toBe(403);
    });
  });
});
