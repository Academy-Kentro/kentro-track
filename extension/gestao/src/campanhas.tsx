import { useState } from 'preact/hooks';
import { Aviso, Carregando, Vazio } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { dinheiro, inteiro, percentual, vezes } from '../../comum/formato';
import type { Carga } from './filtro';
import { SituacaoCarga } from './visao-geral';
import type { AlcanceCampanhas, Campanhas as Dados, Metricas, NoCampanha } from './tipos';

type ChaveAlcance = 'alcance' | 'frequencia';
type ChaveColuna = keyof Metricas | ChaveAlcance;
type Coluna = { chave: ChaveColuna; rotulo: string; formato: 'dinheiro' | 'inteiro' | 'percentual' | 'vezes' | 'decimal'; ajuda?: string };
type Nivel = 'campanha' | 'conjunto' | 'anuncio';

const COLUNAS: Coluna[] = [
  { chave: 'investimento', rotulo: 'Investimento', formato: 'dinheiro' },
  { chave: 'impressoes', rotulo: 'Impressões', formato: 'inteiro' },
  { chave: 'alcance', rotulo: 'Alcance', formato: 'inteiro', ajuda: 'Pessoas diferentes que viram o anúncio no período.' },
  { chave: 'frequencia', rotulo: 'Frequência', formato: 'decimal', ajuda: 'Quantas vezes, em média, cada pessoa viu o anúncio no período.' },
  { chave: 'cpm', rotulo: 'CPM', formato: 'dinheiro' },
  { chave: 'cliquesLink', rotulo: 'Cliques', formato: 'inteiro' },
  { chave: 'cpc', rotulo: 'CPC', formato: 'dinheiro' },
  { chave: 'ctr', rotulo: 'CTR', formato: 'percentual' },
  { chave: 'leads', rotulo: 'Leads', formato: 'inteiro' },
  { chave: 'cpl', rotulo: 'CPL', formato: 'dinheiro' },
  { chave: 'conversas', rotulo: 'Conversas', formato: 'inteiro' },
  { chave: 'custoPorConversa', rotulo: 'Custo/conversa', formato: 'dinheiro' },
  { chave: 'vendas', rotulo: 'Vendas', formato: 'inteiro' },
  { chave: 'receita', rotulo: 'Receita', formato: 'dinheiro' },
  { chave: 'roas', rotulo: 'ROAS', formato: 'vezes' },
  { chave: 'custoPorVenda', rotulo: 'Custo/venda', formato: 'dinheiro' },
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

/** Alcance e frequência chegam depois, e podem não chegar: até lá a célula fica vazia ("—"). */
function valorDe(no: NoCampanha, nivel: Nivel, chave: ChaveColuna, alcance: AlcanceCampanhas | null): number | null {
  if (chave === 'alcance' || chave === 'frequencia') return alcance?.[nivel]?.[no.idMeta]?.[chave] ?? null;
  return no.metricas[chave];
}

function celula(c: Coluna, v: number | null, moeda: string) {
  if (c.formato === 'dinheiro') return dinheiro(v, moeda);
  if (c.formato === 'percentual') return percentual(v);
  if (c.formato === 'vezes') return vezes(v);
  if (c.formato === 'decimal') return v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v == null ? '—' : inteiro(v);
}

/** Ordena pela coluna; vazio ("—") vai sempre para o fim. */
function ordenar<T extends NoCampanha>(lista: T[], nivel: Nivel, chave: ChaveColuna, crescente: boolean, alcance: AlcanceCampanhas | null): T[] {
  return [...lista].sort((a, b) => {
    const x = valorDe(a, nivel, chave, alcance);
    const y = valorDe(b, nivel, chave, alcance);
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return crescente ? x - y : y - x;
  });
}

const NIVEIS: Nivel[] = ['campanha', 'conjunto', 'anuncio'];

function Linha({ no, nivel, moeda, alcance, aberto, alternar }: { no: NoCampanha; nivel: 0 | 1 | 2; moeda: string; alcance: AlcanceCampanhas | null; aberto?: boolean; alternar?: () => void }) {
  return (
    <tr class={`kt-nivel-${nivel}`}>
      <td>
        <div class="kt-nome-celula" style={{ paddingLeft: `${nivel * 18}px` }}>
          {alternar ? (
            <button type="button" class="kt-abrir" aria-expanded={aberto} aria-label={aberto ? 'Recolher' : 'Expandir'} onClick={alternar}>
              <Icone nome="direita" tamanho={14} />
            </button>
          ) : (
            <span class="kt-abrir" />
          )}
          <span class="kt-nome-bloco">
            <span class="kt-nome">{no.nome}</span>
            {no.status && (
              <span class={`kt-status kt-status-${no.status === 'ACTIVE' ? 'ativo' : 'outro'}`}>
                <span class="kt-ponto" />
                {STATUS[no.status] ?? no.status}
              </span>
            )}
          </span>
        </div>
      </td>
      {COLUNAS.map((c) => (
        <td key={c.chave} class="kt-num">
          {celula(c, valorDe(no, NIVEIS[nivel], c.chave, alcance), moeda)}
        </td>
      ))}
    </tr>
  );
}

export function Campanhas({ carga, alcance = null }: { carga: Carga<Dados>; alcance?: AlcanceCampanhas | null }) {
  const [ordem, setOrdem] = useState<{ chave: ChaveColuna; crescente: boolean }>({ chave: 'investimento', crescente: false });
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;

  const alternar = (id: string) =>
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  const clicarColuna = (chave: ChaveColuna) => setOrdem((o) => ({ chave, crescente: o.chave === chave ? !o.crescente : false }));

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <SituacaoCarga cargaPendente={dados.cargaPendente} sincronizadoEm={dados.sincronizadoEm} />
      {alcance?.indisponivel && <p class="kt-muted">O Meta não entregou todo o alcance e a frequência agora. O resto da tabela não muda.</p>}
      {dados.campanhas.length === 0 ? (
        <section class="kt-card">
          <Vazio icone="megafone" titulo="Nenhuma campanha com entrega no período">
            Troque o período ou a conta de anúncio no filtro.
          </Vazio>
        </section>
      ) : (
        <div class="kt-tabela-rolagem kt-tabela-card">
          <table class="kt-tabela kt-tabela-campanhas">
            <thead>
              <tr>
                <th>Campanha › conjunto › anúncio</th>
                {COLUNAS.map((c) => (
                  <th key={c.chave} class="kt-num" aria-sort={ordem.chave === c.chave ? (ordem.crescente ? 'ascending' : 'descending') : undefined}>
                    <button type="button" class="kt-ordenar" title={c.ajuda} onClick={() => clicarColuna(c.chave)}>
                      {c.rotulo}
                      {ordem.chave === c.chave ? (ordem.crescente ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenar(dados.campanhas, 'campanha', ordem.chave, ordem.crescente, alcance).map((c) => {
                const idC = `c${c.idMeta}`;
                return [
                  <Linha key={idC} no={c} nivel={0} moeda={dados.moeda} alcance={alcance} aberto={abertos.has(idC)} alternar={() => alternar(idC)} />,
                  ...(abertos.has(idC)
                    ? ordenar(c.conjuntos, 'conjunto', ordem.chave, ordem.crescente, alcance).flatMap((j) => {
                        const idJ = `j${j.idMeta}`;
                        return [
                          <Linha key={idJ} no={j} nivel={1} moeda={dados.moeda} alcance={alcance} aberto={abertos.has(idJ)} alternar={() => alternar(idJ)} />,
                          ...(abertos.has(idJ)
                            ? ordenar(j.anuncios, 'anuncio', ordem.chave, ordem.crescente, alcance).map((a) => <Linha key={`a${a.idMeta}`} no={a} nivel={2} moeda={dados.moeda} alcance={alcance} />)
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
