import { useEffect, useMemo, useState } from 'preact/hooks';
import { Api, criarApi, lerConfigInstalacao, mensagemDeErro } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando } from '../../comum/componentes';
import type { ChatOmni, CtxOmni, Omni } from '../../comum/omni';
import { buscarAnuncio, Busca, diagnostico, resumirAnuncio } from './anuncio';
import { Entradas, Etapas, Historico, LeadPainel, Origem } from './lead';

interface Conta {
  nome: string | null;
  papel: 'admin' | 'gestor' | 'atendimento';
}

type EstadoConta = { tipo: 'carregando' } | { tipo: 'sem_chave' } | { tipo: 'erro'; mensagem: string } | { tipo: 'ok'; conta: Conta };

function useConta(api: Api | null): EstadoConta {
  const [estado, setEstado] = useState<EstadoConta>({ tipo: 'carregando' });
  useEffect(() => {
    if (!api) {
      setEstado({ tipo: 'sem_chave' });
      return;
    }
    api<Conta>('/v1/conta').then(
      (conta) => setEstado({ tipo: 'ok', conta }),
      (erro) => setEstado({ tipo: 'erro', mensagem: mensagemDeErro(erro) }),
    );
  }, [api]);
  return estado;
}

function SituacaoConta({ estado }: { estado: EstadoConta }) {
  if (estado.tipo === 'carregando') return null;
  if (estado.tipo === 'sem_chave') return <Aviso>Peça ao administrador para configurar o Kentro Track.</Aviso>;
  if (estado.tipo === 'erro') return <Aviso tipo="erro">{estado.mensagem}</Aviso>;
  // A chave de admin ou de gestor não pode ficar aqui: ela chegaria ao navegador de todos os atendentes.
  if (estado.conta.papel !== 'atendimento') {
    return (
      <Aviso tipo="erro">
        Esta instalação está com a chave de {estado.conta.papel}. Peça ao administrador para colar a <strong>chave de atendimento</strong> e trocar
        a chave de {estado.conta.papel} no Kentro Track — Gestão.
      </Aviso>
    );
  }
  return null;
}

type EstadoChat =
  | { tipo: 'sem_chat' }
  | { tipo: 'buscando' }
  | { tipo: 'erro'; mensagem: string; chat?: ChatOmni; busca?: Busca }
  | { tipo: 'ok'; chat: ChatOmni; busca: Busca; lead: LeadPainel | null };

/** Sem a API (chave ausente), o painel ainda mostra o anúncio que veio na conversa. */
function AnuncioLocal({ busca }: { busca: Busca }) {
  const anuncio = busca.mensagem ? resumirAnuncio(busca.mensagem.ad) : null;
  return (
    <div class="kt-card">
      {anuncio ? (
        <>
          <p>
            <span class="kt-selo">Veio de um anúncio</span>
          </p>
          {anuncio.titulo && <h3>{anuncio.titulo}</h3>}
          {anuncio.texto && <p>{anuncio.texto}</p>}
          {anuncio.url && <p class="kt-muted" style={{ wordBreak: 'break-all' }}>{anuncio.url}</p>}
        </>
      ) : (
        <p class="kt-muted">Nenhum anúncio identificado nas {busca.analisadas} mensagens mais recentes deste atendimento.</p>
      )}
    </div>
  );
}

function Diagnostico({ chat, busca }: { chat: ChatOmni; busca: Busca }) {
  const texto = diagnostico(chat, busca);
  return (
    <details class="kt-diagnostico">
      <summary class="kt-muted">Diagnóstico do anúncio</summary>
      <p class="kt-muted">Só os dados do anúncio, sem mensagens nem telefone do cliente.</p>
      <pre class="kt-json">{texto}</pre>
      <div class="kt-linha-acoes" style={{ marginTop: '8px' }}>
        <BotaoCopiar texto={texto} rotulo="Copiar diagnóstico" aoCopiar="Diagnóstico copiado." />
      </div>
    </details>
  );
}

