import { useEffect, useRef, useState } from 'preact/hooks';
import type { Api } from '../../comum/api';
import { Avatar, Aviso, Carregando, Vazio } from '../../comum/componentes';
import { dinheiro, inteiro, percentual } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import type { Omni } from '../../comum/omni';
import { atendentesNaKentro, gravarAtendentes } from './atendentes';
import { Seletor, type Carga } from './filtro';
import { CLASSE_TIPO, FILTRO_LEADS_PADRAO, filtrosAtivos, origemDoLead, ORIGENS, SITUACOES, type DadosLeads, type Etapa, type FiltroLeads, type VisaoLeads } from './leads-comum';
import { PainelFiltros, useFiltrosSalvos } from './leads-filtros';
import { TrocaEmLote } from './leads-lote';
import { QuadroLeads } from './leads-quadro';
import { PainelAtualizacoes, PainelExportar } from './leads-relatorios';
import type { TipoEtapa } from './tipos';

export interface DadosEquipe {
  moeda: string;
  atendentes: {
    id: string | null;
    nome: string;
    entradas: number;
    qualificados: number;
    vendas: number;
    descartados: number;
    receita: number;
    taxaVenda: number | null;
    minutosAteAtender: number | null;
    /** Por id da etapa: chegaram até ela ou além (perda: estão nela). */
    porEtapa?: Record<string, number>;
  }[];
  /** As colunas por etapa, na ordem do funil. */
  etapas?: { id: string; nome: string; tipo: TipoEtapa }[];
  /** Atendimentos do período sem atendente gravado: a tela pergunta à Kentro quem está com eles. */
  semAtendente?: string[];
}

const VISOES: { id: VisaoLeads; rotulo: string }[] = [
  { id: 'lista', rotulo: 'Lista' },
  { id: 'colunas', rotulo: 'Colunas' },
  { id: 'lote', rotulo: 'Troca em lote' },
];

const ETAPA_ROTULO: Record<Etapa, string> = { novo: 'Novo', em_atendimento: 'Em atendimento', qualificado: 'Qualificado', venda: 'Venda', descartado: 'Descartado' };

/**
 * Quem está com o atendimento agora na Kentro, para os leads em que o Kentro Track ainda não sabe:
 * mostra na lista e grava, para a aba Equipe contar.
 */
function useAtendentesAtuais(omni: Omni, api: Api, itens: DadosLeads['itens'] | undefined): Record<string, string> {
  const [nomes, setNomes] = useState<Record<string, string>>({});
  useEffect(() => {
    const chatIds = (itens ?? []).filter((l) => l.chatId && !l.atendente).map((l) => l.chatId!);
    if (chatIds.length === 0) return;
    let vivo = true;
    atendentesNaKentro(omni, chatIds).then((achados) => {
      if (!vivo) return;
      setNomes(Object.fromEntries(Object.entries(achados).map(([chatId, a]) => [chatId, a.atendente])));
      gravarAtendentes(api, achados);
    });
    return () => {
      vivo = false;
    };
  }, [omni, api, itens]);
  return nomes;
}

