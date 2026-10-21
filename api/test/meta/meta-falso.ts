import type { Fetch } from '../../src/comum/fetch';

export interface Requisicao {
  metodo: string;
  caminho: string;
  params: URLSearchParams;
  autorizacao: string | null;
  url: string;
}

export interface RespostaFalsa {
  status?: number;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
  /** Para imagens (miniaturas). */
  bytes?: Buffer;
}

type Rota = { metodo: string; caminho: RegExp; responder: (r: Requisicao) => RespostaFalsa };

/** Graph API em memória: rotas por método + caminho (sem a versão), com registro de cada chamada. */
export function metaFalso() {
  const rotas: Rota[] = [];
  const chamadas: Requisicao[] = [];

  const fetch: Fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada));
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const caminho = url.hostname === 'graph.facebook.com' ? url.pathname.replace(/^\/v\d+\.\d+\//, '') : url.href;
    const cabecalhos = new Headers(init?.headers);
    const req: Requisicao = { metodo, caminho, params: url.searchParams, autorizacao: cabecalhos.get('authorization'), url: url.href };
    chamadas.push(req);
    const rota = [...rotas].reverse().find((r) => r.metodo === metodo && r.caminho.test(caminho));
    if (!rota) return new Response(JSON.stringify({ error: { message: `rota falsa ausente: ${metodo} ${caminho}`, code: 100 } }), { status: 400 });
    const r = rota.responder(req);
    if (r.bytes) return new Response(new Uint8Array(r.bytes), { status: r.status ?? 200, headers: r.cabecalhos });
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.cabecalhos } });
  }) as Fetch;

  const no = (metodo: string, caminho: string | RegExp, responder: RespostaFalsa | ((r: Requisicao) => RespostaFalsa)) => {
    const re = typeof caminho === 'string' ? new RegExp(`^${caminho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : caminho;
    rotas.push({ metodo, caminho: re, responder: typeof responder === 'function' ? responder : () => responder });
  };

  return {
    fetch,
    chamadas,
    get: (caminho: string | RegExp, r: RespostaFalsa | ((req: Requisicao) => RespostaFalsa)) => no('GET', caminho, r),
    post: (caminho: string | RegExp, r: RespostaFalsa | ((req: Requisicao) => RespostaFalsa)) => no('POST', caminho, r),
    limpar: () => {
      rotas.length = 0;
      chamadas.length = 0;
    },
  };
}

export const erroMeta = (code: number, message = 'erro', status = 400): RespostaFalsa => ({
  status,
  corpo: { error: { message, type: 'OAuthException', code, fbtrace_id: 'TRACE' } },
});

/** Um usuário do sistema com duas contas de anúncio. */
export function comUsuarioDoSistema(meta: ReturnType<typeof metaFalso>) {
  meta.get('me', { corpo: { id: '9001', name: 'Kentro Track (sistema)' } });
  meta.get('me/permissions', { corpo: { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'leads_retrieval', status: 'declined' }] } });
  meta.get('me/adaccounts', {
    corpo: {
      data: [
        { id: 'act_111', name: 'Loja Principal', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 1, business: { name: 'Grupo PK' } },
        { id: 'act_222', name: 'Conta Antiga', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 2 },
      ],
    },
  });
}

export const TOKEN_FALSO = 'EAAG' + 'x'.repeat(60);
