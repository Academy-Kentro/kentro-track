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
