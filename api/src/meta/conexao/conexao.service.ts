import { Inject, Injectable } from '@nestjs/common';
import { ContaAnuncio } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../../comum/config';
import { cifrar, decifrar } from '../../comum/cripto';
import { ErroApi } from '../../comum/erros';
import { PrismaService } from '../../comum/prisma.service';
import { ClienteGraph, TokenMeta } from '../cliente/graph';
import { ErroMeta, PermissaoFaltando, TokenInvalido } from '../cliente/erros';

const DEFINICOES = ['formulario', 'conversa', 'site'] as const;
export type DefinicaoLead = (typeof DEFINICOES)[number];

/** Sem estas, os painéis ficam vazios: a tela avisa logo na conexão. */
const ESCOPOS_ESSENCIAIS = ['ads_read'];

interface ContaAnuncioGraph {
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { name?: string };
}

export interface SelecaoConta {
  id: string;
  selecionada: boolean;
  definicaoLead?: DefinicaoLead[];
}

function contaPublica(c: ContaAnuncio) {
  return {
    id: c.id,
    idMeta: c.idMeta,
    nome: c.nome,
    moeda: c.moeda,
    fuso: c.fuso,
    empresa: c.empresa,
    ativaNoMeta: c.statusMeta === 1,
    selecionada: c.selecionada,
    definicaoLead: c.definicaoLead,
    sincronizacao: {
      cargaConcluidaEm: c.cargaConcluidaEm,
      ultimaEm: c.ultimaSincronizacaoEm,
      ultimoErro: c.ultimoErro,
      emAndamento: !!c.emExecucaoAte && c.emExecucaoAte > new Date(),
    },
  };
}

/** Mensagem para o admin a partir da falha do Meta ao conectar. */
function mensagemDeConexao(erro: ErroMeta): ErroApi {
  if (erro instanceof TokenInvalido) {
    return new ErroApi(400, 'TOKEN_META_INVALIDO', 'O Meta recusou este token (inválido, expirado ou revogado). Gere um novo no Business Manager e cole de novo.');
  }
  if (erro instanceof PermissaoFaltando) {
    return new ErroApi(400, 'PERMISSAO_META_FALTANDO', `O token não tem a permissão necessária: ${erro.message}`);
  }
  return new ErroApi(502, erro.codigo, `Não foi possível falar com o Meta agora: ${erro.message}`);
}

