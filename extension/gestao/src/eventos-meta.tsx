import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Interruptor, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { inteiro } from '../../comum/formato';
import { avisar, type Omni } from '../../comum/omni';

type Gatilho = 'lead_recebido' | 'qualificado' | 'venda' | 'descartado';

interface Config {
  ativo: boolean;
  datasetId: string | null;
  datasetNome: string | null;
  tokenProprio: boolean;
  wabaId: string | null;
  codigoTeste: string | null;
  mapeamento: Record<Gatilho, string | null>;
}

interface Envios {
  ultimos30Dias: Partial<Record<'pendente' | 'enviado' | 'erro' | 'descartado', number>>;
  envios: { id: string; gatilho: Gatilho; evento: string; status: string; teste: boolean; tentativas: number; erro: string | null; lead: string | null; criadoEm: string; enviadoEm: string | null }[];
}

const GATILHOS: { id: Gatilho; rotulo: string; ajuda: string }[] = [
  { id: 'lead_recebido', rotulo: 'Lead chegou ao atendimento', ajuda: 'Só leads de anúncio de WhatsApp ou link (o formulário o Meta já conta).' },
  { id: 'qualificado', rotulo: 'Qualificado', ajuda: 'Botão Qualificado no painel ou evento da automação.' },
  { id: 'venda', rotulo: 'Venda', ajuda: 'Vai com o valor da venda. Venda direta também envia o Qualificado.' },
  { id: 'descartado', rotulo: 'Descartado', ajuda: 'Normalmente desligado.' },
];

/** Eventos padrão do Meta; "Outro" permite o nome personalizado que a conta já usa (ex.: do n8n). */
const PADRAO = ['Lead', 'QualifiedLead', 'Purchase', 'CompleteRegistration', 'Contact', 'Schedule', 'SubmitApplication'];

const STATUS: Record<string, string> = { pendente: 'Na fila', enviado: 'Recebido', erro: 'Erro', descartado: 'Descartado' };

function SeletorEvento({ valor, mudar }: { valor: string | null; mudar: (v: string | null) => void }) {
  const personalizado = valor !== null && !PADRAO.includes(valor);
  const [outro, setOutro] = useState(personalizado ? valor! : '');
  return (
    <span class="kt-linha-acoes kt-seletor-evento">
      <span class="kt-select">
      <select
        value={valor === null ? '' : personalizado ? '__outro' : valor}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          mudar(v === '' ? null : v === '__outro' ? outro || 'EventoKentro' : v);
        }}
      >
        <option value="">Não enviar</option>
        {PADRAO.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="__outro">Outro…</option>
      </select>
      </span>
      {personalizado && (
        <input
          value={outro}
          maxLength={50}
          aria-label="Nome do evento"
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value.replace(/[^A-Za-z0-9_]/g, '');
            setOutro(v);
            if (/^[A-Za-z]/.test(v)) mudar(v);
          }}
        />
      )}
    </span>
  );
}

