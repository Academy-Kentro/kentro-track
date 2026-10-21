import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
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

/** Uma rota por aba: a extensão tem 30 chamadas por minuto no omni.http.request. */
@Controller('v1/painel')
@UseGuards(ChaveContaGuard)
@Papeis('admin', 'gestor')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

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
}
