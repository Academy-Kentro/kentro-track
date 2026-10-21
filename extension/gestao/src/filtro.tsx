import { useEffect, useRef, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import type { Filtros } from './tipos';

export type Preset = 'ultimos7' | 'ultimos30' | 'ultimos90' | 'mes' | 'mesPassado';

export const PRESETS: { id: Preset; rotulo: string }[] = [
  { id: 'ultimos7', rotulo: 'Últimos 7 dias' },
  { id: 'ultimos30', rotulo: 'Últimos 30 dias' },
  { id: 'ultimos90', rotulo: 'Últimos 90 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mesPassado', rotulo: 'Mês passado' },
];

export interface Filtro {
  preset: Preset;
  contaAnuncio: string;
  campanha: string;
}

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Período do preset no relógio de quem está vendo (o mesmo dia que a pessoa chama de "hoje"). */
export function periodo(preset: Preset, hoje = new Date()): { de: string; ate: string } {
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const menos = (n: number) => new Date(h.getFullYear(), h.getMonth(), h.getDate() - n);
  switch (preset) {
    case 'ultimos7':
      return { de: dia(menos(6)), ate: dia(h) };
    case 'ultimos90':
      return { de: dia(menos(89)), ate: dia(h) };
    case 'mes':
      return { de: dia(new Date(h.getFullYear(), h.getMonth(), 1)), ate: dia(h) };
    case 'mesPassado':
      return { de: dia(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: dia(new Date(h.getFullYear(), h.getMonth(), 0)) };
    default:
      return { de: dia(menos(29)), ate: dia(h) };
  }
}

export function consulta(filtro: Filtro): string {
  const { de, ate } = periodo(filtro.preset);
  const q = new URLSearchParams({ de, ate });
  if (filtro.contaAnuncio) q.set('contaAnuncio', filtro.contaAnuncio);
  if (filtro.campanha) q.set('campanha', filtro.campanha);
  return q.toString();
}

/** Uma linha de filtros acima de todas as abas: período primeiro. */
export function BarraFiltros({ filtro, opcoes, mudar }: { filtro: Filtro; opcoes: Filtros | null; mudar: (f: Filtro) => void }) {
  const campanhas = (opcoes?.campanhas ?? []).filter((c) => !filtro.contaAnuncio || c.contaAnuncioId === filtro.contaAnuncio);
  return (
    <div class="kt-filtros" role="group" aria-label="Filtros">
      <label>
        <span>Período</span>
        <select value={filtro.preset} onChange={(e) => mudar({ ...filtro, preset: (e.target as HTMLSelectElement).value as Preset })}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.rotulo}
            </option>
          ))}
        </select>
      </label>
      {(opcoes?.contasAnuncio.length ?? 0) > 1 && (
        <label>
          <span>Conta de anúncio</span>
          <select value={filtro.contaAnuncio} onChange={(e) => mudar({ ...filtro, contaAnuncio: (e.target as HTMLSelectElement).value, campanha: '' })}>
            <option value="">Todas</option>
            {opcoes!.contasAnuncio.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      {campanhas.length > 0 && (
        <label>
          <span>Campanha</span>
          <select value={filtro.campanha} onChange={(e) => mudar({ ...filtro, campanha: (e.target as HTMLSelectElement).value })}>
            <option value="">Todas</option>
            {campanhas.map((c) => (
              <option key={c.idMeta} value={c.idMeta}>
                {c.nome}
                {c.ativa ? '' : ' (pausada)'}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export type Carga<T> = { dados: T | null; erro: string; carregando: boolean };

/**
 * Busca a rota da aba a cada mudança de filtro. Enquanto recarrega, mantém os dados anteriores
 * (a tela esmaece em vez de piscar) e descarta a resposta de um filtro que já mudou.
 */
export function useDados<T>(api: Api, caminho: string | null, recarregarACada?: number): Carga<T> {
  const [estado, setEstado] = useState<Carga<T>>({ dados: null, erro: '', carregando: !!caminho });
  const pedido = useRef(0);
  const [tique, setTique] = useState(0);

  useEffect(() => {
    if (!caminho) return;
    const meu = ++pedido.current;
    setEstado((e) => ({ ...e, carregando: true }));
    api<T>(caminho).then(
      (dados) => meu === pedido.current && setEstado({ dados, erro: '', carregando: false }),
      (erro) => meu === pedido.current && setEstado((e) => ({ dados: e.dados, erro: mensagemDeErro(erro), carregando: false })),
    );
  }, [api, caminho, tique]);

  useEffect(() => {
    if (!recarregarACada || !caminho) return;
    const relogio = setInterval(() => setTique((t) => t + 1), recarregarACada);
    return () => clearInterval(relogio);
  }, [recarregarACada, caminho]);

  return estado;
}
