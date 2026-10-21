import { createHmac } from 'node:crypto';
import { ClienteGraph, lerUso, RegistroChamada } from '../../src/meta/cliente/graph';
import { LimiteMeta, MetaIndisponivel, PermissaoFaltando, RecusadoPeloMeta, TokenInvalido } from '../../src/meta/cliente/erros';
import { erroMeta, metaFalso } from './meta-falso';

const MANUAL = { valor: 'tok-manual', doNossoApp: false };
const DO_APP = { valor: 'tok-app', doNossoApp: true };
const ctx = { contaId: 'c1', operacao: 'teste' };

function cliente(meta = metaFalso(), appSecret: string | null = 'segredo-app') {
  const esperas: number[] = [];
  const registros: RegistroChamada[] = [];
  const graph = new ClienteGraph({
    versao: 'v24.0',
    fetch: meta.fetch,
    appSecret,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    registrar: (r) => registros.push(r),
  });
  return { graph, meta, esperas, registros };
}

describe('ClienteGraph', () => {
  it('manda o token no cabeçalho, nunca na URL, e usa a versão configurada', async () => {
    const { graph, meta } = cliente();
    meta.get('me', { corpo: { id: '1' } });
    await graph.get(MANUAL, 'me', { fields: 'id' }, ctx);
    expect(meta.chamadas[0].autorizacao).toBe('Bearer tok-manual');
    expect(meta.chamadas[0].url).toBe('https://graph.facebook.com/v24.0/me?fields=id');
    expect(meta.chamadas[0].url).not.toContain('tok-manual');
  });

  it('assina com appsecret_proof só os tokens do nosso app', async () => {
    const { graph, meta } = cliente();
    meta.get('me', { corpo: { id: '1' } });
    await graph.get(DO_APP, 'me', {}, ctx);
    await graph.get(MANUAL, 'me', {}, ctx);
    expect(meta.chamadas[0].params.get('appsecret_proof')).toBe(createHmac('sha256', 'segredo-app').update('tok-app').digest('hex'));
    expect(meta.chamadas[1].params.has('appsecret_proof')).toBe(false);
  });

  it.each([
    [190, TokenInvalido],
    [102, TokenInvalido],
    [10, PermissaoFaltando],
    [200, PermissaoFaltando],
    [272, PermissaoFaltando],
    [100, RecusadoPeloMeta],
  ])('código %i vira %p sem nova tentativa', async (codigo, Tipo) => {
    const { graph, meta } = cliente();
    meta.get('me', erroMeta(codigo, 'mensagem do meta'));
    await expect(graph.get(MANUAL, 'me', {}, ctx)).rejects.toBeInstanceOf(Tipo);
    expect(meta.chamadas).toHaveLength(1);
  });

  it('tenta de novo em erro 5xx e desiste na terceira', async () => {
    const { graph, meta, esperas } = cliente();
    meta.get('me', erroMeta(2, 'instável', 500));
    await expect(graph.get(MANUAL, 'me', {}, ctx)).rejects.toBeInstanceOf(MetaIndisponivel);
    expect(meta.chamadas).toHaveLength(3);
    expect(esperas).toEqual([500, 1000]);
  });

  it('recupera quando o Meta volta na segunda tentativa', async () => {
    const { graph, meta } = cliente();
    let n = 0;
    meta.get('me', () => (++n === 1 ? erroMeta(1, 'temporário', 500) : { corpo: { id: '1' } }));
    await expect(graph.get(MANUAL, 'me', {}, ctx)).resolves.toEqual({ id: '1' });
  });

  it('limite curto: espera o tempo que o Meta pede e tenta de novo; limite longo: desiste com o tempo', async () => {
    const curto = cliente();
    let n = 0;
    curto.meta.get('x', () =>
      ++n === 1
        ? { ...erroMeta(17, 'limite'), cabecalhos: { 'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: 100, reset_time_duration: 20 }) } }
        : { corpo: { ok: true } },
    );
    await expect(curto.graph.get(MANUAL, 'x', {}, ctx)).resolves.toEqual({ ok: true });
    expect(curto.esperas).toEqual([20_000]);
    expect(curto.meta.chamadas).toHaveLength(2);

    const longo = cliente();
    longo.meta.get('x', {
      ...erroMeta(80004, 'limite de insights'),
      cabecalhos: { 'x-business-use-case-usage': JSON.stringify({ '1': [{ type: 'ads_insights', call_count: 100, estimated_time_to_regain_access: 30 }] }) },
    });
    const erro = (await longo.graph.get(MANUAL, "x", {}, ctx).catch((e) => e)) as LimiteMeta;
    expect(erro).toBeInstanceOf(LimiteMeta);
    expect(erro.esperarSegundos).toBe(1800);
    expect(longo.meta.chamadas).toHaveLength(1);
  });

  it('limite sem tempo nos cabeçalhos: 1 minuto, sem esperar dentro da chamada', async () => {
    const { graph, meta, esperas } = cliente();
    meta.get('x', erroMeta(4, 'limite do app'));
    const erro = (await graph.get(MANUAL, "x", {}, ctx).catch((e) => e)) as LimiteMeta;
    expect(erro).toBeInstanceOf(LimiteMeta);
    expect(erro.esperarSegundos).toBe(60);
    expect(esperas).toEqual([]);
  });

  it('pagina pelo cursor até o fim e respeita o teto de páginas', async () => {
    const { graph, meta } = cliente();
    meta.get('act_1/campaigns', (r) => {
      const after = r.params.get('after');
      if (!after) return { corpo: { data: [{ id: 'a' }, { id: 'b' }], paging: { cursors: { after: 'C1' }, next: 'https://graph.facebook.com/...' } } };
      if (after === 'C1') return { corpo: { data: [{ id: 'c' }], paging: { cursors: { after: 'C2' } } } };
      return { corpo: { data: [{ id: 'nunca' }] } };
    });
    expect((await graph.listar<{ id: string }>(MANUAL, 'act_1/campaigns', { limit: 2 }, ctx)).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(await graph.listar(MANUAL, 'act_1/campaigns', {}, ctx, 1)).toHaveLength(2);
  });

  it('registra cada chamada sem URL nem token', async () => {
    const { graph, meta, registros } = cliente();
    meta.get('me', erroMeta(190));
    await graph.get(MANUAL, 'me', {}, ctx).catch(() => {});
    expect(registros).toEqual([{ contaId: 'c1', operacao: 'teste', statusHttp: 400, ms: expect.any(Number), erroCodigo: 'TOKEN_INVALIDO', uso: null }]);
    expect(JSON.stringify(registros)).not.toContain('tok-manual');
  });
});

describe('lerUso', () => {
  it('pega o pior percentual entre os cabeçalhos e o tempo para liberar em segundos', () => {
    const h = new Headers({
      'x-business-use-case-usage': JSON.stringify({ '9': [{ call_count: 40, total_cputime: 80, total_time: 10, estimated_time_to_regain_access: 2 }] }),
      'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: 55, reset_time_duration: 30 }),
      'x-app-usage': JSON.stringify({ call_count: 12 }),
    });
    expect(lerUso(h)).toEqual({ pct: 80, liberaEmSegundos: 120 });
  });

  it('sem cabeçalhos devolve null', () => {
    expect(lerUso(new Headers())).toBeNull();
  });
});
