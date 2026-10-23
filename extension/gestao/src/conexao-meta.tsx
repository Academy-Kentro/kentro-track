import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { haQuanto } from '../../comum/formato';
import { avisar, type Omni } from '../../comum/omni';
import type { ContaAnuncio, DefinicaoLead, EstadoConexao } from './tipos';

const DEFINICOES: { id: DefinicaoLead; rotulo: string }[] = [
  { id: 'formulario', rotulo: 'Formulário de lead' },
  { id: 'conversa', rotulo: 'Conversa iniciada (WhatsApp/Messenger)' },
  { id: 'site', rotulo: 'Lead no site (pixel)' },
];

/** Com carga em andamento, a tela se atualiza sozinha (3 chamadas por minuto, longe do limite de 30). */
const ATUALIZAR_MS = 20_000;

function FormularioToken({ api, aoConectar, cancelar }: { api: Api; aoConectar: (e: EstadoConexao) => void; cancelar?: () => void }) {
  const [token, setToken] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const enviar = async () => {
    setEnviando(true);
    setErro('');
    try {
      const estado = await api<EstadoConexao>('/v1/meta/token-manual', { method: 'PUT', body: { token: token.replace(/\s+/g, '') } });
      setToken('');
      aoConectar(estado);
      avisar('Meta conectado.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div>
      <ol class="kt-passos">
        <li>
          No Business Manager do cliente, abra <em>Configurações do negócio › Usuários › Usuários do sistema</em> e crie (ou escolha) um usuário do
          sistema.
        </li>
        <li>
          Em <em>Atribuir ativos</em>, dê acesso às <strong>contas de anúncio</strong> (e ao pixel, se for usar eventos depois).
        </li>
        <li>
          Clique em <em>Gerar token</em>, marque a permissão <strong>ads_read</strong> e copie o token.
        </li>
      </ol>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <label class="kt-campo">
        <span>Token de usuário do sistema</span>
        <textarea rows={3} value={token} autoComplete="off" spellcheck={false} onInput={(e) => setToken((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={enviando || token.trim().length < 20} onClick={enviar}>
          {enviando ? 'Conferindo no Meta…' : 'Conectar'}
        </button>
        {cancelar && (
          <button type="button" class="kt-botao kt-botao-secundario" onClick={cancelar}>
            Cancelar
          </button>
        )}
      </div>
      <p class="kt-muted" style={{ marginTop: '8px' }}>
        O token é conferido no Meta e guardado cifrado. Ninguém consegue lê-lo de volta, nem por esta tela.
      </p>
    </div>
  );
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function SituacaoConta({ c }: { c: ContaAnuncio }) {
  const s = c.sincronizacao;
  if (!c.selecionada) return null;
  if (s.limitadaAte) {
    const progresso = !s.cargaConcluidaEm && s.diasCarregados ? ` Já carregados: ${s.diasCarregados} de 90 dias.` : '';
    return (
      <span class="kt-muted">
        {s.ultimoErro ?? 'Pausada para não estourar o limite de consultas do Meta.'} Nova tentativa às {hora(s.limitadaAte)}.{progresso}
      </span>
    );
  }
  if (s.ultimoErro) return <span class="kt-delta kt-delta-ruim">Erro: {s.ultimoErro}</span>;
  if (!s.cargaConcluidaEm) {
    const progresso = s.diasCarregados ? ` (${s.diasCarregados} de 90 dias, do mais recente para trás)` : '';
    return <span class="kt-muted">{s.emAndamento || s.diasCarregados ? `Carregando os últimos 90 dias…${progresso}` : 'Na fila para carregar os últimos 90 dias.'}</span>;
  }
  return <span class="kt-muted">Atualizada {haQuanto(s.ultimaEm)}.</span>;
}

function ListaContas({ api, estado, mudar }: { api: Api; estado: Extract<EstadoConexao, { conectado: true }>; mudar: (e: EstadoConexao) => void }) {
  const [rascunho, setRascunho] = useState<Record<string, { selecionada: boolean; definicaoLead: DefinicaoLead[] }>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const atual = (c: ContaAnuncio) => rascunho[c.id] ?? { selecionada: c.selecionada, definicaoLead: c.definicaoLead };
  const editar = (c: ContaAnuncio, mudanca: Partial<{ selecionada: boolean; definicaoLead: DefinicaoLead[] }>) =>
    setRascunho((r) => ({ ...r, [c.id]: { ...atual(c), ...mudanca } }));
  const alterado = Object.keys(rascunho).length > 0;

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const contas = Object.entries(rascunho).map(([id, v]) => ({ id, ...v }));
      mudar(await api<EstadoConexao>('/v1/meta/contas-anuncio', { method: 'PUT', body: { contas } }));
      setRascunho({});
      avisar('Contas de anúncio salvas.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const sincronizar = async (c: ContaAnuncio) => {
    try {
      mudar(await api<EstadoConexao>(`/v1/meta/contas-anuncio/${c.id}/sincronizar`, { method: 'POST' }));
      avisar('Sincronização agendada para o próximo minuto.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <div>
      <h3 class="kt-subtitulo">Contas de anúncio</h3>
      <p class="kt-muted">Marque as que entram nos painéis. Ao marcar uma conta, os últimos 90 dias são carregados (pode levar alguns minutos).</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ul class="kt-contas-anuncio">
        {estado.contasAnuncio.map((c) => {
          const v = atual(c);
          return (
            <li key={c.id} class={v.selecionada ? 'kt-selecionada' : ''}>
              <label class="kt-conta-topo">
                <input type="checkbox" checked={v.selecionada} onChange={(e) => editar(c, { selecionada: (e.target as HTMLInputElement).checked })} />
                <span>
                  <strong>{c.nome}</strong>
                  <span class="kt-muted">
                    {' '}
                    {c.idMeta.replace('act_', '')} · {c.moeda}
                    {c.empresa ? ` · ${c.empresa}` : ''}
                    {c.ativaNoMeta ? '' : ' · inativa no Meta'}
                  </span>
                </span>
              </label>
              {v.selecionada && (
                <div class="kt-conta-detalhe">
                  <fieldset class="kt-definicao">
                    <legend>O que conta como lead (para o CPL)</legend>
                    {DEFINICOES.map((d) => (
                      <label key={d.id}>
                        <input
                          type="checkbox"
                          checked={v.definicaoLead.includes(d.id)}
                          onChange={(e) =>
                            editar(c, {
                              definicaoLead: (e.target as HTMLInputElement).checked ? [...v.definicaoLead, d.id] : v.definicaoLead.filter((x) => x !== d.id),
                            })
                          }
                        />{' '}
                        {d.rotulo}
                      </label>
                    ))}
                  </fieldset>
                  <div class="kt-linha-acoes">
                    <SituacaoConta c={c} />
                    {c.selecionada && c.sincronizacao.cargaConcluidaEm && !c.sincronizacao.limitadaAte && (
                      <button type="button" class="kt-link" onClick={() => sincronizar(c)}>
                        Sincronizar agora
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={!alterado || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        {alterado && (
          <button type="button" class="kt-botao kt-botao-secundario" onClick={() => setRascunho({})}>
            Desfazer
          </button>
        )}
      </div>
    </div>
  );
}

export function ConexaoMeta({ omni, api }: { omni: Omni; api: Api }) {
  const [estado, setEstado] = useState<EstadoConexao | null>(null);
  const [erro, setErro] = useState('');
  const [trocandoToken, setTrocandoToken] = useState(false);

  const carregar = () =>
    api<EstadoConexao>('/v1/meta/conexao').then(
      (e) => {
        setEstado(e);
        setErro('');
      },
      (e) => setErro(mensagemDeErro(e)),
    );

  useEffect(() => {
    void carregar();
  }, [api]);

  const carregando = estado?.conectado && estado.contasAnuncio.some((c) => c.selecionada && !c.sincronizacao.cargaConcluidaEm);
  useEffect(() => {
    if (!carregando) return;
    const relogio = setInterval(() => void carregar(), ATUALIZAR_MS);
    return () => clearInterval(relogio);
  }, [carregando, api]);

  const desconectar = async () => {
    const r = await omni.ui
      .confirm({
        title: 'Desconectar o Meta',
        message: 'O token é apagado e a sincronização para. Os números já carregados continuam nos painéis.',
        okLabel: 'Desconectar',
      })
      .catch(() => ({ confirmed: false }));
    if (!r.confirmed) return;
    try {
      setEstado(await api<EstadoConexao>('/v1/meta/conexao', { method: 'DELETE' }));
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  const aoConectar = (e: EstadoConexao) => {
    setEstado(e);
    setTrocandoToken(false);
  };

  const conectado = estado?.conectado && estado.status === 'ativa' && !trocandoToken;
  return (
    <Secao
      icone="tomada"
      titulo="Conexão com o Meta"
      descricao="Token de usuário do sistema do Business Manager do cliente"
      acoes={
        conectado ? (
          <>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setTrocandoToken(true)}>
              <Icone nome="chave" tamanho={14} />
              Trocar token
            </button>
            <button type="button" class="kt-botao kt-botao-perigo kt-botao-pequeno" onClick={desconectar}>
              Desconectar
            </button>
          </>
        ) : undefined
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!estado ? (
        !erro && <Carregando />
      ) : !estado.conectado ? (
        <>
          <p>Conecte o Business Manager do cliente para trazer campanhas, investimento e leads.</p>
          <FormularioToken api={api} aoConectar={aoConectar} />
        </>
      ) : (
        <>
          {estado.status === 'reconectar' ? (
            <Aviso tipo="erro">
              O Meta deixou de aceitar o token{estado.ultimoErro ? ` (${estado.ultimoErro})` : ''}. A sincronização está parada: gere um token novo e
              conecte de novo.
            </Aviso>
          ) : (
            <div class="kt-conexao-status">
              <span class="kt-conexao-icone">
                <Icone nome="check" tamanho={16} />
              </span>
              <div>
                <strong>Conectado</strong>
                <div class="kt-muted">
                  como {estado.usuarioMeta} · conferido {haQuanto(estado.verificadoEm)}
                </div>
              </div>
            </div>
          )}
          {(estado.avisos ?? []).map((a) => (
            <Aviso key={a} tipo="erro">
              {a}
            </Aviso>
          ))}
          {(trocandoToken || estado.status === 'reconectar') && (
            <FormularioToken api={api} aoConectar={aoConectar} cancelar={estado.status === 'reconectar' ? undefined : () => setTrocandoToken(false)} />
          )}
          {estado.status === 'ativa' && <ListaContas api={api} estado={estado} mudar={setEstado} />}
        </>
      )}
    </Secao>
  );
}