function ListaEnvios({ api }: { api: Api }) {
  const [dados, setDados] = useState<Envios | null>(null);
  const [erro, setErro] = useState('');
  const carregar = () => api<Envios>('/v1/eventos/envios').then(setDados, (e) => setErro(mensagemDeErro(e)));
  useEffect(() => {
    void carregar();
  }, [api]);
  const reenviar = async (id: string) => {
    try {
      setDados(await api<Envios>(`/v1/eventos/envios/${id}/reenviar`, { method: 'POST' }));
      avisar('Evento volta para a fila e sai no próximo minuto.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  const c = dados.ultimos30Dias;
  return (
    <div class="kt-envios">
      <h3 class="kt-subtitulo">Últimos envios</h3>
      <p class="kt-muted">
        Últimos 30 dias: {inteiro(c.enviado ?? 0)} recebidos · {inteiro(c.pendente ?? 0)} na fila · {inteiro(c.erro ?? 0)} com erro{' '}
        <button type="button" class="kt-link" onClick={() => void carregar()}>
          Atualizar
        </button>
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.envios.length === 0 ? (
        <p class="kt-muted">Nenhum evento enviado ainda.</p>
      ) : (
        <div class="kt-tabela-rolagem">
          <table class="kt-tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Lead</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.envios.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    {e.evento}
                    {e.teste && <span class="kt-muted"> (teste)</span>}
                  </td>
                  <td>{e.lead ?? '—'}</td>
                  <td class="kt-celula-quebra">
                    <span class={`kt-selo ${e.status === 'enviado' ? 'kt-selo-ok' : e.status === 'erro' ? 'kt-selo-erro' : 'kt-selo-neutro'}`}>
                      <span class="kt-ponto" />
                      {STATUS[e.status] ?? e.status}
                    </span>
                    {e.erro && <span class="kt-muted"> {e.erro}</span>}
                  </td>
                  <td>
                    {e.status === 'erro' && (
                      <button type="button" class="kt-link" onClick={() => reenviar(e.id)}>
                        Reenviar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Configurações › Eventos para o Meta (API de Conversões). Substitui o envio que hoje é feito no n8n. */
export function EventosMeta({ omni, api }: { omni: Omni; api: Api }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [rascunho, setRascunho] = useState<Partial<Config> & { token?: string | null }>({});
  const [pixels, setPixels] = useState<{ id: string; nome: string; ultimoDisparo: string | null; contaAnuncio: string }[] | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState('');

  useEffect(() => {
    api<Config>('/v1/eventos/configuracao').then(setConfig, (e) => setErro(mensagemDeErro(e)));
  }, [api]);

  if (!config) {
    return (
      <Secao icone="raio" titulo="Eventos para o Meta">
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />}
      </Secao>
    );
  }

  const atual = { ...config, ...rascunho, mapeamento: { ...config.mapeamento, ...(rascunho.mapeamento ?? {}) } };
  const alterado = Object.keys(rascunho).length > 0;

  const buscarPixels = async () => {
    setErro('');
    try {
      setPixels((await api<{ pixels: NonNullable<typeof pixels> }>('/v1/eventos/pixels')).pixels);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  const salvar = async () => {
    setSalvando(true);
    setErro('');
    try {
      setConfig(await api<Config>('/v1/eventos/configuracao', { method: 'PUT', body: rascunho }));
      setRascunho({});
      avisar('Eventos para o Meta salvos.');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setErro('');
    try {
      const r = await api<{ eventosRecebidos: number; evento: string }>('/v1/eventos/testar', { method: 'POST', body: teste.trim() ? { codigoTeste: teste.trim() } : {} });
      await omni.ui
        .confirm({ title: 'Evento de teste enviado', message: `O Meta recebeu ${r.eventosRecebidos} evento "${r.evento}". Confira em Gerenciador de Eventos › Eventos de teste.`, okLabel: 'Ok' })
        .catch(() => undefined);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  };

  return (
    <Secao
      icone="raio"
      titulo="Eventos para o Meta"
      descricao="API de Conversões: o pixel fica sabendo quem virou lead qualificado e venda"
      acoes={
        <span class={`kt-selo ${config.ativo ? 'kt-selo-ok' : 'kt-selo-neutro'}`}>
          <span class="kt-ponto" />
          {config.ativo ? (config.codigoTeste ? 'Ligado em modo teste' : 'Ligado') : 'Desligado'}
        </span>
      }
    >
      <p>
        Quando o lead chega, é qualificado ou vira venda, o Kentro Track avisa o pixel pela API de Conversões. O Meta passa a otimizar as campanhas para
        quem compra, não só para quem chama.
      </p>
      <Aviso>
        Se este cliente já manda esses eventos por outra integração (ex.: o n8n), <strong>desligue a outra no mesmo dia</strong> em que ligar aqui: os
        ids dos eventos são diferentes e o Meta contaria em dobro.
      </Aviso>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Interruptor ligado={atual.ativo} mudar={(v) => setRascunho({ ...rascunho, ativo: v })}>
        Enviar eventos para o pixel
      </Interruptor>

      <h3 class="kt-subtitulo">Pixel</h3>
      <div class="kt-linha-acoes">
        <label class="kt-campo">
          <span>Id do pixel (conjunto de dados)</span>
          <input
            value={atual.datasetId ?? ''}
            inputMode="numeric"
            onInput={(e) => setRascunho({ ...rascunho, datasetId: (e.target as HTMLInputElement).value.replace(/\D/g, '') || null, datasetNome: null })}
          />
        </label>
        <button type="button" class="kt-botao kt-botao-secundario" onClick={buscarPixels}>
          Buscar pixels das contas de anúncio
        </button>
      </div>
      {atual.datasetNome && <p class="kt-muted">{atual.datasetNome}</p>}
      {pixels &&
        (pixels.length === 0 ? (
          <p class="kt-muted">O token não enxerga nenhum pixel nas contas selecionadas. Dê acesso ao pixel no Business Manager ou digite o id.</p>
        ) : (
          <ul class="kt-pixels">
            {pixels.map((p) => (
              <li key={p.id}>
                <button type="button" class="kt-link" onClick={() => setRascunho({ ...rascunho, datasetId: p.id, datasetNome: p.nome })}>
                  {p.nome}
                </button>
                <span class="kt-muted">
                  {' '}
                  {p.id} · {p.contaAnuncio}
                  {p.ultimoDisparo ? ` · último disparo ${new Date(p.ultimoDisparo).toLocaleDateString('pt-BR')}` : ' · nunca disparou'}
                </span>
              </li>
            ))}
          </ul>
        ))}

      <details class="kt-sanfona">
        <summary>Token próprio do pixel e WhatsApp Business (opcional)</summary>
        <p class="kt-muted">
          Sem token próprio, o envio usa o token da conexão (ele precisa de acesso ao pixel). Para usar o token gerado no Gerenciador de Eventos (o mesmo
          da integração antiga), cole aqui.
        </p>
        {config.tokenProprio && rascunho.token === undefined ? (
          <p>
            <span class="kt-selo kt-selo-ok">
              <Icone nome="check" tamanho={12} />
              Token próprio configurado
            </span>{' '}
            <button type="button" class="kt-link" onClick={() => setRascunho({ ...rascunho, token: null })}>
              Remover
            </button>
          </p>
        ) : (
          <label class="kt-campo">
            <span>Token de acesso do pixel</span>
            <textarea rows={2} spellcheck={false} value={rascunho.token ?? ''} onInput={(e) => setRascunho({ ...rascunho, token: (e.target as HTMLTextAreaElement).value || undefined })} />
          </label>
        )}
        <label class="kt-campo">
          <span>Id da conta do WhatsApp Business (WABA)</span>
          <input value={atual.wabaId ?? ''} inputMode="numeric" onInput={(e) => setRascunho({ ...rascunho, wabaId: (e.target as HTMLInputElement).value.replace(/\D/g, '') || null })} />
        </label>
        <p class="kt-muted">Com o WABA, quando a conversa traz o identificador do clique (ctwa_clid), o evento vai no modo de mensageria comercial, que o Meta atribui melhor.</p>
      </details>

      <h3 class="kt-subtitulo">O que cada etapa envia</h3>
      <table class="kt-tabela kt-mapeamento">
        <tbody>
          {GATILHOS.map((g) => (
            <tr key={g.id}>
              <th scope="row">
                {g.rotulo}
                <div class="kt-muted">{g.ajuda}</div>
              </th>
              <td>
                <SeletorEvento valor={atual.mapeamento[g.id]} mudar={(v) => setRascunho({ ...rascunho, mapeamento: { ...atual.mapeamento, [g.id]: v } })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 class="kt-subtitulo">Testar</h3>
      <div class="kt-linha-acoes">
        <label class="kt-campo">
          <span>Código de teste (Gerenciador de Eventos › Eventos de teste)</span>
          <input value={teste} placeholder={config.codigoTeste ?? 'TEST12345'} onInput={(e) => setTeste((e.target as HTMLInputElement).value)} />
        </label>
        <button type="button" class="kt-botao kt-botao-secundario" disabled={!config.datasetId} onClick={testar}>
          <Icone nome="teste" tamanho={15} />
          Enviar evento de teste
        </button>
      </div>
      <Interruptor ligado={!!atual.codigoTeste} mudar={(v) => setRascunho({ ...rascunho, codigoTeste: v ? teste.trim() || config.codigoTeste || null : null })}>
        Modo teste: todos os eventos vão com o código acima e não contam nas campanhas
      </Interruptor>

      <div class="kt-linha-acoes" style={{ margin: '12px 0 16px' }}>
        <button type="button" class="kt-botao" disabled={!alterado || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        {alterado && (
          <button type="button" class="kt-botao kt-botao-secundario" onClick={() => setRascunho({})}>
            Desfazer
          </button>
        )}
      </div>

      <ListaEnvios api={api} />
    </Secao>
  );
}
