import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { WebhooksService } from './webhooks.service';

export class WebhookDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 500)
  url?: string | null;
}

export class TestarWebhookDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  url?: string;
}

/** Só o admin: o webhook leva os dados dos leads, com telefone completo, para fora. */
@Controller('v1/webhooks')
@UseGuards(ChaveContaGuard)
@Papeis('admin')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  listar(@Req() req: RequisicaoDaConta) {
    return this.webhooks.listar(req.conta.id);
  }

  @Put()
  salvar(@Req() req: RequisicaoDaConta, @Body() dto: WebhookDto) {
    return this.webhooks.salvar(req.conta.id, dto.url);
  }

  @Post('testar')
  @HttpCode(200)
  testar(@Req() req: RequisicaoDaConta, @Body() dto: TestarWebhookDto) {
    return this.webhooks.testar(req.conta.id, dto.url);
  }

  @Post('envios/:id/reenviar')
  @HttpCode(200)
  reenviar(@Req() req: RequisicaoDaConta, @Param('id') id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Envio não encontrado.');
    return this.webhooks.reenviar(req.conta.id, BigInt(id));
  }
}
