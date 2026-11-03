import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Aviso, Carregando, Interruptor } from '../../comum/componentes';
import { compacto, dinheiro, dinheiroCompacto, inteiro, percentual, vezes } from '../../comum/formato';
import { Icone, NomeIcone } from '../../comum/icones';
import type { Carga } from './filtro';
import { BarrasHorizontais, GraficoColunas, GraficoEmpilhado, LeadsDdd, LeadsUf, MapaBrasil, MapaCalor } from './graficos';

type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'venda' | 'descartado';
type BaseFunil = 'contato' | 'venda';

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
  porDia: { data: string; entradas: number; vendas: number; receita: number; origens?: Record<string, number> }[];
  etapas: Partial<Record<Etapa, number>>;
  motivosDescarte: { motivo: string; leads: number }[];
  estados: { itens: LeadsUf[]; ddds: LeadsDdd[]; semEstado: number };
  horario: { diaSemana: number; hora: number; leads: number }[];
  tempoAtendimento: { faixas: { id: string; rotulo: string; leads: number }[]; naoAtendidos: number };
  /** Só existe com as mensagens ligadas (Configurações › Integração); API anterior não manda. */
  tempoResposta?: { respondidos: number; aguardando: number; minutosPrimeira: number | null; minutosSegunda: number | null };
  /** API anterior não manda os dois abaixo. */
  tempoJornada?: { vendas: number; minutos: number | null };
  funil?: Record<BaseFunil, { id: string; nome: string; leads: number }[]>;
  ranking: { campanhas: ItemRanking[]; conjuntos: ItemRanking[]; anuncios: ItemRanking[] };
}

const ORIGEM: Record<string, string> = {
  ctwa: 'Anúncio de WhatsApp',
  formulario: 'Formulário de anúncio',
  link: 'Link rastreável',
  organico: 'Sem anúncio (orgânico)',
};

/** Rastreadas na base, onde dá para comparar os dias; o que veio sem anúncio fica neutro, em cima. */
const SERIES_ORIGEM = [
  { id: 'ctwa', rotulo: ORIGEM.ctwa, classe: 'kt-serie-1' },
  { id: 'formulario', rotulo: ORIGEM.formulario, classe: 'kt-serie-2' },
  { id: 'link', rotulo: ORIGEM.link, classe: 'kt-serie-3' },
  { id: 'organico', rotulo: ORIGEM.organico, classe: 'kt-serie-neutra' },
];

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

const duracao = (min: number) => {
  if (min < 60) return `${inteiro(min)} min`;
  if (min < 48 * 60) return `${(min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return `${(min / 1440).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
};

/** Do lead chegar à resposta do atendente. A saudação manual de cada atendente distorce: daí a opção da 2ª mensagem. */
function TempoResposta({ dados }: { dados: DadosAnalises['tempoResposta'] }) {
  const [daSegunda, setDaSegunda] = useState(false);
  const minutos = daSegunda ? dados?.minutosSegunda : dados?.minutosPrimeira;
  return (
    <figure class="kt-grafico kt-tempo-resposta">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>Tempo de resposta</h3>
          <p class="kt-muted">Do lead chegar até o atendente responder</p>
        </div>
      </figcaption>
      {!dados || (dados.respondidos === 0 && dados.aguardando === 0) ? (
        <p class="kt-muted">Sem dados no período. Ligue as mensagens em Configurações › Integração com o atendimento.</p>
      ) : (
        <>
          <strong class="kt-tempo-valor">{minutos == null ? '—' : duracao(minutos)}</strong>
          <p class="kt-muted">
            {plural(dados.respondidos, 'conversa respondida', 'conversas respondidas')} · {plural(dados.aguardando, 'aguardando', 'aguardando')}
          </p>
          <Interruptor ligado={daSegunda} mudar={setDaSegunda}>
            Calcular a partir da 2ª mensagem
          </Interruptor>
        </>
      )}
    </figure>
  );
}

/** Do primeiro contato até a venda, nas vendas registradas no período. */
function TempoJornada({ dados }: { dados: NonNullable<DadosAnalises['tempoJornada']> }) {
  return (
    <figure class="kt-grafico kt-tempo-jornada">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>Tempo médio de jornada</h3>
          <p class="kt-muted">Do primeiro contato até a venda</p>
        </div>
      </figcaption>
      {dados.minutos == null ? (
        <p class="kt-muted">Nenhuma venda no período.</p>
      ) : (
        <>
          <strong class="kt-tempo-valor">{duracao(dados.minutos)}</strong>
          <p class="kt-muted">{plural(dados.vendas, 'venda do período', 'vendas do período')}</p>
        </>
      )}
    </figure>
  );
}

const BASES_FUNIL: { id: BaseFunil; rotulo: string }[] = [
  { id: 'contato', rotulo: 'Data do contato' },
  { id: 'venda', rotulo: 'Data da venda' },
];

/** Os mesmos passos por duas perguntas: o que aconteceu com quem chegou no período, e de onde vieram as vendas dele. */
function FunilJornada({ funil }: { funil: NonNullable<DadosAnalises['funil']> }) {
  const [base, setBase] = useState<BaseFunil>('contato');
  const passos = funil[base];
  return (
    <BarrasHorizontais
      titulo="Funil da jornada"
      subtitulo={base === 'contato' ? 'Leads que chegaram no período e até onde foram' : 'Leads que compraram no período e por onde passaram'}
      barras={passos.map((p, i) => {
        const anterior = passos[i - 1]?.leads;
        return { rotulo: p.nome, valor: p.leads, detalhe: anterior ? `${percentual((p.leads / anterior) * 100, 1)} da etapa anterior` : undefined };
      })}
      formatar={inteiro}
      vazio={base === 'contato' ? 'Nenhum lead no período.' : 'Nenhuma venda no período.'}
      acoes={
        <div class="kt-chips" role="group" aria-label="Contar pela">
          {BASES_FUNIL.map((b) => (
            <button key={b.id} type="button" class="kt-chip" aria-pressed={base === b.id} onClick={() => setBase(b.id)}>
              {b.rotulo}
            </button>
          ))}
        </div>
      }
    />
  );
}

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
        {dados.porDia.some((d) => d.origens) && (
          <GraficoEmpilhado
            titulo="Origem dos leads por dia"
            resumo={plural(dados.porDia.reduce((a, d) => a + d.entradas, 0), 'lead', 'leads')}
            series={SERIES_ORIGEM}
            pontos={dados.porDia.map((d) => ({ dia: d.data, valores: d.origens ?? {} }))}
            formatar={inteiro}
            formatarEixo={compacto}
          />
        )}
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

      <Bloco icone="alvo" titulo="Jornada e gargalos" descricao="Até onde os leads foram, em que etapa estão, por que os perdidos foram perdidos e quanto demoram a ser atendidos e a comprar">
        {dados.funil && <FunilJornada funil={dados.funil} />}
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
        <TempoResposta dados={dados.tempoResposta} />
        {dados.tempoJornada && <TempoJornada dados={dados.tempoJornada} />}
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
