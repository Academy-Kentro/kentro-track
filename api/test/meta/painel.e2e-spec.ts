import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from './apoio';
import { metaFalso } from './meta-falso';

const prisma = new PrismaClient();
const meta = metaFalso();
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/** Conta com uma conta de anúncio selecionada e métricas gravadas direto no banco. */
async function semear(r: Registro, opcoes: { definicaoLead?: string[]; moeda?: string; idMeta?: string; selecionada?: boolean } = {}) {
  const ca = await prisma.contaAnuncio.create({
    data: {
      contaId: r.contaId,
      idMeta: opcoes.idMeta ?? 'act_111',
      nome: `Conta ${opcoes.idMeta ?? 'act_111'}`,
      moeda: opcoes.moeda ?? 'BRL',
      fuso: 'America/Sao_Paulo',
      selecionada: opcoes.selecionada ?? true,
      definicaoLead: opcoes.definicaoLead ?? ['formulario', 'conversa'],
      cargaConcluidaEm: new Date('2026-10-21T10:00:00Z'),
      ultimaSincronizacaoEm: new Date('2026-10-21T10:00:00Z'),
    },
  });
  const base = { contaId: r.contaId, contaAnuncioId: ca.id };
  await prisma.campanha.create({ data: { ...base, idMeta: '1001', nome: 'Black Friday', statusEfetivo: 'ACTIVE' } });
  await prisma.conjunto.create({ data: { ...base, idMeta: 'S1', campanhaIdMeta: '1001', nome: 'Quente', statusEfetivo: 'ACTIVE' } });
  const anuncio = await prisma.anuncio.create({
    data: { ...base, idMeta: 'A1', conjuntoIdMeta: 'S1', campanhaIdMeta: '1001', nome: 'Vídeo', titulo: 'Promo', criativoIdMeta: 'CR1', miniaturaUrl: 'https://scontent.example/a1.jpg' },
  });
  const insight = (dia: string, anuncioIdMeta: string, campanhaIdMeta: string, m: Partial<Prisma.InsightDiarioCreateManyInput>) => ({
    ...base,
    data: new Date(`${dia}T00:00:00Z`),
    anuncioIdMeta,
    conjuntoIdMeta: anuncioIdMeta === 'A1' ? 'S1' : 'S9',
    campanhaIdMeta,
    ...m,
  });
  await prisma.insightDiario.createMany({
    data: [
      insight('2026-10-10', 'A1', '1001', { investimento: 100, impressoes: 10000, cliques: 300, cliquesLink: 200, leadsFormulario: 4, conversas: 6, leadsSite: 10 }),
      insight('2026-10-12', 'A1', '1001', { investimento: 50, impressoes: 5000, cliquesLink: 50, conversas: 5 }),
      // Anúncio de uma campanha que ainda não foi sincronizada: aparece pelo id.
      insight('2026-10-12', 'A9', '1009', { investimento: 25.5, impressoes: 1000, cliquesLink: 10 }),
      // Período anterior (01 a 09/10 tem o mesmo tamanho de 10 a 18/10).
      insight('2026-10-05', 'A1', '1001', { investimento: 80, impressoes: 8000, cliquesLink: 80, conversas: 4 }),
    ],
  });
  return { ca, anuncio };
}