/** Visão, busca e os painéis de filtros, exportação e atualizações, acima da lista e das colunas. */
function Ferramentas({
  omni,
  api,
  q,
  filtro,
  mudar,
  visao,
  mudarVisao,
}: {
  omni: Omni;
  api: Api;
  q: string;
  filtro: FiltroLeads;
  mudar: (f: FiltroLeads) => void;
  visao: VisaoLeads;
  mudarVisao: (v: VisaoLeads) => void;
}) {
  const [aberto, setAberto] = useState<'' | 'filtros' | 'exportar' | 'atualizacoes'>('');
  const [busca, setBusca] = useState(filtro.busca ?? '');
  const { salvos, salvar, remover } = useFiltrosSalvos(omni);
  useEffect(() => setBusca(filtro.busca ?? ''), [filtro.busca]);

  const alternar = (p: typeof aberto) => setAberto(aberto === p ? '' : p);
  const ativos = filtrosAtivos(filtro);
  const temFiltro = ativos > 0 || !!filtro.busca || !!filtro.origem || !!filtro.etapa || !!filtro.aguardando;
  return (
    <>
      <div class="kt-leads-ferramentas">
        <div class="kt-segmento" role="group" aria-label="Visualização">
          {VISOES.map((v) => (
            <button key={v.id} type="button" aria-pressed={visao === v.id} onClick={() => mudarVisao(v.id)}>
              {v.rotulo}
            </button>
          ))}
        </div>
        {visao !== 'lote' && (
          <>
            <form
              class="kt-busca"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                mudar({ ...filtro, busca: busca.trim() || undefined, pagina: 1 });
              }}
            >
              <input type="search" aria-label="Buscar por nome ou telefone" placeholder="Nome ou telefone" maxLength={120} value={busca} onInput={(e) => setBusca((e.target as HTMLInputElement).value)} />
              <button type="submit" class="kt-botao kt-botao-fantasma kt-botao-pequeno">
                Buscar
              </button>
            </form>
            <Seletor icone="funil" rotulo="Origem" valor={filtro.origem} mudar={(v) => mudar({ ...filtro, origem: v as FiltroLeads['origem'], pagina: 1 })}>
              {ORIGENS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </Seletor>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" aria-expanded={aberto === 'filtros'} onClick={() => alternar('filtros')}>
              Filtros{ativos > 0 && ` (${ativos})`}
            </button>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" aria-expanded={aberto === 'exportar'} onClick={() => alternar('exportar')}>
              Exportar
            </button>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" aria-expanded={aberto === 'atualizacoes'} onClick={() => alternar('atualizacoes')}>
              Últimas atualizações
            </button>
            {temFiltro && (
              <button type="button" class="kt-link" onClick={() => mudar(FILTRO_LEADS_PADRAO)}>
                Limpar filtros
              </button>
            )}
          </>
        )}
      </div>
      {visao !== 'lote' && salvos.length > 0 && (
        <div class="kt-filtros-salvos" role="group" aria-label="Filtros salvos">
          <span class="kt-muted">Filtros salvos:</span>
          {salvos.map((s) => (
            <span key={s.nome} class="kt-filtro-salvo">
              <button type="button" class="kt-link" onClick={() => mudar({ ...FILTRO_LEADS_PADRAO, ...s.filtro, pagina: 1 })}>
                {s.nome}
              </button>
              <button type="button" class="kt-filtro-salvo-remover" aria-label={`Remover o filtro ${s.nome}`} onClick={() => remover(s.nome)}>
                <Icone nome="fechar" tamanho={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {visao !== 'lote' && aberto === 'filtros' && <PainelFiltros key={JSON.stringify(filtro)} api={api} q={q} filtro={filtro} mudar={mudar} salvar={salvar} fechar={() => setAberto('')} />}
      {visao !== 'lote' && aberto === 'exportar' && <PainelExportar api={api} q={q} filtro={filtro} />}
      {visao !== 'lote' && aberto === 'atualizacoes' && <PainelAtualizacoes api={api} />}
    </>
  );
}

export function Leads({
  omni,
  api,
  q,
  carga,
  filtro,
  mudar,
  visao,
  mudarVisao,
}: {
  omni: Omni;
  api: Api;
  /** O período e a campanha da barra de cima. */
  q: string;
  carga: Carga<DadosLeads>;
  filtro: FiltroLeads;
  mudar: (f: FiltroLeads) => void;
  visao: VisaoLeads;
  mudarVisao: (v: VisaoLeads) => void;
}) {
  const { dados, erro, carregando } = carga;
  const atuais = useAtendentesAtuais(omni, api, visao === 'lista' ? dados?.itens : undefined);
  const ferramentas = <Ferramentas omni={omni} api={api} q={q} filtro={filtro} mudar={mudar} visao={visao} mudarVisao={mudarVisao} />;

  if (visao === 'colunas') {
    return (
      <div>
        {ferramentas}
        <QuadroLeads api={api} q={q} filtro={filtro} />
      </div>
    );
  }
  if (visao === 'lote') {
    return (
      <div>
        {ferramentas}
        {dados ? <TrocaEmLote api={api} etapas={dados.etapas ?? []} aoConcluir={() => carga.recarregar?.()} /> : erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />}
      </div>
    );
  }

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {ferramentas}
      <div class="kt-barra-leads">
        {dados && (
          <div class="kt-chips" role="group" aria-label="Etapa">
            <button type="button" class="kt-chip" aria-pressed={filtro.etapa === ''} onClick={() => mudar({ ...filtro, etapa: '', pagina: 1 })}>
              Todas <span class="kt-chip-n">({inteiro(Object.values(dados.porEtapa).reduce((a, b) => a + (b ?? 0), 0))})</span>
            </button>
            {[
              ...SITUACOES,
              ...(dados.etapas ?? []).filter((e) => e.ativa && e.noPainel).map((e) => ({ id: e.id, rotulo: e.nome, classe: CLASSE_TIPO[e.tipo] })),
            ].map((e) => (
              <button key={e.id} type="button" class={`kt-chip kt-chip-${e.classe}`} aria-pressed={filtro.etapa === e.id} onClick={() => mudar({ ...filtro, etapa: e.id, pagina: 1 })}>
                {e.rotulo} <span class="kt-chip-n">({inteiro(dados.porEtapa[e.id] ?? 0)})</span>
              </button>
            ))}
            {((dados.aguardandoResposta ?? 0) > 0 || filtro.aguardando) && (
              <button type="button" class="kt-chip" aria-pressed={!!filtro.aguardando} onClick={() => mudar({ ...filtro, aguardando: !filtro.aguardando || undefined, pagina: 1 })}>
                <Icone nome="relogio" tamanho={13} /> Aguardando 1ª resposta <span class="kt-chip-n">({inteiro(dados.aguardandoResposta ?? 0)})</span>
              </button>
            )}
          </div>
        )}
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <Carregando />
      ) : dados.itens.length === 0 ? (
        <section class="kt-card">
          <Vazio icone="lista" titulo="Nenhum lead com esses filtros no período" />
        </section>
      ) : (
        <>
          <div class="kt-tabela-rolagem kt-tabela-card">
            <table class="kt-tabela">
              <thead>
                <tr>
                  <th>Chegou</th>
                  <th>Lead</th>
                  <th>Origem</th>
                  <th>Atendente</th>
                  <th>Etapa</th>
                  <th>Última mensagem</th>
                  <th class="kt-num">Venda</th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.recebidoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      <span class="kt-pessoa">
                        <Avatar nome={l.nome} />
                        <span>
                          {l.nome ?? 'Sem nome'}
                          {l.telefone && <span class="kt-muted"> · {l.telefone}</span>}
                        </span>
                      </span>
                    </td>
                    <td class="kt-celula-quebra">
                      {origemDoLead(l)}
                      {l.anuncio && <span class="kt-muted"> › {l.anuncio}</span>}
                      {l.vinculoAproximado && <span class="kt-muted" title="Anúncio identificado pelo texto ou pelo link do post"> *</span>}
                    </td>
                    <td>
                      {l.atendente ?? (l.chatId && atuais[l.chatId] ? <span title="Com o atendimento agora na Kentro">{atuais[l.chatId]}</span> : '—')}
                    </td>
                    <td>
                      <span class={`kt-etapa kt-etapa-${l.etapaTipo ? CLASSE_TIPO[l.etapaTipo] : l.etapa}`}>{l.etapaNome ?? ETAPA_ROTULO[l.etapa]}</span>
                    </td>
                    <td>{l.ultimaMensagemEm ? new Date(l.ultimaMensagemEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td class="kt-num">{l.valorVenda == null ? '—' : dinheiro(l.valorVenda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="kt-muted">* anúncio identificado pelo texto ou pelo link do post (aproximado). O telefone aparece parcial de propósito.</p>
          <div class="kt-paginacao">
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={dados.pagina <= 1} onClick={() => mudar({ ...filtro, pagina: dados.pagina - 1 })}>
              Anteriores
            </button>
            <span class="kt-muted">Página {dados.pagina}</span>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={!dados.temMais} onClick={() => mudar({ ...filtro, pagina: dados.pagina + 1 })}>
              Próximos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Equipe({ omni, api, carga }: { omni: Omni; api: Api; carga: Carga<DadosEquipe> }) {
  const { dados, erro, carregando } = carga;
  const consultados = useRef('');

  // Leads sem atendente gravado: pergunta à Kentro uma vez por lista e recarrega se achou alguém.
  useEffect(() => {
    const chatIds = dados?.semAtendente ?? [];
    const chave = chatIds.join(',');
    if (chatIds.length === 0 || chave === consultados.current) return;
    consultados.current = chave;
    atendentesNaKentro(omni, chatIds)
      .then((achados) => gravarAtendentes(api, achados))
      .then((n) => n > 0 && carga.recarregar?.());
  }, [omni, api, dados]);

  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  if (dados.atendentes.length === 0) {
    return (
      <section class="kt-card">
        <Vazio icone="usuarios" titulo="Nenhum lead no atendimento neste período" />
      </section>
    );
  }
  const melhorTaxa = Math.max(1, ...dados.atendentes.map((a) => a.taxaVenda ?? 0));
  type Linha = DadosEquipe['atendentes'][number];
  // Uma coluna por etapa visível do funil; API sem etapas (versão anterior) mantém as três de antes.
  const colunas: { id: string; nome: string; valor: (a: Linha) => number }[] = dados.etapas
    ? dados.etapas.map((e) => ({ id: e.id, nome: e.nome, valor: (a: Linha) => a.porEtapa?.[e.id] ?? 0 }))
    : [
        { id: 'q', nome: 'Qualificados', valor: (a: Linha) => a.qualificados },
        { id: 'v', nome: 'Vendas', valor: (a: Linha) => a.vendas },
        { id: 'd', nome: 'Descartados', valor: (a: Linha) => a.descartados },
      ];
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-tabela-rolagem kt-tabela-card">
        <table class="kt-tabela">
          <thead>
            <tr>
              <th>Atendente</th>
              <th class="kt-num">Leads</th>
              {colunas.map((c) => (
                <th key={c.id} class="kt-num">
                  {c.nome}
                </th>
              ))}
              <th class="kt-num">Taxa de venda</th>
              <th class="kt-num">Receita</th>
              <th class="kt-num" title="Do lead chegar até alguém abrir o painel da conversa">Tempo até atender</th>
            </tr>
          </thead>
          <tbody>
            {dados.atendentes.map((a) => (
              <tr key={a.id ?? 'sem'}>
                <td>
                  <span class="kt-pessoa">
                    <Avatar nome={a.id ? a.nome : null} />
                    {a.nome}
                  </span>
                </td>
                <td class="kt-num">{inteiro(a.entradas)}</td>
                {colunas.map((c) => (
                  <td key={c.id} class="kt-num">
                    {inteiro(c.valor(a))}
                  </td>
                ))}
                <td class="kt-num">
                  <span class="kt-taxa">
                    <span class="kt-taxa-trilho" aria-hidden="true">
                      <span class="kt-taxa-barra" style={{ width: `${((a.taxaVenda ?? 0) / melhorTaxa) * 100}%` }} />
                    </span>
                    {percentual(a.taxaVenda, 1)}
                  </span>
                </td>
                <td class="kt-num">{dinheiro(a.receita, dados.moeda)}</td>
                <td class="kt-num">{a.minutosAteAtender == null ? '—' : a.minutosAteAtender < 60 ? `${a.minutosAteAtender} min` : `${(a.minutosAteAtender / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="kt-muted">Inclui atendimentos sem anúncio. "Sem atendente": leads que ninguém assumiu ainda (só a IA ou a fila) ou que a Kentro não deixa seu usuário consultar.</p>
    </div>
  );
}
