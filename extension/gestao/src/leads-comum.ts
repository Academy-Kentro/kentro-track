import type { EtapaFunil, TipoEtapa } from './tipos';

/** Situação do lead (derivada da etapa do funil). */
export type Etapa = 'novo' | 'em_atendimento' | 'qualificado' | 'venda' | 'descartado';

export interface LeadDaLista {
  id: string;
  origem: 'ctwa' | 'formulario' | 'link' | 'organico';
  etapa: Etapa;
  etapaId?: string | null;
  etapaNome?: string | null;
  etapaTipo?: TipoEtapa | null;
  nome: string | null;
  telefone: string | null;
  chatId: string | null;
  recebidoEm: string;
  atendente: string | null;
  primeiraRespostaEm?: string | null;
  ultimaMensagemEm?: string | null;
  valorVenda: number | null;
  campanha: string | null;
  anuncio: string | null;
  vinculoAproximado: boolean;
}

export interface DadosLeads {
  pagina: number;
  temMais: boolean;
  /** Por "novo", "em_atendimento" ou id da etapa do funil. */
  porEtapa: Record<string, number>;
  /** Conversas do período em que o cliente escreveu e a equipe ainda não respondeu. */
  aguardandoResposta?: number;
  etapas?: EtapaFunil[];
  itens: LeadDaLista[];
}

export interface FiltroLeads {
  origem: '' | 'ctwa' | 'formulario' | 'link' | 'organico';
  /** "novo", "em_atendimento" ou o id da etapa do funil. */
  etapa: string;
  pagina: number;
  busca?: string;
  conjunto?: string;
  anuncio?: string;
  /** Id do atendente na Kentro, ou "sem". */
  atendente?: string;
  vendaDe?: string;
  vendaAte?: string;
  ordem?: '' | 'antigos' | 'maior_venda' | 'nome' | 'ultima_mensagem';
  aguardando?: boolean;
}

export const FILTRO_LEADS_PADRAO: FiltroLeads = { origem: '', etapa: '', pagina: 1 };

export type VisaoLeads = 'lista' | 'colunas' | 'lote';

/** Antes de qualquer etapa do funil. */
export const SITUACOES: { id: string; rotulo: string; classe: string }[] = [
  { id: 'novo', rotulo: 'Novos', classe: 'novo' },
  { id: 'em_atendimento', rotulo: 'Em atendimento', classe: 'em_atendimento' },
];

/** A cor da etapa vem do tipo: andamento como qualificado, venda verde, perda vermelha. */
export const CLASSE_TIPO: Record<TipoEtapa, Etapa> = { andamento: 'qualificado', venda: 'venda', perda: 'descartado' };

export const ORIGENS: { id: FiltroLeads['origem']; rotulo: string }[] = [
  { id: '', rotulo: 'Todas as origens' },
  { id: 'ctwa', rotulo: 'Anúncio (WhatsApp)' },
  { id: 'formulario', rotulo: 'Formulário' },
  { id: 'link', rotulo: 'Link rastreável' },
  { id: 'organico', rotulo: 'Sem anúncio' },
];

/** O período e a campanha da barra de cima (`base`) mais os filtros da aba Leads. */
export function consultaLeads(base: string, filtro: FiltroLeads): string {
  const q = new URLSearchParams(base);
  if (filtro.origem) q.set('origem', filtro.origem);
  if (filtro.etapa) q.set('etapa', filtro.etapa);
  if (filtro.busca?.trim()) q.set('busca', filtro.busca.trim());
  if (filtro.conjunto) q.set('conjunto', filtro.conjunto);
  if (filtro.anuncio) q.set('anuncio', filtro.anuncio);
  if (filtro.atendente) q.set('atendente', filtro.atendente);
  if (filtro.vendaDe) q.set('vendaDe', filtro.vendaDe);
  if (filtro.vendaAte) q.set('vendaAte', filtro.vendaAte);
  if (filtro.ordem) q.set('ordem', filtro.ordem);
  if (filtro.aguardando) q.set('aguardando', '1');
  if (filtro.pagina > 1) q.set('pagina', String(filtro.pagina));
  return q.toString();
}

/** Quantos filtros do painel "Filtros" estão ligados (o botão mostra o número). */
export const filtrosAtivos = (f: FiltroLeads): number => [f.conjunto, f.anuncio, f.atendente, f.vendaDe || f.vendaAte, f.ordem].filter(Boolean).length;

/** "1.234,50" → 1234.5 (NaN se não for número). */
export const lerValor = (texto: string): number => Number(texto.trim().replace(/\./g, '').replace(',', '.'));
