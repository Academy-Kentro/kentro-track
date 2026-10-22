import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { Autor, EtapaDoAtendente, LeadsService } from './leads.service';

export class VincularDto {
  @Matches(/^\d{1,20}$/)
  chatId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  telefone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  nome?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  contatoId?: string;

  /** Resumo do campo `ad` da mensagem, feito pela extensão (idAnuncio, ctwaClid, url, titulo, texto). */
  @IsOptional()
  @IsObject()
  anuncio?: Record<string, unknown>;
}

const ETAPAS: EtapaDoAtendente[] = ['em_atendimento', 'qualificado', 'venda', 'descartado'];

export class EtapaDto {
  @IsIn(ETAPAS)
  etapa!: EtapaDoAtendente;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  valor?: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  motivo?: string;
}

/** Quem está no painel (só para o histórico: vem do navegador e não vale como autorização). */
export function atendenteDa(req: Request): Autor {
  const decodificar = (v: string | undefined) => {
    try {
      return v ? decodeURIComponent(v).trim().slice(0, 120) : undefined;
    } catch {
      return undefined;
    }
  };
  const id = req.header('X-Kentro-Usuario-Id')?.trim();
  return { tipo: 'atendente', id: id && /^\d{1,20}$/.test(id) ? id : undefined, nome: decodificar(req.header('X-Kentro-Usuario-Nome')) || undefined };
}

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Lead não encontrado.') });

/** Painel do atendente: a chave de atendimento (ou a de admin). */
@Controller('v1/atendimento')
@UseGuards(ChaveContaGuard)
@Papeis('admin', 'atendimento')
export class AtendimentoController {
  constructor(private readonly leads: LeadsService) {}

  /** Ao abrir a conversa: registra o lead (ou reencontra) e devolve a origem pronta para mostrar. */
  @Post('vincular')
  @HttpCode(200)
  async vincular(@Req() req: RequisicaoDaConta, @Body() dto: VincularDto) {
    const lead = await this.leads.registrarAtendimento(req.conta.id, dto, atendenteDa(req), true);
    return this.leads.paraPainel(lead);
  }

  @Get('chat/:chatId')
  async doChat(@Req() req: RequisicaoDaConta, @Param('chatId') chatId: string) {
    const lead = /^\d{1,20}$/.test(chatId) ? await this.leads.porChat(req.conta.id, chatId) : null;
    if (!lead) throw new ErroApi(404, 'SEM_LEAD', 'Este atendimento ainda não tem lead no Kentro Track.');
    return this.leads.paraPainel(lead);
  }

  @Post('leads/:id/etapa')
  @HttpCode(200)
  async etapa(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string, @Body() dto: EtapaDto) {
    const lead = await this.leads.porId(req.conta.id, id);
    return this.leads.paraPainel(await this.leads.mudarEtapa(req.conta.id, lead, dto.etapa, dto, atendenteDa(req)));
  }
}

const EVENTOS = ['chat_iniciado', 'qualificado', 'venda', 'descartado'] as const;

/** Número que a automação manda como texto ("1.234,50", "1234.5"). */
function valorDe(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!t) return undefined;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Webhook que a automação da Kentro chama (elemento de requisição HTTP). O corpo vem com variáveis
 * já preenchidas pela automação, por isso é lido sem DTO estrito: campo a mais não derruba o evento.
 */
@Controller('v1/kentro')
export class KentroController {
  constructor(
    private readonly leads: LeadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('eventos/:referencia')
  @HttpCode(200)
  async evento(@Param('referencia') referencia: string, @Body() corpo: Record<string, unknown>) {
    const conta = await this.leads.contaDoWebhook(referencia);
    if (!conta) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Webhook do Kentro Track não encontrado. Copie a URL de novo em Configurações.');
    if (conta.status === 'bloqueada') throw new ErroApi(403, 'CONTA_BLOQUEADA', 'Conta bloqueada no Kentro Track.');

    const evento = String(corpo?.evento ?? '').trim();
    if (!(EVENTOS as readonly string[]).includes(evento)) {
      throw new ErroApi(400, 'EVENTO_INVALIDO', `Evento desconhecido. Use: ${EVENTOS.join(', ')}.`);
    }
    const autor: Autor = { tipo: 'kentro', nome: 'Automação da Kentro' };
    const anuncio = corpo.anuncio && typeof corpo.anuncio === 'object' ? (corpo.anuncio as Record<string, unknown>) : null;
    const atendimento = {
      chatId: String(corpo.chatId ?? '').trim(),
      telefone: typeof corpo.telefone === 'string' ? corpo.telefone : undefined,
      nome: typeof corpo.nome === 'string' ? corpo.nome : undefined,
      contatoId: corpo.contatoId == null ? undefined : String(corpo.contatoId),
      anuncio,
    };

    // chat_iniciado não marca "atendido": o atendimento pode estar só com a IA ou na fila.
    // chat_iniciado pode ser reenviado (é idempotente): é assim que a automação conta quem assumiu.
    const lead = await this.leads.definirAtendente(await this.leads.registrarAtendimento(conta.id, atendimento, autor, false), corpo.atendenteId, corpo.atendente);
    if (evento !== 'chat_iniciado') {
      await this.leads.mudarEtapa(conta.id, lead, evento as Exclude<(typeof EVENTOS)[number], 'chat_iniciado'>, { valor: valorDe(corpo.valor), motivo: typeof corpo.motivo === 'string' ? corpo.motivo : undefined }, autor);
    }
    return { ok: true, leadId: lead.id };
  }

  /** O que o admin cola na automação: URL e corpo de exemplo de cada evento. */
  @Get('integracao')
  @UseGuards(ChaveContaGuard)
  @Papeis('admin')
  integracao(@Req() req: RequisicaoDaConta) {
    return this.descrever(req.conta.id, req.conta.versaoWebhook);
  }

  @Post('integracao/rotacionar')
  @HttpCode(200)
  @UseGuards(ChaveContaGuard)
  @Papeis('admin')
  async rotacionar(@Req() req: RequisicaoDaConta) {
    const conta = await this.prisma.conta.update({ where: { id: req.conta.id }, data: { versaoWebhook: { increment: 1 } } });
    return this.descrever(conta.id, conta.versaoWebhook);
  }

  private descrever(contaId: string, versao: number) {
    const atendente = { atendenteId: '{{chat_recent_agent_id}}', atendente: '{{chat_agent.agent_full_name}}' };
    const base = { chatId: '{{chat_id}}', telefone: '{{chat_client_number}}', nome: '{{chat_client_name}}', contatoId: '{{chat_contact_id}}', ...atendente };
    return {
      url: this.leads.urlWebhook(contaId, versao),
      exemplos: {
        chat_iniciado: { evento: 'chat_iniciado', ...base, anuncio: { url: '{{message_ad_url}}', titulo: '{{message_ad_title}}', texto: '{{message_ad_body}}' } },
        qualificado: { evento: 'qualificado', chatId: '{{chat_id}}', ...atendente },
        venda: { evento: 'venda', chatId: '{{chat_id}}', valor: '{{opportunity_value}}', ...atendente },
        descartado: { evento: 'descartado', chatId: '{{chat_id}}', motivo: 'Sem interesse', ...atendente },
      },
    };
  }
}
