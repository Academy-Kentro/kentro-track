import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';

interface Registro {
  contaId: string;
  chaveAdmin: string;
  chaveGestor: string;
  chaveAtendimento: string;
}

const prisma = new PrismaClient();
let ipSeq = 0;

// Cada registro sai de um IP diferente para o limite por IP não interferir nos outros testes.
async function registrar(app: INestApplication, corpo: object = { nome: 'Empresa Teste' }, instancia?: string): Promise<Registro> {
  ipSeq += 1;
  const req = request(app.getHttpServer()).post('/v1/contas/registrar').set('X-Forwarded-For', `10.0.0.${ipSeq}`);
  if (instancia) req.set('X-Kentro-Instancia', instancia);
  const res = await req.send(corpo);
  expect(res.status).toBe(201);
  return res.body;
}

function conta(app: INestApplication, chave?: string) {
  const req = request(app.getHttpServer()).get('/v1/conta');
  return chave === undefined ? req : req.set('X-Track-Chave', chave);
}

function rotacionar(app: INestApplication, tipo: string, chave: string) {
  return request(app.getHttpServer()).post(`/v1/conta/chaves/${tipo}/rotacionar`).set('X-Track-Chave', chave);
}

afterAll(() => prisma.$disconnect());

describe('registro e chaves da conta', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(() => limparBanco(prisma));
  afterAll(() => app.close());

  it('registra a conta e devolve três chaves diferentes com os prefixos certos', async () => {
    const r = await registrar(app);
    expect(r.contaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.chaveAdmin).toMatch(/^kta_/);
    expect(r.chaveGestor).toMatch(/^ktg_/);
    expect(r.chaveAtendimento).toMatch(/^ktk_/);
    expect(new Set([r.chaveAdmin, r.chaveGestor, r.chaveAtendimento]).size).toBe(3);
  });

  it('não guarda nenhuma chave em claro no banco', async () => {
    const r = await registrar(app);
    const linha = JSON.stringify(await prisma.conta.findUniqueOrThrow({ where: { id: r.contaId } }));
    for (const segredo of [r.chaveAdmin, r.chaveGestor, r.chaveAtendimento]) {
      expect(linha).not.toContain(segredo);
      expect(linha).not.toContain(segredo.slice(4));
    }
  });

  it('guarda a instância da Kentro que criou a conta', async () => {
    const r = await registrar(app, {}, '  Cliente.AtenderBem.com ');
    const linha = await prisma.conta.findUniqueOrThrow({ where: { id: r.contaId } });
    expect(linha.instanciaKentro).toBe('cliente.atenderbem.com');
  });

  it('identifica o papel pela chave usada', async () => {
    const r = await registrar(app);
    const comAdmin = await conta(app, r.chaveAdmin);
    expect(comAdmin.status).toBe(200);
    expect(comAdmin.body).toEqual({
      id: r.contaId,
      nome: 'Empresa Teste',
      status: 'pendente_conexao',
      plano: 'gratis',
      fuso: 'America/Sao_Paulo',
      moeda: 'BRL',
      papel: 'admin',
      loginMetaDisponivel: false,
    });
    expect((await conta(app, r.chaveGestor)).body.papel).toBe('gestor');
    expect((await conta(app, r.chaveAtendimento)).body.papel).toBe('atendimento');
  });

  it('aceita a chave colada com espaços e tab nas pontas', async () => {
    const r = await registrar(app);
    expect((await conta(app, `  ${r.chaveAtendimento}\t`)).status).toBe(200);
  });

  it('recusa sem chave ou com chave desconhecida', async () => {
    const sem = await conta(app);
    expect(sem.status).toBe(401);
    expect(sem.body.erro.codigo).toBe('CHAVE_INVALIDA');
    const desconhecida = await conta(app, 'kta_inexistente');
    expect(desconhecida.status).toBe(401);
    expect(desconhecida.body.erro.codigo).toBe('CHAVE_INVALIDA');
  });

  it.each(['chaveGestor', 'chaveAtendimento'] as const)('%s não rotaciona chaves (só a de admin)', async (campo) => {
    const r = await registrar(app);
    const res = await rotacionar(app, 'admin', r[campo]);
    expect(res.status).toBe(403);
    expect(res.body.erro.codigo).toBe('PERMISSAO_NEGADA');
  });

  it.each([
    ['admin', 'chaveAdmin', /^kta_/],
    ['gestor', 'chaveGestor', /^ktg_/],
    ['atendimento', 'chaveAtendimento', /^ktk_/],
  ] as const)('rotacionar a chave de %s invalida a antiga na hora e mantém as outras', async (tipo, campo, prefixo) => {
    const r = await registrar(app);
    const res = await rotacionar(app, tipo, r.chaveAdmin);
    expect(res.status).toBe(200);
    expect(res.body.chave).toMatch(prefixo);
    expect((await conta(app, r[campo])).status).toBe(401);
    expect((await conta(app, res.body.chave)).body.papel).toBe(tipo);
    const outras = (['chaveAdmin', 'chaveGestor', 'chaveAtendimento'] as const).filter((c) => c !== campo);
    for (const outra of outras) expect((await conta(app, r[outra])).status).toBe(200);
  });

  it('tipo de chave desconhecido dá 404', async () => {
    const r = await registrar(app);
    const res = await rotacionar(app, 'mcp', r.chaveAdmin);
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });

  it('cada chave enxerga só a própria conta', async () => {
    const a = await registrar(app, { nome: 'Empresa A' });
    const b = await registrar(app, { nome: 'Empresa B' });
    expect((await conta(app, a.chaveAtendimento)).body.id).toBe(a.contaId);
    expect((await conta(app, b.chaveGestor)).body.id).toBe(b.contaId);
  });

  it('conta bloqueada não é atendida', async () => {
    const r = await registrar(app);
    await prisma.conta.update({ where: { id: r.contaId }, data: { status: 'bloqueada' } });
    const res = await conta(app, r.chaveAtendimento);
    expect(res.status).toBe(403);
    expect(res.body.erro.codigo).toBe('CONTA_BLOQUEADA');
  });

  it('nome é opcional', async () => {
    const r = await registrar(app, {});
    expect((await conta(app, r.chaveAdmin)).body.nome).toBeNull();
  });

  it('recusa campo desconhecido no registro', async () => {
    const res = await request(app.getHttpServer()).post('/v1/contas/registrar').set('X-Forwarded-For', '10.1.0.1').send({ nome: 'x', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('ENTRADA_INVALIDA');
  });

  it('recusa JSON malformado sem erro interno', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/contas/registrar')
      .set('X-Forwarded-For', '10.1.0.2')
      .set('Content-Type', 'application/json')
      .send('{nome:');
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('ENTRADA_INVALIDA');
  });
});

describe('limite de registros', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  afterAll(() => app.close());

  it('o sexto registro do mesmo IP na mesma hora é recusado', async () => {
    const enviar = () => request(app.getHttpServer()).post('/v1/contas/registrar').set('X-Forwarded-For', '10.9.9.9').send({});
    for (let i = 0; i < 5; i++) expect((await enviar()).status).toBe(201);
    const sexto = await enviar();
    expect(sexto.status).toBe(429);
    expect(sexto.body.erro.codigo).toBe('LIMITE_DE_REQUISICOES');
  });

  // Todas as chamadas das extensões saem do mesmo IP (o backend da Kentro): o limite
  // precisa ser por instância, senão uma instância esgota o cadastro de todas as outras.
  it('instâncias da Kentro que saem do mesmo IP têm limites separados', async () => {
    const enviar = (instancia: string) =>
      request(app.getHttpServer()).post('/v1/contas/registrar').set('X-Forwarded-For', '10.8.8.8').set('X-Kentro-Instancia', instancia).send({});
    for (let i = 0; i < 5; i++) expect((await enviar('a.kentro.test')).status).toBe(201);
    expect((await enviar('a.kentro.test')).status).toBe(429);
    expect((await enviar('b.kentro.test')).status).toBe(201);
  });
});
