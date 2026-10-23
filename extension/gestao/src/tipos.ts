export type Papel = 'admin' | 'gestor' | 'atendimento';

export interface Conta {
  id: string;
  nome: string | null;
  status: 'pendente_conexao' | 'ativa' | 'reconectar' | 'bloqueada';
  plano: string;
  fuso: string;
  moeda: string;
  papel: Papel;
  loginMetaDisponivel: boolean;
}

export interface ChavesNovas {
  contaId: string;
  chaveAdmin: string;
  chaveGestor: string;
  chaveAtendimento: string;
}

export type DefinicaoLead = 'formulario' | 'conversa' | 'site';

/** Andamento: um passo do funil. Venda: pede o valor e entra na receita. Perda: pede o motivo. */
export type TipoEtapa = 'andamento' | 'venda' | 'perda';

/** Etapa do funil que o admin define em Configurações › Etapas do funil. */
export interface EtapaFunil {
  id: string;
  chave: string;
  nome: string;
  tipo: TipoEtapa;
  ordem: number;
  /** Chegar aqui (ou além) conta como lead qualificado. */
  qualificada: boolean;
  eventoMeta: string | null;
  botaoAtendente: boolean;
  noPainel: boolean;
  ativa: boolean;
}

export interface ContaAnuncio {
  id: string;
  idMeta: string;
  nome: string;
  moeda: string;
  fuso: string;
  empresa: string | null;
  ativaNoMeta: boolean;
  selecionada: boolean;
  definicaoLead: DefinicaoLead[];
  sincronizacao: {
    cargaConcluidaEm: string | null;
    /** Dias da carga inicial já trazidos (de 90). */
    diasCarregados?: number;
    ultimaEm: string | null;
    ultimoErro: string | null;
    /** O Meta pediu para esperar (ou o uso chegou perto do teto): nova tentativa só depois disso. */
    limitadaAte?: string | null;
    emAndamento: boolean;
  };
}

export type EstadoConexao =
  | { conectado: false; loginMetaDisponivel: boolean; contasAnuncio: [] }
  | {
      conectado: true;
      loginMetaDisponivel: boolean;
      tipo: 'token_manual' | 'login_empresa';
      status: 'ativa' | 'reconectar';
      usuarioMeta: string;
      escopos: string[];
      verificadoEm: string;
      ultimoErro: string | null;
      contasAnuncio: ContaAnuncio[];
      avisos?: string[];
    };

export interface Metricas {
  investimento: number;
  impressoes: number;
  cliques: number;
  cliquesLink: number;
  leads: number;
  conversas: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  custoPorConversa: number | null;
  entradas: number;
  qualificados: number;
  vendas: number;
  receita: number;
  roas: number | null;
  custoPorVenda: number | null;
  taxaVenda: number | null;
}

interface Situacao {
  cargaPendente: boolean;
  sincronizadoEm: string | null;
}

export interface VisaoGeral extends Situacao {
  moeda: string;
  periodo: { de: string; ate: string };
  anterior: { de: string; ate: string; metricas: Metricas } | null;
  metricas: Metricas;
  organicos: number;
  serie: { data: string; investimento: number; leads: number; conversas: number; impressoes: number; cliquesLink: number }[];
  /** O funil do atendimento nas etapas da conta: quem chegou a cada uma ou além. */
  funil?: { id: string; nome: string; tipo: TipoEtapa; leads: number }[];
  contasAnuncio: number;
}

export interface NoCampanha {
  idMeta: string;
  nome: string;
  status: string | null;
  metricas: Metricas;
}

export interface Campanhas extends Situacao {
  moeda: string;
  campanhas: (NoCampanha & { conjuntos: (NoCampanha & { anuncios: NoCampanha[] })[] })[];
}

export interface Criativos extends Situacao {
  moeda: string;
  criativos: (NoCampanha & { campanha: string | null; titulo: string | null; texto: string | null; miniatura: string | null })[];
}

export interface Filtros extends Situacao {
  contasAnuncio: { id: string; nome: string; moeda: string; fuso: string }[];
  campanhas: { idMeta: string; nome: string; contaAnuncioId: string; ativa: boolean }[];
}
