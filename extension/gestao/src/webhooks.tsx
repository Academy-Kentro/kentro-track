import { useEffect, useState } from 'preact/hooks';
import { mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando, Interruptor, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { avisar, type Omni } from '../../comum/omni';

interface Webhook {
  id: string;
  nome: string;
  urlCriada: string | null;
  urlAlterada: string | null;
  urlMensagem: string | null;
  urlOrigem: string | null;
  origens: string[];
  ativo: boolean;
  motivoDesativado: string | null;
  segredo: string;
}

interface Envio {
  id: string;
  webhook: string;
  evento: string;
  status: 'pendente' | 'enviado' | 'erro' | 'descartado';
  tentativas: number;
  respostaStatus: number | null;
  erro: string | null;
  criadoEm: string;
}

interface Dados {
  maximo: number;
  webhooks: Webhook[];
  envios: Envio[];
}

type Rascunho = Pick<Webhook, 'nome' | 'origens' | 'ativo'> & Record<'urlCriada' | 'urlAlterada' | 'urlMensagem' | 'urlOrigem', string>;

const URLS: { campo: 'urlCriada' | 'urlAlterada' | 'urlMensagem' | 'urlOrigem'; rotulo: string }[] = [
  { campo: 'urlCriada', rotulo: 'Quando uma conversa for criada' },
  { campo: 'urlAlterada', rotulo: 'Quando a etapa de uma conversa mudar' },
  { campo: 'urlMensagem', rotulo: 'A cada mensagem nova (uma tentativa só; leva o texto)' },
  { campo: 'urlOrigem', rotulo: 'Quando a origem de uma conversa mudar' },
];
const ORIGENS: { id: string; rotulo: string }[] = [
  { id: 'ctwa', rotulo: 'Anúncio' },
  { id: 'link', rotulo: 'Link rastreável' },
  { id: 'formulario', rotulo: 'Formulário' },
  { id: 'organico', rotulo: 'Sem anúncio' },
];
const EVENTO: Record<string, string> = { lead_create: 'Conversa criada', lead_update: 'Etapa alterada', lead_source_update: 'Origem alterada' };
const STATUS: Record<Envio['status'], string> = { pendente: 'Na fila', enviado: 'Entregue', erro: 'Com erro', descartado: 'Descartado' };

const paraRascunho = (w: Webhook | null): Rascunho => ({
  nome: w?.nome ?? '',
  origens: w?.origens ?? [],
  ativo: w?.ativo ?? true,
  urlCriada: w?.urlCriada ?? '',
  urlAlterada: w?.urlAlterada ?? '',
  urlMensagem: w?.urlMensagem ?? '',
  urlOrigem: w?.urlOrigem ?? '',
});

function Formulario({ api, webhook, concluir, cancelar }: { api: Api; webhook: Webhook | null; concluir: () => void; cancelar: () => void }) {
  const [d, setD] = useState<Rascunho>(paraRascunho(webhook));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      await api(webhook ? `/v1/webhooks/${webhook.id}` : '/v1/webhooks', { method: webhook ? 'PUT' : 'POST', body: d });
      avisar('Webhook salvo.');
      concluir();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };
  const alternar = (id: string) => setD({ ...d, origens: d.origens.includes(id) ? d.origens.filter((o) => o !== id) : [...d.origens, id] });
  return (
    <div class="kt-formulario-webhook">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <label class="kt-campo">
        <span>Nome</span>
        <input value={d.nome} maxLength={80} placeholder="Ex.: Planilha de vendas" onInput={(e) => setD({ ...d, nome: (e.target as HTMLInputElement).value })} />
      </label>
      {URLS.map(({ campo, rotulo }) => (
        <label key={campo} class="kt-campo">
          <span>{rotulo}</span>
          <input value={d[campo]} type="url" placeholder="https://" onInput={(e) => setD({ ...d, [campo]: (e.target as HTMLInputElement).value })} />
        </label>
      ))}
      <div class="kt-campo">
        <span>Conversas que disparam (nenhuma marcada: todas)</span>
        <div class="kt-etapa-chaves kt-link-chaves">
          {ORIGENS.map((o) => (
            <Interruptor key={o.id} ligado={d.origens.includes(o.id)} mudar={() => alternar(o.id)}>
              {o.rotulo}
            </Interruptor>
          ))}
        </div>
      </div>
      {webhook && (
        <div class="kt-link-chaves">
          <Interruptor ligado={d.ativo} mudar={(v) => setD({ ...d, ativo: v })}>
            Ativo
          </Interruptor>
        </div>
      )}
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={salvando || !d.nome.trim()} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar webhook'}
        </button>
        <button type="button" class="kt-botao kt-botao-fantasma" disabled={salvando} onClick={cancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Configurações › Webhooks: leva os dados dos leads para CRMs, planilhas e automações. */
export function Webhooks({ omni, api }: { omni: Omni; api: Api }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [edicao, setEdicao] = useState<Webhook | 'novo' | null>(null);

  const carregar = () => api<Dados>('/v1/webhooks').then(setDados, (e) => setErro(mensagemDeErro(e)));
  useEffect(() => {
    carregar();
  }, [api]);

  const excluir = async (w: Webhook) => {
    const r = await omni.ui.confirm({ title: 'Excluir webhook', message: `O webhook "${w.nome}" para de receber eventos.`, okLabel: 'Excluir' }).catch(() => ({ confirmed: false }));
    if (!r.confirmed) return;
    try {
      await api(`/v1/webhooks/${w.id}`, { method: 'DELETE' });
      carregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };
  const reenviar = async (id: string) => {
    try {
      await api(`/v1/webhooks/envios/${id}/reenviar`, { method: 'POST' });
      avisar('O envio voltou para a fila.');
      carregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <Secao
      icone="link"
      titulo="Webhooks"
      descricao="Envia os dados dos leads, com telefone completo, para outros sistemas. Depois de 4 tentativas sem resposta, o webhook desliga sozinho."
      acoes={
        dados && dados.webhooks.length < dados.maximo && !edicao ? (
          <button type="button" class="kt-botao kt-botao-secundario" onClick={() => setEdicao('novo')}>
            <Icone nome="mais" tamanho={15} />
            Adicionar webhook
          </button>
        ) : undefined
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <Carregando />
      ) : (
        <>
          {edicao && (
            <Formulario
              key={edicao === 'novo' ? 'novo' : edicao.id}
              api={api}
              webhook={edicao === 'novo' ? null : edicao}
              cancelar={() => setEdicao(null)}
              concluir={() => {
                setEdicao(null);
                carregar();
              }}
            />
          )}
          {dados.webhooks.length === 0 && !edicao && <p class="kt-muted">Nenhum webhook configurado.</p>}
          <ul class="kt-webhooks">
            {dados.webhooks.map((w) => (
              <li key={w.id}>
                <div class="kt-webhook-topo">
                  <strong>{w.nome}</strong>
                  <span class={`kt-selo ${w.ativo ? 'kt-selo-ok' : 'kt-selo-erro'}`}>{w.ativo ? 'Ativo' : 'Desligado'}</span>
                  <span class="kt-linha-acoes">
                    <BotaoCopiar texto={w.segredo} rotulo="Copiar segredo" aoCopiar="Segredo copiado." />
                    <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setEdicao(w)}>
                      Editar
                    </button>
                    <button type="button" class="kt-botao kt-botao-perigo kt-botao-pequeno" aria-label={`Excluir ${w.nome}`} onClick={() => excluir(w)}>
                      <Icone nome="lixeira" tamanho={14} />
                    </button>
                  </span>
                </div>
                {w.motivoDesativado && <Aviso tipo="erro">{w.motivoDesativado}</Aviso>}
              </li>
            ))}
          </ul>
          {dados.webhooks.length > 0 && <p class="kt-muted">Cada envio leva o cabeçalho X-Kentro-Track-Assinatura: sha256 do corpo com o segredo do webhook.</p>}
          {dados.envios.length > 0 && (
            <details class="kt-sanfona">
              <summary>Últimos envios</summary>
              <div class="kt-tabela-rolagem">
                <table class="kt-tabela">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Webhook</th>
                      <th>Evento</th>
                      <th>Situação</th>
                      <th>Detalhe</th>
                      <th>
                        <span class="kt-invisivel">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.envios.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{e.webhook}</td>
                        <td>{EVENTO[e.evento] ?? e.evento}</td>
                        <td>{STATUS[e.status]}</td>
                        <td class="kt-celula-quebra">{e.erro ?? (e.respostaStatus ? `Resposta ${e.respostaStatus}` : '—')}</td>
                        <td>
                          {(e.status === 'erro' || e.status === 'descartado') && (
                            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => reenviar(e.id)}>
                              Reenviar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </Secao>
  );
}
