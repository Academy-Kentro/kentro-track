import { useEffect, useState } from 'preact/hooks';
import { criarApi, lerConfigInstalacao, mensagemDeErro } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando } from '../../comum/componentes';
import type { ChatOmni, CtxOmni, Omni } from '../../comum/omni';
import { buscarAnuncio, Busca, diagnostico, resumirAnuncio } from './anuncio';

interface Conta {
  nome: string | null;
  papel: 'admin' | 'gestor' | 'atendimento';
}

type EstadoConta = { tipo: 'carregando' } | { tipo: 'sem_chave' } | { tipo: 'erro'; mensagem: string } | { tipo: 'ok'; conta: Conta };

function useConta(omni: Omni, ctx: CtxOmni): EstadoConta {
  const [estado, setEstado] = useState<EstadoConta>({ tipo: 'carregando' });
  useEffect(() => {
    const { apiUrl, chave } = lerConfigInstalacao(ctx, 'chave_atendimento');
    if (!apiUrl || !chave) {
      setEstado({ tipo: 'sem_chave' });
      return;
    }
    criarApi({ omni, apiUrl, chave, ctx })<Conta>('/v1/conta').then(
      (conta) => setEstado({ tipo: 'ok', conta }),
      (erro) => setEstado({ tipo: 'erro', mensagem: mensagemDeErro(erro) }),
    );
  }, [omni, ctx]);
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

type EstadoChat = { tipo: 'sem_chat' } | { tipo: 'buscando' } | { tipo: 'erro' } | { tipo: 'ok'; chat: ChatOmni; busca: Busca };

function Origem({ estado }: { estado: EstadoChat }) {
  if (estado.tipo === 'sem_chat') return <p class="kt-muted">Abra um atendimento para ver de onde o lead veio.</p>;
  if (estado.tipo === 'buscando') return <Carregando texto="Procurando o anúncio na conversa…" />;
  if (estado.tipo === 'erro') return <Aviso tipo="erro">Não foi possível ler as mensagens deste atendimento.</Aviso>;

  const { chat, busca } = estado;
  const anuncio = busca.mensagem ? resumirAnuncio(busca.mensagem.ad) : null;
  return (
    <>
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
      <details>
        <summary class="kt-muted">Diagnóstico do anúncio</summary>
        <p class="kt-muted">Só os dados do anúncio, sem mensagens nem telefone do cliente.</p>
        <pre class="kt-json">{diagnostico(chat, busca)}</pre>
        <div class="kt-linha-acoes" style={{ marginTop: '8px' }}>
          <BotaoCopiar texto={diagnostico(chat, busca)} rotulo="Copiar diagnóstico" aoCopiar="Diagnóstico copiado." />
        </div>
      </details>
    </>
  );
}

export function App({ omni, ctx }: { omni: Omni; ctx: CtxOmni }) {
  const conta = useConta(omni, ctx);
  const [chat, setChat] = useState<EstadoChat>({ tipo: 'buscando' });

  useEffect(() => {
    let atual = 0;
    const carregar = async (selecionado: ChatOmni | null) => {
      const minha = ++atual;
      if (!selecionado?.id) {
        setChat({ tipo: 'sem_chat' });
        return;
      }
      setChat({ tipo: 'buscando' });
      try {
        const busca = await buscarAnuncio(omni, selecionado.id);
        if (minha === atual) setChat({ tipo: 'ok', chat: selecionado, busca });
      } catch {
        if (minha === atual) setChat({ tipo: 'erro' });
      }
    };
    omni.on('omniChatSelected', (selecionado: never) => carregar(selecionado as ChatOmni | null));
    omni.chats.getSelected().then(carregar, () => setChat({ tipo: 'sem_chat' }));
  }, [omni]);

  return (
    <main class="kt-painel">
      <SituacaoConta estado={conta} />
      <Origem estado={chat} />
    </main>
  );
}
