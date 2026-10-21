import { useEffect, useRef, useState } from 'preact/hooks';
import { diaCurto, diaLongo } from '../../comum/formato';
import { Icone } from '../../comum/icones';

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
