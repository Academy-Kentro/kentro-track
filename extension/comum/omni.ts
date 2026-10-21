// Só a parte do SDK injetado pela Kentro que o Kentro Track usa.
// Referência completa: ../kentro-shop/docs/kentro/sdk-omni-referencia.md

export interface UsuarioOmni {
  id?: number;
  name?: string;
  type?: number;
  permissions?: { isAdmin?: boolean; isSupervisor?: boolean };
}

export interface CtxOmni {
  config?: Record<string, unknown>;
  user?: UsuarioOmni;
  instance?: { name?: string; domain?: string };
}

export interface ChatOmni {
  id: number;
  contactId?: number | null;
  channel?: unknown;
  contact?: { name?: string; phone?: string } | null;
}

/** Mensagem normalizada pelo SDK. `ad` traz o anúncio do clique para WhatsApp; a estrutura não é documentada. */
export interface MensagemOmni {
  id: number | string;
  direction?: unknown;
  text?: string | null;
  at?: string | number | null;
  ad?: unknown;
}

export interface RespostaHttp {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface Omni {
  ready(cb: (ctx: CtxOmni) => void): unknown;
  on(evento: string, cb: (payload: never) => void): unknown;
  http: {
    request(opts: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number }): Promise<RespostaHttp>;
  };
  chats: {
    getSelected(): Promise<ChatOmni | null>;
    getMessages(chatId: number, opts?: { limit?: number; before?: number | string }): Promise<MensagemOmni[]>;
  };
  ui: {
    toast(msg: string, tipo?: 'success' | 'error' | 'info' | 'warning'): Promise<unknown>;
    resize(altura: number): Promise<unknown>;
    confirm(opts: { title?: string; message: string; okLabel?: string; cancelLabel?: string }): Promise<{ confirmed: boolean }>;
  };
  storage: {
    get(chave: string): Promise<unknown>;
    set(chave: string, valor: unknown): Promise<unknown>;
    remove(chave: string): Promise<unknown>;
  };
}

/** O SDK chega como global `omni` antes do script da extensão. */
export function sdk(): Omni {
  const omni = (globalThis as { omni?: Omni }).omni;
  if (!omni) throw new Error('O SDK da Kentro (omni) não foi carregado.');
  return omni;
}

/** Aviso flutuante da Kentro, sem derrubar a tela se o host recusar. */
export function avisar(texto: string, tipo: 'success' | 'error' | 'info' = 'success'): void {
  Promise.resolve()
    .then(() => sdk().ui.toast(texto, tipo))
    .catch(() => {});
}

/** O painel lateral tem largura fixa: a altura acompanha o conteúdo. */
export function acompanharAltura(): void {
  if (typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    Promise.resolve()
      .then(() => sdk().ui.resize(document.body.scrollHeight + 16))
      .catch(() => {});
  }).observe(document.body);
}
