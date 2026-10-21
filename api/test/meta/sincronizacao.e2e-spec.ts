import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { SincronizacaoService } from '../../src/meta/sincronizacao/sincronizacao.service';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from './apoio';
import { comUsuarioDoSistema, erroMeta, metaFalso, Requisicao } from './meta-falso';

const prisma = new PrismaClient();
const meta = metaFalso();
const AGORA = new Date('2026-10-21T15:00:00Z'); // 12h em São Paulo
const minutos = (n: number) => new Date(AGORA.getTime() + n * 60_000);

const linha = (anuncio: string, dia: string, gasto: string, extra: object = {}) => ({
  ad_id: anuncio,
  adset_id: anuncio === 'AD1' ? 'SET1' : 'SET2',
  campaign_id: 'CAMP1',
  date_start: dia,
  spend: gasto,
  impressions: '1000',
  clicks: '20',
  inline_link_clicks: '10',
  actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }],
  ...extra,
});

function comEntidades() {
  meta.get('act_111/campaigns', { corpo: { data: [{ id: 'CAMP1', name: 'Black Friday', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '5000' }] } });
  meta.get('act_111/adsets', {
    corpo: {
      data: [
        { id: 'SET1', name: 'Público quente', campaign_id: 'CAMP1', effective_status: 'ACTIVE' },
        { id: 'SET2', name: 'Público frio', campaign_id: 'CAMP1', effective_status: 'PAUSED' },
      ],
    },
  });
  meta.get('act_111/ads', {
    corpo: {
      data: [
        {
          id: 'AD1',
          name: 'Vídeo depoimento',
          adset_id: 'SET1',
          campaign_id: 'CAMP1',
          effective_status: 'ACTIVE',
          creative: { id: 'CR1', title: 'Promo', body: 'Chama no WhatsApp', thumbnail_url: 'https://scontent.example/t1.jpg', effective_object_story_id: '55_66' },
        },
        { id: 'AD2', name: 'Carrossel', adset_id: 'SET2', campaign_id: 'CAMP1', effective_status: 'PAUSED', creative: { id: 'CR2', image_url: 'https://scontent.example/i2.jpg' } },
      ],
    },
  });
}

function comRelatorioAssincrono(linhas: object[]) {
  let consultas = 0;
  meta.post('act_111/insights', { corpo: { report_run_id: 'R1' } });
  meta.get('R1', () => ({ corpo: { async_status: ++consultas < 2 ? 'Job Running' : 'Job Completed', async_percent_completion: consultas < 2 ? 50 : 100 } }));
  meta.get('R1/insights', { corpo: { data: linhas } });
}

