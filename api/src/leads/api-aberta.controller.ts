import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { etapaPublica, EtapasService } from '../etapas/etapas.service';
import { LeadsService } from './leads.service';
import { normalizarTelefone } from './telefone';

const POR_PAGINA = 100;

export class LeadsApiDto {
  /** Leads recebidos a partir deste instante (ISO 8601). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/)
  desde?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pagina?: number;
}

export class EtapaApiDto {
  /** Um dos dois: o id do atendimento na Kentro ou o telefone (vale a entrada mais recente). */
  @IsOptional()
  @Matches(/^\d{1,20}$/)
  chatId?: string;

  @IsOptional()
  @IsString()
  @Length(8, 30)
  telefone?: string;

  @IsString()
  @Length(1, 60)
  etapa!: string;

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

/** API para outros sistemas, com a chave própria de integração (telefone completo: quem integra precisa dele). */
@Controller('v1/api')
@UseGuards(ChaveContaGuard)
@Papeis('api')
export class ApiAbertaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly etapas: EtapasService,
  ) {}

  @Get('etapas')
  async listarEtapas(@Req() req: RequisicaoDaConta) {
    return { etapas: (await this.etapas.listar(req.conta.id)).map(({ id, chave, nome, tipo, ordem, ativa }) => ({ id, chave, nome, tipo, ordem, ativa })) };
  }

  @Get('leads')
  async listarLeads(@Req() req: RequisicaoDaConta, @Query() q: LeadsApiDto) {
    const pagina = q.pagina ?? 1;
    const linhas = await this.prisma.lead.findMany({
      where: { contaId: req.conta.id, ...(q.desde ? { recebidoEm: { gte: new Date(q.desde) } } : {}) },
      orderBy: { recebidoEm: 'desc' },
      take: POR_PAGINA + 1,
      skip: (pagina - 1) * POR_PAGINA,
    });
    const etapas = new Map((await this.etapas.listar(req.conta.id)).map((e) => [e.id, e]));
    return {
      pagina,
      temMais: linhas.length > POR_PAGINA,
      itens: linhas.slice(0, POR_PAGINA).map((l) => ({
        id: l.id,
        nome: l.nome,
        telefone: l.telefone,
        email: l.email,
        chatId: l.chatId,
        origem: l.origem,
        etapa: l.etapaId ? etapaPublica(etapas.get(l.etapaId)!).chave : l.etapa,
        valorVenda: l.valorVenda == null ? null : Number(l.valorVenda),
        recebidoEm: l.recebidoEm,
        vendaEm: l.vendaEm,
        campanhaId: l.campanhaIdMeta,
        conjuntoId: l.conjuntoIdMeta,
        anuncioId: l.anuncioIdMeta,
        utmSource: l.utmSource,
        utmMedium: l.utmMedium,
        utmCampaign: l.utmCampaign,
        utmContent: l.utmContent,
        utmTerm: l.utmTerm,
        gclid: l.gclid,
        fbclid: l.fbclid,
      })),
    };
  }

  @Post('leads/etapa')
  @HttpCode(200)
  async mudarEtapa(@Req() req: RequisicaoDaConta, @Body() dto: EtapaApiDto) {
    const chave = dto.telefone ? normalizarTelefone(dto.telefone)?.chave : undefined;
    if (!dto.chatId && !chave) throw new ErroApi(400, 'LEAD_NAO_INFORMADO', 'Informe chatId ou telefone.');
    const lead = await this.prisma.lead.findFirst({
      where: { contaId: req.conta.id, ...(dto.chatId ? { chatId: dto.chatId } : { telefoneChave: chave }) },
      orderBy: { recebidoEm: 'desc' },
    });
    if (!lead) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Lead não encontrado.');
    const novo = await this.leads.mudarEtapa(req.conta.id, lead, dto.etapa, { valor: dto.valor, motivo: dto.motivo }, { tipo: 'sistema', nome: 'API' });
    return { id: novo.id, etapa: novo.etapa, etapaId: novo.etapaId };
  }
}
