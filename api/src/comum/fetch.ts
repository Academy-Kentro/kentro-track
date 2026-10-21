/** fetch injetável: produção usa o global; os testes trocam por um servidor falso do Meta. */
export const FETCH = Symbol('FETCH');

export type Fetch = typeof fetch;

/** Espera injetável (novas tentativas, relatório assíncrono): os testes não esperam de verdade. */
export const ESPERAR = Symbol('ESPERAR');

export type Esperar = (ms: number) => Promise<void>;

export const esperarDeVerdade: Esperar = (ms) => new Promise((r) => setTimeout(r, ms));
