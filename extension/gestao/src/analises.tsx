import type { ComponentChildren } from 'preact';
import { Aviso, Carregando } from '../../comum/componentes';
import { compacto, dinheiro, dinheiroCompacto, inteiro, percentual, vezes } from '../../comum/formato';
import { Icone, NomeIcone } from '../../comum/icones';
import type { Carga } from './filtro';
import { BarrasHorizontais, GraficoColunas, LeadsDdd, LeadsUf, MapaBrasil, MapaCalor } from './graficos';

type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'venda' | 'descartado';

interface ItemRanking {
  idMeta: string;
  nome: string;
  investimento: number;
  entradas: number;
  vendas: number;
  receita: number;
  roas: number | null;
  custoPorVenda: number | null;
}

export interface DadosAnalises {
  moeda: string;
  periodo: { de: string; ate: string };
  origens: { total: number; percentualRastreado: number | null; itens: { origem: string; leads: number; vendas: number; receita: number }[] };
  porDia: { data: string; entradas: number; vendas: number; receita: number }[];
  etapas: Partial<Record<Etapa, number>>;
  motivosDescarte: { motivo: string; leads: number }[];
  estados: { itens: LeadsUf[]; ddds: LeadsDdd[]; semEstado: number };
  horario: { diaSemana: number; hora: number; leads: number }[];
  tempoAtendimento: { faixas: { id: string; rotulo: string; leads: number }[]; naoAtendidos: number };
  ranking: { campanhas: ItemRanking[]; conjuntos: ItemRanking[]; anuncios: ItemRanking[] };
}

const ORIGEM: Record<string, string> = {
  ctwa: 'Anúncio de WhatsApp',
  formulario: 'Formulário de anúncio',
  link: 'Link rastreável',
  organico: 'Sem anúncio (orgânico)',
};

const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: 'novo', rotulo: 'Novo (ainda sem atendente)' },
  { id: 'em_atendimento', rotulo: 'Em atendimento' },
  { id: 'qualificado', rotulo: 'Qualificado' },
  { id: 'venda', rotulo: 'Venda' },
  { id: 'descartado', rotulo: 'Descartado' },
];

function Bloco({ icone, titulo, descricao, colunas = 3, children }: { icone: NomeIcone; titulo: string; descricao: string; colunas?: 2 | 3; children: ComponentChildren }) {
  return (
    <section class="kt-bloco">
      <div class="kt-secao">
        <span class="kt-secao-icone">
          <Icone nome={icone} tamanho={16} />
        </span>
        <div>
          <h2>{titulo}</h2>
          <p class="kt-muted">{descricao}</p>
        </div>
      </div>
      <div class={`kt-graficos kt-graficos-${colunas}`}>{children}</div>
    </section>
  );
}

const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

