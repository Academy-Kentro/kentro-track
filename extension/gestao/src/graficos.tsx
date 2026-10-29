import { MapChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent, AriaComponent } from 'echarts/components';
import { init, registerMap, use, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef, useState } from 'preact/hooks';
import { diaCurto, diaLongo } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { MAPA_BRASIL } from './mapa-brasil';

// Só o que o mapa do Brasil usa: o resto do ECharts fica fora do pacote.
use([MapChart, TooltipComponent, VisualMapComponent, AriaComponent, SVGRenderer]);
registerMap('BR', MAPA_BRASIL as unknown as Parameters<typeof registerMap>[1]);

export interface Ponto {
  dia: string;
  valor: number;
}

interface Props {
  titulo: string;
  /** Total do período, ao lado do título. */
  resumo?: string;
  pontos: Ponto[];
  formatar: (v: number) => string;
  formatarEixo: (v: number) => string;
}

const ALTURA = 160;
const MARGEM = { topo: 8, direita: 8, base: 22, esquerda: 52 };
const LARGURA_MAX_BARRA = 24;
const ESPACO = 2;
const RAIO = 4;

/** Topo "redondo" (1, 2, 2,5, 5 × 10ⁿ) para o eixo terminar num número limpo. */
export function tetoRedondo(maximo: number): number {
  if (maximo <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(maximo));
  for (const passo of [1, 2, 2.5, 5, 10]) if (passo * potencia >= maximo) return passo * potencia;
  return 10 * potencia;
}

/** Coluna com o topo arredondado (o dado) e a base reta (a linha de base). */
function caminhoColuna(x: number, y: number, largura: number, altura: number): string {
  const r = Math.min(RAIO, largura / 2, altura);
  return `M${x},${y + altura}V${y + r}Q${x},${y} ${x + r},${y}H${x + largura - r}Q${x + largura},${y} ${x + largura},${y + r}V${y + altura}Z`;
}

