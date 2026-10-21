import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from '../app';
import { limparBanco } from '../limpar';
import { comChave, registrarConta, Registro } from './apoio';
import { comUsuarioDoSistema, erroMeta, metaFalso, TOKEN_FALSO } from './meta-falso';

const prisma = new PrismaClient();
const meta = metaFalso();

describe('conexão com o Meta por token de usuário do sistema', () => {
  let app: INestApplication;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const conectar = (token = TOKEN_FALSO, chave = r.chaveAdmin) => comChave(http().put('/v1/meta/token-manual'), chave).send({ token });

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { fetch: meta.fetch });
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

  it('confere o token no Meta, guarda cifrado e lista as contas de anúncio', async () => {
    comUsuarioDoSistema(meta);
    const res = await conectar(`  ${TOKEN_FALSO}  `);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conectado: true,
      tipo: 'token_manual',
      status: 'ativa',
      usuarioMeta: 'Kentro Track (sistema)',
      escopos: ['ads_read'],
      avisos: [],
    });
    expect(res.body.contasAnuncio.map((c: { idMeta: string }) => c.idMeta)).toEqual(['act_222', 'act_111']);
    expect(res.body.contasAnuncio.find((c: { idMeta: string }) => c.idMeta === 'act_111')).toMatchObject({
      nome: 'Loja Principal',
      empresa: 'Grupo PK',
      ativaNoMeta: true,
      selecionada: false,
      definicaoLead: ['formulario', 'conversa'],
    });
    // O token foi aparado antes de ir ao Meta, e nunca fica em claro no banco.
    expect(meta.chamadas.every((c) => c.autorizacao === `Bearer ${TOKEN_FALSO}`)).toBe(true);
    const linha = await prisma.conexaoMeta.findUniqueOrThrow({ where: { contaId: r.contaId } });
    expect(Buffer.from(linha.tokenCifrado).toString('utf8')).not.toContain(TOKEN_FALSO.slice(4, 30));
    expect((await prisma.conta.findUniqueOrThrow({ where: { id: r.contaId } })).status).toBe('ativa');
  });

  it('avisa quando falta ads_read', async () => {
    comUsuarioDoSistema(meta);
    meta.get('me/permissions', { corpo: { data: [{ permission: 'leads_retrieval', status: 'granted' }] } });
    const res = await conectar();
    expect(res.body.avisos).toEqual(['O token não tem a permissão ads_read: os números das campanhas não vão chegar.']);
  });

  it('segue sem a lista de permissões quando o Meta não a entrega', async () => {
    comUsuarioDoSistema(meta);
    meta.get('me/permissions', erroMeta(100, 'não suportado'));
    const res = await conectar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ escopos: [], avisos: [] });
  });

  it('token recusado pelo Meta dá mensagem clara e não grava nada', async () => {
    meta.get('me', erroMeta(190, 'Error validating access token'));
    const res = await conectar();
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('TOKEN_META_INVALIDO');
    expect(await prisma.conexaoMeta.count()).toBe(0);
  });

  it('token sem nenhuma conta de anúncio ensina a atribuir os ativos', async () => {
    comUsuarioDoSistema(meta);
    meta.get('me/adaccounts', { corpo: { data: [] } });
    const res = await conectar();
    expect(res.status).toBe(400);
    expect(res.body.erro).toMatchObject({ codigo: 'SEM_CONTAS_DE_ANUNCIO', mensagem: expect.stringContaining('Atribuir ativos') });
  });

  it('se o token não lê o nome da empresa, lista as contas sem ele', async () => {
    comUsuarioDoSistema(meta);
    meta.get('me/adaccounts', (req) =>
      req.params.get('fields')!.includes('business')
        ? erroMeta(100, '(#100) Tried accessing nonexisting field (business)')
        : { corpo: { data: [{ id: 'act_111', name: 'Loja Principal', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 1 }] } },
    );
    const res = await conectar();
    expect(res.status).toBe(200);
    expect(res.body.contasAnuncio).toEqual([expect.objectContaining({ idMeta: 'act_111', empresa: null })]);
  });

  it('recusa do Meta que não é do token vira 400 com a mensagem dele', async () => {
    meta.get('me', erroMeta(100, 'Unsupported get request'));
    const res = await conectar();
    expect(res.status).toBe(400);
    expect(res.body.erro).toEqual({ codigo: 'RECUSADO_PELO_META', mensagem: 'O Meta recusou a consulta: Unsupported get request' });
  });

  it('Meta fora do ar vira 502', async () => {
    meta.get('me', erroMeta(2, 'Service temporarily unavailable', 503));
    const res = await conectar();
    expect(res.status).toBe(502);
  });

  it('recusa token curto e campo extra', async () => {
    expect((await conectar('curto')).status).toBe(400);
    expect((await comChave(http().put('/v1/meta/token-manual'), r.chaveAdmin).send({ token: TOKEN_FALSO, x: 1 })).status).toBe(400);
  });

  it.each(['chaveGestor', 'chaveAtendimento'] as const)('%s não mexe na conexão', async (campo) => {
    expect((await conectar(TOKEN_FALSO, r[campo])).status).toBe(403);
    expect((await comChave(http().get('/v1/meta/conexao'), r[campo])).status).toBe(403);
  });

  it('seleciona contas, troca a definição de lead e agenda a carga', async () => {
    comUsuarioDoSistema(meta);
    const conectado = await conectar();
    const principal = conectado.body.contasAnuncio.find((c: { idMeta: string }) => c.idMeta === 'act_111');
    const res = await comChave(http().put('/v1/meta/contas-anuncio'), r.chaveAdmin).send({
      contas: [{ id: principal.id, selecionada: true, definicaoLead: ['conversa', 'site'] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.contasAnuncio[0]).toMatchObject({ idMeta: 'act_111', selecionada: true, definicaoLead: ['conversa', 'site'] });
    const linha = await prisma.contaAnuncio.findUniqueOrThrow({ where: { id: principal.id } });
    expect(linha.proximaHorariaEm).not.toBeNull();
  });

  it('recusa definição de lead desconhecida e conta de anúncio de outra conta', async () => {
    comUsuarioDoSistema(meta);
    const conectado = await conectar();
    const id = conectado.body.contasAnuncio[0].id;
    const ruim = await comChave(http().put('/v1/meta/contas-anuncio'), r.chaveAdmin).send({ contas: [{ id, selecionada: true, definicaoLead: ['vendas'] }] });
    expect(ruim.status).toBe(400);

    const outra = await registrarConta(app, 'Outra');
    const alheia = await comChave(http().put('/v1/meta/contas-anuncio'), outra.chaveAdmin).send({ contas: [{ id, selecionada: true }] });
    expect(alheia.status).toBe(404);
  });

  it('desconectar apaga o token, tira a seleção e volta a conta para pendente', async () => {
    comUsuarioDoSistema(meta);
    const conectado = await conectar();
    await comChave(http().put('/v1/meta/contas-anuncio'), r.chaveAdmin).send({ contas: [{ id: conectado.body.contasAnuncio[0].id, selecionada: true }] });
    const res = await comChave(http().delete('/v1/meta/conexao'), r.chaveAdmin);
    expect(res.body).toMatchObject({ conectado: false });
    expect(await prisma.conexaoMeta.count()).toBe(0);
    expect(await prisma.contaAnuncio.count({ where: { selecionada: true } })).toBe(0);
    expect((await prisma.conta.findUniqueOrThrow({ where: { id: r.contaId } })).status).toBe('pendente_conexao');
  });

  it('sem conexão, o estado diz que não está conectado', async () => {
    const res = await comChave(http().get('/v1/meta/conexao'), r.chaveAdmin);
    expect(res.body).toEqual({ conectado: false, loginMetaDisponivel: false, contasAnuncio: [] });
  });
});
