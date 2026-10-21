import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { ErroApi } from '../../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../../contas/chave-conta.guard';
import { ConexaoService, DEFINICOES, DefinicaoLead } from './conexao.service';

export class TokenManualDto {
  @IsString()
  @Length(20, 1000)
  token!: string;
}

export class SelecaoContaDto {
  @IsUUID()
  id!: string;

  @IsBoolean()
  selecionada!: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(DEFINICOES, { each: true })
  definicaoLead?: DefinicaoLead[];
}

export class SelecionarContasDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SelecaoContaDto)
  contas!: SelecaoContaDto[];
}

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Conta de anúncio não encontrada.') });

/** Configuração da conexão com o Meta: só a chave de admin. */
@Controller('v1/meta')
@UseGuards(ChaveContaGuard)
@Papeis('admin')
export class MetaController {
  constructor(private readonly conexao: ConexaoService) {}

  @Get('conexao')
  estado(@Req() req: RequisicaoDaConta) {
    return this.conexao.estado(req.conta.id);
  }

  @Put('token-manual')
  conectar(@Req() req: RequisicaoDaConta, @Body() dto: TokenManualDto) {
    return this.conexao.conectarTokenManual(req.conta.id, dto.token);
  }

  @Delete('conexao')
  desconectar(@Req() req: RequisicaoDaConta) {
    return this.conexao.desconectar(req.conta.id);
  }

  @Put('contas-anuncio')
  selecionar(@Req() req: RequisicaoDaConta, @Body() dto: SelecionarContasDto) {
    return this.conexao.selecionar(req.conta.id, dto.contas);
  }

  @Post('contas-anuncio/:id/sincronizar')
  @HttpCode(200)
  sincronizar(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string) {
    return this.conexao.sincronizarAgora(req.conta.id, id);
  }
}
