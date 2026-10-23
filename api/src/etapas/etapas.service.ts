import { Injectable } from '@nestjs/common';
import { EtapaFunil, Prisma, TipoEtapa } from '@prisma/client';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';

export const EVENTO_META = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
export const MAX_ETAPAS = 20;

/** A lista que toda conta começa: as etapas de antes de o funil ser configurável. */
const PADRAO: Omit<Prisma.EtapaFunilCreateManyInput, 'contaId'>[] = [
  { chave: 'qualificado', nome: 'Qualificado', tipo: 'andamento', ordem: 1, qualificada: true, eventoMeta: 'QualifiedLead' },
  { chave: 'venda', nome: 'Venda', tipo: 'venda', ordem: 2, eventoMeta: 'Purchase' },
  { chave: 'descartado', nome: 'Descartado', tipo: 'perda', ordem: 3, eventoMeta: null },
];

/** Os nomes que a automação da Kentro usava antes: valem enquanto a conta não tiver etapa com essa chave. */
const LEGADO: Record<string, (e: EtapaFunil) => boolean> = {
  qualificado: (e) => e.tipo === 'andamento' && e.qualificada,
  venda: (e) => e.tipo === 'venda',
  descartado: (e) => e.tipo === 'perda',
};

export interface EtapaEnviada {
  id?: string;
  nome: string;
  tipo: TipoEtapa;
  qualificada?: boolean;
  eventoMeta?: string | null;
  botaoAtendente?: boolean;
  noPainel?: boolean;
  ativa?: boolean;
}

/** Nome técnico a partir do nome: sem acento, minúsculo, "_" no lugar do resto. */
export function chaveDe(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'etapa';
}

export function etapaPublica(e: EtapaFunil) {
  return {
    id: e.id,
    chave: e.chave,
    nome: e.nome,
    tipo: e.tipo,
    ordem: e.ordem,
    qualificada: e.qualificada,
    eventoMeta: e.eventoMeta,
    botaoAtendente: e.botaoAtendente,
    noPainel: e.noPainel,
    ativa: e.ativa,
  };
}

@Injectable()
export class EtapasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Na ordem do funil. Conta sem nenhuma recebe a lista padrão na primeira leitura. */
  async listar(contaId: string): Promise<EtapaFunil[]> {
    const etapas = await this.prisma.etapaFunil.findMany({ where: { contaId }, orderBy: { ordem: 'asc' } });
    if (etapas.length > 0) return etapas;
    await this.prisma.etapaFunil.createMany({ data: PADRAO.map((e) => ({ ...e, contaId })), skipDuplicates: true });
    return this.prisma.etapaFunil.findMany({ where: { contaId }, orderBy: { ordem: 'asc' } });
  }

  /**
   * A etapa que o painel do atendente ou a automação pediram: pelo id, pela chave ou pelos nomes de
   * antes (qualificado, venda, descartado). Etapa desativada não recebe lead.
   */
  async resolver(contaId: string, ref: string): Promise<EtapaFunil> {
    const etapas = await this.listar(contaId);
    const valor = ref.trim();
    const achada =
      etapas.find((e) => e.id === valor) ?? etapas.find((e) => e.chave === valor) ?? (LEGADO[valor] ? etapas.find((e) => e.ativa && LEGADO[valor](e)) : undefined);
    if (!achada) {
      const validas = etapas.filter((e) => e.ativa).map((e) => e.chave);
      throw new ErroApi(400, 'ETAPA_DESCONHECIDA', `Etapa desconhecida. Use: em_atendimento, ${validas.join(', ')}.`);
    }
    if (!achada.ativa) throw new ErroApi(400, 'ETAPA_DESATIVADA', `A etapa "${achada.nome}" está desativada. Ative em Configurações › Etapas do funil.`);
    return achada;
  }

  /**
   * Grava a lista inteira na ordem recebida. Etapa sem id é criada; etapa que ficou de fora é excluída,
   * a não ser que algum lead já tenha passado por ela (aí só dá para desativar).
   */
  async salvar(contaId: string, enviadas: EtapaEnviada[]): Promise<EtapaFunil[]> {
    const atuais = await this.listar(contaId);
    const porId = new Map(atuais.map((e) => [e.id, e]));
    if (enviadas.length === 0) throw new ErroApi(400, 'ETAPAS_VAZIAS', 'O funil precisa de pelo menos uma etapa.');
    if (enviadas.length > MAX_ETAPAS) throw new ErroApi(400, 'ETAPAS_DEMAIS', `No máximo ${MAX_ETAPAS} etapas.`);

    const nomes = new Set<string>();
    for (const e of enviadas) {
      const nome = e.nome.trim();
      if (!nome) throw new ErroApi(400, 'NOME_OBRIGATORIO', 'Toda etapa precisa de um nome.');
      if (nomes.has(nome.toLowerCase())) throw new ErroApi(400, 'NOME_REPETIDO', `Duas etapas com o nome "${nome}".`);
      nomes.add(nome.toLowerCase());
      if (e.id && !porId.has(e.id)) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Etapa não encontrada.');
      if (e.eventoMeta && !EVENTO_META.test(e.eventoMeta)) throw new ErroApi(400, 'EVENTO_INVALIDO', `Nome de evento do Meta inválido: "${e.eventoMeta}".`);
    }

    const removidas = atuais.filter((a) => !enviadas.some((e) => e.id === a.id));
    for (const r of removidas) {
      const usada = await this.prisma.lead.count({ where: { contaId, OR: [{ etapaId: r.id }, { etapasAlcancadas: { has: r.id } }] } });
      if (usada > 0) {
        throw new ErroApi(409, 'ETAPA_EM_USO', `"${r.nome}" já tem leads (${usada}). Desative a etapa em vez de excluir: o histórico continua nos painéis.`);
      }
    }

    const chaves = new Set(atuais.filter((a) => !removidas.includes(a)).map((a) => a.chave));
    const novaChave = (nome: string) => {
      const base = chaveDe(nome);
      let chave = base;
      for (let i = 2; chaves.has(chave) || chave === 'em_atendimento' || chave === 'chat_iniciado' || chave === 'novo'; i++) chave = `${base}_${i}`;
      chaves.add(chave);
      return chave;
    };

    await this.prisma.$transaction(async (tx) => {
      if (removidas.length) await tx.etapaFunil.deleteMany({ where: { contaId, id: { in: removidas.map((r) => r.id) } } });
      for (const [i, e] of enviadas.entries()) {
        const dados = {
          nome: e.nome.trim().slice(0, 40),
          tipo: e.tipo,
          ordem: i + 1,
          // Venda já conta como qualificado; perda não entra na contagem.
          qualificada: e.tipo === 'andamento' && !!e.qualificada,
          eventoMeta: e.eventoMeta?.trim() || null,
          botaoAtendente: e.botaoAtendente ?? true,
          noPainel: e.noPainel ?? true,
          ativa: e.ativa ?? true,
        };
        if (e.id) await tx.etapaFunil.update({ where: { id: e.id }, data: dados });
        else await tx.etapaFunil.create({ data: { ...dados, contaId, chave: novaChave(e.nome) } });
      }
    });
    return this.listar(contaId);
  }
}
