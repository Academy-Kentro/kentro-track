import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';
import { comUsuarioDoSistema, erroMeta, metaFalso, Requisicao } from './meta/meta-falso';

const prisma = new PrismaClient();
const meta = metaFalso();
const PERIODO = 'de=2026-10-10&ate=2026-10-16';

const LINHAS: Record<string, object[]> = {
  campaign: [{ campaign_id: 'C1', reach: '1500', frequency: '1.8349' }],
  adset: [{ adset_id: 'S1', reach: '900', frequency: '2.1' }],
  ad: [{ ad_id: 'A1', reach: '400', frequency: '1.5' }, { ad_id: 'A2', reach: 'x', frequency: '1' }],
};

describe('alcance e frequência das campanhas', () => {
  let app: INestApplication;
  let r: Registro;
  let contaAnuncioId: string;
  const alcance = (q = PERIODO, chave = r.chaveGestor) => comChave(request(app.getHttpServer()).get(`/v1/painel/campanhas/alcance?${q}`), chave);
  const consultas = () => meta.chamadas.filter((c) => c.caminho === 'act_111/insights') as Requisicao[];
  const comAlcance = () => meta.get('act_111/insights', (req) => ({ corpo: { data: LINHAS[req.params.get('level')!] } }));

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { fetch: meta.fetch });
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    meta.limpar();
    r = await registrarConta(app);
    comUsuarioDoSistema(meta);
    const conectado = await comChave(request(app.getHttpServer()).put('/v1/meta/token-manual'), r.chaveAdmin).send({ token: 'EAAG' + 'y'.repeat(40) });
    contaAnuncioId = conectado.body.contasAnuncio.find((c: { idMeta: string }) => c.idMeta === 'act_111').id;
    await comChave(request(app.getHttpServer()).put('/v1/meta/contas-anuncio'), r.chaveAdmin).send({ contas: [{ id: contaAnuncioId, selecionada: true }] });
    meta.limpar();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lê o período inteiro, uma consulta por nível, sem dividir por dia', async () => {
    comAlcance();
    const { body, status } = await alcance();
    expect(status).toBe(200);
    expect(body).toEqual({
      campanha: { C1: { alcance: 1500, frequencia: 1.83 } },
      conjunto: { S1: { alcance: 900, frequencia: 2.1 } },
      anuncio: { A1: { alcance: 400, frequencia: 1.5 } },
      indisponivel: false,
    });
    expect(consultas().map((c) => c.params.get('level'))).toEqual(['campaign', 'adset', 'ad']);
    for (const c of consultas()) {
      expect(JSON.parse(c.params.get('time_range')!)).toEqual({ since: '2026-10-10', until: '2026-10-16' });
      expect(c.params.get('time_increment')).toBeNull();
    }
  });

  it('a segunda leitura do mesmo período não chama o Meta; outro período, sim', async () => {
    comAlcance();
    await alcance();
    await alcance();
    expect(consultas()).toHaveLength(3);
    await alcance('de=2026-10-01&ate=2026-10-16');
    expect(consultas()).toHaveLength(6);
  });

  it('com campanha no filtro, pede só ela ao Meta', async () => {
    comAlcance();
    await alcance(`${PERIODO}&campanha=1001`);
    expect(JSON.parse(consultas()[0].params.get('filtering')!)).toEqual([{ field: 'campaign.id', operator: 'EQUAL', value: '1001' }]);
  });

  it('um nível falhar mantém os outros, avisa e não fica guardado', async () => {
    meta.get('act_111/insights', (req) => (req.params.get('level') === 'adset' ? erroMeta(100, 'Invalid') : { corpo: { data: LINHAS[req.params.get('level')!] } }));
    const { body, status } = await alcance();
    expect(status).toBe(200);
    expect(body).toMatchObject({ campanha: { C1: { alcance: 1500 } }, conjunto: {}, anuncio: { A1: { alcance: 400 } }, indisponivel: true });
    await alcance();
    expect(consultas()).toHaveLength(6);
  });

  it('limite do Meta: para na primeira consulta e devolve vazio, sem erro', async () => {
    meta.get('act_111/insights', erroMeta(80004, 'There have been too many calls'));
    const { body, status } = await alcance();
    expect(status).toBe(200);
    expect(body).toEqual({ campanha: {}, conjunto: {}, anuncio: {}, indisponivel: true });
    expect(consultas()).toHaveLength(1);
  });

  it('conta que já está esperando o Meta liberar não gasta cota', async () => {
    await prisma.contaAnuncio.update({ where: { id: contaAnuncioId }, data: { limitadaAte: new Date(Date.now() + 3_600_000) } });
    comAlcance();
    expect((await alcance()).body.indisponivel).toBe(true);
    expect(consultas()).toHaveLength(0);
  });

  it('a chave de atendimento não lê', async () => {
    expect((await alcance(PERIODO, r.chaveAtendimento)).status).toBe(403);
  });
});
