import { Aviso } from '../../comum/componentes';
import { compacto, diaLongo, dinheiro, dinheiroCompacto, inteiro, percentual, variacao } from '../../comum/formato';
import { GraficoColunas } from './graficos';
import type { Carga } from './filtro';
import type { Metricas, VisaoGeral as Dados } from './tipos';

interface Indicador {
  rotulo: string;
  chave: keyof Metricas;
  formato: 'dinheiro' | 'inteiro' | 'percentual';
  melhorQuandoSobe: boolean;
  destaque?: boolean;
  ajuda?: string;
}

const INDICADORES: Indicador[] = [
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

function valorFormatado(i: Indicador, v: number | null, moeda: string): string {
  if (i.formato === 'dinheiro') return dinheiro(v, moeda);
  if (i.formato === 'percentual') return percentual(v);
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
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <SituacaoCarga cargaPendente={dados.cargaPendente} sincronizadoEm={dados.sincronizadoEm} />
      <p class="kt-muted">
        {diaLongo(dados.periodo.de)} a {diaLongo(dados.periodo.ate)}
        {dados.anterior && ` · comparado com ${diaLongo(dados.anterior.de)} a ${diaLongo(dados.anterior.ate)}`}
      </p>
      <section class="kt-indicadores" aria-label="Indicadores do período">
        {INDICADORES.map((i) => (
          <Cartao key={i.chave} indicador={i} dados={dados} />
        ))}
      </section>
      {/* Duas grandezas, dois gráficos com o mesmo eixo de dias (nunca um eixo duplo). */}
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
      </section>
    </div>
  );
}