describe('painel do gestor', () => {
  let app: INestApplication;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const painel = (rota: string, query: string, chave = r.chaveGestor) => comChave(http().get(`/v1/painel/${rota}?${query}`), chave);
  const PERIODO = 'de=2026-10-10&ate=2026-10-18';

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://tracks.teste' }, { fetch: meta.fetch });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    meta.limpar();
    r = await registrarConta(app);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('visão geral: totais, taxas, CPL pela definição de lead e comparação com o período anterior', async () => {
    await semear(r);
    const res = await painel('visao-geral', PERIODO);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      moeda: 'BRL',
      periodo: { de: '2026-10-10', ate: '2026-10-18' },
      cargaPendente: false,
      metricas: {
        investimento: 175.5,
        impressoes: 16000,
        cliquesLink: 260,
        // formulário 4 + conversas 11 (o pixel não entra na definição padrão)
        leads: 15,
        conversas: 11,
        cpl: 11.7,
        ctr: 1.625,
        cpm: expect.closeTo(10.9688, 3),
        custoPorConversa: 15.9545,
      },
      anterior: { de: '2026-10-01', ate: '2026-10-09', metricas: { investimento: 80, leads: 4, cpl: 20 } },
    });
    // Um ponto por dia, com zero nos dias sem entrega.
    expect(res.body.serie).toHaveLength(9);
    expect(res.body.serie[1]).toEqual({ data: '2026-10-11', investimento: 0, leads: 0, conversas: 0, impressoes: 0, cliquesLink: 0 });
    expect(res.body.serie[2]).toMatchObject({ data: '2026-10-12', investimento: 75.5, leads: 5 });
  });

  it('a definição de lead da conta de anúncio muda o CPL', async () => {
    await semear(r, { definicaoLead: ['site'] });
    const res = await painel('visao-geral', PERIODO);
    expect(res.body.metricas).toMatchObject({ leads: 10, cpl: 17.55 });
  });

  it('sem dados no período anterior, não compara; sem leads, CPL é null e não infinito', async () => {
    await semear(r);
    const res = await painel('visao-geral', 'de=2026-10-12&ate=2026-10-12&campanha=1009');
    expect(res.body.anterior).toBeNull();
    expect(res.body.metricas).toMatchObject({ investimento: 25.5, leads: 0, cpl: null });
  });

  it('não soma moedas diferentes sem filtrar a conta de anúncio', async () => {
    await semear(r);
    const dolar = await semear(r, { moeda: 'USD', idMeta: 'act_222' });
    expect((await painel('visao-geral', PERIODO)).body.erro.codigo).toBe('MOEDAS_DIFERENTES');
    const filtrado = await painel('visao-geral', `${PERIODO}&contaAnuncio=${dolar.ca.id}`);
    expect(filtrado.body).toMatchObject({ moeda: 'USD', metricas: { investimento: 175.5 } });
  });

  it('conta de anúncio não selecionada fica fora dos números', async () => {
    await semear(r, { selecionada: false });
    expect((await painel('visao-geral', PERIODO)).body.metricas.investimento).toBe(0);
  });

  it('campanhas: árvore campanha › conjunto › anúncio, ordenada por investimento', async () => {
    await semear(r);
    const res = await painel('campanhas', PERIODO);
    expect(res.status).toBe(200);
    expect(res.body.campanhas.map((c: { nome: string }) => c.nome)).toEqual(['Black Friday', '#1009']);
    const [bf] = res.body.campanhas;
    expect(bf).toMatchObject({ idMeta: '1001', status: 'ACTIVE', metricas: { investimento: 150, leads: 15, cpl: 10 } });
    expect(bf.conjuntos).toEqual([
      expect.objectContaining({ nome: 'Quente', anuncios: [expect.objectContaining({ idMeta: 'A1', nome: 'Vídeo', metricas: expect.objectContaining({ investimento: 150 }) })] }),
    ]);
  });

  it('criativos: miniatura pela nossa rota assinada, servida com cache e CORS', async () => {
    const { anuncio } = await semear(r);
    const res = await painel('criativos', PERIODO);
    const [primeiro] = res.body.criativos;
    expect(primeiro).toMatchObject({ idMeta: 'A1', nome: 'Vídeo', titulo: 'Promo', campanha: 'Black Friday', metricas: { investimento: 150 } });
    expect(primeiro.miniatura).toMatch(new RegExp(`^https://tracks\\.teste/m/${anuncio.id}\\.[A-Za-z0-9_-]{22}$`));
    expect(res.body.criativos[1].miniatura).toBeNull();

    meta.get('https://scontent.example/a1.jpg', { bytes: PNG, cabecalhos: { 'content-type': 'image/png' } });
    const caminho = new URL(primeiro.miniatura).pathname;
    const img = await http().get(caminho);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['access-control-allow-origin']).toBe('*');
    expect(Buffer.from(img.body).equals(PNG)).toBe(true);
    // Segunda vez sai do cache, sem ir ao Meta.
    await http().get(caminho);
    expect(meta.chamadas.filter((c) => c.url === 'https://scontent.example/a1.jpg')).toHaveLength(1);
  });

  it('miniatura expirada: pede a URL nova ao Graph e guarda', async () => {
    const { anuncio } = await semear(r);
    await prisma.conexaoMeta.create({
      data: { contaId: r.contaId, tipo: 'token_manual', tokenCifrado: new Uint8Array([1]), iv: new Uint8Array([1]), usuarioMetaId: '1', usuarioMetaNome: 'x', escopos: [], verificadoEm: new Date() },
    });
    // Sem token decifrável a renovação não acontece: a rota responde 404 sem quebrar.
    meta.get('https://scontent.example/a1.jpg', { status: 403, corpo: {} });
    const { miniatura } = (await painel('criativos', PERIODO)).body.criativos[0];
    expect((await http().get(new URL(miniatura).pathname)).status).toBe(404);
    expect((await prisma.anuncio.findUniqueOrThrow({ where: { id: anuncio.id } })).miniaturaUrl).toBe('https://scontent.example/a1.jpg');
  });

  it.each(['/m/nao-e-ref', '/m/00000000-0000-0000-0000-000000000000.AAAAAAAAAAAAAAAAAAAAAA'])('%s com assinatura inválida dá 404', async (caminho) => {
    expect((await http().get(caminho)).status).toBe(404);
  });

  it('filtros: contas de anúncio selecionadas e as campanhas delas', async () => {
    await semear(r);
    const res = await comChave(http().get('/v1/painel/filtros'), r.chaveGestor);
    expect(res.body).toMatchObject({
      contasAnuncio: [{ nome: 'Conta act_111', moeda: 'BRL' }],
      campanhas: [{ idMeta: '1001', nome: 'Black Friday', ativa: true }],
      cargaPendente: false,
    });
  });

  it('validação: período invertido, data inválida e período longo demais', async () => {
    await semear(r);
    expect((await painel('visao-geral', 'de=2026-10-18&ate=2026-10-10')).body.erro.codigo).toBe('PERIODO_INVALIDO');
    expect((await painel('visao-geral', 'de=2026-02-30&ate=2026-03-01')).body.erro.codigo).toBe('PERIODO_INVALIDO');
    expect((await painel('visao-geral', 'de=2024-01-01&ate=2026-01-01')).body.erro.codigo).toBe('PERIODO_INVALIDO');
    expect((await painel('visao-geral', 'de=ontem&ate=hoje')).status).toBe(400);
  });

  it('a chave de atendimento não lê o painel; a de admin lê', async () => {
    await semear(r);
    expect((await painel('visao-geral', PERIODO, r.chaveAtendimento)).status).toBe(403);
    expect((await painel('visao-geral', PERIODO, r.chaveAdmin)).status).toBe(200);
  });

  it('uma conta não enxerga os números de outra', async () => {
    const { ca } = await semear(r);
    const outra = await registrarConta(app, 'Outra');
    expect((await painel('visao-geral', PERIODO, outra.chaveGestor)).body.metricas.investimento).toBe(0);
    expect((await painel('visao-geral', `${PERIODO}&contaAnuncio=${ca.id}`, outra.chaveGestor)).status).toBe(404);
  });
});
