import { createHmac } from 'node:crypto';
import type { Fetch } from '../../comum/fetch';
import { ErroMeta, LimiteMeta, MetaIndisponivel, PermissaoFaltando, RecusadoPeloMeta, TokenInvalido } from './erros';

export const BASE_GRAPH = 'https://graph.facebook.com';

/**
 * O appsecret_proof só vale com o segredo do app que emitiu o token: vai nos tokens do nosso app
 * (Login for Business), nunca no token manual, que vem de um app do próprio cliente.
 */
export interface TokenMeta {
  valor: string;
  doNossoApp: boolean;
}

export interface ContextoChamada {
  contaId?: string;
  /** Nome curto para a aba Saúde, ex.: "insights", "campanhas". Nunca a URL com parâmetros. */
  operacao: string;
}

export interface RegistroChamada extends ContextoChamada {
  statusHttp: number | null;
  ms: number;
  erroCodigo: string | null;
  uso: UsoMeta | null;
}

/** Maior percentual de uso entre os cabeçalhos de limite e quanto falta para liberar. */
export interface UsoMeta {
  pct: number;
  liberaEmSegundos: number;
}

export interface OpcoesGraph {
  versao: string;
  fetch: Fetch;
  appSecret: string | null;
  esperar?: (ms: number) => Promise<void>;
  registrar?: (registro: RegistroChamada) => unknown;
  tempoLimiteMs?: number;
}

type Parametros = Record<string, string | number | boolean | undefined>;

const LIMITE = new Set([4, 17, 32, 613]);
const TRANSITORIO = new Set([1, 2]);
const MAX_TENTATIVAS = 3;
/** Até quanto vale esperar dentro da própria chamada por um limite que libera logo. */
const ESPERA_CURTA_S = 30;

interface CorpoErro {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** X-Business-Use-Case-Usage, X-Ad-Account-Usage e X-App-Usage: o pior deles. */
export function lerUso(cabecalhos: Headers): UsoMeta | null {
  let pct = 0;
  let liberaEmSegundos = 0;
  let achou = false;
  const ler = (nome: string): unknown => {
    const bruto = cabecalhos.get(nome);
    if (!bruto) return null;
    try {
      achou = true;
      return JSON.parse(bruto);
    } catch {
      return null;
    }
  };

  const porCaso = ler('x-business-use-case-usage');
  if (porCaso && typeof porCaso === 'object') {
    for (const lista of Object.values(porCaso as Record<string, unknown>)) {
      for (const item of Array.isArray(lista) ? lista : []) {
        pct = Math.max(pct, numero(item?.call_count), numero(item?.total_cputime), numero(item?.total_time));
        liberaEmSegundos = Math.max(liberaEmSegundos, numero(item?.estimated_time_to_regain_access) * 60);
      }
    }
  }
  const daConta = ler('x-ad-account-usage') as Record<string, unknown> | null;
  if (daConta) {
    pct = Math.max(pct, numero(daConta.acc_id_util_pct));
    liberaEmSegundos = Math.max(liberaEmSegundos, numero(daConta.reset_time_duration));
  }
  const doApp = ler('x-app-usage') as Record<string, unknown> | null;
  if (doApp) pct = Math.max(pct, numero(doApp.call_count), numero(doApp.total_cputime), numero(doApp.total_time));
  return achou ? { pct, liberaEmSegundos } : null;
}

function classificar(status: number, corpo: CorpoErro, uso: UsoMeta | null): ErroMeta {
  const erro = corpo.error ?? {};
  const codigo = erro.code ?? 0;
  const mensagem = erro.message || `O Meta respondeu ${status}.`;
  const trace = erro.fbtrace_id;
  if (codigo === 190 || codigo === 102) return new TokenInvalido(mensagem, trace);
  if (codigo === 10 || (codigo >= 200 && codigo <= 299)) return new PermissaoFaltando(mensagem, trace);
  if (LIMITE.has(codigo) || (codigo >= 80000 && codigo <= 80014)) {
    // Sem o tempo nos cabeçalhos, 1 minuto.
    return new LimiteMeta(uso?.liberaEmSegundos ? Math.ceil(uso.liberaEmSegundos) : 60, mensagem, trace);
  }
  if (status >= 500 || TRANSITORIO.has(codigo)) return new MetaIndisponivel(mensagem, trace);
  return new RecusadoPeloMeta(mensagem, trace);
}

export class ClienteGraph {
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(private readonly opcoes: OpcoesGraph) {
    this.esperar = opcoes.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get<T>(token: TokenMeta, caminho: string, params: Parametros, ctx: ContextoChamada): Promise<T> {
    return this.chamar<T>('GET', token, caminho, params, ctx);
  }

  /** GET que devolve também o uso da API informado pelo Meta (para frear antes do bloqueio). */
  getComUso<T>(token: TokenMeta, caminho: string, params: Parametros, ctx: ContextoChamada): Promise<{ dados: T; uso: UsoMeta | null }> {
    return this.chamarComUso<T>('GET', token, caminho, params, ctx);
  }

  /** POST com os parâmetros na URL e, se houver, um corpo JSON (ex.: os eventos da API de Conversões). */
  post<T>(token: TokenMeta, caminho: string, params: Parametros, ctx: ContextoChamada, corpo?: unknown): Promise<T> {
    return this.chamar<T>('POST', token, caminho, params, ctx, corpo);
  }

  /** Lista paginada por cursor (`after`), com teto de páginas para não varrer sem fim. */
  async *paginar<T>(token: TokenMeta, caminho: string, params: Parametros, ctx: ContextoChamada, maxPaginas = 100): AsyncGenerator<T> {
    let after: string | undefined;
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const resposta = await this.get<{ data?: T[]; paging?: { next?: string; cursors?: { after?: string } } }>(
        token,
        caminho,
        after ? { ...params, after } : params,
        ctx,
      );
      for (const item of resposta.data ?? []) yield item;
      after = resposta.paging?.cursors?.after;
      if (!resposta.paging?.next || !after) return;
    }
  }

