import { Aviso } from '../../comum/componentes';
import { compacto, diaLongo, dinheiro, dinheiroCompacto, inteiro, percentual, variacao, vezes } from '../../comum/formato';
import { GraficoColunas } from './graficos';
import type { Carga } from './filtro';
import type { Metricas, VisaoGeral as Dados } from './tipos';

interface Indicador {
  rotulo: string;
  chave: keyof Metricas;
  formato: 'dinheiro' | 'inteiro' | 'percentual' | 'vezes';
  melhorQuandoSobe: boolean;
  destaque?: boolean;
  ajuda?: string;
}

const DO_META: Indicador[] = [
  { rotulo: 'Investimento', chave: 'investimento', formato: 'dinheiro', melhorQuandoSobe: true, destaque: true },
  { rotulo: 'Leads', chave: 'leads', formato: 'inteiro', melhorQuandoSobe: true, ajuda: 'Conforme o que conta como lead em cada conta de anúncio (Configurações).' },
  { rotulo: 'Custo por lead', chave: 'cpl', formato: 'dinheiro', melhorQuandoSobe: false },
  { rotulo: 'Conversas iniciadas', chave: 'conversas', formato: 'inteiro', melhorQuandoSobe: true },
  { rotulo: 'Custo por conversa', chave: 'custoPorConversa', formato: 'dinheiro', melhorQuandoSobe: false },
  { rotulo: 'CTR (link)', chave: 'ctr', formato: 'percentual', melhorQuandoSobe: true },
  { rotulo: 'CPC (link)', chave: 'cpc', formato: 'dinheiro', melhorQuandoSobe: false },
  { rotulo: 'CPM', chave: 'cpm', formato: 'dinheiro', melhorQuandoSobe: false },
  { rotulo: 'Impressões', chave: 'impressoes', formato: 'inteiro', melhorQuandoSobe: true },
];

const DO_ATENDIMENTO: Indicador[] = [
  { rotulo: 'Receita', chave: 'receita', formato: 'dinheiro', melhorQuandoSobe: true, destaque: true, ajuda: 'Soma das vendas registradas no atendimento para leads de anúncio.' },
  { rotulo: 'ROAS', chave: 'roas', formato: 'vezes', melhorQuandoSobe: true, ajuda: 'Receita ÷ investimento.' },
  { rotulo: 'Vendas', chave: 'vendas', formato: 'inteiro', melhorQuandoSobe: true },
  { rotulo: 'Custo por venda', chave: 'custoPorVenda', formato: 'dinheiro', melhorQuandoSobe: false },
  { rotulo: 'Taxa de venda', chave: 'taxaVenda', formato: 'percentual', melhorQuandoSobe: true, ajuda: 'Vendas ÷ leads que chegaram ao atendimento.' },
  { rotulo: 'Leads no atendimento', chave: 'entradas', formato: 'inteiro', melhorQuandoSobe: true },
  { rotulo: 'Qualificados', chave: 'qualificados', formato: 'inteiro', melhorQuandoSobe: true },
];

function valorFormatado(i: Indicador, v: number | null, moeda: string): string {
  if (i.formato === 'dinheiro') return dinheiro(v, moeda);
  if (i.formato === 'percentual') return percentual(v);
  if (i.formato === 'vezes') return vezes(v);
  return i.destaque ? compacto(v) : inteiro(v);
}

function Cartao({ indicador, dados }: { indicador: Indicador; dados: Dados }) {
  const atual = dados.metricas[indicador.chave];
  const anterior = dados.anterior?.metricas[indicador.chave];
  const delta = variacao(atual, anterior ?? null, indicador.melhorQuandoSobe);
  return (
    <div class={`kt-indicador${indicador.destaque ? ' kt-indicador-destaque' : ''}`} title={indicador.ajuda}>
      <span class="kt-indicador-rotulo">{indicador.rotulo}</span>
      <span class="kt-indicador-valor">{valorFormatado(indicador, atual, dados.moeda)}</span>
      {delta ? (
        // A direção vai em seta e texto, não só na cor.
        <span class={`kt-delta kt-delta-${delta.bom === null ? 'neutro' : delta.bom ? 'bom' : 'ruim'}`}>
          {delta.direcao === 'sobe' ? '▲' : delta.direcao === 'desce' ? '▼' : '■'} {delta.texto}
          <span class="kt-muted"> vs. anterior</span>
        </span>
      ) : (
        <span class="kt-delta kt-delta-neutro">{dados.anterior ? '—' : 'sem período anterior'}</span>
      )}
    </div>
  );
}

