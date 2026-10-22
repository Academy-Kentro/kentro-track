import type { Api } from '../../comum/api';
import type { Omni } from '../../comum/omni';

export interface AtendenteNaKentro {
  atendenteId: string;
  atendente: string;
}

/**
 * Quem está com cada atendimento agora, lido da própria Kentro (chamadas do SDK, fora do limite do
 * omni.http.request). Atendimento que o usuário não enxerga, ou só com a IA ou a fila, fica de fora.
 */
export async function atendentesNaKentro(omni: Omni, chatIds: string[]): Promise<Record<string, AtendenteNaKentro>> {
  if (chatIds.length === 0) return {};
  const usuarios = await Promise.resolve()
    .then(() => omni.users.list())
    .catch(() => []);
  const porId = new Map(usuarios.map((u) => [u.id, u.name]));
  const achados: Record<string, AtendenteNaKentro> = {};
  await Promise.all(
    chatIds.map(async (chatId) => {
      const chat = await Promise.resolve()
        .then(() => omni.chats.get(Number(chatId)))
        .catch(() => null);
      const nome = chat?.userId ? porId.get(chat.userId) : undefined;
      if (chat?.userId && nome) achados[chatId] = { atendenteId: String(chat.userId), atendente: nome };
    }),
  );
  return achados;
}

/** Grava no Kentro Track (a aba Equipe soma pelo atendente gravado); devolve quantos leads mudaram. */
export async function gravarAtendentes(api: Api, achados: Record<string, AtendenteNaKentro>): Promise<number> {
  const itens = Object.entries(achados).map(([chatId, a]) => ({ chatId, ...a }));
  if (itens.length === 0) return 0;
  const r = await api<{ atualizados: number }>('/v1/painel/atendentes', { method: 'POST', body: { itens } }).catch(() => ({ atualizados: 0 }));
  return r.atualizados;
}
