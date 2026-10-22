import { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { haQuanto } from '../../comum/formato';
import { Icone, NomeIcone } from '../../comum/icones';
import type { Filtros } from './tipos';

export type Preset =
  | 'hoje'
  | 'ontem'
  | 'ultimos7'
  | 'ultimos14'
  | 'ultimos30'
  | 'ultimos90'
  | 'mes'
  | 'mesPassado'
  | 'personalizado';

export const PRESETS: { id: Preset; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'ontem', rotulo: 'Ontem' },
  { id: 'ultimos7', rotulo: 'Últimos 7 dias' },
  { id: 'ultimos14', rotulo: 'Últimos 14 dias' },
  { id: 'ultimos30', rotulo: 'Últimos 30 dias' },
  { id: 'ultimos90', rotulo: 'Últimos 90 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mesPassado', rotulo: 'Mês passado' },
  { id: 'personalizado', rotulo: 'Personalizado…' },
];

/** O Kentro Track carrega 90 dias do Meta ao conectar (DIAS_CARGA): o período não volta além disso. */
export const MAX_DIAS_PERIODO = 90;

export interface Filtro {
  preset: Preset;
  contaAnuncio: string;
  campanha: string;
  /** Só no personalizado: AAAA-MM-DD. */
  de?: string;
  ate?: string;
}

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Período do preset no relógio de quem está vendo (o mesmo dia que a pessoa chama de "hoje"). */
export function periodo(preset: Preset, hoje = new Date()): { de: string; ate: string } {
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const menos = (n: number) => new Date(h.getFullYear(), h.getMonth(), h.getDate() - n);
  switch (preset) {
    case 'hoje':
      return { de: dia(h), ate: dia(h) };
    case 'ontem':
      return { de: dia(menos(1)), ate: dia(menos(1)) };
    case 'ultimos7':
      return { de: dia(menos(6)), ate: dia(h) };
    case 'ultimos14':
      return { de: dia(menos(13)), ate: dia(h) };
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

/** O período em vigor: as datas escolhidas no personalizado, ou as do preset. */
export function intervalo(filtro: Filtro, hoje = new Date()): { de: string; ate: string } {
  if (filtro.preset === 'personalizado' && filtro.de && filtro.ate && DIA.test(filtro.de) && DIA.test(filtro.ate) && filtro.de <= filtro.ate) {
    // Guardado há dias: o início pode ter saído da janela de 90 dias.
    return datasPersonalizadas(filtro.de, filtro.ate, 'ate', hoje);
  }
  return periodo(filtro.preset === 'personalizado' ? 'ultimos30' : filtro.preset, hoje);
}

export function consulta(filtro: Filtro): string {
  const { de, ate } = intervalo(filtro);
  const q = new URLSearchParams({ de, ate });
  if (filtro.contaAnuncio) q.set('contaAnuncio', filtro.contaAnuncio);
  if (filtro.campanha) q.set('campanha', filtro.campanha);
  return q.toString();
}

/** Primeiro dia que o personalizado aceita: hoje e os 89 anteriores. */
export function primeiroDia(hoje = new Date()): string {
  return dia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (MAX_DIAS_PERIODO - 1)));
}

/** Ajusta as datas do personalizado: dentro dos últimos 90 dias e fim nunca antes do início. */
export function datasPersonalizadas(de: string, ate: string, mexeu: 'de' | 'ate', hoje = new Date()): { de: string; ate: string } {
  const [min, max] = [primeiroDia(hoje), dia(hoje)];
  const limitar = (d: string) => (d < min ? min : d > max ? max : d);
  let d = limitar(de);
  let a = limitar(ate);
  if (d > a) {
    if (mexeu === 'de') a = d;
    else d = a;
  }
  return { de: d, ate: a };
}

/** Seletor com ícone e chevron próprios: o <select> nativo continua por baixo (teclado, leitor de tela). */
export function Seletor({ icone, rotulo, valor, mudar, children }: { icone: NomeIcone; rotulo: string; valor: string; mudar: (v: string) => void; children: ComponentChildren }) {
  return (
    <label class="kt-select" title={rotulo}>
      <Icone nome={icone} tamanho={15} />
      <span class="kt-invisivel">{rotulo}</span>
      <select value={valor} onChange={(e) => mudar((e.target as HTMLSelectElement).value)}>
        {children}
      </select>
    </label>
  );
}

