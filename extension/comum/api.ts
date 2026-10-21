import type { CtxOmni, Omni } from './omni';

export interface ErroTrack {
  status: number;
  codigo: string;
  mensagem: string;
}

export interface ConfigCliente {
  omni: Omni;
  apiUrl: string;
  /** Vazio só no registro da conta. */
  chave: string;
  ctx: CtxOmni;
}

export type Api = <T>(caminho: string, opcoes?: { method?: string; body?: unknown }) => Promise<T>;

/** Valores da instalação: a URL sem barra final e a chave sem espaços (colada à mão). */
export function lerConfigInstalacao(ctx: CtxOmni, campoChave: string): { apiUrl: string; chave: string } {
  const config = ctx.config ?? {};
  return {
    apiUrl: String(config.api_url ?? '').trim().replace(/\/+$/, ''),
    chave: String(config[campoChave] ?? '').replace(/\s+/g, ''),
  };
}

function erroDe(status: number | undefined, texto: string | undefined): ErroTrack {
  const erro: ErroTrack = { status: status ?? 0, codigo: '', mensagem: '' };
  try {
    const corpo = JSON.parse(texto ?? '');
    if (corpo?.erro) {
      erro.codigo = String(corpo.erro.codigo ?? '');
      erro.mensagem = String(corpo.erro.mensagem ?? '');
    }
  } catch {
    // corpo sem o formato padrão
  }
  return erro;
}

/**
 * Chamada à API do Kentro Track pelo servidor da Kentro (omni.http.request, sem CORS; 30 por minuto).
 * O proxy da Kentro devolve um erro da API de quatro jeitos: resolvido com status de erro,
 * rejeitado com http_error (status e corpo), ou convertido em forbidden (401/403) ou not_found (404).
 */
export function criarApi({ omni, apiUrl, chave, ctx }: ConfigCliente): Api {
  const usuario = ctx.user ?? {};
  return async <T>(caminho: string, opcoes: { method?: string; body?: unknown } = {}): Promise<T> => {
    const headers: Record<string, string> = {
      'X-Kentro-Usuario-Id': String(usuario.id ?? ''),
      // Cabeçalho HTTP não aceita emoji nem boa parte do Unicode: o nome vai codificado.
      'X-Kentro-Usuario-Nome': encodeURIComponent(String(usuario.name ?? '')),
      'X-Kentro-Instancia': String(ctx.instance?.domain ?? ''),
    };
    if (chave) headers['X-Track-Chave'] = chave;
    let body: string | undefined;
    if (opcoes.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opcoes.body);
    }

    let resposta;
    try {
      resposta = await omni.http.request({ url: apiUrl + caminho, method: opcoes.method ?? 'GET', headers, body });
    } catch (e) {
      const falha = e as { code?: string; status?: number; body?: string };
      if (falha?.code === 'http_error') throw erroDe(falha.status, falha.body);
      if (falha?.code === 'forbidden') throw { status: 403, codigo: 'forbidden_kentro', mensagem: '' } satisfies ErroTrack;
      if (falha?.code === 'not_found') throw { status: 404, codigo: 'NAO_ENCONTRADO', mensagem: '' } satisfies ErroTrack;
      throw { status: 0, codigo: falha?.code ?? '', mensagem: '' } satisfies ErroTrack;
    }
    if (resposta && resposta.status >= 200 && resposta.status < 300) {
      return (resposta.body ? JSON.parse(resposta.body) : {}) as T;
    }
    throw erroDe(resposta?.status, resposta?.body);
  };
}

export function mensagemDeErro(erro: unknown): string {
  const e = (erro ?? {}) as Partial<ErroTrack>;
  if (e.status === 401) return 'A chave do Kentro Track é inválida. Peça ao administrador para conferir a configuração da extensão.';
  if (e.codigo === 'forbidden_kentro') return 'A Kentro recusou a chamada ao Kentro Track. Peça ao administrador para conferir a chave e a permissão de chamadas externas.';
  if (e.codigo === 'CONTA_BLOQUEADA') return 'Esta conta está bloqueada no Kentro Track. Fale com o suporte.';
  if (e.codigo === 'rate_limited') return 'Muitas consultas seguidas. Aguarde um minuto.';
  if (e.status && e.status >= 400 && e.status < 500 && e.mensagem) return e.mensagem;
  return 'Não foi possível falar com o Kentro Track agora. Tente de novo em instantes.';
}
