import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { AnalisesService } from './analises.service';
import { PainelService } from './painel.service';

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

  @Get('analises')
  analises(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.analisesService.analises(req.conta.id, filtro);
  }

  @Get('equipe')
  equipe(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.painel.equipe(req.conta.id, filtro);
  }
}
