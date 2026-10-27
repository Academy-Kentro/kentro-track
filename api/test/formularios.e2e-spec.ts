import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { FormulariosService } from '../src/formularios/formularios.service';
import { lerLead, montarPayloadKentro, rotulosDasPerguntas } from '../src/formularios/leitura';
import { criarAppDeTeste } from './app';
import { limparBanco } from './limpar';
import { comChave, registrarConta, Registro } from './meta/apoio';
import { comUsuarioDoSistema, erroMeta, metaFalso, TOKEN_FALSO } from './meta/meta-falso';

const prisma = new PrismaClient();
const CAPTURA = 'https://kentro.atenderbem.com/webhookcapture/capture/abc123';

describe('leitura do lead do formulário', () => {
  const perguntas = rotulosDasPerguntas([
    { key: 'full_name', type: 'FULL_NAME' },
    { key: 'phone_number', type: 'PHONE' },
    { key: 'email', type: 'EMAIL' },
    { key: 'qual_o_melhor_horário?', label: 'Qual o melhor horário?', type: 'CUSTOM' },
    { key: 'city', type: 'CITY' },
  ]);

  it('nome, telefone e e-mail viram o contato; o resto vira resposta com o texto da pergunta', () => {
    const lead = lerLead(
      {
        id: 'L1',
        created_time: '2026-10-27T13:05:00+0000',
        ad_id: 'ad1',
        adset_id: 'adset1',
        campaign_id: 'camp1',
        field_data: [
          { name: 'full_name', values: ['Maria Souza'] },
          { name: 'phone_number', values: ['+5538999990000'] },
          { name: 'email', values: ['maria@exemplo.com'] },
          { name: 'qual_o_melhor_horário?', values: ['Manhã'] },
          { name: 'city', values: ['Montes Claros'] },
          { name: 'vazio', values: [''] },
        ],
      },
      { idMeta: 'F1', nome: 'Cadastro', perguntas },
    );
    expect(lead).toEqual({
      leadgenId: 'L1',
      formularioIdMeta: 'F1',
      formularioNome: 'Cadastro',
      criadoEm: new Date('2026-10-27T13:05:00Z'),
      nome: 'Maria Souza',
      telefone: '+5538999990000',
      email: 'maria@exemplo.com',
      respostas: [
        { chave: 'qual_o_melhor_horário?', pergunta: 'Qual o melhor horário?', resposta: 'Manhã' },
        { chave: 'city', pergunta: 'Cidade', resposta: 'Montes Claros' },
      ],
      anuncioIdMeta: 'ad1',
      conjuntoIdMeta: 'adset1',
      campanhaIdMeta: 'camp1',
    });
  });

  it('o envio à Kentro é plano (cada campo vira capture_<campo>) e as respostas vão em texto e uma a uma', () => {
    const payload = montarPayloadKentro({
      leadId: 'id',
      leadgenId: 'L1',
      nome: 'Maria',
      telefone: '5538999990000',
      email: null,
      formulario: 'Cadastro',
      formularioId: 'F1',
      pagina: 'Loja',
      campanha: 'Black Friday',
      conjunto: null,
      anuncio: null,
      recebidoEm: new Date('2026-10-27T13:05:00Z'),
      fuso: 'America/Sao_Paulo',
      respostas: [{ chave: 'qual_o_melhor_horário?', pergunta: 'Qual o melhor horário?', resposta: 'Manhã' }],
    });
    expect(payload).toMatchObject({
      evento: 'lead_formulario',
      titulo: 'Maria — Cadastro',
      email: '',
      conjunto: '',
      recebido_em: '27/10/2026, 10:05',
      respostas_texto: 'Qual o melhor horário?: Manhã',
      resposta_qual_o_melhor_horario: 'Manhã',
    });
    expect(Object.values(payload).every((v) => typeof v === 'string')).toBe(true);
  });
});

