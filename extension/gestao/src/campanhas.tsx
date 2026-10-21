import { useState } from 'preact/hooks';
import { Aviso } from '../../comum/componentes';
import { dinheiro, inteiro, percentual } from '../../comum/formato';
import type { Carga } from './filtro';
import { SituacaoCarga } from './visao-geral';
import type { Campanhas as Dados, Metricas, NoCampanha } from './tipos';

type Coluna = { chave: keyof Metricas; rotulo: string; formato: 'dinheiro' | 'inteiro' | 'percentual' };

const COLUNAS: Coluna[] = [
  { chave: 'investimento', rotulo: 'Investimento', formato: 'dinheiro' },
  { chave: 'impressoes', rotulo: 'Impressões', formato: 'inteiro' },
  { chave: 'cliquesLink', rotulo: 'Cliques', formato: 'inteiro' },
  { chave: 'ctr', rotulo: 'CTR', formato: 'percentual' },
  { chave: 'leads', rotulo: 'Leads', formato: 'inteiro' },
  { chave: 'cpl', rotulo: 'CPL', formato: 'dinheiro' },
  { chave: 'conversas', rotulo: 'Conversas', formato: 'inteiro' },
  { chave: 'custoPorConversa', rotulo: 'Custo/conversa', formato: 'dinheiro' },
];

const STATUS: Record<string, string> = {
  ACTIVE: 'Ativo',
  PAUSED: 'Pausado',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  ADSET_PAUSED: 'Conjunto pausado',
  ARCHIVED: 'Arquivado',
  DELETED: 'Excluído',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
  PENDING_REVIEW: 'Em análise',
  DISAPPROVED: 'Reprovado',
};

function celula(c: Coluna, m: Metricas, moeda: string) {
  const v = m[c.chave];
  if (c.formato === 'dinheiro') return dinheiro(v, moeda);
  if (c.formato === 'percentual') return percentual(v);
  return inteiro(v);
}

/** Ordena pela coluna; vazio ("—") vai sempre para o fim. */
function ordenar<T extends NoCampanha>(lista: T[], chave: keyof Metricas, crescente: boolean): T[] {
  return [...lista].sort((a, b) => {
    const x = a.metricas[chave];
    const y = b.metricas[chave];
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return crescente ? x - y : y - x;
  });
}

function Linha({ no, nivel, moeda, aberto, alternar }: { no: NoCampanha; nivel: 0 | 1 | 2; moeda: string; aberto?: boolean; alternar?: () => void }) {
  return (
    <tr class={`kt-nivel-${nivel}`}>
      <td>
        <div class="kt-nome-celula" style={{ paddingLeft: `${nivel * 18}px` }}>
          {alternar ? (
            <button type="button" class="kt-abrir" aria-expanded={aberto} aria-label={aberto ? 'Recolher' : 'Expandir'} onClick={alternar}>
              {aberto ? '▾' : '▸'}
            </button>
          ) : (
            <span class="kt-abrir" />
          )}
          <span>
            <span class="kt-nome">{no.nome}</span>
            {no.status && <span class={`kt-status kt-status-${no.status === 'ACTIVE' ? 'ativo' : 'outro'}`}>{STATUS[no.status] ?? no.status}</span>}
          </span>
        </div>
      </td>
      {COLUNAS.map((c) => (
        <td key={c.chave} class="kt-num">
          {celula(c, no.metricas, moeda)}
        </td>
      ))}
    </tr>
  );
}

export function Campanhas({ carga }: { carga: Carga<Dados> }) {
  const [ordem, setOrdem] = useState<{ chave: keyof Metricas; crescente: boolean }>({ chave: 'investimento', crescente: false });
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <p class="kt-muted">Carregando…</p>;

  const alternar = (id: string) =>
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  const clicarColuna = (chave: keyof Metricas) => setOrdem((o) => ({ chave, crescente: o.chave === chave ? !o.crescente : false }));

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <SituacaoCarga cargaPendente={dados.cargaPendente} sincronizadoEm={dados.sincronizadoEm} />
      {dados.campanhas.length === 0 ? (
        <p class="kt-muted">Nenhuma campanha com entrega no período.</p>
      ) : (
        <div class="kt-tabela-rolagem">
          <table class="kt-tabela kt-tabela-campanhas">
            <thead>
              <tr>
                <th>Campanha › conjunto › anúncio</th>
                {COLUNAS.map((c) => (
                  <th key={c.chave} class="kt-num" aria-sort={ordem.chave === c.chave ? (ordem.crescente ? 'ascending' : 'descending') : undefined}>
                    <button type="button" class="kt-ordenar" onClick={() => clicarColuna(c.chave)}>
                      {c.rotulo}
                      {ordem.chave === c.chave ? (ordem.crescente ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenar(dados.campanhas, ordem.chave, ordem.crescente).map((c) => {
                const idC = `c${c.idMeta}`;
                return [
                  <Linha key={idC} no={c} nivel={0} moeda={dados.moeda} aberto={abertos.has(idC)} alternar={() => alternar(idC)} />,
                  ...(abertos.has(idC)
                    ? ordenar(c.conjuntos, ordem.chave, ordem.crescente).flatMap((j) => {
                        const idJ = `j${j.idMeta}`;
                        return [
                          <Linha key={idJ} no={j} nivel={1} moeda={dados.moeda} aberto={abertos.has(idJ)} alternar={() => alternar(idJ)} />,
                          ...(abertos.has(idJ)
                            ? ordenar(j.anuncios, ordem.chave, ordem.crescente).map((a) => <Linha key={`a${a.idMeta}`} no={a} nivel={2} moeda={dados.moeda} />)
                            : []),
                        ];
                      })
                    : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