export function App({ omni, ctx }: { omni: Omni; ctx: CtxOmni }) {
  const { apiUrl, chave } = lerConfigInstalacao(ctx, 'chave_atendimento');
  const api = useMemo(() => (apiUrl && chave ? criarApi({ omni, apiUrl, chave, ctx }) : null), [omni, apiUrl, chave, ctx]);
  const conta = useConta(api);
  const [chat, setChat] = useState<EstadoChat>({ tipo: 'buscando' });
  const [selecionado, setSelecionado] = useState<ChatOmni | null | undefined>(undefined);
  // Só liga ao lead com a chave de atendimento confirmada (a de admin não deve ficar no painel).
  const apiDoLead = conta.tipo === 'ok' && conta.conta.papel === 'atendimento' ? api : null;
  const contaDecidida = conta.tipo !== 'carregando';

  useEffect(() => {
    omni.on('omniChatSelected', (c: never) => setSelecionado((c as ChatOmni | null) ?? null));
    omni.chats.getSelected().then(
      (c) => setSelecionado(c ?? null),
      () => setSelecionado(null),
    );
  }, [omni]);

  useEffect(() => {
    if (selecionado === undefined || !contaDecidida) return;
    if (!selecionado?.id) {
      setChat({ tipo: 'sem_chat' });
      return;
    }
    let vale = true;
    setChat({ tipo: 'buscando' });
    (async () => {
      let busca: Busca;
      try {
        busca = await buscarAnuncio(omni, selecionado.id);
      } catch {
        if (vale) setChat({ tipo: 'erro', mensagem: 'Não foi possível ler as mensagens deste atendimento.', chat: selecionado });
        return;
      }
      if (!apiDoLead) {
        if (vale) setChat({ tipo: 'ok', chat: selecionado, busca, lead: null });
        return;
      }
      try {
        const resumo = busca.mensagem ? resumirAnuncio(busca.mensagem.ad) : null;
        // Uma chamada por atendimento aberto (o omni.http.request aceita 30 por minuto).
        const lead = await apiDoLead<LeadPainel>('/v1/atendimento/vincular', {
          method: 'POST',
          body: {
            chatId: String(selecionado.id),
            telefone: selecionado.contact?.phone ?? undefined,
            nome: selecionado.contact?.name ?? undefined,
            contatoId: selecionado.contactId != null ? String(selecionado.contactId) : undefined,
            anuncio: resumo && Object.keys(resumo).length ? resumo : undefined,
          },
        });
        if (vale) setChat({ tipo: 'ok', chat: selecionado, busca, lead });
      } catch (erro) {
        if (vale) setChat({ tipo: 'erro', mensagem: mensagemDeErro(erro), chat: selecionado, busca });
      }
    })();
    return () => {
      vale = false;
    };
  }, [omni, selecionado, apiDoLead, contaDecidida]);

  const mudarLead = (lead: LeadPainel) => setChat((c) => (c.tipo === 'ok' ? { ...c, lead } : c));

  return (
    <main class="kt-painel">
      <SituacaoConta estado={conta} />
      {chat.tipo === 'sem_chat' && <p class="kt-muted">Abra um atendimento para ver de onde o lead veio.</p>}
      {chat.tipo === 'buscando' && <Carregando texto="Procurando a origem do lead…" />}
      {chat.tipo === 'erro' && (
        <>
          <Aviso tipo="erro">{chat.mensagem}</Aviso>
          {chat.busca && <AnuncioLocal busca={chat.busca} />}
        </>
      )}
      {chat.tipo === 'ok' &&
        (chat.lead && apiDoLead ? (
          <>
            <Origem lead={chat.lead} />
            <Etapas api={apiDoLead} lead={chat.lead} mudar={mudarLead} />
            <Entradas lead={chat.lead} />
            <Historico lead={chat.lead} />
          </>
        ) : (
          <AnuncioLocal busca={chat.busca} />
        ))}
      {(chat.tipo === 'ok' || (chat.tipo === 'erro' && chat.busca && chat.chat)) && (
        <Diagnostico chat={(chat as { chat: ChatOmni }).chat} busca={(chat as { busca: Busca }).busca} />
      )}
    </main>
  );
}
