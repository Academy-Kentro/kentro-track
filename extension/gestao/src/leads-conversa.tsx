import { useEffect, useState } from 'preact/hooks';
import { Aviso, Carregando, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import type { MensagemOmni, Omni } from '../../comum/omni';
import type { LeadDaLista } from './leads-comum';

const POR_PAGINA = 50;
const SEM_ACESSO = 'Seu usuário na Kentro não tem acesso a este atendimento.';
const SEM_MENSAGENS = 'A Kentro encontrou o atendimento, mas não devolveu as mensagens para esta tela. Abra a conversa pela tela de atendimentos da Kentro.';

const lado = (m: MensagemOmni) => {
  const d = String(m.direction ?? '');
  if (d === 'in') return 'cliente';
  if (d === 'out' || d === 'system-out') return 'equipe';
  return 'aviso';
};

const horario = (at: MensagemOmni['at']) => {
  if (at == null) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/**
 * Lê a conversa direto da Kentro, com a permissão de quem está vendo: nada disso passa pela API do
 * Kentro Track nem fica guardado nela.
 */
export function ConversaLead({ omni, lead, fechar }: { omni: Omni; lead: Pick<LeadDaLista, 'nome' | 'chatId'>; fechar: () => void }) {
  const [mensagens, setMensagens] = useState<MensagemOmni[] | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const buscar = async (antes?: number | string) => {
    setCarregando(true);
    setErro('');
    try {
      const lote = await omni.chats.getMessages(Number(lead.chatId), antes === undefined ? { limit: POR_PAGINA } : { limit: POR_PAGINA, before: antes });
      const pagina = Array.isArray(lote) ? lote : [];
      if (pagina.length === 0 && antes === undefined) {
        // Vazio não prova que a conversa está vazia: o lead pode ter mensagens que esta tela não recebe.
        const existe = await Promise.resolve()
          .then(() => omni.chats.get(Number(lead.chatId)))
          .then(
            () => true,
            () => false,
          );
        setErro(existe ? SEM_MENSAGENS : SEM_ACESSO);
      }
      setTemMais(pagina.length === POR_PAGINA);
      // A Kentro entrega da mais recente para a mais antiga; a tela lê de cima para baixo.
      setMensagens((atuais) => [...[...pagina].reverse(), ...(antes === undefined ? [] : atuais ?? [])]);
    } catch (e) {
      const codigo = (e as { code?: string })?.code;
      setErro(codigo === 'not_found' || codigo === 'forbidden' ? SEM_ACESSO : 'Não foi possível ler a conversa na Kentro agora.');
      setMensagens((atuais) => atuais ?? []);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => {
    setMensagens(null);
    buscar();
  }, [omni, lead.chatId]);

  return (
    <Secao
      icone="mensagem"
      titulo={`Conversa de ${lead.nome ?? 'lead sem nome'}`}
      descricao="Vem direto da Kentro, com a permissão do seu usuário, e não fica guardada no Kentro Track. Só leitura."
      acoes={
        <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" aria-label="Fechar a conversa" onClick={fechar}>
          <Icone nome="fechar" tamanho={14} />
        </button>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!mensagens ? (
        <Carregando />
      ) : (
        <>
          {temMais && (
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={carregando} onClick={() => buscar(mensagens[0]!.id)}>
              {carregando ? 'Carregando…' : 'Mensagens anteriores'}
            </button>
          )}
          {mensagens.length > 0 && (
            <ol class="kt-conversa">
              {mensagens.map((m) => (
                <li key={m.id} class={`kt-mensagem kt-mensagem-${lado(m)}`}>
                  <span class="kt-mensagem-texto">{m.text?.trim() || <em class="kt-muted">Arquivo ou mídia</em>}</span>
                  <span class="kt-muted kt-mensagem-hora">{horario(m.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Secao>
  );
}
