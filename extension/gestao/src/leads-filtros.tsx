import { useEffect, useState } from 'preact/hooks';
import type { Api } from '../../comum/api';
import { Aviso, Secao } from '../../comum/componentes';
import { avisar, type Omni } from '../../comum/omni';
import { useDados } from './filtro';
import { FILTRO_LEADS_PADRAO, type FiltroLeads } from './leads-comum';

interface Opcao {
  id: string;
  nome: string;
}

interface OpcoesLeads {
  conjuntos: Opcao[];
  anuncios: Opcao[];
  atendentes: Opcao[];
  links?: Opcao[];
  utmSource?: string[];
  utmMedium?: string[];
  utmCampaign?: string[];
}

export interface FiltroSalvo {
  nome: string;
  filtro: FiltroLeads;
}

/** Em omni.storage, como o filtro da barra de cima: é do usuário, e não ocupa a API. */
const CHAVE_SALVOS = 'filtros-leads';
const MAX_SALVOS = 20;

export function useFiltrosSalvos(omni: Omni) {
  const [salvos, setSalvos] = useState<FiltroSalvo[]>([]);
  useEffect(() => {
    omni.storage.get(CHAVE_SALVOS).then(
      (lido) => Array.isArray(lido) && setSalvos(lido as FiltroSalvo[]),
      () => {},
    );
  }, [omni]);
  const gravar = (lista: FiltroSalvo[]) => {
    setSalvos(lista);
    omni.storage.set(CHAVE_SALVOS, lista).catch(() => avisar('Não foi possível guardar o filtro neste navegador.', 'error'));
  };
  return {
    salvos,
    // Mesmo nome substitui: é assim que se atualiza um filtro salvo.
    salvar: (nome: string, filtro: FiltroLeads) => gravar([{ nome, filtro: { ...filtro, pagina: 1 } }, ...salvos.filter((s) => s.nome !== nome)].slice(0, MAX_SALVOS)),
    remover: (nome: string) => gravar(salvos.filter((s) => s.nome !== nome)),
  };
}

export function PainelFiltros({
  api,
  q,
  filtro,
  mudar,
  salvar,
  fechar,
}: {
  api: Api;
  q: string;
  filtro: FiltroLeads;
  mudar: (f: FiltroLeads) => void;
  salvar: (nome: string, f: FiltroLeads) => void;
  fechar: () => void;
}) {
  const opcoes = useDados<OpcoesLeads>(api, `/v1/painel/leads/opcoes?${q}`);
  const [rascunho, setRascunho] = useState<FiltroLeads>(filtro);
  const [nome, setNome] = useState('');
  const campo = <K extends keyof FiltroLeads>(chave: K, valor: FiltroLeads[K]) => setRascunho({ ...rascunho, [chave]: valor });

  const lista = (rotulo: string, chave: 'conjunto' | 'anuncio' | 'atendente', itens: Opcao[] | undefined, extra?: { id: string; nome: string }) => (
    <label class="kt-campo">
      <span>{rotulo}</span>
      <select value={rascunho[chave] ?? ''} onChange={(e) => campo(chave, (e.target as HTMLSelectElement).value)}>
        <option value="">Todos</option>
        {extra && <option value={extra.id}>{extra.nome}</option>}
        {(itens ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </label>
  );

  const listaUtm = (rotulo: string, chave: 'utmSource' | 'utmMedium' | 'utmCampaign') =>
    (opcoes.dados?.[chave]?.length ?? 0) > 0 && (
      <label class="kt-campo">
        <span>{rotulo}</span>
        <select value={rascunho[chave] ?? ''} onChange={(e) => campo(chave, (e.target as HTMLSelectElement).value)}>
          <option value="">Todos</option>
          {opcoes.dados![chave]!.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <Secao icone="ajustes" titulo="Filtros" descricao="Valem para a lista, as colunas e a exportação, dentro do período escolhido acima.">
      {opcoes.erro && <Aviso tipo="erro">{opcoes.erro}</Aviso>}
      <div class="kt-grade-filtros">
        {lista('Conjunto de anúncios', 'conjunto', opcoes.dados?.conjuntos)}
        {lista('Anúncio', 'anuncio', opcoes.dados?.anuncios)}
        {lista('Atendente', 'atendente', opcoes.dados?.atendentes, { id: 'sem', nome: 'Sem atendente' })}
        {(opcoes.dados?.links?.length ?? 0) > 0 && (
          <label class="kt-campo">
            <span>Link rastreável</span>
            <select value={rascunho.link ?? ''} onChange={(e) => campo('link', (e.target as HTMLSelectElement).value)}>
              <option value="">Todos</option>
              {opcoes.dados!.links!.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {listaUtm('UTM Source', 'utmSource')}
        {listaUtm('UTM Medium', 'utmMedium')}
        {listaUtm('UTM Campaign', 'utmCampaign')}
        <label class="kt-campo">
          <span>Venda a partir de</span>
          <input type="date" value={rascunho.vendaDe ?? ''} onChange={(e) => campo('vendaDe', (e.target as HTMLInputElement).value)} />
        </label>
        <label class="kt-campo">
          <span>Venda até</span>
          <input type="date" value={rascunho.vendaAte ?? ''} onChange={(e) => campo('vendaAte', (e.target as HTMLInputElement).value)} />
        </label>
        <label class="kt-campo">
          <span>Ordenar por</span>
          <select value={rascunho.ordem ?? ''} onChange={(e) => campo('ordem', (e.target as HTMLSelectElement).value as FiltroLeads['ordem'])}>
            <option value="">Mais recentes</option>
            <option value="antigos">Mais antigos</option>
            <option value="maior_venda">Maior venda</option>
            <option value="nome">Nome</option>
            <option value="ultima_mensagem">Última mensagem</option>
          </select>
        </label>
      </div>
      <div class="kt-linha-acoes">
        <button
          type="button"
          class="kt-botao"
          onClick={() => {
            mudar({ ...rascunho, pagina: 1 });
            fechar();
          }}
        >
          Aplicar
        </button>
        <button type="button" class="kt-botao kt-botao-fantasma" onClick={() => setRascunho({ ...FILTRO_LEADS_PADRAO, origem: rascunho.origem, etapa: rascunho.etapa, busca: rascunho.busca })}>
          Limpar estes campos
        </button>
        <span class="kt-filtro-salvar">
          <input aria-label="Nome do filtro" placeholder="Nome para salvar este filtro" maxLength={40} value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} />
          <button
            type="button"
            class="kt-botao kt-botao-secundario"
            disabled={!nome.trim()}
            onClick={() => {
              salvar(nome.trim(), rascunho);
              setNome('');
              avisar('Filtro salvo.');
            }}
          >
            Salvar filtro
          </button>
        </span>
      </div>
    </Secao>
  );
}
