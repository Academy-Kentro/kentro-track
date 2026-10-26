import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Interruptor, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';

interface Formulario {
  id: string;
  idMeta: string;
  nome: string;
  status: string | null;
  pagina: string;
  selecionado: boolean;
  perguntas: string[];
  ultimaLeituraEm: string | null;
  ultimoErro: string | null;
  leads30Dias: number;
}

interface Envio {
  leadId: string;
  nome: string | null;
  telefone: string | null;
  formulario: string | null;
  recebidoEm: string;
  status: 'pendente' | 'enviado' | 'erro' | 'descartado';
  tentativas: number;
  erro: string | null;
}

interface Dados {
  conectado: boolean;
  permissoesFaltando: string[];
  capturaKentroUrl: string | null;
  formularios: Formulario[];
  envios: Envio[];
  avisos?: string[];
}

const STATUS: Record<Envio['status'], string> = { pendente: 'Na fila', enviado: 'Na Kentro', erro: 'Erro', descartado: 'Não enviado' };
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Configurações › Formulários do Meta: cada lead de formulário vira uma oportunidade no CRM da Kentro. */
export function FormulariosMeta({ api }: { api: Api }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [selecao, setSelecao] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<'buscar' | 'salvar' | 'testar' | null>(null);

  const receber = (d: Dados) => {
    setDados(d);
    setUrl(undefined);
    setSelecao({});
  };
  useEffect(() => {
    api<Dados>('/v1/formularios').then(receber, (e) => setErro(mensagemDeErro(e)));
  }, [api]);

  if (!dados) {
    return (
      <Secao icone="formulario" titulo="Formulários do Meta">
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />}
      </Secao>
    );
  }

  const executar = async (qual: NonNullable<typeof ocupado>, acao: () => Promise<void>) => {
    setOcupado(qual);
    setErro('');
    try {
      await acao();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(null);
    }
  };
  const buscar = () =>
    executar('buscar', async () => {
      const d = await api<Dados>('/v1/formularios/buscar', { method: 'POST' });
      // A busca não mexe no que ainda não foi salvo.
      setDados(d);
    });
  const salvar = () =>
    executar('salvar', async () => {
      const corpo = {
        ...(url !== undefined ? { capturaKentroUrl: url.trim() || null } : {}),
        formularios: Object.entries(selecao).map(([id, selecionado]) => ({ id, selecionado })),
      };
      receber(await api<Dados>('/v1/formularios', { method: 'PUT', body: corpo }));
      avisar('Formulários salvos.');
    });
  const testar = () =>
    executar('testar', async () => {
      await api('/v1/formularios/testar-envio', { method: 'POST', body: { url: (url ?? dados.capturaKentroUrl ?? '').trim() } });
      avisar('Lead de teste enviado. Confira a oportunidade no CRM da Kentro.');
    });
  const reenviar = (leadId: string) =>
    executar('salvar', async () => {
      setDados(await api<Dados>(`/v1/formularios/envios/${leadId}/reenviar`, { method: 'POST' }));
      avisar('O lead volta para a fila e sai no próximo minuto.');
    });

  const urlAtual = url ?? dados.capturaKentroUrl ?? '';
  const alterado = url !== undefined || Object.keys(selecao).length > 0;
  const selecionado = (f: Formulario) => selecao[f.id] ?? f.selecionado;
  const paginas = [...new Set(dados.formularios.map((f) => f.pagina))];

  return (
    <Secao
      icone="formulario"
      titulo="Formulários do Meta"
      descricao="Cada lead de formulário de cadastro vira uma oportunidade no CRM da Kentro, com as respostas preenchidas."
    >
      {!dados.conectado && <Aviso>Conecte o Meta acima para buscar os formulários.</Aviso>}
      {dados.permissoesFaltando.length > 0 && (
        <Aviso tipo="erro">
          O token da conexão não tem {dados.permissoesFaltando.join(', ')}. Sem elas o Meta não entrega os leads: gere o token de novo com essas
          permissões e reconecte.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.avisos?.map((a) => (
        <Aviso key={a}>{a}</Aviso>
      ))}

      <h3 class="kt-subtitulo">1. Onde o lead entra na Kentro</h3>
      <p class="kt-muted">
        Na Kentro, crie uma <strong>captura de webhook</strong> ligada à automação que cria a oportunidade e cole o endereço dela aqui. Cada campo do lead
        chega na automação como variável: <code>capture_nome</code>, <code>capture_telefone</code>, <code>capture_email</code>,{' '}
        <code>capture_respostas_texto</code>, <code>capture_campanha</code>…
      </p>
      <div class="kt-linha-acoes">
        <label class="kt-campo kt-campo-largo">
          <span>Endereço da captura</span>
          <input value={urlAtual} placeholder="https://suaempresa.atenderbem.com/webhookcapture/capture/…" spellcheck={false} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
        </label>
        <button type="button" class="kt-botao kt-botao-secundario" disabled={!urlAtual.trim() || ocupado !== null} onClick={testar}>
          <Icone nome="teste" tamanho={15} />
          {ocupado === 'testar' ? 'Enviando…' : 'Enviar lead de teste'}
        </button>
      </div>

      <h3 class="kt-subtitulo">2. Quais formulários</h3>
      <p class="kt-muted">Só os leads que chegarem depois de ligar o formulário entram (os antigos não viram oportunidade). A leitura é a cada 2 minutos.</p>
      <button type="button" class="kt-botao kt-botao-secundario" disabled={!dados.conectado || ocupado !== null} onClick={buscar}>
        <Icone nome="atualizar" tamanho={15} />
        {ocupado === 'buscar' ? 'Buscando…' : dados.formularios.length ? 'Atualizar lista de formulários' : 'Buscar formulários no Meta'}
      </button>
      {paginas.map((pagina) => (
        <div key={pagina} class="kt-formularios-pagina">
          <h4>{pagina}</h4>
          <ul class="kt-formularios">
            {dados.formularios
              .filter((f) => f.pagina === pagina)
              .map((f) => (
                <li key={f.id}>
                  <Interruptor ligado={selecionado(f)} mudar={(v) => setSelecao({ ...selecao, [f.id]: v })}>
                    <strong>{f.nome}</strong>
                    {f.status && f.status !== 'ACTIVE' && <span class="kt-selo kt-selo-neutro">{f.status === 'ARCHIVED' ? 'Arquivado' : f.status}</span>}
                  </Interruptor>
                  <p class="kt-muted">
                    {f.perguntas.length} pergunta{f.perguntas.length === 1 ? '' : 's'} · {f.leads30Dias} lead{f.leads30Dias === 1 ? '' : 's'} em 30 dias
                    {f.selecionado && f.ultimaLeituraEm && ` · lido às ${new Date(f.ultimaLeituraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                  {f.selecionado && f.ultimoErro && <p class="kt-erro-texto">{f.ultimoErro}</p>}
                </li>
              ))}
          </ul>
        </div>
      ))}

      <div class="kt-linha-acoes" style={{ margin: '14px 0 16px' }}>
        <button type="button" class="kt-botao" disabled={!alterado || ocupado !== null} onClick={salvar}>
          {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
        </button>
        {alterado && (
          <button type="button" class="kt-link" onClick={() => receber(dados)}>
            Descartar mudanças
          </button>
        )}
      </div>

      {dados.envios.length > 0 && (
        <>
          <h3 class="kt-subtitulo">Últimos leads enviados à Kentro</h3>
          <div class="kt-tabela-rolagem">
            <table class="kt-tabela">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Lead</th>
                  <th>Formulário</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dados.envios.map((e) => (
                  <tr key={e.leadId}>
                    <td>{quando(e.recebidoEm)}</td>
                    <td>
                      {e.nome ?? '—'}
                      {e.telefone && <div class="kt-muted">{e.telefone}</div>}
                    </td>
                    <td>{e.formulario ?? '—'}</td>
                    <td class="kt-celula-quebra">
                      <span class={`kt-selo ${e.status === 'enviado' ? 'kt-selo-ok' : e.status === 'erro' ? 'kt-selo-erro' : 'kt-selo-neutro'}`}>
                        <span class="kt-ponto" />
                        {STATUS[e.status]}
                      </span>
                      {e.erro && e.status !== 'enviado' && <span class="kt-muted"> {e.erro}</span>}
                    </td>
                    <td>
                      {(e.status === 'erro' || e.status === 'descartado') && (
                        <button type="button" class="kt-link" disabled={ocupado !== null} onClick={() => reenviar(e.leadId)}>
                          Reenviar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Secao>
  );
}
