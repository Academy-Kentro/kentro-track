import { useEffect, useState } from 'preact/hooks';
import { mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando, Secao } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';

interface Envio {
  id: string;
  nome: string | null;
  telefone: string | null;
  status: 'pendente' | 'enviado' | 'erro' | 'descartado';
  tentativas: number;
  respostaStatus: number | null;
  erro: string | null;
  criadoEm: string;
}

interface Dados {
  url: string | null;
  segredo: string;
  envios: Envio[];
}

const STATUS: Record<Envio['status'], string> = { pendente: 'Na fila', enviado: 'Entregue', erro: 'Erro', descartado: 'Não enviado' };
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Configurações › Webhook de leads: cada lead de campanha vai para o endereço que o cliente cadastrar. */
export function Webhooks({ api }: { api: Api }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | null>(null);

  const carregar = () => api<Dados>('/v1/webhooks').then(setDados, (e) => setErro(mensagemDeErro(e)));
  useEffect(() => {
    carregar();
  }, [api]);

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
  const salvar = () =>
    executar('salvar', async () => {
      setDados(await api<Dados>('/v1/webhooks', { method: 'PUT', body: { url: (url ?? '').trim() || null } }));
      setUrl(undefined);
      avisar('Webhook salvo.');
    });
  const testar = () =>
    executar('testar', async () => {
      await api('/v1/webhooks/testar', { method: 'POST', body: { url: urlAtual.trim() } });
      avisar('Lead de teste enviado. Confira no seu sistema.');
    });
  const reenviar = (id: string) =>
    executar('salvar', async () => {
      await api(`/v1/webhooks/envios/${id}/reenviar`, { method: 'POST' });
      await carregar();
      avisar('O lead volta para a fila e sai no próximo minuto.');
    });

  const urlAtual = url ?? dados?.url ?? '';
  const alterado = url !== undefined && url.trim() !== (dados?.url ?? '');

  return (
    <Secao
      icone="link"
      titulo="Webhook de leads"
      descricao="Cada lead que chega de campanha (anúncio, formulário do Meta ou link rastreável) é enviado para este endereço, com telefone completo, e o seu sistema faz o que quiser com ele."
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <Carregando />
      ) : (
        <>
          <div class="kt-linha-acoes">
            <label class="kt-campo kt-campo-largo">
              <span>Endereço do webhook</span>
              <input value={urlAtual} type="url" placeholder="https://" spellcheck={false} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
            </label>
            <button type="button" class="kt-botao kt-botao-secundario" disabled={!urlAtual.trim() || ocupado !== null} onClick={testar}>
              <Icone nome="teste" tamanho={15} />
              {ocupado === 'testar' ? 'Enviando…' : 'Enviar lead de teste'}
            </button>
          </div>
          <p class="kt-muted">
            Cada lead sai uma vez, em JSON: <code>nome</code>, <code>telefone</code>, <code>email</code>, <code>origem</code>, <code>campanha</code>, <code>conjunto</code>, <code>anuncio</code>,{' '}
            <code>formulario</code>, <code>respostas_texto</code>, <code>utm_source</code>… Numa captura de webhook da Kentro, eles viram <code>capture_nome</code>, <code>capture_telefone</code>…
          </p>
          <div class="kt-linha-acoes" style={{ margin: '14px 0 16px' }}>
            <button type="button" class="kt-botao" disabled={!alterado || ocupado !== null} onClick={salvar}>
              {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
            </button>
            {dados.url && <BotaoCopiar texto={dados.segredo} rotulo="Copiar segredo" aoCopiar="Segredo copiado." />}
          </div>
          {dados.url && <p class="kt-muted">Para conferir a origem, cada envio leva o cabeçalho X-Kentro-Track-Assinatura: sha256 do corpo com este segredo.</p>}
          {dados.envios.length > 0 && (
            <>
              <h3 class="kt-subtitulo">Últimos leads enviados</h3>
              <div class="kt-tabela-rolagem">
                <table class="kt-tabela">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Lead</th>
                      <th>Situação</th>
                      <th>
                        <span class="kt-invisivel">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.envios.map((e) => (
                      <tr key={e.id}>
                        <td>{quando(e.criadoEm)}</td>
                        <td>
                          {e.nome ?? '—'}
                          {e.telefone && <div class="kt-muted">{e.telefone}</div>}
                        </td>
                        <td class="kt-celula-quebra">
                          <span class={`kt-selo ${e.status === 'enviado' ? 'kt-selo-ok' : e.status === 'erro' ? 'kt-selo-erro' : 'kt-selo-neutro'}`}>
                            <span class="kt-ponto" />
                            {STATUS[e.status]}
                          </span>
                          {e.erro && e.status !== 'enviado' && <span class="kt-muted"> {e.erro}</span>}
                        </td>
                        <td>
                          {e.status === 'erro' && (
                            <button type="button" class="kt-link" disabled={ocupado !== null} onClick={() => reenviar(e.id)}>
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
        </>
      )}
    </Secao>
  );
}
