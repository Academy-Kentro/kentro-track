import { Aviso } from '../../comum/componentes';
import { dinheiro, inteiro, percentual } from '../../comum/formato';
import { avisar, type Omni } from '../../comum/omni';
import type { Carga } from './filtro';

export type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'venda' | 'descartado';

export interface DadosLeads {
  pagina: number;
  temMais: boolean;
  porEtapa: Partial<Record<Etapa, number>>;
  itens: {
    id: string;
    origem: 'ctwa' | 'formulario' | 'link' | 'organico';
    etapa: Etapa;
    nome: string | null;
    telefone: string | null;
    chatId: string | null;
    recebidoEm: string;
    atendente: string | null;
    valorVenda: number | null;
    campanha: string | null;
    anuncio: string | null;
    vinculoAproximado: boolean;
  }[];
}

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
  }[];
}

export interface FiltroLeads {
  origem: '' | 'ctwa' | 'formulario' | 'link' | 'organico';
  etapa: '' | Etapa;
  pagina: number;
}

const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: 'novo', rotulo: 'Novos' },
  { id: 'em_atendimento', rotulo: 'Em atendimento' },
  { id: 'qualificado', rotulo: 'Qualificados' },
  { id: 'venda', rotulo: 'Vendas' },
  { id: 'descartado', rotulo: 'Descartados' },
];

const ORIGENS: { id: FiltroLeads['origem']; rotulo: string }[] = [
  { id: '', rotulo: 'Todas as origens' },
  { id: 'ctwa', rotulo: 'Anúncio (WhatsApp)' },
  { id: 'formulario', rotulo: 'Formulário' },
  { id: 'link', rotulo: 'Link rastreável' },
  { id: 'organico', rotulo: 'Sem anúncio' },
];

const ETAPA_ROTULO: Record<Etapa, string> = { novo: 'Novo', em_atendimento: 'Em atendimento', qualificado: 'Qualificado', venda: 'Venda', descartado: 'Descartado' };

export function Leads({ omni, carga, filtro, mudar }: { omni: Omni; carga: Carga<DadosLeads>; filtro: FiltroLeads; mudar: (f: FiltroLeads) => void }) {
  const { dados, erro, carregando } = carga;
  const abrirConversa = async (chatId: string) => {
    const r = await omni.chats.select(Number(chatId)).catch(() => ({ selected: false }));
    if (!r.selected) avisar('Não foi possível abrir este atendimento (ele pode estar encerrado ou em outra fila).', 'error');
  };

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      <div class="kt-filtros">
        <label>
          <span>Origem</span>
          <select value={filtro.origem} onChange={(e) => mudar({ ...filtro, origem: (e.target as HTMLSelectElement).value as FiltroLeads['origem'], pagina: 1 })}>
            {ORIGENS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dados && (
        <div class="kt-chips" role="group" aria-label="Etapa">
          <button type="button" class="kt-chip" aria-pressed={filtro.etapa === ''} onClick={() => mudar({ ...filtro, etapa: '', pagina: 1 })}>
            Todas ({inteiro(Object.values(dados.porEtapa).reduce((a, b) => a + (b ?? 0), 0))})
          </button>
          {ETAPAS.map((e) => (
            <button key={e.id} type="button" class="kt-chip" aria-pressed={filtro.etapa === e.id} onClick={() => mudar({ ...filtro, etapa: e.id, pagina: 1 })}>
              {e.rotulo} ({inteiro(dados.porEtapa[e.id] ?? 0)})
            </button>
          ))}
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados ? (
        !erro && <p class="kt-muted">Carregando…</p>
      ) : dados.itens.length === 0 ? (
        <p class="kt-muted">Nenhum lead com esses filtros no período.</p>
      ) : (
        <>
          <div class="kt-tabela-rolagem">
            <table class="kt-tabela">
              <thead>
                <tr>
                  <th>Chegou</th>
                  <th>Lead</th>
                  <th>Origem</th>
                  <th>Atendente</th>
                  <th>Etapa</th>
                  <th class="kt-num">Venda</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.recebidoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>
                      {l.nome ?? 'Sem nome'}
                      {l.telefone && <span class="kt-muted"> · {l.telefone}</span>}
                    </td>
                    <td class="kt-celula-quebra">
                      {l.campanha ?? ORIGENS.find((o) => o.id === l.origem)?.rotulo ?? l.origem}
                      {l.anuncio && <span class="kt-muted"> › {l.anuncio}</span>}
                      {l.vinculoAproximado && <span class="kt-muted" title="Anúncio identificado pelo texto ou pelo link do post"> *</span>}
                    </td>
                    <td>{l.atendente ?? '—'}</td>
                    <td>{ETAPA_ROTULO[l.etapa]}</td>
                    <td class="kt-num">{l.valorVenda == null ? '—' : dinheiro(l.valorVenda)}</td>
                    <td>
                      {l.chatId && (
                        <button type="button" class="kt-link" onClick={() => abrirConversa(l.chatId!)}>
                          Abrir conversa
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="kt-muted">* anúncio identificado pelo texto ou pelo link do post (aproximado). O telefone aparece parcial de propósito.</p>
          <div class="kt-linha-acoes">
            <button type="button" class="kt-botao kt-botao-suave" disabled={dados.pagina <= 1} onClick={() => mudar({ ...filtro, pagina: dados.pagina - 1 })}>
              Anteriores
            </button>
            <span class="kt-muted">Página {dados.pagina}</span>
            <button type="button" class="kt-botao kt-botao-suave" disabled={!dados.temMais} onClick={() => mudar({ ...filtro, pagina: dados.pagina + 1 })}>
              Próximos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Equipe({ carga }: { carga: Carga<DadosEquipe> }) {
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <p class="kt-muted">Carregando…</p>;
  if (dados.atendentes.length === 0) return <p class="kt-muted">Nenhum lead no atendimento neste período.</p>;
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-tabela-rolagem">
        <table class="kt-tabela">
          <thead>
            <tr>
              <th>Atendente</th>
              <th class="kt-num">Leads</th>
              <th class="kt-num">Qualificados</th>
              <th class="kt-num">Vendas</th>
              <th class="kt-num">Descartados</th>
              <th class="kt-num">Taxa de venda</th>
              <th class="kt-num">Receita</th>
              <th class="kt-num" title="Do lead chegar até alguém abrir o painel da conversa">Tempo até atender</th>
            </tr>
          </thead>
          <tbody>
            {dados.atendentes.map((a) => (
              <tr key={a.id ?? 'sem'}>
                <td>{a.nome}</td>
                <td class="kt-num">{inteiro(a.entradas)}</td>
                <td class="kt-num">{inteiro(a.qualificados)}</td>
                <td class="kt-num">{inteiro(a.vendas)}</td>
                <td class="kt-num">{inteiro(a.descartados)}</td>
                <td class="kt-num">{percentual(a.taxaVenda, 1)}</td>
                <td class="kt-num">{dinheiro(a.receita, dados.moeda)}</td>
                <td class="kt-num">{a.minutosAteAtender == null ? '—' : a.minutosAteAtender < 60 ? `${a.minutosAteAtender} min` : `${(a.minutosAteAtender / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="kt-muted">Inclui atendimentos sem anúncio. "Sem atendente": leads que ainda não tiveram o painel aberto por ninguém (só a IA ou a fila).</p>
    </div>
  );
}