/**
 * Funil do anúncio à venda: uma barra por etapa, todas na mesma escala (os leads do Meta), com a
 * passagem de uma etapa para a outra em %. É uma série só: a cor é uma, o rótulo diz o que é.
 */
function Funil({ m }: { m: Metricas }) {
  const etapas = [
    { rotulo: 'Leads no Meta', valor: m.leads },
    { rotulo: 'Chegaram ao atendimento', valor: m.entradas },
    { rotulo: 'Qualificados', valor: m.qualificados },
    { rotulo: 'Vendas', valor: m.vendas },
  ];
  const maximo = Math.max(1, ...etapas.map((e) => e.valor));
  return (
    <figure class="kt-grafico kt-funil">
      <figcaption class="kt-grafico-topo">
        <h3>Do anúncio à venda</h3>
      </figcaption>
      <table class="kt-funil-tabela">
        <tbody>
          {etapas.map((e, i) => {
            const anterior = i > 0 ? etapas[i - 1].valor : null;
            const passagem = anterior ? (e.valor / anterior) * 100 : null;
            return (
              <tr key={e.rotulo}>
                <th scope="row">{e.rotulo}</th>
                <td class="kt-funil-barra-celula">
                  <div class="kt-funil-barra" style={{ width: `${Math.max(e.valor > 0 ? 1.5 : 0, (e.valor / maximo) * 100)}%` }} />
                </td>
                <td class="kt-num">{inteiro(e.valor)}</td>
                <td class="kt-num kt-muted">{passagem == null ? '' : percentual(passagem, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

export function SituacaoCarga({ cargaPendente, sincronizadoEm }: { cargaPendente: boolean; sincronizadoEm: string | null }) {
  if (cargaPendente) {
    return <Aviso>Carregando os últimos 90 dias do Meta. Os números aparecem aos poucos; esta tela se atualiza sozinha.</Aviso>;
  }
  return sincronizadoEm ? <p class="kt-muted kt-atualizado">Dados do Meta atualizados em {new Date(sincronizadoEm).toLocaleString('pt-BR')}.</p> : null;
}

export function VisaoGeral({ carga }: { carga: Carga<Dados> }) {
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <p class="kt-muted">Carregando…</p>;
  const moeda = dados.moeda;
  const semAtendimento = !dados.metricas.entradas;
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <SituacaoCarga cargaPendente={dados.cargaPendente} sincronizadoEm={dados.sincronizadoEm} />
      <p class="kt-muted">
        {diaLongo(dados.periodo.de)} a {diaLongo(dados.periodo.ate)}
        {dados.anterior && ` · comparado com ${diaLongo(dados.anterior.de)} a ${diaLongo(dados.anterior.ate)}`}
      </p>

      <h2 class="kt-secao">No Meta</h2>
      <section class="kt-indicadores" aria-label="Indicadores do Meta">
        {DO_META.map((i) => (
          <Cartao key={i.chave} indicador={i} dados={dados} />
        ))}
      </section>

      <h2 class="kt-secao">No atendimento</h2>
      {semAtendimento ? (
        <p class="kt-muted">
          Nenhum lead de anúncio chegou ao atendimento neste período. Os números aparecem quando os atendentes usam o painel Origem do lead ou a
          automação da Kentro está ligada (Configurações › Integração com o atendimento).
        </p>
      ) : (
        <section class="kt-indicadores" aria-label="Indicadores do atendimento">
          {DO_ATENDIMENTO.map((i) => (
            <Cartao key={i.chave} indicador={i} dados={dados} />
          ))}
        </section>
      )}
      {dados.organicos > 0 && <p class="kt-muted">Mais {inteiro(dados.organicos)} atendimentos sem anúncio identificado no período (fora do funil e do ROAS).</p>}

      {/* Grandezas diferentes, gráficos diferentes (nunca um eixo duplo). */}
      <section class="kt-graficos">
        <GraficoColunas
          titulo="Investimento por dia"
          pontos={dados.serie.map((d) => ({ dia: d.data, valor: d.investimento }))}
          formatar={(v) => dinheiro(v, moeda)}
          formatarEixo={(v) => dinheiroCompacto(v, moeda)}
        />
        <GraficoColunas
          titulo="Leads por dia"
          pontos={dados.serie.map((d) => ({ dia: d.data, valor: d.leads }))}
          formatar={(v) => `${inteiro(v)} ${v === 1 ? 'lead' : 'leads'}`}
          formatarEixo={compacto}
        />
        {!semAtendimento && <Funil m={dados.metricas} />}
      </section>
    </div>
  );
}
