import { useState } from 'preact/hooks';
import { mensagemDeErro, type Api } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando, Interruptor, Secao, Vazio } from '../../comum/componentes';
import { dinheiro, inteiro } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';
import { useDados } from './filtro';

interface Link {
  id: string;
  nome: string;
  telefone: string;
  mensagem: string;
  computadorWeb: boolean;
  tituloEspera: string;
  mensagemEspera: string;
  codigoVisivel: boolean;
  ativo: boolean;
  url: string;
  urlDireta: string;
  visitas: number;
  conversas: number;
  vendas: number;
  receita: number;
}

interface DadosLinks {
  pixel: string;
  parametrosMeta: string;
  itens: Link[];
}

type Rascunho = Pick<Link, 'nome' | 'telefone' | 'mensagem' | 'computadorWeb' | 'tituloEspera' | 'mensagemEspera' | 'codigoVisivel' | 'ativo'>;

const NOVO: Rascunho = {
  nome: '',
  telefone: '',
  mensagem: '',
  computadorWeb: true,
  tituloEspera: 'Por favor, aguarde alguns segundos.',
  mensagemEspera: 'Estamos localizando um atendente disponível…',
  codigoVisivel: false,
  ativo: true,
};

function Formulario({ api, link, concluir, cancelar }: { api: Api; link: Link | null; concluir: () => void; cancelar: () => void }) {
  const [d, setD] = useState<Rascunho>(link ?? NOVO);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const campo = <K extends keyof Rascunho>(chave: K, valor: Rascunho[K]) => setD({ ...d, [chave]: valor });
  const salvar = async () => {
    setSalvando(true);
    setErro('');
    const { nome, telefone, mensagem, computadorWeb, tituloEspera, mensagemEspera, codigoVisivel, ativo } = d;
    try {
      await api(link ? `/v1/links/${link.id}` : '/v1/links', {
        method: link ? 'PUT' : 'POST',
        body: { nome, telefone, mensagem, computadorWeb, tituloEspera, mensagemEspera, codigoVisivel, ativo },
      });
      avisar(link ? 'Link salvo.' : 'Link criado.');
      concluir();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Secao icone="link" titulo={link ? `Editar ${link.nome}` : 'Novo link rastreável'}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <label class="kt-campo">
        <span>Nome do link</span>
        <input value={d.nome} maxLength={80} placeholder="Ex.: Botão do site" onInput={(e) => campo('nome', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="kt-campo">
        <span>WhatsApp de atendimento</span>
        <input value={d.telefone} inputMode="tel" placeholder="5538999990000" onInput={(e) => campo('telefone', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="kt-campo">
        <span>Mensagem que já vem escrita</span>
        <textarea rows={2} value={d.mensagem} maxLength={500} placeholder="Olá! Quero saber mais." onInput={(e) => campo('mensagem', (e.target as HTMLTextAreaElement).value)} />
        <span class="kt-campo-ajuda kt-muted">O código da visita vai junto, invisível. Se a pessoa apagar a mensagem, a conversa fica sem rastreio.</span>
      </label>
      <label class="kt-campo">
        <span>Título da página de espera</span>
        <input value={d.tituloEspera} maxLength={80} onInput={(e) => campo('tituloEspera', (e.target as HTMLInputElement).value)} />
      </label>
      <label class="kt-campo">
        <span>Texto da página de espera</span>
        <input value={d.mensagemEspera} maxLength={200} onInput={(e) => campo('mensagemEspera', (e.target as HTMLInputElement).value)} />
      </label>
      <div class="kt-etapa-chaves kt-link-chaves">
        <Interruptor ligado={d.computadorWeb} mudar={(v) => campo('computadorWeb', v)}>
          No computador, abrir o WhatsApp Web
        </Interruptor>
        <Interruptor ligado={d.codigoVisivel} mudar={(v) => campo('codigoVisivel', v)}>
          Código visível na mensagem
        </Interruptor>
        <Interruptor ligado={d.ativo} mudar={(v) => campo('ativo', v)}>
          Ativo
        </Interruptor>
      </div>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={salvando || !d.nome.trim() || !d.telefone.trim() || !d.mensagem.trim()} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar link'}
        </button>
        <button type="button" class="kt-botao kt-botao-fantasma" disabled={salvando} onClick={cancelar}>
          Cancelar
        </button>
      </div>
    </Secao>
  );
}

/** Links que levam ao WhatsApp e dizem de onde a conversa veio, com o pixel para o site. */
export function Links({ api, podeEditar }: { api: Api; podeEditar: boolean }) {
  const carga = useDados<DadosLinks>(api, '/v1/links');
  const { dados, erro } = carga;
  const [edicao, setEdicao] = useState<Link | 'novo' | null>(null);

  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  return (
    <div>
      {edicao && (
        <Formulario
          key={edicao === 'novo' ? 'novo' : edicao.id}
          api={api}
          link={edicao === 'novo' ? null : edicao}
          cancelar={() => setEdicao(null)}
          concluir={() => {
            setEdicao(null);
            carga.recarregar?.();
          }}
        />
      )}
      <Secao
        icone="link"
        titulo="Links rastreáveis"
        descricao="Para campanhas, site e redes sociais. Conta visitas, conversas e vendas de cada link."
        acoes={
          podeEditar && (
            <button type="button" class="kt-botao kt-botao-secundario" onClick={() => setEdicao('novo')}>
              <Icone nome="mais" tamanho={15} />
              Novo link
            </button>
          )
        }
      >
        {dados.itens.length === 0 ? (
          <Vazio icone="link" titulo="Nenhum link criado ainda">
            <p>Crie um link e use no anúncio ou no botão de WhatsApp do site.</p>
          </Vazio>
        ) : (
          <div class="kt-tabela-rolagem">
            <table class="kt-tabela">
              <thead>
                <tr>
                  <th>Link</th>
                  <th class="kt-num">Visitas</th>
                  <th class="kt-num">Conversas</th>
                  <th class="kt-num">Vendas</th>
                  <th class="kt-num">Receita</th>
                  <th>Endereços</th>
                  {podeEditar && (
                    <th>
                      <span class="kt-invisivel">Ações</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((l) => (
                  <tr key={l.id} class={l.ativo ? '' : 'kt-linha-apagada'}>
                    <td>
                      <strong>{l.nome}</strong>
                      {!l.ativo && <span class="kt-muted"> · desativado</span>}
                    </td>
                    <td class="kt-num">{inteiro(l.visitas)}</td>
                    <td class="kt-num">{inteiro(l.conversas)}</td>
                    <td class="kt-num">{inteiro(l.vendas)}</td>
                    <td class="kt-num">{dinheiro(l.receita)}</td>
                    <td>
                      <span class="kt-linha-acoes">
                        <BotaoCopiar texto={l.url} rotulo="Para anúncio" aoCopiar="Endereço para anúncio copiado." />
                        <BotaoCopiar texto={l.urlDireta} rotulo="Para site" aoCopiar="Endereço para site copiado." />
                      </span>
                    </td>
                    {podeEditar && (
                      <td>
                        <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setEdicao(l)}>
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
      <Secao icone="raio" titulo="Pixel para o site" descricao="Guarda de onde o visitante veio (UTM, gclid, fbclid) e leva esses dados para os links rastreáveis da página.">
        <pre class="kt-json">{dados.pixel}</pre>
        <div class="kt-linha-acoes">
          <BotaoCopiar texto={dados.pixel} rotulo="Copiar o código" aoCopiar="Código do pixel copiado." />
        </div>
        <p class="kt-muted">Cole logo depois de abrir o &lt;body&gt;. Ele guarda só os parâmetros da URL no navegador do visitante, por 90 dias. Confira se a política de cookies do site cobre isso.</p>
      </Secao>
      <Secao icone="megafone" titulo="Parâmetros para o anúncio do Meta" descricao="Cole em Parâmetros de URL. O fbid liga cada lead ao anúncio exato.">
        <pre class="kt-json">{dados.parametrosMeta}</pre>
        <div class="kt-linha-acoes">
          <BotaoCopiar texto={dados.parametrosMeta} rotulo="Copiar os parâmetros" aoCopiar="Parâmetros copiados." />
        </div>
      </Secao>
    </div>
  );
}