/** Início e fim do personalizado com o calendário do navegador. */
function Datas({ filtro, mudar }: { filtro: Filtro; mudar: (f: Filtro) => void }) {
  const { de, ate } = intervalo(filtro);
  const [min, hoje] = [primeiroDia(), dia(new Date())];
  const trocar = (campo: 'de' | 'ate', valor: string) => {
    if (!DIA.test(valor)) return;
    mudar({ ...filtro, ...datasPersonalizadas(campo === 'de' ? valor : de, campo === 'ate' ? valor : ate, campo) });
  };
  return (
    <div class="kt-datas" role="group" aria-label="Datas do período">
      <label class="kt-data">
        <span class="kt-invisivel">De</span>
        <input type="date" value={de} min={min} max={hoje} onChange={(e) => trocar('de', (e.target as HTMLInputElement).value)} />
      </label>
      <span class="kt-muted" aria-hidden="true">
        até
      </span>
      <label class="kt-data">
        <span class="kt-invisivel">Até</span>
        <input type="date" value={ate} min={min} max={hoje} onChange={(e) => trocar('ate', (e.target as HTMLInputElement).value)} />
      </label>
    </div>
  );
}

/** Uma linha de filtros acima de todas as abas: período primeiro. */
export function BarraFiltros({ filtro, opcoes, mudar }: { filtro: Filtro; opcoes: Filtros | null; mudar: (f: Filtro) => void }) {
  const campanhas = (opcoes?.campanhas ?? []).filter((c) => !filtro.contaAnuncio || c.contaAnuncioId === filtro.contaAnuncio);
  return (
    <div class="kt-filtros" role="group" aria-label="Filtros">
      <Seletor
        icone="calendario"
        rotulo="Período"
        valor={filtro.preset}
        // Ao abrir o personalizado, parte do período que estava na tela.
        mudar={(v) => mudar(v === 'personalizado' ? { ...filtro, preset: 'personalizado', ...intervalo(filtro) } : { ...filtro, preset: v as Preset })}
      >
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.rotulo}
          </option>
        ))}
      </Seletor>
      {filtro.preset === 'personalizado' && <Datas filtro={filtro} mudar={mudar} />}
      {(opcoes?.contasAnuncio.length ?? 0) > 1 && (
        <Seletor icone="maleta" rotulo="Conta de anúncio" valor={filtro.contaAnuncio} mudar={(v) => mudar({ ...filtro, contaAnuncio: v, campanha: '' })}>
          <option value="">Todas as contas</option>
          {opcoes!.contasAnuncio.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Seletor>
      )}
      {campanhas.length > 0 && (
        <Seletor icone="megafone" rotulo="Campanha" valor={filtro.campanha} mudar={(v) => mudar({ ...filtro, campanha: v })}>
          <option value="">Todas as campanhas</option>
          {/* Ativas primeiro: são as que o gestor acompanha no dia a dia. */}
          {[
            { rotulo: 'Ativas', itens: campanhas.filter((c) => c.ativa) },
            { rotulo: 'Pausadas', itens: campanhas.filter((c) => !c.ativa) },
          ]
            .filter((g) => g.itens.length > 0)
            .map((g) => (
              <optgroup key={g.rotulo} label={g.rotulo}>
                {g.itens.map((c) => (
                  <option key={c.idMeta} value={c.idMeta}>
                    {c.nome}
                    {c.ativa ? '' : ' (pausada)'}
                  </option>
                ))}
              </optgroup>
            ))}
        </Seletor>
      )}
      {opcoes?.sincronizadoEm && (
        <span class="kt-filtros-estado" title={`Última sincronização com o Meta: ${new Date(opcoes.sincronizadoEm).toLocaleString('pt-BR')}`}>
          <Icone nome="atualizar" tamanho={14} />
          Meta atualizado {haQuanto(opcoes.sincronizadoEm)}
        </span>
      )}
    </div>
  );
}

export type Carga<T> = { dados: T | null; erro: string; carregando: boolean; recarregar?: () => void };

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

  return { ...estado, recarregar: () => setTique((t) => t + 1) };
}
