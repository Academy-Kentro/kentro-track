import { Aviso, Carregando, Vazio } from '../../comum/componentes';
import { compacto, diaLongo, dinheiro, dinheiroCompacto, inteiro, percentual, variacao, vezes } from '../../comum/formato';
import { Icone, NomeIcone } from '../../comum/icones';
import { GraficoColunas, Sparkline } from './graficos';
import type { Carga } from './filtro';
import type { Metricas, VisaoGeral as Dados } from './tipos';

interface Indicador {
  rotulo: string;
  chave: keyof Metricas;
  formato: 'dinheiro' | 'inteiro' | 'percentual' | 'vezes';
  melhorQuandoSobe: boolean;
  icone: NomeIcone;
  destaque?: boolean;
  ajuda?: string;
  /** Série diária para o mini gráfico (só nos destaques). */
  serie?: 'investimento' | 'leads';
}

const DO_META: Indicador[] = [
  { rotulo: 'Investimento', chave: 'investimento', formato: 'dinheiro', melhorQuandoSobe: true, icone: 'dinheiro', destaque: true, serie: 'investimento' },
  { rotulo: 'Leads', chave: 'leads', formato: 'inteiro', melhorQuandoSobe: true, icone: 'usuario', destaque: true, serie: 'leads', ajuda: 'Conforme o que conta como lead em cada conta de anúncio (Configurações).' },
  { rotulo: 'Custo por lead', chave: 'cpl', formato: 'dinheiro', melhorQuandoSobe: false, icone: 'alvo' },
  { rotulo: 'Conversas iniciadas', chave: 'conversas', formato: 'inteiro', melhorQuandoSobe: true, icone: 'mensagem' },
  { rotulo: 'Custo por conversa', chave: 'custoPorConversa', formato: 'dinheiro', melhorQuandoSobe: false, icone: 'mensagem' },
  { rotulo: 'CTR (link)', chave: 'ctr', formato: 'percentual', melhorQuandoSobe: true, icone: 'clique' },
  { rotulo: 'CPC (link)', chave: 'cpc', formato: 'dinheiro', melhorQuandoSobe: false, icone: 'clique' },
  { rotulo: 'CPM', chave: 'cpm', formato: 'dinheiro', melhorQuandoSobe: false, icone: 'olho' },
  { rotulo: 'Impressões', chave: 'impressoes', formato: 'inteiro', melhorQuandoSobe: true, icone: 'olho' },
];

const DO_ATENDIMENTO: Indicador[] = [
  { rotulo: 'Receita', chave: 'receita', formato: 'dinheiro', melhorQuandoSobe: true, icone: 'dinheiro', destaque: true, ajuda: 'Soma das vendas registradas no atendimento para leads de anúncio.' },
  { rotulo: 'ROAS', chave: 'roas', formato: 'vezes', melhorQuandoSobe: true, icone: 'grafico', destaque: true, ajuda: 'Receita ÷ investimento.' },
  { rotulo: 'Vendas', chave: 'vendas', formato: 'inteiro', melhorQuandoSobe: true, icone: 'sacola' },
  { rotulo: 'Custo por venda', chave: 'custoPorVenda', formato: 'dinheiro', melhorQuandoSobe: false, icone: 'alvo' },
  { rotulo: 'Taxa de venda', chave: 'taxaVenda', formato: 'percentual', melhorQuandoSobe: true, icone: 'percentual', ajuda: 'Vendas ÷ leads que chegaram ao atendimento.' },
  { rotulo: 'Leads no atendimento', chave: 'entradas', formato: 'inteiro', melhorQuandoSobe: true, icone: 'mensagem' },
  { rotulo: 'Qualificados', chave: 'qualificados', formato: 'inteiro', melhorQuandoSobe: true, icone: 'estrela' },
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
  const pontos = indicador.serie ? dados.serie.map((d) => d[indicador.serie!]) : null;
  return (
    <div class={`kt-indicador${indicador.destaque ? ' kt-indicador-destaque' : ''}`} title={indicador.ajuda}>
      <div class="kt-indicador-topo">
        <span class="kt-indicador-icone">
          <Icone nome={indicador.icone} tamanho={15} />
        </span>
        <span class="kt-indicador-rotulo">{indicador.rotulo}</span>
      </div>
      <span class="kt-indicador-valor">{valorFormatado(indicador, atual, dados.moeda)}</span>
      <div class="kt-indicador-rodape">
        {delta ? (
          // A direção vai em seta e texto, não só na cor.
          <span class={`kt-delta kt-delta-${delta.bom === null ? 'neutro' : delta.bom ? 'bom' : 'ruim'}`}>
            <Icone nome={delta.direcao === 'sobe' ? 'sobe' : delta.direcao === 'desce' ? 'desce' : 'igual'} tamanho={12} />
            {delta.texto}
          </span>
        ) : (
          <span class="kt-delta kt-delta-neutro">{dados.anterior ? '—' : 'sem comparação'}</span>
        )}
        {delta && <span class="kt-muted">vs. anterior</span>}
      </div>
      {pontos && pontos.some((p) => p > 0) && <Sparkline pontos={pontos} rotulo={`${indicador.rotulo} por dia`} />}
    </div>
  );
}

/**
 * Funil do anúncio à venda: uma barra por etapa, todas na mesma escala (os leads do Meta), com a
 * passagem de uma etapa para a outra em %. É uma série só: a cor é uma, o rótulo diz o que é.
 */
