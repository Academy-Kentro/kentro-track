import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { Response } from 'express';
import { ErroApi } from '../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { LinksService } from './links.service';

export class LinkDto {
  @IsString()
  @Length(1, 80)
  nome!: string;

  @IsString()
  @Length(8, 30)
  telefone!: string;

  @IsString()
  @Length(1, 500)
  mensagem!: string;

  @IsOptional()
  @IsBoolean()
  computadorWeb?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  tituloEspera?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  mensagemEspera?: string;

  @IsOptional()
  @IsBoolean()
  codigoVisivel?: boolean;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Link não encontrado.') });

/** O gestor acompanha os resultados; só o admin cria e muda link. */
@Controller('v1/links')
@UseGuards(ChaveContaGuard)
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get()
  @Papeis('admin', 'gestor')
  listar(@Req() req: RequisicaoDaConta) {
    return this.links.listar(req.conta.id);
  }

  @Post()
  @Papeis('admin')
  criar(@Req() req: RequisicaoDaConta, @Body() dto: LinkDto) {
    return this.links.criar(req.conta.id, dto);
  }

  @Put(':id')
  @Papeis('admin')
  atualizar(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string, @Body() dto: LinkDto) {
    return this.links.atualizar(req.conta.id, id, dto);
  }
}

/** Abertas: quem clica no anúncio ou visita o site não tem chave. Por isso o limite por IP. */
@Controller()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ registro: true })
export class LinkPublicoController {
  constructor(private readonly links: LinksService) {}

  @Get('l/:codigo')
  async visitar(@Param('codigo') codigo: string, @Query() parametros: Record<string, unknown>, @Headers('user-agent') navegador: string | undefined, @Res() res: Response) {
    const { status, html } = await this.links.visitar(codigo, parametros, navegador ?? '');
    res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }).type('html').send(html);
  }

  /** O mesmo script para todas as contas: a conta na URL só deixa o pixel identificável no site. */
  @Get('p/:arquivo')
  pixel(@Res() res: Response) {
    res.set({ 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).type('application/javascript').send(this.links.scriptDoPixel());
  }
}