export function Analises({ carga }: { carga: Carga<DadosAnalises> }) {
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  const moeda = dados.moeda;
  const r = dados.ranking;
  const detalheRanking = (i: ItemRanking) =>
    `${plural(i.entradas, 'lead', 'leads')} · ${plural(i.vendas, 'venda', 'vendas')} · investido ${dinheiro(i.investimento, moeda)}${i.roas != null ? ` · ROAS ${vezes(i.roas)}` : ''}`;
  const totalTempo = dados.tempoAtendimento.faixas.reduce((a, f) => a + f.leads, 0) + dados.tempoAtendimento.naoAtendidos;

  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Bloco icone="funil" titulo="De onde vêm os leads" descricao="Origem de cada atendimento e quanto dele foi rastreado até um anúncio" colunas={2}>
        <div class="kt-grafico kt-destaques">
          <div class="kt-destaque">
            <span class="kt-destaque-rotulo">Leads no período</span>
            <span class="kt-destaque-valor">{compacto(dados.origens.total)}</span>
          </div>
          <div class="kt-destaque">
            <span class="kt-destaque-rotulo">Rastreados até um anúncio</span>
            <span class="kt-destaque-valor">{percentual(dados.origens.percentualRastreado, 1)}</span>
            <span class="kt-destaque-trilho" aria-hidden="true">
              <span style={{ width: `${dados.origens.percentualRastreado ?? 0}%` }} />
            </span>
          </div>
        </div>
        <BarrasHorizontais
          titulo="Leads por origem"
          barras={dados.origens.itens.map((o) => ({
            rotulo: ORIGEM[o.origem] ?? o.origem,
            valor: o.leads,
            detalhe: `${plural(o.vendas, 'venda', 'vendas')} · ${dinheiro(o.receita, moeda)}`,
          }))}
          formatar={inteiro}
        />
      </Bloco>

      <Bloco icone="calendario" titulo="Dia a dia do atendimento" descricao="Leads pelo dia em que chegaram; vendas e faturamento pelo dia em que a venda foi registrada">
        <GraficoColunas
          titulo="Leads que chegaram"
          resumo={plural(dados.porDia.reduce((a, d) => a + d.entradas, 0), 'lead', 'leads')}
          pontos={dados.porDia.map((d) => ({ dia: d.data, valor: d.entradas }))}
          formatar={(v) => plural(v, 'lead', 'leads')}
          formatarEixo={compacto}
        />
        <GraficoColunas
          titulo="Vendas"
          resumo={plural(dados.porDia.reduce((a, d) => a + d.vendas, 0), 'venda', 'vendas')}
          pontos={dados.porDia.map((d) => ({ dia: d.data, valor: d.vendas }))}
          formatar={(v) => plural(v, 'venda', 'vendas')}
          formatarEixo={compacto}
        />
        <GraficoColunas
          titulo="Faturamento"
          resumo={dinheiro(dados.porDia.reduce((a, d) => a + d.receita, 0), moeda)}
          pontos={dados.porDia.map((d) => ({ dia: d.data, valor: d.receita }))}
          formatar={(v) => dinheiro(v, moeda)}
          formatarEixo={(v) => dinheiroCompacto(v, moeda)}
        />
      </Bloco>

      <Bloco icone="estrela" titulo="O que mais vende" descricao="Campanhas, públicos (conjuntos) e criativos pela receita que geraram no atendimento" colunas={2}>
        <BarrasHorizontais
          titulo="Campanhas por faturamento"
          barras={r.campanhas.map((i) => ({ rotulo: i.nome, valor: i.receita, detalhe: detalheRanking(i) }))}
          formatar={(v) => dinheiro(v, moeda)}
          vazio="Nenhuma venda de anúncio no período."
        />
        <BarrasHorizontais
          titulo="ROAS por campanha"
          subtitulo="Faturamento ÷ investimento"
          barras={r.campanhas.filter((i) => i.roas != null).map((i) => ({ rotulo: i.nome, valor: i.roas!, detalhe: detalheRanking(i) }))}
          formatar={vezes}
          vazio="Sem investimento e venda no mesmo período."
        />
        <BarrasHorizontais
          titulo="Públicos que mais vendem"
          subtitulo="Conjuntos de anúncios"
          barras={r.conjuntos.map((i) => ({ rotulo: i.nome, valor: i.vendas, detalhe: detalheRanking(i) }))}
          formatar={inteiro}
          vazio="Nenhuma venda de anúncio no período."
        />
        <BarrasHorizontais
          titulo="Criativos que mais vendem"
          barras={r.anuncios.map((i) => ({ rotulo: i.nome, valor: i.vendas, detalhe: detalheRanking(i) }))}
          formatar={inteiro}
          vazio="Nenhuma venda de anúncio no período."
        />
      </Bloco>

      <Bloco icone="alvo" titulo="Jornada e gargalos" descricao="Em que etapa estão os leads do período, por que os perdidos foram perdidos e quanto demoram a ser atendidos">
        <BarrasHorizontais
          titulo="Etapa atual dos leads"
          barras={ETAPAS.map((e) => ({ rotulo: e.rotulo, valor: dados.etapas[e.id] ?? 0 }))}
          formatar={inteiro}
        />
        <BarrasHorizontais
          titulo="Motivos de descarte"
          barras={dados.motivosDescarte.map((m) => ({ rotulo: m.motivo, valor: m.leads }))}
          formatar={inteiro}
          vazio="Nenhum lead descartado no período."
        />
        <BarrasHorizontais
          titulo="Tempo até o atendimento"
          subtitulo="Do lead chegar até alguém abrir o painel da conversa"
          barras={[
            ...dados.tempoAtendimento.faixas.map((f) => ({ rotulo: f.rotulo, valor: f.leads, detalhe: totalTempo ? percentual((f.leads / totalTempo) * 100, 0) + ' dos leads' : undefined })),
            { rotulo: 'Ainda não atendidos', valor: dados.tempoAtendimento.naoAtendidos },
          ]}
          formatar={inteiro}
        />
      </Bloco>

      <Bloco icone="relogio" titulo="Quando e onde" descricao="Horário de chegada (no fuso da conta) e de onde vêm os leads, pelo DDD do telefone" colunas={2}>
        <MapaCalor titulo="Chegada de leads por dia e hora" subtitulo="Bom para escalar a equipe nos horários de pico" celulas={dados.horario} />
        <MapaBrasil
          titulo="Leads por estado"
          subtitulo={dados.estados.semEstado ? `Pelo DDD · ${plural(dados.estados.semEstado, 'lead', 'leads')} sem DDD brasileiro identificado` : 'Pelo DDD do telefone'}
          estados={dados.estados.itens}
          ddds={dados.estados.ddds}
        />
        <BarrasHorizontais
          titulo="Leads por DDD"
          subtitulo="As 10 regiões que mais trazem leads"
          barras={dados.estados.ddds.slice(0, 10).map((d) => ({
            rotulo: `${d.ddd} · ${d.cidade ?? d.uf}`,
            valor: d.leads,
            detalhe: `${d.cidade ? `${d.cidade} e região (${d.uf})` : d.uf} · ${plural(d.vendas, 'venda', 'vendas')}`,
          }))}
          formatar={inteiro}
          vazio="Nenhum lead com DDD brasileiro no período."
        />
      </Bloco>
    </div>
  );
}