  async listar<T>(token: TokenMeta, caminho: string, params: Parametros, ctx: ContextoChamada, maxPaginas = 100): Promise<T[]> {
    const itens: T[] = [];
    for await (const item of this.paginar<T>(token, caminho, params, ctx, maxPaginas)) itens.push(item);
    return itens;
  }

  private montarUrl(token: TokenMeta, caminho: string, params: Parametros): string {
    const busca = new URLSearchParams();
    for (const [chave, valor] of Object.entries(params)) if (valor !== undefined) busca.set(chave, String(valor));
    if (token.doNossoApp && this.opcoes.appSecret) {
      busca.set('appsecret_proof', createHmac('sha256', this.opcoes.appSecret).update(token.valor).digest('hex'));
    }
    const consulta = busca.toString();
    return `${BASE_GRAPH}/${this.opcoes.versao}/${caminho.replace(/^\/+/, '')}${consulta ? `?${consulta}` : ''}`;
  }

  private async chamar<T>(metodo: 'GET' | 'POST', token: TokenMeta, caminho: string, params: Parametros, ctx: ContextoChamada, corpo?: unknown): Promise<T> {
    return (await this.chamarComUso<T>(metodo, token, caminho, params, ctx, corpo)).dados;
  }

  private async chamarComUso<T>(
    metodo: 'GET' | 'POST',
    token: TokenMeta,
    caminho: string,
    params: Parametros,
    ctx: ContextoChamada,
    corpo?: unknown,
  ): Promise<{ dados: T; uso: UsoMeta | null }> {
    const url = this.montarUrl(token, caminho, params);
    let ultimo: ErroMeta = new MetaIndisponivel('O Meta não respondeu.');
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const inicio = Date.now();
      let status: number | null = null;
      let uso: UsoMeta | null = null;
      try {
        // O token vai no cabeçalho, não na URL: assim não aparece em log de proxy nem de erro.
        const resposta = await this.opcoes.fetch(url, {
          method: metodo,
          headers: { Authorization: `Bearer ${token.valor}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
          signal: AbortSignal.timeout(this.opcoes.tempoLimiteMs ?? 15_000),
        });
        status = resposta.status;
        uso = lerUso(resposta.headers);
        const texto = await resposta.text();
        let json: unknown;
        try {
          json = texto ? JSON.parse(texto) : {};
        } catch {
          json = {};
        }
        if (resposta.ok && !(json as CorpoErro).error) {
          this.registrar({ ...ctx, statusHttp: status, ms: Date.now() - inicio, erroCodigo: null, uso });
          return { dados: json as T, uso };
        }
        ultimo = classificar(status, json as CorpoErro, uso);
      } catch (e) {
        ultimo = e instanceof ErroMeta ? e : new MetaIndisponivel('Não foi possível falar com o Meta (rede ou tempo limite).');
      }
      this.registrar({ ...ctx, statusHttp: status, ms: Date.now() - inicio, erroCodigo: ultimo.codigo, uso });

      const ultimaTentativa = tentativa === MAX_TENTATIVAS;
      if (ultimo instanceof MetaIndisponivel && !ultimaTentativa) {
        await this.esperar(500 * 2 ** (tentativa - 1));
        continue;
      }
      if (ultimo instanceof LimiteMeta && !ultimaTentativa && ultimo.esperarSegundos <= ESPERA_CURTA_S) {
        await this.esperar(ultimo.esperarSegundos * 1000);
        continue;
      }
      throw ultimo;
    }
    throw ultimo;
  }

  private registrar(registro: RegistroChamada): void {
    try {
      Promise.resolve(this.opcoes.registrar?.(registro)).catch(() => {});
    } catch {
      // registrar é só diagnóstico: nunca derruba a chamada
    }
  }
}