@Injectable()
export class ConexaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: ClienteGraph,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /** Token de usuário do sistema colado pelo admin: confere no Meta antes de guardar. */
  async conectarTokenManual(contaId: string, valor: string) {
    const token: TokenMeta = { valor: valor.trim(), doNossoApp: false };
    const ctx = { contaId, operacao: 'conectar' };
    let usuario: { id: string; name?: string };
    let contas: ContaAnuncioGraph[];
    let escopos: string[] = [];
    try {
      usuario = await this.graph.get(token, 'me', { fields: 'id,name' }, ctx);
      contas = await this.graph.listar<ContaAnuncioGraph>(
        token,
        'me/adaccounts',
        { fields: 'id,name,currency,timezone_name,account_status,business{name}', limit: 200 },
        ctx,
        20,
      );
    } catch (erro) {
      if (erro instanceof ErroMeta) throw mensagemDeConexao(erro);
      throw erro;
    }
    try {
      const permissoes = await this.graph.listar<{ permission: string; status: string }>(token, 'me/permissions', {}, ctx, 2);
      escopos = permissoes.filter((p) => p.status === 'granted').map((p) => p.permission);
    } catch {
      // Alguns tokens de usuário do sistema não leem /me/permissions: segue sem a lista.
    }
    if (contas.length === 0) {
      throw new ErroApi(
        400,
        'SEM_CONTAS_DE_ANUNCIO',
        'O token funciona, mas não enxerga nenhuma conta de anúncio. No Business Manager, abra Usuários do sistema › Atribuir ativos e dê acesso às contas de anúncio.',
      );
    }

    const { cifrado, iv } = cifrar(token.valor, this.config.chaveMestra);
    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      const dados = {
        tipo: 'token_manual' as const,
        tokenCifrado: new Uint8Array(cifrado),
        iv: new Uint8Array(iv),
        usuarioMetaId: String(usuario.id),
        usuarioMetaNome: usuario.name?.trim() || String(usuario.id),
        escopos,
        status: 'ativa' as const,
        verificadoEm: agora,
        ultimoErro: null,
      };
      await tx.conexaoMeta.upsert({ where: { contaId }, create: { contaId, ...dados }, update: dados });
      for (const c of contas) {
        const dadosConta = {
          nome: c.name?.trim() || c.id,
          moeda: c.currency || 'BRL',
          fuso: c.timezone_name || 'America/Sao_Paulo',
          statusMeta: c.account_status ?? null,
          empresa: c.business?.name ?? null,
        };
        await tx.contaAnuncio.upsert({
          where: { contaId_idMeta: { contaId, idMeta: c.id } },
          create: { contaId, idMeta: c.id, ...dadosConta },
          update: dadosConta,
        });
      }
      await tx.conta.update({ where: { id: contaId }, data: { status: 'ativa' } });
    });

    const faltando = escopos.length ? ESCOPOS_ESSENCIAIS.filter((e) => !escopos.includes(e)) : [];
    return { ...(await this.estado(contaId)), avisos: faltando.map((e) => `O token não tem a permissão ${e}: os números das campanhas não vão chegar.`) };
  }

  async estado(contaId: string) {
    const [conexao, contas] = await Promise.all([
      this.prisma.conexaoMeta.findUnique({ where: { contaId } }),
      this.prisma.contaAnuncio.findMany({ where: { contaId }, orderBy: [{ selecionada: 'desc' }, { nome: 'asc' }] }),
    ]);
    if (!conexao) return { conectado: false as const, loginMetaDisponivel: this.config.meta !== null, contasAnuncio: [] };
    return {
      conectado: true as const,
      loginMetaDisponivel: this.config.meta !== null,
      tipo: conexao.tipo,
      status: conexao.status,
      usuarioMeta: conexao.usuarioMetaNome,
      escopos: conexao.escopos,
      verificadoEm: conexao.verificadoEm,
      ultimoErro: conexao.ultimoErro,
      contasAnuncio: contas.map(contaPublica),
    };
  }

  async selecionar(contaId: string, selecao: SelecaoConta[]) {
    const ids = selecao.map((s) => s.id);
    const existentes = await this.prisma.contaAnuncio.findMany({ where: { contaId, id: { in: ids } } });
    if (existentes.length !== new Set(ids).size) {
      throw new ErroApi(404, 'NAO_ENCONTRADO', 'Conta de anúncio não encontrada. Atualize a tela e tente de novo.');
    }
    const porId = new Map(existentes.map((c) => [c.id, c]));
    const agora = new Date();
    await this.prisma.$transaction(
      selecao.map((s) => {
        const antes = porId.get(s.id)!;
        const passaASerSincronizada = s.selecionada && !antes.selecionada;
        return this.prisma.contaAnuncio.update({
          where: { id: s.id },
          data: {
            selecionada: s.selecionada,
            ...(s.definicaoLead ? { definicaoLead: [...new Set(s.definicaoLead)] } : {}),
            // Selecionar agenda a carga já: a agenda pega no próximo ciclo.
            ...(passaASerSincronizada ? { proximaHorariaEm: agora, proximaEntidadesEm: agora, ultimoErro: null } : {}),
          },
        });
      }),
    );
    return this.estado(contaId);
  }

  /** "Sincronizar agora": antecipa a agenda da conta de anúncio. */
  async sincronizarAgora(contaId: string, contaAnuncioId: string) {
    const conta = await this.prisma.contaAnuncio.findFirst({ where: { id: contaAnuncioId, contaId, selecionada: true } });
    if (!conta) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Conta de anúncio não encontrada ou não selecionada.');
    const agora = new Date();
    await this.prisma.contaAnuncio.update({
      where: { id: conta.id },
      data: { proximaHorariaEm: agora, proximaEntidadesEm: agora, proximoRecalculoEm: agora, ultimoErro: null },
    });
    return this.estado(contaId);
  }

  /** Desconectar apaga o token e para a sincronização; os números já carregados continuam. */
  async desconectar(contaId: string) {
    await this.prisma.$transaction([
      this.prisma.conexaoMeta.deleteMany({ where: { contaId } }),
      this.prisma.contaAnuncio.updateMany({ where: { contaId }, data: { selecionada: false } }),
      this.prisma.conta.update({ where: { id: contaId }, data: { status: 'pendente_conexao' } }),
    ]);
    return this.estado(contaId);
  }

  /** Token decifrado só para a chamada; null sem conexão ou com conexão para reconectar. */
  async token(contaId: string): Promise<TokenMeta | null> {
    const conexao = await this.prisma.conexaoMeta.findUnique({ where: { contaId } });
    if (!conexao || conexao.status !== 'ativa') return null;
    return {
      valor: decifrar(Buffer.from(conexao.tokenCifrado), Buffer.from(conexao.iv), this.config.chaveMestra),
      doNossoApp: conexao.tipo === 'login_empresa',
    };
  }

  /** O Meta recusou o token: para tudo e mostra "reconectar" (os envios futuros esperam). */
  async marcarReconectar(contaId: string, motivo: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.conexaoMeta.updateMany({ where: { contaId }, data: { status: 'reconectar', ultimoErro: motivo.slice(0, 500) } }),
      this.prisma.conta.updateMany({ where: { id: contaId, status: { not: 'bloqueada' } }, data: { status: 'reconectar' } }),
    ]);
  }
}

export { DEFINICOES };