describe('sincronização com o Meta', () => {
  let app: INestApplication;
  let sinc: SincronizacaoService;
  let r: Registro;
  let contaAnuncioId: string;

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { fetch: meta.fetch });
    sinc = app.get(SincronizacaoService);
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    meta.limpar();
    r = await registrarConta(app);
    comUsuarioDoSistema(meta);
    const conectado = await comChave(request(app.getHttpServer()).put('/v1/meta/token-manual'), r.chaveAdmin).send({ token: 'EAAG' + 'y'.repeat(40) });
    contaAnuncioId = conectado.body.contasAnuncio.find((c: { idMeta: string }) => c.idMeta === 'act_111').id;
    await comChave(request(app.getHttpServer()).put('/v1/meta/contas-anuncio'), r.chaveAdmin).send({ contas: [{ id: contaAnuncioId, selecionada: true }] });
    // Selecionar agenda pelo relógio real; os testes usam um AGORA fixo, então a agenda começa vencida.
    await prisma.contaAnuncio.update({ where: { id: contaAnuncioId }, data: { proximaHorariaEm: null, proximaEntidadesEm: null } });
    meta.limpar();
    comEntidades();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function fazerCarga() {
    comRelatorioAssincrono([linha('AD1', '2026-10-20', '100.50'), linha('AD2', '2026-10-21', '20')]);
    expect(await sinc.executarProxima(AGORA)).toBe(true);
  }

  it('conta nova: sincroniza entidades e carrega 90 dias pelo relatório assíncrono', async () => {
    await fazerCarga();

    const criacao = meta.chamadas.find((c) => c.metodo === 'POST') as Requisicao;
    expect(criacao.caminho).toBe('act_111/insights');
    expect(JSON.parse(criacao.params.get('time_range')!)).toEqual({ since: '2026-07-24', until: '2026-10-21' });
    expect(criacao.params.get('level')).toBe('ad');
    expect(criacao.params.get('time_increment')).toBe('1');

    expect(await prisma.campanha.findFirst({ where: { contaAnuncioId } })).toMatchObject({ nome: 'Black Friday', objetivo: 'OUTCOME_LEADS' });
    expect(String((await prisma.campanha.findFirstOrThrow()).orcamentoDiario)).toBe('50');
    expect(await prisma.conjunto.count()).toBe(2);
    expect(await prisma.anuncio.findFirst({ where: { idMeta: 'AD1' } })).toMatchObject({
      titulo: 'Promo',
      texto: 'Chama no WhatsApp',
      miniaturaUrl: 'https://scontent.example/t1.jpg',
      objectStoryId: '55_66',
      criativoIdMeta: 'CR1',
    });
    expect((await prisma.anuncio.findFirst({ where: { idMeta: 'AD2' } }))?.miniaturaUrl).toBe('https://scontent.example/i2.jpg');

    const insights = await prisma.insightDiario.findMany({ orderBy: { data: 'asc' } });
    expect(insights.map((i) => [i.anuncioIdMeta, i.data.toISOString().slice(0, 10), String(i.investimento), i.conversas])).toEqual([
      ['AD1', '2026-10-20', '100.5', 3],
      ['AD2', '2026-10-21', '20', 3],
    ]);

    const conta = await prisma.contaAnuncio.findUniqueOrThrow({ where: { id: contaAnuncioId } });
    expect(conta).toMatchObject({ cargaConcluidaEm: AGORA, ultimaSincronizacaoEm: AGORA, ultimoErro: null, emExecucaoAte: null });
    expect(conta.proximaHorariaEm).toEqual(minutos(60));
    expect(conta.proximoRecalculoEm?.toISOString()).toBe('2026-10-22T07:00:00.000Z');
    expect(conta.proximaEntidadesEm).toEqual(minutos(360));
    // Nada vencido logo depois.
    expect(await sinc.executarProxima(AGORA)).toBe(false);
  });

  it('a horária relê ontem e hoje e substitui o que havia nesses dias', async () => {
    await fazerCarga();
    meta.limpar();
    meta.get('act_111/insights', { corpo: { data: [linha('AD1', '2026-10-21', '7.25')] } });

    expect(await sinc.executarProxima(minutos(61))).toBe(true);

    const consulta = meta.chamadas.find((c) => c.caminho === 'act_111/insights') as Requisicao;
    expect(JSON.parse(consulta.params.get('time_range')!)).toEqual({ since: '2026-10-20', until: '2026-10-21' });
    const insights = await prisma.insightDiario.findMany();
    // O dia 20 sumiu da resposta (o Meta omite dia sem entrega): sai do banco também.
    expect(insights.map((i) => [i.anuncioIdMeta, i.data.toISOString().slice(0, 10), String(i.investimento)])).toEqual([['AD1', '2026-10-21', '7.25']]);
  });

  it('token recusado: marca a conexão para reconectar e para de sincronizar', async () => {
    await fazerCarga();
    meta.limpar();
    meta.get('act_111/insights', erroMeta(190, 'Error validating access token: Session has expired'));

    expect(await sinc.executarProxima(minutos(61))).toBe(true);

    expect(await prisma.conexaoMeta.findUniqueOrThrow({ where: { contaId: r.contaId } })).toMatchObject({ status: 'reconectar', ultimoErro: expect.stringContaining('expired') });
    expect((await prisma.conta.findUniqueOrThrow({ where: { id: r.contaId } })).status).toBe('reconectar');
    expect(await sinc.executarProxima(minutos(200))).toBe(false);
  });

  it('erro passageiro: guarda a mensagem, libera a trava e tenta de novo em 15 minutos', async () => {
    meta.post('act_111/insights', erroMeta(100, 'Invalid parameter'));
    expect(await sinc.executarProxima(AGORA)).toBe(true);
    const conta = await prisma.contaAnuncio.findUniqueOrThrow({ where: { id: contaAnuncioId } });
    expect(conta).toMatchObject({ cargaConcluidaEm: null, ultimoErro: 'Invalid parameter', emExecucaoAte: null, proximaHorariaEm: minutos(15) });
    expect(await sinc.executarProxima(minutos(10))).toBe(false);
  });

  it('limite do Meta: tenta de novo depois do tempo que ele pede', async () => {
    meta.post('act_111/insights', {
      ...erroMeta(80004, 'There have been too many calls'),
      cabecalhos: { 'x-business-use-case-usage': JSON.stringify({ '1': [{ call_count: 100, estimated_time_to_regain_access: 40 }] }) },
    });
    await sinc.executarProxima(AGORA);
    expect((await prisma.contaAnuncio.findUniqueOrThrow({ where: { id: contaAnuncioId } })).proximaHorariaEm).toEqual(minutos(40));
  });

  it('não pega conta travada, não selecionada ou de conta bloqueada', async () => {
    await prisma.contaAnuncio.update({ where: { id: contaAnuncioId }, data: { emExecucaoAte: minutos(5) } });
    expect(await sinc.executarProxima(AGORA)).toBe(false);

    await prisma.contaAnuncio.update({ where: { id: contaAnuncioId }, data: { emExecucaoAte: null, selecionada: false } });
    expect(await sinc.executarProxima(AGORA)).toBe(false);

    await prisma.contaAnuncio.update({ where: { id: contaAnuncioId }, data: { selecionada: true } });
    await prisma.conta.update({ where: { id: r.contaId }, data: { status: 'bloqueada' } });
    expect(await sinc.executarProxima(AGORA)).toBe(false);
  });

  it('registra as chamadas para a aba Saúde, sem token', async () => {
    await fazerCarga();
    // O registro é gravado em segundo plano para não atrasar a chamada ao Meta.
    await new Promise((fim) => setTimeout(fim, 100));
    const registros = await prisma.chamadaMeta.findMany({ where: { contaId: r.contaId } });
    expect(registros.map((c) => c.operacao)).toEqual(expect.arrayContaining(['campanhas', 'conjuntos', 'anuncios', 'insights-assincrono']));
    expect(JSON.stringify(registros, (_, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('EAAG');
  });
});