function Funil({ m, funil }: { m: Metricas; funil?: { id: string; nome: string; leads: number }[] }) {
  // As etapas são as da conta (Configurações › Etapas do funil); API sem elas mantém as de antes.
  const etapas = [
    { rotulo: 'Leads no Meta', valor: m.leads },
    { rotulo: 'Chegaram ao atendimento', valor: m.entradas },
    ...(funil
      ? funil.map((e) => ({ rotulo: e.nome, valor: e.leads }))
      : [
          { rotulo: 'Qualificados', valor: m.qualificados },
          { rotulo: 'Vendas', valor: m.vendas },
        ]),
  ];
  const maximo = Math.max(1, ...etapas.map((e) => e.valor));
  return (
    <figure class="kt-grafico kt-funil">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>Do anúncio à venda</h3>
          <p class="kt-muted">Quantos passam de uma etapa para a próxima</p>
        </div>
      </figcaption>
      <table class="kt-funil-tabela">
        <tbody>
          {etapas.map((e, i) => {
            const anterior = i > 0 ? etapas[i - 1].valor : null;
            const passagem = anterior ? (e.valor / anterior) * 100 : null;
            return (
              <tr key={`${i}-${e.rotulo}`}>
                <th scope="row">{e.rotulo}</th>
                <td class="kt-funil-barra-celula">
                  <div class="kt-funil-trilho">
                    <div class="kt-funil-barra" style={{ width: `${Math.max(e.valor > 0 ? 1.5 : 0, (e.valor / maximo) * 100)}%` }} />
                  </div>
                </td>
                <td class="kt-num kt-funil-valor">{inteiro(e.valor)}</td>
                <td class="kt-num">{passagem == null ? '' : <span class="kt-funil-passagem">{percentual(passagem, 0)}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

export function SituacaoCarga({ cargaPendente }: { cargaPendente: boolean; sincronizadoEm?: string | null }) {
  if (!cargaPendente) return null;
  return <Aviso>Carregando os últimos 90 dias do Meta. Os números aparecem aos poucos; esta tela se atualiza sozinha.</Aviso>;
}

function Cabecalho({ icone, titulo, descricao }: { icone: NomeIcone; titulo: string; descricao: string }) {
  return (
    <div class="kt-secao">
      <span class="kt-secao-icone">
        <Icone nome={icone} tamanho={16} />
      </span>
      <div>
        <h2>{titulo}</h2>
        <p class="kt-muted">{descricao}</p>
      </div>
    </div>
  );
}

export function VisaoGeral({ carga }: { carga: Carga<Dados> }) {
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  const moeda = dados.moeda;
  const semAtendimento = !dados.metricas.entradas;
  const periodo = `${diaLongo(dados.periodo.de)} a ${diaLongo(dados.periodo.ate)}${dados.anterior ? ` · comparado com ${diaLongo(dados.anterior.de)} a ${diaLongo(dados.anterior.ate)}` : ''}`;
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <SituacaoCarga cargaPendente={dados.cargaPendente} />

      <Cabecalho icone="megafone" titulo="No Meta" descricao={periodo} />
      <section class="kt-indicadores" aria-label="Indicadores do Meta">
        {DO_META.map((i) => (
          <Cartao key={i.chave} indicador={i} dados={dados} />
        ))}
      </section>

      <Cabecalho icone="mensagem" titulo="No atendimento" descricao="Leads de anúncio que chegaram à Kentro e o que virou venda" />
      {semAtendimento ? (
        <section class="kt-card">
          <Vazio icone="mensagem" titulo="Nenhum lead de anúncio chegou ao atendimento neste período">
            Os números aparecem quando os atendentes usam o painel Origem do lead ou a automação da Kentro está ligada (Configurações › Integração com o
            atendimento).
          </Vazio>
        </section>
      ) : (
        <section class="kt-indicadores" aria-label="Indicadores do atendimento">
          {DO_ATENDIMENTO.map((i) => (
            <Cartao key={i.chave} indicador={i} dados={dados} />
          ))}
        </section>
      )}
      {dados.organicos > 0 && (
        <p class="kt-muted kt-nota">
          <Icone nome="info" tamanho={14} /> Mais {inteiro(dados.organicos)} atendimentos sem anúncio identificado no período (fora do funil e do ROAS).
        </p>
      )}

      <Cabecalho icone="calendario" titulo="Dia a dia" descricao="Investimento e leads por dia, em gráficos separados (escalas diferentes)" />
      {/* Grandezas diferentes, gráficos diferentes (nunca um eixo duplo). */}
      <section class="kt-graficos">
        <GraficoColunas
          titulo="Investimento por dia"
          resumo={dinheiro(dados.metricas.investimento, moeda)}
          pontos={dados.serie.map((d) => ({ dia: d.data, valor: d.investimento }))}
          formatar={(v) => dinheiro(v, moeda)}
          formatarEixo={(v) => dinheiroCompacto(v, moeda)}
        />
        <GraficoColunas
          titulo="Leads por dia"
          resumo={`${inteiro(dados.metricas.leads)} leads`}
          pontos={dados.serie.map((d) => ({ dia: d.data, valor: d.leads }))}
          formatar={(v) => `${inteiro(v)} ${v === 1 ? 'lead' : 'leads'}`}
          formatarEixo={compacto}
        />
        {!semAtendimento && <Funil m={dados.metricas} funil={dados.funil} />}
      </section>
    </div>
  );
}
