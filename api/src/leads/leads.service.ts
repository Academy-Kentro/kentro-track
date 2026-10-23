import { Inject, Injectable, Logger } from '@nestjs/common';
import { EtapaFunil, Lead, Prisma } from '@prisma/client';
import { CapiService } from '../capi/capi.service';
import { Gatilho } from '../capi/evento';
import { assinar, conferirAssinatura } from '../comum/assinatura';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { etapaPublica, EtapasService } from '../etapas/etapas.service';
import { PainelService } from '../painel/painel.service';
import { normalizarTelefone } from './telefone';

/** O anúncio como a extensão (campo `ad` da mensagem) ou a automação (message_ad_*) o descrevem. */
export interface ResumoAnuncio {
  idAnuncio?: string;
  ctwaClid?: string;
  url?: string;
  titulo?: string;
  texto?: string;
}

export interface Atendimento {
  chatId: string;
  telefone?: string;
  nome?: string;
  contatoId?: string;
  anuncio?: ResumoAnuncio | null;
}

export interface Autor {
  tipo: 'atendente' | 'kentro' | 'sistema';
  id?: string;
  nome?: string;
}


/** Formulário do mesmo telefone até 30 dias antes: a conversa é continuação dele, não outra entrada. */
const JANELA_FORMULARIO_DIAS = 30;
const MAX_TEXTO = 2000;

const limpo = (v: unknown, max = 300) => {
  const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  // Variável da automação que não existia chega como "{{...}}" ou vazia.
  return t && !/^\{\{.*\}\}$/.test(t) ? t.slice(0, max) : undefined;
};

