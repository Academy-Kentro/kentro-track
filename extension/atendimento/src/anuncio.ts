import type { MensagemOmni, Omni } from '../../comum/omni';

/**
 * O que conseguimos tirar do campo `ad` da mensagem (clique para WhatsApp). A Kentro não documenta a
 * estrutura dele, então os nomes são procurados entre as grafias prováveis (camelCase, snake_case, do
 * webhook do WhatsApp e das variáveis message_ad_* das automações).
 */
export interface ResumoAnuncio {
  idAnuncio?: string;
  ctwaClid?: string;
  url?: string;
  titulo?: string;
  texto?: string;
  tipo?: string;
  midia?: string;
}

const CAMPOS: Record<keyof ResumoAnuncio, string[]> = {
  idAnuncio: ['sourceid', 'adid', 'idanuncio', 'messageadid'],
  ctwaClid: ['ctwaclid', 'clid'],
  url: ['sourceurl', 'adurl', 'messageadurl', 'url', 'link'],
  titulo: ['headline', 'adtitle', 'messageadtitle', 'title', 'titulo'],
  texto: ['body', 'adbody', 'messageadbody', 'text', 'texto', 'description'],
  tipo: ['sourcetype', 'mediatype', 'type'],
  midia: ['imageurl', 'thumbnailurl', 'videourl', 'mediaurl'],
};

const normalizar = (chave: string) => chave.toLowerCase().replace(/[^a-z0-9]/g, '');

function comoObjeto(ad: unknown): Record<string, unknown> | null {
  if (typeof ad === 'string') {
    const texto = ad.trim();
    if (!texto) return null;
    try {
      return comoObjeto(JSON.parse(texto));
    } catch {
      return /^https?:\/\//i.test(texto) ? { url: texto } : { body: texto };
    }
  }
  if (ad && typeof ad === 'object' && !Array.isArray(ad)) return ad as Record<string, unknown>;
  return null;
}

/** Achata até dois níveis (ex.: { referral: { source_id } }), guardando só valores de texto ou número. */
function folhas(obj: Record<string, unknown>, profundidade = 0, saida = new Map<string, string>()): Map<string, string> {
  for (const [chave, valor] of Object.entries(obj)) {
    if (valor == null) continue;
    if (typeof valor === 'string' || typeof valor === 'number') {
      const texto = String(valor).trim();
      const nome = normalizar(chave);
      if (texto && !saida.has(nome)) saida.set(nome, texto);
    } else if (typeof valor === 'object' && !Array.isArray(valor) && profundidade < 2) {
      folhas(valor as Record<string, unknown>, profundidade + 1, saida);
    }
  }
  return saida;
}

export function resumirAnuncio(ad: unknown): ResumoAnuncio {
  const obj = comoObjeto(ad);
  if (!obj) return {};
  const valores = folhas(obj);
  const resumo: ResumoAnuncio = {};
  for (const campo of Object.keys(CAMPOS) as (keyof ResumoAnuncio)[]) {
    const achado = CAMPOS[campo].map((nome) => valores.get(nome)).find(Boolean);
    if (achado) resumo[campo] = achado;
  }
  return resumo;
}

export function temAnuncio(ad: unknown): boolean {
  const obj = comoObjeto(ad);
  return !!obj && folhas(obj).size > 0;
}

function instante(m: MensagemOmni, indice: number): number {
  const t = typeof m.at === 'number' ? m.at : Date.parse(String(m.at ?? ''));
  // Sem data: mantém a ordem do array (a página vem da mais recente para a mais antiga).
  return Number.isFinite(t) ? t : -indice;
}

/** A mensagem mais antiga com anúncio: é a que abriu a conversa pelo clique. */
export function primeiraComAnuncio(mensagens: MensagemOmni[]): MensagemOmni | null {
  const com = mensagens.map((m, i) => ({ m, t: instante(m, i) })).filter(({ m }) => temAnuncio(m.ad));
  if (com.length === 0) return null;
  return com.reduce((a, b) => (b.t < a.t ? b : a)).m;
}

export interface Busca {
  mensagem: MensagemOmni | null;
  analisadas: number;
}

const POR_PAGINA = 50;

/**
 * Procura o anúncio recuando no histórico (o clique costuma estar na primeira mensagem do cliente).
 * São chamadas ao SDK, não ao omni.http.request: não contam no limite de 30 por minuto.
 */
export async function buscarAnuncio(omni: Omni, chatId: number, maxPaginas = 4): Promise<Busca> {
  const todas: MensagemOmni[] = [];
  let antes: number | string | undefined;
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const lote = await omni.chats.getMessages(chatId, antes === undefined ? { limit: POR_PAGINA } : { limit: POR_PAGINA, before: antes });
    if (!Array.isArray(lote) || lote.length === 0) break;
    todas.push(...lote);
    if (lote.length < POR_PAGINA) break;
    const maisAntiga = lote.reduce((a, b) => (Number(b.id) < Number(a.id) ? b : a));
    if (maisAntiga.id === antes) break;
    antes = maisAntiga.id;
  }
  return { mensagem: primeiraComAnuncio(todas), analisadas: todas.length };
}

/** Diagnóstico para o suporte: só o anúncio e metadados, sem texto nem telefone do cliente. */
export function diagnostico(chat: { id: number; channel?: unknown }, busca: Busca): string {
  const m = busca.mensagem;
  return JSON.stringify(
    {
      chatId: chat.id,
      canal: chat.channel ?? null,
      mensagensAnalisadas: busca.analisadas,
      mensagem: m ? { id: m.id, at: m.at ?? null, direction: m.direction ?? null } : null,
      ad: m?.ad ?? null,
      chavesDoAd: m ? [...folhas(comoObjeto(m.ad) ?? {}).keys()] : [],
      resumo: m ? resumirAnuncio(m.ad) : null,
    },
    null,
    2,
  );
}
