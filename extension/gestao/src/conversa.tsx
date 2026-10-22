import { useEffect, useRef, useState } from 'preact/hooks';
import { Aviso, Carregando } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { codigoDoErro, type MensagemOmni, type Omni } from '../../comum/omni';

const POR_PAGINA = 50;

export interface ConversaAberta {
  chatId: number;
  titulo: string;
  /** Quem está com o atendimento agora, para o aviso de "só leitura". */
  com: string | null;
}

/** Quem mandou: a direção quando o SDK a diz em texto, senão quem gravou a mensagem (atendente, automação ou IA). */
export function doCliente(m: MensagemOmni): boolean {
  const d = typeof m.direction === 'string' ? m.direction.toLowerCase() : '';
  if (/^(in|inbound|incoming|received)$/.test(d)) return true;
  if (/^(out|outbound|outgoing|sent)$/.test(d)) return false;
  return !m.userId && !m.automationId && !m.assistantId;
}

function conteudo(m: MensagemOmni): { texto: string; vazio: boolean } {
  if (m.deleted) return { texto: 'Mensagem apagada', vazio: true };
  const texto = m.text?.trim() || m.transcription?.trim();
  if (texto) return { texto, vazio: false };
  if (m.fileName) return { texto: `Arquivo: ${m.fileName}`, vazio: true };
  if (m.fileRef) return { texto: 'Arquivo (imagem, áudio ou documento)', vazio: true };
  return { texto: 'Mensagem sem texto', vazio: true };
}

function quando(at: MensagemOmni['at']): string {
  if (at == null || at === '') return '';
  const d = new Date(typeof at === 'number' && at < 1e12 ? at * 1000 : at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * A conversa em modo leitura, dentro do Kentro Track: a Kentro só abre na tela de chat os
 * atendimentos do próprio usuário, e o gestor quase nunca é quem atende.
 */
export function Conversa({ omni, conversa, fechar }: { omni: Omni; conversa: ConversaAberta; fechar: () => void }) {
  // Da mais antiga para a mais recente (o SDK devolve ao contrário).
  const [mensagens, setMensagens] = useState<MensagemOmni[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const primeira = useRef(true);

  const carregar = async (antes?: number | string) => {
    setCarregando(true);
    try {
      const lote = await omni.chats.getMessages(conversa.chatId, antes === undefined ? { limit: POR_PAGINA } : { limit: POR_PAGINA, before: antes });
      setMensagens((atuais) => [...[...lote].reverse(), ...atuais]);
      setTemMais(lote.length === POR_PAGINA);
      setErro(null);
    } catch (e) {
      setErro(`A Kentro não liberou as mensagens deste atendimento (${codigoDoErro(e)}).`);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [conversa.chatId]);

  // Abre no fim, como no WhatsApp; ao puxar as anteriores, fica onde estava.
  useEffect(() => {
    if (primeira.current && mensagens.length > 0 && lista.current) {
      lista.current.scrollTop = lista.current.scrollHeight;
      primeira.current = false;
    }
  }, [mensagens]);

  return (
    <div class="kt-modal-fundo" onClick={(e) => e.target === e.currentTarget && fechar()}>
      <div class="kt-modal" role="dialog" aria-modal="true" aria-label={`Conversa com ${conversa.titulo}`}>
        <header class="kt-modal-topo">
          <div>
            <h2 class="kt-modal-titulo">{conversa.titulo}</h2>
            <p class="kt-muted">
              Atendimento #{conversa.chatId} · só leitura{conversa.com ? `, a conversa está com ${conversa.com}` : ''}
            </p>
          </div>
          <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={fechar} aria-label="Fechar">
            <Icone nome="fechar" tamanho={14} />
          </button>
        </header>
        <div class="kt-conversa" ref={lista}>
          {temMais && (
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno kt-conversa-mais" disabled={carregando} onClick={() => carregar(mensagens[0]?.id)}>
              Carregar mensagens anteriores
            </button>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {carregando && mensagens.length === 0 && <Carregando texto="Carregando a conversa…" />}
          {!carregando && !erro && mensagens.length === 0 && <p class="kt-muted kt-conversa-vazia">Nenhuma mensagem neste atendimento.</p>}
          {mensagens.map((m) => {
            const { texto, vazio } = conteudo(m);
            const cliente = doCliente(m);
            return (
              <div key={m.id} class={`kt-balao ${cliente ? 'kt-balao-cliente' : 'kt-balao-empresa'}`}>
                {!cliente && m.participantName && <span class="kt-balao-autor">{m.participantName}</span>}
                <span class={vazio ? 'kt-balao-texto kt-muted' : 'kt-balao-texto'}>{texto}</span>
                <span class="kt-balao-hora">{quando(m.at)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