/** Gráfico de colunas diário de uma série. Uma série só: o título diz o que é, sem legenda. */
export function GraficoColunas({ titulo, resumo, pontos, formatar, formatarEixo }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(600);
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);

  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.max(240, Math.floor(e.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
    // A área é recriada ao voltar da tabela: observa de novo.
  }, [tabela]);

  const teto = tetoRedondo(Math.max(0, ...pontos.map((p) => p.valor)));
  const areaL = largura - MARGEM.esquerda - MARGEM.direita;
  const areaA = ALTURA - MARGEM.topo - MARGEM.base;
  const faixa = pontos.length ? areaL / pontos.length : areaL;
  const barra = Math.max(1, Math.min(LARGURA_MAX_BARRA, faixa - ESPACO));
  const y = (v: number) => MARGEM.topo + areaA - (v / teto) * areaA;
  const marcas = [0, teto / 2, teto];
  // Rótulos do eixo X: primeiro, meio e último dia (nunca um por coluna).
  const rotulosX = pontos.length <= 1 ? [0] : [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1];
  const p = ativo != null ? pontos[ativo] : null;

  return (
    <figure class="kt-grafico">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>{titulo}</h3>
          {resumo && <p class="kt-grafico-resumo">{resumo}</p>}
        </div>
        <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setTabela(!tabela)}>
          <Icone nome={tabela ? 'grafico' : 'lista'} tamanho={14} />
          {tabela ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </figcaption>
      {tabela ? (
        <div class="kt-tabela-rolagem">
          <table class="kt-tabela">
            <thead>
              <tr>
                <th>Dia</th>
                <th class="kt-num">{titulo}</th>
              </tr>
            </thead>
            <tbody>
              {pontos.map((pt) => (
                <tr key={pt.dia}>
                  <td>{diaLongo(pt.dia)}</td>
                  <td class="kt-num">{formatar(pt.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="kt-grafico-area" ref={caixa} onPointerLeave={() => setAtivo(null)}>
          <svg width={largura} height={ALTURA} role="img" aria-label={titulo}>
            {marcas.map((m) => (
              <g key={m}>
                <line class="kt-grade" x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(m)} y2={y(m)} />
                <text class="kt-eixo" x={MARGEM.esquerda - 6} y={y(m) + 4} text-anchor="end">
                  {formatarEixo(m)}
                </text>
              </g>
            ))}
            {pontos.map((pt, i) => {
              const x = MARGEM.esquerda + i * faixa + (faixa - barra) / 2;
              const altura = Math.max(0, y(0) - y(pt.valor));
              return (
                <g key={pt.dia}>
                  {altura > 0 && <path class={`kt-coluna${ativo === i ? ' kt-coluna-ativa' : ''}`} d={caminhoColuna(x, y(pt.valor), barra, altura)} />}
                  {/* Alvo do ponteiro e do teclado: a faixa inteira do dia, maior que a coluna. */}
                  <rect
                    class="kt-alvo"
                    x={MARGEM.esquerda + i * faixa}
                    y={MARGEM.topo}
                    width={faixa}
                    height={areaA}
                    tabIndex={0}
                    aria-label={`${diaLongo(pt.dia)}: ${formatar(pt.valor)}`}
                    onPointerEnter={() => setAtivo(i)}
                    onFocus={() => setAtivo(i)}
                    onBlur={() => setAtivo(null)}
                  />
                </g>
              );
            })}
            {rotulosX.map((i) =>
              pontos[i] ? (
                <text
                  key={i}
                  class="kt-eixo"
                  x={MARGEM.esquerda + i * faixa + faixa / 2}
                  y={ALTURA - 6}
                  text-anchor={i === 0 ? 'start' : i === pontos.length - 1 ? 'end' : 'middle'}
                >
                  {diaCurto(pontos[i].dia)}
                </text>
              ) : null,
            )}
          </svg>
          {p && ativo != null && (
            <div
              class="kt-dica"
              role="status"
              style={{ left: `${Math.min(largura - 150, Math.max(0, MARGEM.esquerda + ativo * faixa + faixa / 2 - 70))}px` }}
            >
              <strong>{formatar(p.valor)}</strong>
              <span>{diaLongo(p.dia)}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Tendência sem eixo, no cartão do indicador: linha de 2 px e uma lavagem de 10% da mesma cor. */
export function Sparkline({ pontos, rotulo }: { pontos: number[]; rotulo: string }) {
  const L = 120;
  const A = 32;
  const max = Math.max(...pontos, 1);
  const passo = pontos.length > 1 ? L / (pontos.length - 1) : L;
  const coords = pontos.map((v, i) => [i * passo, A - 2 - (v / max) * (A - 4)] as const);
  const linha = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return (
    <svg class="kt-sparkline" viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" role="img" aria-label={rotulo}>
      <path class="kt-sparkline-area" d={`${linha}L${L},${A}L0,${A}Z`} />
      <path class="kt-sparkline-linha" d={linha} vector-effect="non-scaling-stroke" />
    </svg>
  );
}

export interface Barra {
  rotulo: string;
  valor: number;
  /** Linha secundária na dica (ex.: "3 vendas · R$ 4.000,00"). */
  detalhe?: string;
}

/**
 * Ranking ou distribuição em barras horizontais, todas na mesma escala. Uma série só: uma cor,
 * o título diz o que é. Rótulo à esquerda, valor na ponta, detalhe na dica (hover e foco).
 */
export function BarrasHorizontais({
  titulo,
  subtitulo,
  barras,
  formatar,
  vazio = 'Sem dados no período.',
}: {
  titulo: string;
  subtitulo?: string;
  barras: Barra[];
  formatar: (v: number) => string;
  vazio?: string;
}) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const maximo = Math.max(...barras.map((b) => b.valor), 0);
  return (
    <figure class="kt-grafico kt-barras">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>{titulo}</h3>
          {subtitulo && <p class="kt-muted">{subtitulo}</p>}
        </div>
      </figcaption>
      {barras.length === 0 || maximo === 0 ? (
        <p class="kt-muted kt-barras-vazio">{vazio}</p>
      ) : (
        <ul class="kt-barras-lista" onPointerLeave={() => setAtiva(null)}>
          {barras.map((b, i) => (
            <li
              key={`${b.rotulo}-${i}`}
              class={ativa === i ? 'kt-barra-ativa' : ''}
              tabIndex={0}
              aria-label={`${b.rotulo}: ${formatar(b.valor)}${b.detalhe ? ` (${b.detalhe})` : ''}`}
              onPointerEnter={() => setAtiva(i)}
              onFocus={() => setAtiva(i)}
              onBlur={() => setAtiva(null)}
            >
              <span class="kt-barra-rotulo" title={b.rotulo}>
                {b.rotulo}
              </span>
              <span class="kt-barra-trilho" aria-hidden="true">
                <span class="kt-barra-preenchida" style={{ width: `${b.valor > 0 ? Math.max(1.5, (b.valor / maximo) * 100) : 0}%` }} />
              </span>
              <span class="kt-barra-valor">{formatar(b.valor)}</span>
              {ativa === i && b.detalhe && (
                <span class="kt-dica kt-barra-dica" role="status">
                  <strong>{b.rotulo}</strong>
                  <span>{b.detalhe}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const DIAS_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/**
 * Mapa de calor dia da semana × hora (sequencial: um tom só, do claro ao escuro, em 5 degraus).
 * Cada célula tem dica no hover e no foco; a legenda mostra o que cada degrau significa.
 */
export function MapaCalor({ titulo, subtitulo, celulas }: { titulo: string; subtitulo?: string; celulas: { diaSemana: number; hora: number; leads: number }[] }) {
  const [ativa, setAtiva] = useState<{ d: number; h: number } | null>(null);
  const valor = new Map(celulas.map((c) => [`${c.diaSemana}|${c.hora}`, c.leads]));
  const maximo = Math.max(1, ...celulas.map((c) => c.leads));
  const degrau = (v: number) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / maximo) * 5)));
  const atual = ativa ? valor.get(`${ativa.d}|${ativa.h}`) ?? 0 : null;
  return (
    <figure class="kt-grafico kt-calor">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>{titulo}</h3>
          {subtitulo && <p class="kt-muted">{subtitulo}</p>}
        </div>
        <span class="kt-calor-leitura" aria-live="polite">
          {ativa ? `${DIAS_LONGOS[ativa.d - 1]}, ${ativa.h}h: ${atual} ${atual === 1 ? 'lead' : 'leads'}` : ''}
        </span>
      </figcaption>
      <div class="kt-calor-grade" onPointerLeave={() => setAtiva(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={`h${h}`} class="kt-calor-hora">
            {h % 3 === 0 ? `${h}h` : ''}
          </span>
        ))}
        {DIAS.map((dia, i) => [
          <span key={`d${i}`} class="kt-calor-dia">
            {dia}
          </span>,
          ...Array.from({ length: 24 }, (_, h) => {
            const v = valor.get(`${i + 1}|${h}`) ?? 0;
            return (
              <span
                key={`${i}-${h}`}
                class={`kt-calor-celula kt-calor-${degrau(v)}`}
                tabIndex={0}
                aria-label={`${DIAS_LONGOS[i]}, ${h}h: ${v} leads`}
                onPointerEnter={() => setAtiva({ d: i + 1, h })}
                onFocus={() => setAtiva({ d: i + 1, h })}
              />
            );
          }),
        ])}
      </div>
      <div class="kt-calor-legenda" aria-hidden="true">
        <span>Menos</span>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <span key={n} class={`kt-calor-celula kt-calor-${n}`} />
        ))}
        <span>Mais (até {maximo})</span>
      </div>
    </figure>
  );
}

const NOMES_UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí',
  PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
  SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

export interface LeadsUf {
  uf: string;
  leads: number;
  vendas: number;
}

export interface LeadsDdd extends LeadsUf {
  ddd: string;
  cidade: string | null;
}

type Rgb = [number, number, number];

/** Resolve uma cor do tema (variável CSS, color-mix…) para RGB: o ECharts desenha em SVG e não lê variáveis CSS. */
function corDoTema(el: HTMLElement, valor: string, padrao: Rgb): Rgb {
  const sonda = document.createElement('span');
  sonda.style.color = valor;
  el.appendChild(sonda);
  const cor = getComputedStyle(sonda).color;
  sonda.remove();
  const n = cor.match(/[\d.]+/g)?.map(Number);
  if (!n || n.length < 3) return padrao;
  // "color(srgb 0.4 0.2 0.8)" vem de 0 a 1; "rgb(102, 51, 204)", de 0 a 255.
  return (cor.startsWith('color(') ? n.slice(0, 3).map((v) => Math.round(v * 255)) : n.slice(0, 3)) as Rgb;
}
const rgb = (c: Rgb) => `rgb(${c.join(',')})`;
const misturar = (cor: Rgb, fundo: Rgb, peso: number) => rgb(cor.map((v, i) => Math.round(v * peso + fundo[i] * (1 - peso))) as Rgb);

/**
 * Mapa de calor do Brasil por estado (o estado sai do DDD do telefone), com o contorno real dos estados
 * (malha do IBGE) desenhado pelo ECharts. A cor vai do tom claro (1 lead) ao primário (o estado com mais
 * leads); estado sem lead fica cinza. Passar o mouse num estado mostra o detalhe dele e os DDDs que mais
 * trouxeram leads; sem nada em foco, o detalhe é o do estado com mais leads.
 */
export function MapaBrasil({ titulo, subtitulo, estados, ddds }: { titulo: string; subtitulo?: string; estados: LeadsUf[]; ddds: LeadsDdd[] }) {
  const [ativo, setAtivo] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const grafico = useRef<EChartsType | null>(null);
  const porUf = new Map(estados.map((e) => [e.uf, e]));
  const maximo = Math.max(1, ...estados.map((e) => e.leads));
  const total = estados.reduce((a, e) => a + e.leads, 0);
  const foco = ativo ?? estados[0]?.uf ?? null;
  const atual = foco ? porUf.get(foco) ?? { uf: foco, leads: 0, vendas: 0 } : null;
  const dddsDoFoco = ddds.filter((d) => d.uf === foco).slice(0, 4);
  const leads = (n: number) => `${n} ${n === 1 ? 'lead' : 'leads'}`;

  // Cria o gráfico uma vez (quando há dado para mostrar) e acompanha o tamanho do cartão.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const g = init(el, undefined, { renderer: 'svg' });
    grafico.current = g;
    g.on('mouseover', (p) => setAtivo(String(p.name)));
    g.on('globalout', () => setAtivo(null));
    const ajustar = () => g.resize();
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(ajustar);
    observador?.observe(el);
    return () => {
      observador?.disconnect();
      g.dispose();
      grafico.current = null;
    };
  }, [total === 0]);

  useEffect(() => {
    const el = caixa.current;
    if (!el || !grafico.current) return;
    const primaria = corDoTema(el, 'var(--ext-color-primary)', [91, 33, 182]);
    const fundo = corDoTema(el, 'var(--ext-color-bg)', [255, 255, 255]);
    const texto = rgb(corDoTema(el, 'var(--ext-color-text)', [17, 24, 39]));
    const apagado = rgb(corDoTema(el, 'var(--ext-color-text-muted)', [107, 114, 128]));
    const vazio = rgb(corDoTema(el, 'var(--kt-superficie-2)', [241, 241, 244]));
    const linha = rgb(corDoTema(el, 'var(--kt-linha)', [229, 231, 235]));
    const nome = (uf: string) => NOMES_UF[uf] ?? uf;
    grafico.current.setOption(
      {
        aria: {
          enabled: true,
          label: { description: `Mapa do Brasil com os leads por estado: ${estados.map((e) => `${nome(e.uf)} ${leads(e.leads)}`).join(', ')}.` },
        },
        tooltip: {
          trigger: 'item',
          backgroundColor: rgb(fundo),
          borderColor: linha,
          textStyle: { color: texto, fontSize: 12 },
          formatter: (p: { name: string }) => `<strong>${nome(p.name)}</strong><br/>${leads(porUf.get(p.name)?.leads ?? 0)}`,
        },
        visualMap: {
          type: 'continuous',
          // Escala logarítmica: com um estado muito à frente (ex.: 122 × 3), a linear deixava quem tem
          // poucos leads quase da cor de quem não tem nenhum.
          min: 0,
          max: Math.log(Math.max(2, maximo)),
          inRange: { color: [misturar(primaria, fundo, 0.25), rgb(primaria)] },
          text: [`${maximo}`, '1'],
          textStyle: { color: apagado, fontSize: 11 },
          orient: 'horizontal',
          left: 0,
          bottom: 0,
          itemWidth: 10,
          itemHeight: 110,
          calculable: false,
          realtime: false,
        },
        series: [
          {
            type: 'map',
            map: 'BR',
            roam: false,
            selectedMode: false,
            top: 4,
            bottom: 28,
            // Estado sem lead vai sem valor: o visualMap o ignora e ele fica com esta cor (cinza), sem parecer "pouco".
            itemStyle: { areaColor: vazio, borderColor: rgb(fundo), borderWidth: 0.8 },
            // areaColor/color nulos mantêm a cor do estado no hover; só a borda destaca.
            emphasis: { label: { show: true, color: texto, fontWeight: 'bold' }, itemStyle: { areaColor: null, color: null, borderColor: texto, borderWidth: 1.5 } },
            data: Object.keys(NOMES_UF).map((uf) => {
              const n = porUf.get(uf)?.leads ?? 0;
              return { name: uf, value: n > 0 ? Math.log(n) : null };
            }),
          },
        ],
      } as Parameters<EChartsType['setOption']>[0],
      true,
    );
  }, [estados, maximo, total]);

  return (
    <figure class="kt-grafico kt-mapa">
      <figcaption class="kt-grafico-topo">
        <div>
          <h3>{titulo}</h3>
          {subtitulo && <p class="kt-muted">{subtitulo}</p>}
        </div>
      </figcaption>
      {total === 0 ? (
        <p class="kt-muted kt-barras-vazio">Nenhum lead com DDD brasileiro no período.</p>
      ) : (
        <div class="kt-mapa-corpo">
          <div class="kt-mapa-desenho" ref={caixa} />
          {atual && (
            <div class="kt-mapa-detalhe" aria-live="polite">
              <span class="kt-mapa-detalhe-nome">{NOMES_UF[atual.uf] ?? atual.uf}</span>
              <strong class="kt-mapa-detalhe-valor">{leads(atual.leads)}</strong>
              <span class="kt-muted">
                {Math.round((atual.leads / total) * 100)}% do total · {atual.vendas} {atual.vendas === 1 ? 'venda' : 'vendas'}
                {atual.leads ? ` (${Math.round((atual.vendas / atual.leads) * 100)}%)` : ''}
              </span>
              {dddsDoFoco.length > 0 && (
                <ul class="kt-mapa-ddds">
                  {dddsDoFoco.map((d) => (
                    <li key={d.ddd}>
                      <span class="kt-mapa-ddd">{d.ddd}</span>
                      <span class="kt-mapa-cidade">{d.cidade ?? NOMES_UF[d.uf]}</span>
                      <span class="kt-mapa-ddd-valor">{d.leads}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
