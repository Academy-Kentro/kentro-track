import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { AnalisesService } from './analises.service';
import { MAX_ATENDENTES_POR_VEZ, PainelService } from './painel.service';

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

  @IsOptional()
  @IsIn(['novo', 'em_atendimento', 'qualificado', 'venda', 'descartado'])
  etapa?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pagina?: number;
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
