import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length, ValidateIf, ValidateNested } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { FormulariosService } from './formularios.service';

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Lead não encontrado.') });

export class SelecaoFormularioDto {
  @IsUUID()
  id!: string;

  @IsBoolean()
  selecionado!: boolean;
}

export class FormulariosDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SelecaoFormularioDto)
  formularios?: SelecaoFormularioDto[];

  /** Texto grava; null ou vazio apaga; ausente mantém. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 500)
  capturaKentroUrl?: string | null;
}

export class TesteKentroDto {
  @IsOptional()
  @IsString()
  @Length(1, 500)
  url?: string;
}

/** Formulários de cadastro do Meta e o envio de cada lead para o CRM da Kentro: só a chave de admin. */
@Controller('v1/formularios')
@UseGuards(ChaveContaGuard)
@Papeis('admin')
export class FormulariosController {
  constructor(private readonly formularios: FormulariosService) {}

  @Get()
  listar(@Req() req: RequisicaoDaConta) {
    return this.formularios.listar(req.conta.id);
  }

  @Post('buscar')
  @HttpCode(200)
  buscar(@Req() req: RequisicaoDaConta) {
    return this.formularios.buscar(req.conta.id);
  }

  @Put()
  salvar(@Req() req: RequisicaoDaConta, @Body() dto: FormulariosDto) {
    return this.formularios.salvar(req.conta.id, dto);
  }

  @Post('testar-envio')
  @HttpCode(200)
  testar(@Req() req: RequisicaoDaConta, @Body() dto: TesteKentroDto) {
    return this.formularios.testarEnvio(req.conta.id, dto.url);
  }

  @Post('envios/:leadId/reenviar')
  @HttpCode(200)
  reenviar(@Req() req: RequisicaoDaConta, @Param('leadId', uuid) leadId: string) {
    return this.formularios.reenviar(req.conta.id, leadId);
  }
}