describe('formulários do Meta → CRM da Kentro', () => {
  const meta = metaFalso();
  let app: INestApplication;
  let formularios: FormulariosService;
  let r: Registro;
  const http = () => request(app.getHttpServer());
  const admin = (req: request.Test) => comChave(req, r.chaveAdmin);
  const capturas: Record<string, string>[] = [];

  const fetchComCorpo: typeof fetch = async (url, init) => {
    if (String(url) === CAPTURA && init?.body) capturas.push(JSON.parse(String(init.body)));
    return meta.fetch(url, init);
  };

  const leadDoMeta = (id: string, telefone: string, criado = new Date().toISOString()) => ({
    id,
    created_time: criado,
    ad_id: 'ad9',
    campaign_id: 'camp9',
    field_data: [
      { name: 'full_name', values: [`Pessoa ${id}`] },
      { name: 'phone_number', values: [telefone] },
      { name: 'qual_servico', values: ['Instalação'] },
    ],
  });

  beforeAll(async () => {
    app = await criarAppDeTeste({}, { fetch: fetchComCorpo });
    formularios = app.get(FormulariosService);
  });
  beforeEach(async () => {
    await limparBanco(prisma);
    meta.limpar();
    capturas.length = 0;
    r = await registrarConta(app);
    comUsuarioDoSistema(meta);
    await admin(http().put('/v1/meta/token-manual')).send({ token: TOKEN_FALSO });
    meta.get('me/accounts', {
      corpo: {
        data: [
          { id: 'pag1', name: 'Loja Montes Claros', access_token: 'TOKEN-PAGINA' },
          { id: 'pag2', name: 'Página sem acesso' },
        ],
      },
    });
    meta.get('pag1/leadgen_forms', {
      corpo: {
        data: [
          { id: 'form1', name: 'Orçamento', status: 'ACTIVE', questions: [{ key: 'full_name' }, { key: 'qual_servico', label: 'Qual serviço?' }] },
          { id: 'form2', name: 'Antigo', status: 'ARCHIVED', questions: [] },
        ],
      },
    });
    meta.post(CAPTURA, { corpo: { ok: true } });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function buscarESelecionar() {
    const busca = await admin(http().post('/v1/formularios/buscar'));
    expect(busca.status).toBe(200);
    const form1 = busca.body.formularios.find((f: { idMeta: string }) => f.idMeta === 'form1');
    const salvo = await admin(http().put('/v1/formularios')).send({ formularios: [{ id: form1.id, selecionado: true }], capturaKentroUrl: CAPTURA });
    expect(salvo.status).toBe(200);
    return { busca: busca.body, form1 };
  }

  it('só o admin; busca as páginas e os formulários com o token da página e avisa o que falta', async () => {
    expect((await comChave(http().get('/v1/formularios'), r.chaveGestor)).status).toBe(403);
    const { busca } = await buscarESelecionar();
    expect(busca.formularios.map((f: { nome: string; pagina: string; perguntas: string[] }) => [f.nome, f.pagina, f.perguntas])).toEqual([
      ['Antigo', 'Loja Montes Claros', []],
      ['Orçamento', 'Loja Montes Claros', ['Nome completo', 'Qual serviço?']],
    ]);
    expect(busca.avisos).toEqual([expect.stringContaining('Página sem acesso')]);
    // O usuário do sistema de teste recusou leads_retrieval.
    expect(busca.permissoesFaltando).toContain('leads_retrieval');
    expect(meta.chamadas.find((c) => c.caminho === 'pag1/leadgen_forms')?.autorizacao).toBe('Bearer TOKEN-PAGINA');
    expect(JSON.stringify(busca)).not.toContain('TOKEN-PAGINA');

    const lista = (await admin(http().get('/v1/formularios'))).body;
    expect(lista.capturaKentroUrl).toBe(CAPTURA);
    expect(lista.formularios[0]).toMatchObject({ nome: 'Orçamento', selecionado: true });
  });

  it('permissão recusada pelo Meta: o aviso traz a mensagem dele (diz o que falta)', async () => {
    meta.get('pag1/leadgen_forms', erroMeta(200, '(#200) Requires pages_manage_ads permission to manage the object'));
    const busca = await admin(http().post('/v1/formularios/buscar'));
    expect(busca.body.avisos).toContainEqual(expect.stringContaining('Requires pages_manage_ads permission'));
    expect(busca.body.avisos).toContainEqual(expect.stringContaining('ads_management'));
    expect(busca.body.formularios).toEqual([]);
  });

  it('recusa endereço que não é de captura da Kentro', async () => {
    const res = await admin(http().put('/v1/formularios')).send({ capturaKentroUrl: 'http://169.254.169.254/latest' });
    expect(res.body.erro.codigo).toBe('CAPTURA_INVALIDA');
    expect((await admin(http().put('/v1/formularios')).send({ capturaKentroUrl: null })).body.capturaKentroUrl).toBeNull();
  });

  it('lê os leads novos do formulário selecionado, grava uma vez só e manda cada um para a Kentro', async () => {
    await buscarESelecionar();
    meta.get('form1/leads', { corpo: { data: [leadDoMeta('L1', '38999990000'), leadDoMeta('L2', '38988880000')] } });

    expect(await formularios.lerPendentes()).toBe(1);
    const chamada = meta.chamadas.find((c) => c.caminho === 'form1/leads')!;
    expect(chamada.autorizacao).toBe('Bearer TOKEN-PAGINA');
    expect(JSON.parse(chamada.params.get('filtering')!)[0]).toMatchObject({ field: 'time_created', operator: 'GREATER_THAN' });

    const leads = await prisma.lead.findMany({ orderBy: { leadgenId: 'asc' } });
    expect(leads.map((l) => [l.origem, l.nome, l.telefone, l.kentroStatus])).toEqual([
      ['formulario', 'Pessoa L1', '5538999990000', 'pendente'],
      ['formulario', 'Pessoa L2', '5538988880000', 'pendente'],
    ]);
    expect(leads[0].respostas).toEqual([{ chave: 'qual_servico', pergunta: 'Qual serviço?', resposta: 'Instalação' }]);

    // A próxima leitura repete um trecho: nada é gravado de novo.
    await formularios.lerPendentes(new Date(Date.now() + 3 * 60_000));
    expect(await prisma.lead.count()).toBe(2);

    expect(await formularios.enviarPendentes()).toBe(2);
    expect(capturas).toHaveLength(2);
    expect(capturas.find((c) => c.leadgen_id === 'L1')).toMatchObject({
      evento: 'lead_formulario',
      titulo: 'Pessoa L1 — Orçamento',
      nome: 'Pessoa L1',
      telefone: '5538999990000',
      formulario: 'Orçamento',
      pagina: 'Loja Montes Claros',
      respostas_texto: 'Qual serviço?: Instalação',
      resposta_qual_servico: 'Instalação',
    });
    const lista = (await admin(http().get('/v1/formularios'))).body;
    expect(lista.formularios.find((f: { nome: string }) => f.nome === 'Orçamento').leads30Dias).toBe(2);
    expect(lista.envios.map((e: { status: string; telefone: string }) => [e.status, e.telefone])).toEqual([
      ['enviado', '(38) 9****-0000'],
      ['enviado', '(38) 9****-0000'],
    ]);
  });

  it('Kentro fora do ar: tenta de novo com espera e, passadas as tentativas, fica com erro para reenviar', async () => {
    await buscarESelecionar();
    meta.get('form1/leads', { corpo: { data: [leadDoMeta('L1', '38999990000')] } });
    await formularios.lerPendentes();
    meta.post(CAPTURA, { status: 503, corpo: {} });

    let agora = Date.now();
    for (let i = 0; i < 6; i++) {
      expect(await formularios.enviarPendentes(new Date(agora))).toBe(1);
      agora += 13 * 3_600_000;
    }
    const lead = await prisma.lead.findFirstOrThrow();
    expect(lead).toMatchObject({ kentroStatus: 'erro', kentroTentativas: 6, kentroErro: 'A Kentro respondeu 503.' });

    meta.post(CAPTURA, { corpo: {} });
    await admin(http().post(`/v1/formularios/envios/${lead.id}/reenviar`));
    expect(await formularios.enviarPendentes()).toBe(1);
    expect((await prisma.lead.findFirstOrThrow()).kentroStatus).toBe('enviado');
  });

  it('sem endereço da captura, o lead entra nos painéis mas não vai para a Kentro', async () => {
    await buscarESelecionar();
    await admin(http().put('/v1/formularios')).send({ capturaKentroUrl: null });
    meta.get('form1/leads', { corpo: { data: [leadDoMeta('L1', '38999990000')] } });
    await formularios.lerPendentes();
    expect((await prisma.lead.findFirstOrThrow()).kentroStatus).toBeNull();
  });

  it('conversa aberta antes da leitura vira o lead do formulário; conversa depois liga ao formulário', async () => {
    await buscarESelecionar();
    const conversa = await comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).send({ chatId: '901', telefone: '5538999990000' });
    expect(conversa.body.origem).toBe('organico');
    meta.get('form1/leads', { corpo: { data: [leadDoMeta('L1', '38999990000'), leadDoMeta('L2', '38977770000')] } });
    await formularios.lerPendentes();

    const doChat = await comChave(http().get('/v1/atendimento/chat/901'), r.chaveAtendimento);
    expect(doChat.body).toMatchObject({ id: conversa.body.id, origem: 'formulario', respostas: [expect.objectContaining({ pergunta: 'Qual serviço?' })] });

    const depois = await comChave(http().post('/v1/atendimento/vincular'), r.chaveAtendimento).send({ chatId: '902', telefone: '38977770000' });
    expect(depois.body).toMatchObject({ origem: 'formulario', nome: 'Pessoa L2' });
    expect(await prisma.lead.count()).toBe(2);
  });

  it('erro do Meta fica no formulário e a leitura volta mais tarde', async () => {
    await buscarESelecionar();
    meta.get('form1/leads', erroMeta(200, 'Requires leads_retrieval permission'));
    await formularios.lerPendentes();
    const f = await prisma.formularioMeta.findFirstOrThrow({ where: { idMeta: 'form1' } });
    expect(f.ultimoErro).toContain('leads_retrieval');
    expect(f.proximaLeituraEm!.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it('envio de teste vai direto para a captura', async () => {
    const res = await admin(http().post('/v1/formularios/testar-envio')).send({ url: CAPTURA });
    expect(res.status).toBe(200);
    expect(capturas[0]).toMatchObject({ evento: 'teste', nome: 'Lead de teste (Kentro Track)', resposta_qual_o_melhor_horario: 'Manhã' });
    meta.post(CAPTURA, { status: 404, corpo: {} });
    expect((await admin(http().post('/v1/formularios/testar-envio')).send({ url: CAPTURA })).body.erro.codigo).toBe('KENTRO_RECUSOU');
  });
});
