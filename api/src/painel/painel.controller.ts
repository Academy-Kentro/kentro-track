import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { AnalisesService } from './analises.service';
import { MAX_ATENDENTES_POR_VEZ, PainelService, TipoExportacao } from './painel.service';

export class AtendenteDoChatDto {
  @Matches(/^\d{1,20}$/)
  chatId!: string;

  @Matches(/^[1-9]\d{0,19}$/)
  atendenteId!: string;

  @IsString()
  @Length(1, 120)
  atendente!: string;
}

export class AtendentesDto {
  @IsArray()
  @ArrayMaxSize(MAX_ATENDENTES_POR_VEZ)
  @ValidateNested({ each: true })
  @Type(() => AtendenteDoChatDto)
  itens!: AtendenteDoChatDto[];
}

export class FiltroDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  de!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  ate!: string;

  @IsOptional()
  @IsUUID()
  contaAnuncio?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Matches(/^\d+$/)
  campanha?: string;
}

export class FiltroLeadsDto extends FiltroDto {
  @IsOptional()
  @IsIn(['ctwa', 'formulario', 'link', 'organico'])
  origem?: string;

  /** "novo", "em_atendimento" ou o id da etapa do funil. */
  @IsOptional()
  @Matches(/^(novo|em_atendimento|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)
  etapa?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pagina?: number;

  /** Nome ou telefone. */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  busca?: string;

  @IsOptional()
  @Matches(/^\d{1,40}$/)
  conjunto?: string;

  @IsOptional()
  @Matches(/^\d{1,40}$/)
  anuncio?: string;

  /** Id do atendente na Kentro, ou "sem". */
  @IsOptional()
  @Matches(/^(sem|\d{1,20})$/)
  atendente?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vendaDe?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vendaAte?: string;

  @IsOptional()
  @IsIn(['recentes', 'antigos', 'maior_venda', 'nome', 'ultima_mensagem'])
  ordem?: string;

  /** Só as conversas em que o cliente escreveu e a equipe ainda não respondeu. */
  @IsOptional()
  @IsIn(['1'])
  aguardando?: string;

  @IsOptional()
  @IsUUID()
  link?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  utmCampaign?: string;
}

export class ExportarLeadsDto extends FiltroLeadsDto {
  @IsIn(['leads', 'vendas', 'jornada', 'google_offline'])
  tipo!: TipoExportacao;
}

/** Uma rota por aba: a extensão tem 30 chamadas por minuto no omni.http.request. */
@Controller('v1/painel')
@UseGuards(ChaveContaGuard)
@Papeis('admin', 'gestor')
export class PainelController {
  constructor(
    private readonly painel: PainelService,
    private readonly analisesService: AnalisesService,
  ) {}

  @Get('filtros')
  filtros(@Req() req: RequisicaoDaConta) {
    return this.painel.filtros(req.conta.id);
  }

  @Get('visao-geral')
  visaoGeral(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.painel.visaoGeral(req.conta.id, filtro);
  }

  @Get('campanhas')
  campanhas(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.painel.campanhas(req.conta.id, filtro);
  }

  @Get('criativos')
  criativos(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.painel.criativos(req.conta.id, filtro);
  }

  @Get('leads')
  leads(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroLeadsDto) {
    return this.painel.leads(req.conta.id, filtro);
  }

  @Get('primeiros-passos')
  primeirosPassos(@Req() req: RequisicaoDaConta) {
    return this.painel.primeirosPassos(req.conta.id);
  }

  @Get('leads/quadro')
  quadroDeLeads(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroLeadsDto) {
    return this.painel.quadroDeLeads(req.conta.id, filtro);
  }

  @Get('leads/opcoes')
  opcoesDeLeads(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.painel.opcoesDeLeads(req.conta.id, filtro);
  }

  @Get('leads/atualizacoes')
  atualizacoesDeLeads(@Req() req: RequisicaoDaConta) {
    return this.painel.atualizacoesDeLeads(req.conta.id);
  }

  @Get('leads/exportar')
  exportarLeads(@Req() req: RequisicaoDaConta, @Query() { tipo, ...filtro }: ExportarLeadsDto) {
    return this.painel.exportarLeads(req.conta.id, filtro, tipo);
  }

  /** O que a tela do gestor leu na Kentro sobre quem está com cada atendimento. */
  @Post('atendentes')
  @HttpCode(200)
  atendentes(@Req() req: RequisicaoDaConta, @Body() dto: AtendentesDto) {
    return this.painel.registrarAtendentes(req.conta.id, dto.itens);
  }

  @Get('analises')
  analises(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.analisesService.analises(req.conta.id, filtro);
  }

  @Get('equipe')
  equipe(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.painel.equipe(req.conta.id, filtro);
  }
}