const normalizarTexto = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function limparAnuncio(a: unknown): ResumoAnuncio | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const r: ResumoAnuncio = {
    idAnuncio: limpo(o.idAnuncio ?? o.id, 40),
    ctwaClid: limpo(o.ctwaClid, 500),
    url: limpo(o.url, 1000),
    titulo: limpo(o.titulo, 300),
    texto: limpo(o.texto, MAX_TEXTO),
  };
  if (r.idAnuncio && !/^\d+$/.test(r.idAnuncio)) r.idAnuncio = undefined;
  return Object.values(r).some(Boolean) ? r : null;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('Leads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly painel: PainelService,
    private readonly capi: CapiService,
    private readonly etapas: EtapasService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  /** Evento para o pixel: falha aqui nunca derruba o atendimento (o lead já foi gravado). */
  private async avisarMeta(lead: Lead, gatilhos: Gatilho[]): Promise<void> {
    for (const g of gatilhos) {
      try {
        await this.capi.enfileirar(lead, g);
      } catch (e) {
        this.logger.error(`Enfileirar ${g} do lead ${lead.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /**
   * Acha o anúncio sincronizado que trouxe a conversa, do jeito mais exato que os dados permitem:
   * pelo id; pela URL do post (permalink do Instagram ou id do post do Facebook); pelo título + texto.
   */
  async resolverAnuncio(contaId: string, a: ResumoAnuncio) {
    const selecionar = { id: true, contaAnuncioId: true, idMeta: true, conjuntoIdMeta: true, campanhaIdMeta: true } as const;
    if (a.idAnuncio) {
      const porId = await this.prisma.anuncio.findFirst({ where: { contaId, idMeta: a.idAnuncio }, select: selecionar });
      if (porId) return { ...porId, vinculo: 'id' as const };
    }
    if (a.url) {
      const [porUrl] = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM anuncios
        WHERE conta_id = ${contaId}::uuid
          AND (permalink = ${a.url}
               OR (position('_' in object_story_id) > 0 AND length(split_part(object_story_id, '_', 2)) >= 6
                   AND strpos(${a.url}, split_part(object_story_id, '_', 2)) > 0))
        ORDER BY (status_efetivo = 'ACTIVE') DESC, atualizado_em DESC
        LIMIT 1`;
      if (porUrl) {
        const anuncio = await this.prisma.anuncio.findUniqueOrThrow({ where: { id: porUrl.id }, select: selecionar });
        return { ...anuncio, vinculo: 'url' as const };
      }
    }
    if (a.titulo || a.texto) {
      const candidatos = await this.prisma.anuncio.findMany({
        where: { contaId, OR: [...(a.titulo ? [{ titulo: { not: null } }] : []), ...(a.texto ? [{ texto: { not: null } }] : [])] },
        select: { ...selecionar, titulo: true, texto: true, statusEfetivo: true, atualizadoEm: true },
        orderBy: { atualizadoEm: 'desc' },
        take: 2000,
      });
      const titulo = a.titulo ? normalizarTexto(a.titulo) : null;
      const texto = a.texto ? normalizarTexto(a.texto) : null;
      const pontuar = (c: (typeof candidatos)[number]) =>
        (titulo && c.titulo && normalizarTexto(c.titulo) === titulo ? 1 : 0) + (texto && c.texto && normalizarTexto(c.texto) === texto ? 1 : 0);
      const melhor = candidatos
        .map((c) => ({ c, p: pontuar(c) }))
        .filter((x) => x.p > 0)
        .sort((x, y) => y.p - x.p || Number(y.c.statusEfetivo === 'ACTIVE') - Number(x.c.statusEfetivo === 'ACTIVE'))[0];
      if (melhor) {
        const { id, contaAnuncioId, idMeta, conjuntoIdMeta, campanhaIdMeta } = melhor.c;
        return { id, contaAnuncioId, idMeta, conjuntoIdMeta, campanhaIdMeta, vinculo: 'texto' as const };
      }
    }
    return null;
  }

  private dadosDoAnuncio(a: ResumoAnuncio | null, achado: Awaited<ReturnType<LeadsService['resolverAnuncio']>>): Partial<Prisma.LeadUncheckedCreateInput> {
    if (!a) return {};
    return {
      anuncioUrl: a.url ?? null,
      anuncioTitulo: a.titulo ?? null,
      anuncioTexto: a.texto ?? null,
      ctwaClid: a.ctwaClid ?? null,
      ...(achado
        ? {
            contaAnuncioId: achado.contaAnuncioId,
            campanhaIdMeta: achado.campanhaIdMeta,
            conjuntoIdMeta: achado.conjuntoIdMeta,
            anuncioIdMeta: achado.idMeta,
            vinculoAnuncio: achado.vinculo,
          }
        : { anuncioIdMeta: a.idAnuncio ?? null }),
    };
  }

  private async evento(leadId: string, tipo: string, texto: string, autor: Autor, tx: Prisma.TransactionClient = this.prisma) {
    await tx.eventoLead.create({ data: { leadId, tipo, texto: texto.slice(0, 500), autor: autor.tipo, autorNome: autor.nome?.slice(0, 120) ?? null } });
  }

  /**
   * Registra (ou reencontra) o lead de um atendimento. Chamado pelo painel do atendente ao abrir a
   * conversa e pela automação da Kentro quando o atendimento começa: os dois caminhos convergem no
   * mesmo lead (chave conta + chatId).
   */
  async registrarAtendimento(contaId: string, dados: Atendimento, autor: Autor, marcarAtendido: boolean): Promise<Lead> {
    const chatId = limpo(dados.chatId, 40);
    if (!chatId || !/^\d+$/.test(chatId)) throw new ErroApi(400, 'CHAT_INVALIDO', 'Id do atendimento inválido.');
    const fone = normalizarTelefone(dados.telefone);
    const anuncio = limparAnuncio(dados.anuncio);
    const agora = new Date();
    const atendente = autor.tipo === 'atendente' ? { atendenteId: autor.id ?? null, atendenteNome: autor.nome ?? null } : {};

    const existente = await this.prisma.lead.findUnique({ where: { contaId_chatId: { contaId, chatId } } });
    if (existente) {
      const dadosNovos: Prisma.LeadUncheckedUpdateInput = {};
      // A automação pode ter chegado sem o anúncio e o painel achar depois (ou vice-versa).
      if (anuncio && !existente.anuncioIdMeta && !existente.anuncioTitulo && !existente.anuncioUrl) {
        Object.assign(dadosNovos, this.dadosDoAnuncio(anuncio, await this.resolverAnuncio(contaId, anuncio)), { origem: 'ctwa' });
      }
      if (!existente.telefone && fone) Object.assign(dadosNovos, { telefone: fone.telefone, telefoneChave: fone.chave });
      if (!existente.nome && limpo(dados.nome)) dadosNovos.nome = limpo(dados.nome);
      if (marcarAtendido && !existente.atendidoEm) {
        Object.assign(dadosNovos, { atendidoEm: agora, ...atendente }, existente.etapa === 'novo' ? { etapa: 'em_atendimento' } : {});
      }
      if (Object.keys(dadosNovos).length === 0) return existente;
      const atualizado = await this.prisma.lead.update({ where: { id: existente.id }, data: dadosNovos });
      if (dadosNovos.atendidoEm) await this.evento(existente.id, 'atendido', `Atendimento aberto${autor.nome ? ` por ${autor.nome}` : ''}.`, autor);
      // Só agora se soube que veio de anúncio: o "lead recebido" sai agora.
      if (dadosNovos.origem === 'ctwa') await this.avisarMeta(atualizado, ['lead_recebido']);
      return atualizado;
    }

    const base = {
      chatId,
      contatoId: limpo(dados.contatoId, 40) ?? null,
      ...(marcarAtendido ? { atendidoEm: agora, etapa: 'em_atendimento' as const, ...atendente } : {}),
    };

    // Sem anúncio na conversa: pode ser a continuação de um formulário do mesmo telefone.
    if (!anuncio && fone) {
      const desde = new Date(agora.getTime() - JANELA_FORMULARIO_DIAS * 86_400_000);
      const formulario = await this.prisma.lead.findFirst({
        where: { contaId, origem: 'formulario', chatId: null, telefoneChave: fone.chave, recebidoEm: { gte: desde } },
        orderBy: { recebidoEm: 'desc' },
      });
      if (formulario) {
        const lead = await this.prisma.lead.update({
          where: { id: formulario.id },
          data: { ...base, etapa: marcarAtendido && formulario.etapa === 'novo' ? 'em_atendimento' : formulario.etapa },
        });
        await this.evento(lead.id, 'conversa', `Conversa no WhatsApp ligada a este formulário${autor.nome ? ` por ${autor.nome}` : ''}.`, autor);
        return lead;
      }
    }

    const achado = anuncio ? await this.resolverAnuncio(contaId, anuncio) : null;
    try {
      const lead = await this.prisma.lead.create({
        data: {
          contaId,
          origem: anuncio ? 'ctwa' : 'organico',
          telefone: fone?.telefone ?? null,
          telefoneChave: fone?.chave ?? null,
          nome: limpo(dados.nome) ?? null,
          ...base,
          ...this.dadosDoAnuncio(anuncio, achado),
        },
      });
      await this.evento(
        lead.id,
        'recebido',
        anuncio ? `Chegou por um anúncio${achado ? '' : ' (anúncio ainda não identificado)'}.` : 'Atendimento sem anúncio identificado.',
        autor,
      );
      await this.avisarMeta(lead, ['lead_recebido']);
      return lead;
    } catch (erro) {
      // Painel e automação chegaram juntos: o outro criou primeiro.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return this.prisma.lead.findUniqueOrThrow({ where: { contaId_chatId: { contaId, chatId } } });
      }
      throw erro;
    }
  }

  /**
   * Atendente informado pela automação (chat_recent_agent_id): é o dono do atendimento na Kentro,
   * por isso vale mais que quem abriu o painel e substitui o que estava gravado.
   */
  async definirAtendente(lead: Lead, id: unknown, nome: unknown): Promise<Lead> {
    const atendenteId = limpo(id, 20);
    if (!atendenteId || !/^\d+$/.test(atendenteId) || Number(atendenteId) === 0) return lead;
    const atendenteNome = limpo(nome, 120) ?? (lead.atendenteId === atendenteId ? lead.atendenteNome : null);
    if (lead.atendenteId === atendenteId && lead.atendenteNome === atendenteNome) return lead;
    return this.prisma.lead.update({ where: { id: lead.id }, data: { atendenteId, atendenteNome } });
  }

  /**
   * Leva o lead a uma etapa do funil (id, chave ou os nomes de antes) ou de volta a "em atendimento".
   * A situação derivada (etapa) e as datas de qualificado, venda e descarte continuam alimentando as
   * métricas; as etapas alcançadas alimentam o funil configurável.
   */
  async mudarEtapa(contaId: string, lead: Lead, alvo: string, extra: { valor?: number; motivo?: string }, autor: Autor): Promise<Lead> {
    const agora = new Date();
    const dados: Prisma.LeadUncheckedUpdateInput = {};
    let texto: string;
    let tipoEvento: string;
    let etapa: EtapaFunil | null = null;
    let etapas: EtapaFunil[] = [];

    if (alvo === 'em_atendimento') {
      Object.assign(dados, { etapa: 'em_atendimento', etapaId: null });
      texto = 'Voltou para em atendimento.';
      tipoEvento = 'em_atendimento';
    } else {
      etapa = await this.etapas.resolver(contaId, alvo);
      etapas = await this.etapas.listar(contaId);
      dados.etapaId = etapa.id;
      tipoEvento = etapa.chave;
      if (etapa.tipo === 'venda') {
        if (extra.valor == null || !Number.isFinite(extra.valor) || extra.valor < 0) throw new ErroApi(400, 'VALOR_INVALIDO', 'Informe o valor da venda.');
        Object.assign(dados, {
          etapa: 'venda',
          valorVenda: new Prisma.Decimal(extra.valor.toFixed(2)),
          vendaEm: agora,
          qualificadoEm: lead.qualificadoEm ?? agora,
          motivoDescarte: null,
          etapasAlcancadas: [...new Set([...lead.etapasAlcancadas, etapa.id])],
        });
        texto = `Venda registrada${etapa.nome === 'Venda' ? '' : ` (${etapa.nome})`}: ${extra.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`;
      } else if (etapa.tipo === 'perda') {
        const motivo = limpo(extra.motivo, 200);
        if (!motivo) throw new ErroApi(400, 'MOTIVO_OBRIGATORIO', 'Informe o motivo.');
        Object.assign(dados, { etapa: 'descartado', motivoDescarte: motivo, descartadoEm: agora });
        texto = `${etapa.nome}: ${motivo}.`;
      } else {
        // Chegar a uma etapa qualificada, ou a qualquer uma depois dela, conta como qualificado.
        const ordem = etapa.ordem;
        const qualifica = etapas.some((q) => q.qualificada && q.ordem <= ordem);
        const qualificadoEm = lead.qualificadoEm ?? (qualifica ? agora : null);
        Object.assign(dados, {
          etapa: qualificadoEm ? 'qualificado' : 'em_atendimento',
          qualificadoEm,
          etapasAlcancadas: [...new Set([...lead.etapasAlcancadas, etapa.id])],
        });
        texto = `Marcado como ${etapa.nome.toLowerCase()}.`;
      }
    }
    if (!lead.atendidoEm) Object.assign(dados, { atendidoEm: agora });
    if (autor.tipo === 'atendente' && !lead.atendenteId) Object.assign(dados, { atendenteId: autor.id ?? null, atendenteNome: autor.nome ?? null });

    const atualizado = await this.prisma.$transaction(async (tx) => {
      const novo = await tx.lead.update({ where: { id: lead.id }, data: dados });
      await this.evento(lead.id, tipoEvento, `${texto}${autor.nome ? ` (${autor.nome})` : ''}`, autor, tx);
      return novo;
    });
    if (etapa) {
      // Chegou aqui, passou pelas anteriores: os eventos delas também vão (cada um sai uma vez só).
      const enviar =
        etapa.tipo === 'perda'
          ? [etapa]
          : etapas.filter((e) => e.ativa && e.tipo !== 'perda' && e.ordem <= etapa!.ordem && (e.id === etapa!.id || e.tipo === 'andamento'));
      for (const e of enviar) {
        try {
          await this.capi.enfileirarEtapa(atualizado, e);
        } catch (erro) {
          this.logger.error(`Enfileirar ${e.chave} do lead ${lead.id}: ${erro instanceof Error ? erro.message : erro}`);
        }
      }
    }
    return atualizado;
  }

  async porId(contaId: string, id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({ where: { id, contaId } });
    if (!lead) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Lead não encontrado.');
    return lead;
  }

  async porChat(contaId: string, chatId: string): Promise<Lead | null> {
    return this.prisma.lead.findUnique({ where: { contaId_chatId: { contaId, chatId } } });
  }

  /** O lead como o painel do atendente mostra: anúncio com nomes, miniatura, histórico e outras entradas. */
  async paraPainel(lead: Lead) {
    const [anuncio, campanha, conjunto, eventos, outras, eventosMeta, etapas] = await Promise.all([
      lead.anuncioIdMeta && lead.contaAnuncioId
        ? this.prisma.anuncio.findUnique({ where: { contaAnuncioId_idMeta: { contaAnuncioId: lead.contaAnuncioId, idMeta: lead.anuncioIdMeta } } })
        : null,
      lead.campanhaIdMeta && lead.contaAnuncioId
        ? this.prisma.campanha.findUnique({ where: { contaAnuncioId_idMeta: { contaAnuncioId: lead.contaAnuncioId, idMeta: lead.campanhaIdMeta } } })
        : null,
      lead.conjuntoIdMeta && lead.contaAnuncioId
        ? this.prisma.conjunto.findUnique({ where: { contaAnuncioId_idMeta: { contaAnuncioId: lead.contaAnuncioId, idMeta: lead.conjuntoIdMeta } } })
        : null,
      this.prisma.eventoLead.findMany({ where: { leadId: lead.id }, orderBy: { em: 'desc' }, take: 20 }),
      lead.telefoneChave
        ? this.prisma.lead.findMany({
            where: { contaId: lead.contaId, telefoneChave: lead.telefoneChave, id: { not: lead.id } },
            orderBy: { recebidoEm: 'desc' },
            take: 10,
          })
        : [],
      this.capi.doLead(lead.id),
      this.etapas.listar(lead.contaId),
    ]);
    const nomeEtapa = new Map(etapas.map((e) => [e.id, e.nome]));
    const nomesCampanhas = new Map(
      (
        await this.prisma.campanha.findMany({
          where: { contaId: lead.contaId, idMeta: { in: outras.map((o) => o.campanhaIdMeta).filter((x): x is string => !!x) } },
          select: { idMeta: true, nome: true },
        })
      ).map((c) => [c.idMeta, c.nome]),
    );
    return {
      id: lead.id,
      origem: lead.origem,
      etapa: lead.etapa,
      etapaId: lead.etapaId,
      etapaNome: lead.etapaId ? nomeEtapa.get(lead.etapaId) ?? null : null,
      /** As etapas que viram botão no painel (ativas e marcadas para o atendente), na ordem do funil. */
      etapas: etapas.filter((e) => e.ativa && e.botaoAtendente).map(etapaPublica),
      nome: lead.nome,
      recebidoEm: lead.recebidoEm,
      atendidoEm: lead.atendidoEm,
      valorVenda: lead.valorVenda == null ? null : Number(lead.valorVenda),
      motivoDescarte: lead.motivoDescarte,
      respostas: lead.respostas,
      anuncio:
        lead.origem === 'organico'
          ? null
          : {
              vinculo: lead.vinculoAnuncio,
              campanha: campanha ? { idMeta: campanha.idMeta, nome: campanha.nome } : lead.campanhaIdMeta ? { idMeta: lead.campanhaIdMeta, nome: null } : null,
              conjunto: conjunto ? { idMeta: conjunto.idMeta, nome: conjunto.nome } : null,
              anuncio: anuncio
                ? { idMeta: anuncio.idMeta, nome: anuncio.nome, titulo: anuncio.titulo, texto: anuncio.texto, miniatura: anuncio.miniaturaUrl ? this.painel.urlMidia(anuncio.id) : null }
                : null,
              // O que o cliente viu, como chegou na conversa (vale mesmo sem o anúncio identificado).
              titulo: lead.anuncioTitulo,
              texto: lead.anuncioTexto,
              url: lead.anuncioUrl,
            },
      historico: eventos.map((e) => ({ tipo: e.tipo, texto: e.texto, autor: e.autor, em: e.em })),
      eventosMeta,
      outrasEntradas: outras.map((o) => ({
        id: o.id,
        origem: o.origem,
        etapa: o.etapa,
        etapaNome: o.etapaId ? nomeEtapa.get(o.etapaId) ?? null : null,
        recebidoEm: o.recebidoEm,
        campanha: o.campanhaIdMeta ? nomesCampanhas.get(o.campanhaIdMeta) ?? null : null,
        valorVenda: o.valorVenda == null ? null : Number(o.valorVenda),
      })),
    };
  }

  /** URL do webhook de eventos da Kentro: o token é derivado da conta e da versão (rotacionar = versão + 1). */
  urlWebhook(contaId: string, versao: number): string {
    return `${this.config.urlPublica}/v1/kentro/eventos/${contaId}.${assinar(this.config.chaveMestra, `webhook:${contaId}:${versao}`)}`;
  }

  /** Conta dona da referência "<uuid>.<assinatura>" do webhook, se a assinatura vale para a versão atual. */
  async contaDoWebhook(referencia: string) {
    const [id, assinatura] = referencia.split('.');
    if (!id || !assinatura || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const conta = await this.prisma.conta.findUnique({ where: { id } });
    if (!conta || !conferirAssinatura(this.config.chaveMestra, `webhook:${id}:${conta.versaoWebhook}`, assinatura)) return null;
    return conta;
  }
}
