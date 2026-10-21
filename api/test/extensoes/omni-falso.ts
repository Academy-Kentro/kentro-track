import type { ChatOmni, MensagemOmni, Omni, RespostaHttp } from '../../../extension/comum/omni';

export interface ChamadaHttp {
  url: string;
  method: string;
  headers: Record<string, string>;
  corpo?: unknown;
}

export interface OpcoesFalso {
  chat?: ChatOmni | null;
  mensagens?: MensagemOmni[];
  /** Responde as chamadas do omni.http.request (a API do Kentro Track). */
  http?: (chamada: ChamadaHttp) => RespostaHttp | Promise<RespostaHttp>;
  confirmar?: boolean;
}

/** SDK da Kentro em memória, só com o que as extensões usam. */
export function omniFalso(opcoes: OpcoesFalso = {}) {
  const chamadas: ChamadaHttp[] = [];
  const paginas: { chatId: number; before?: number | string }[] = [];
  const armazenamento = new Map<string, unknown>();
  const toasts: string[] = [];
  const ouvintes = new Map<string, ((p: never) => void)[]>();

  const omni: Omni = {
    ready: (cb) => cb({}),
    on: (evento, cb) => {
      ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), cb]);
      return () => {};
    },
    http: {
      request: async (opts) => {
        const chamada: ChamadaHttp = {
          url: opts.url,
          method: opts.method ?? 'GET',
          headers: opts.headers ?? {},
          corpo: opts.body ? JSON.parse(opts.body) : undefined,
        };
        chamadas.push(chamada);
        if (!opcoes.http) throw Object.assign(new Error('sem rede'), { code: 'timeout' });
        return opcoes.http(chamada);
      },
    },
    chats: {
      getSelected: async () => opcoes.chat ?? null,
      // Como o SDK: da mais recente para a mais antiga, em páginas, cortando pelo id.
      getMessages: async (chatId, opts) => {
        paginas.push({ chatId, before: opts?.before });
        const limite = opts?.limit ?? 50;
        const ordenadas = [...(opcoes.mensagens ?? [])].sort((a, b) => Number(b.id) - Number(a.id));
        const filtradas = opts?.before === undefined ? ordenadas : ordenadas.filter((m) => Number(m.id) < Number(opts.before));
        return filtradas.slice(0, limite);
      },
    },
    ui: {
      toast: async (msg) => {
        toasts.push(msg);
        return { shown: true };
      },
      resize: async () => ({}),
      confirm: async () => ({ confirmed: opcoes.confirmar ?? true }),
    },
    storage: {
      get: async (chave) => armazenamento.get(chave) ?? null,
      set: async (chave, valor) => {
        armazenamento.set(chave, valor);
      },
      remove: async (chave) => {
        armazenamento.delete(chave);
      },
    },
  };

  const emitir = (evento: string, payload: unknown) => {
    for (const cb of ouvintes.get(evento) ?? []) cb(payload as never);
  };

  return { omni, chamadas, paginas, armazenamento, toasts, emitir };
}

export const ok = (corpo: unknown, status = 200): RespostaHttp => ({ status, body: JSON.stringify(corpo) });
export const erro = (status: number, codigo: string, mensagem: string): RespostaHttp => ({
  status,
  body: JSON.stringify({ erro: { codigo, mensagem } }),
});

/** Espera as promessas pendentes e os re-renders do Preact. */
export async function aguardar(vezes = 5): Promise<void> {
  for (let i = 0; i < vezes; i++) await new Promise((r) => setTimeout(r, 0));
}
