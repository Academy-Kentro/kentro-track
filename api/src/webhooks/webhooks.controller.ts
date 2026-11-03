import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { ORIGENS_WEBHOOK, WebhooksService } from './webhooks.service';

export class WebhookDto {
  @IsString()
  @Length(1, 80)
  nome!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 500)
  urlCriada?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 500)
  urlAlterada?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 500)
  urlMensagem?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 500)
  urlOrigem?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ORIGENS_WEBHOOK.length)
  @IsIn(ORIGENS_WEBHOOK, { each: true })
  origens?: string[];

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Webhook não encontrado.') });

/** Só o admin: os webhooks levam dados dos leads, com telefone completo, para fora. */
@Controller('v1/webhooks')
@UseGuards(ChaveContaGuard)
@Papeis('admin')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  listar(@Req() req: RequisicaoDaConta) {
    return this.webhooks.listar(req.conta.id);
  }

  @Post()
  criar(@Req() req: RequisicaoDaConta, @Body() dto: WebhookDto) {
    return this.webhooks.criar(req.conta.id, dto);
  }

  @Put(':id')
  atualizar(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string, @Body() dto: WebhookDto) {
    return this.webhooks.atualizar(req.conta.id, id, dto);
  }

  @Delete(':id')
  excluir(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string) {
    return this.webhooks.excluir(req.conta.id, id);
  }

  @Post('envios/:id/reenviar')
  @HttpCode(200)
  reenviar(@Req() req: RequisicaoDaConta, @Param('id') id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Envio não encontrado.');
    return this.webhooks.reenviar(req.conta.id, BigInt(id));
  }
}
