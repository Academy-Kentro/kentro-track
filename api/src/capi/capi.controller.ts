import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, ValidateIf, ValidateNested } from 'class-validator';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { CapiService } from './capi.service';

const EVENTO = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;

export class MapeamentoDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(EVENTO) lead_recebido?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(EVENTO) qualificado?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(EVENTO) venda?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(EVENTO) descartado?: string | null;
}

export class ConfigCapiDto {
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{5,20}$/, { message: 'O id do pixel tem só números.' })
  datasetId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 200)
  datasetNome?: string | null;

  /** Texto novo grava; null apaga; ausente mantém. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(20, 1000)
  token?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{5,20}$/)
  wabaId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 40)
  codigoTeste?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => MapeamentoDto)
  mapeamento?: MapeamentoDto;
}

export class TesteDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  codigoTeste?: string;
}

export class EnviosDto {
  @IsOptional()
  @IsIn(['pendente', 'enviado', 'erro', 'descartado'])
  status?: string;
}

/** Envio de eventos para o pixel (API de Conversões): só a chave de admin. */
@Controller('v1/eventos')
@UseGuards(ChaveContaGuard)
@Papeis('admin')
export class CapiController {
  constructor(private readonly capi: CapiService) {}

  @Get('configuracao')
  configuracao(@Req() req: RequisicaoDaConta) {
    return this.capi.configuracao(req.conta.id);
  }

  @Put('configuracao')
  salvar(@Req() req: RequisicaoDaConta, @Body() dto: ConfigCapiDto) {
    return this.capi.salvar(req.conta.id, dto);
  }

  @Get('pixels')
  pixels(@Req() req: RequisicaoDaConta) {
    return this.capi.pixels(req.conta.id);
  }

  @Post('testar')
  @HttpCode(200)
  testar(@Req() req: RequisicaoDaConta, @Body() dto: TesteDto) {
    return this.capi.testar(req.conta.id, dto.codigoTeste);
  }

  @Get('envios')
  envios(@Req() req: RequisicaoDaConta, @Query() dto: EnviosDto) {
    return this.capi.envios(req.conta.id, dto.status);
  }

  @Post('envios/:id/reenviar')
  @HttpCode(200)
  reenviar(@Req() req: RequisicaoDaConta, @Param('id') id: string) {
    return this.capi.reenviar(req.conta.id, id);
  }
}
