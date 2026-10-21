import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseEnumPipe, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Length } from 'class-validator';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from './chave-conta.guard';
import { ContasService, Papel } from './contas.service';
import { RegistroThrottlerGuard } from './registro-throttler.guard';

export class RegistrarContaDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  nome?: string;
}

const TIPOS_DE_CHAVE = { admin: 'admin', gestor: 'gestor', atendimento: 'atendimento' } as const;

@Controller('v1')
export class ContasController {
  constructor(
    private readonly contas: ContasService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  @Post('contas/registrar')
  @UseGuards(RegistroThrottlerGuard)
  @Throttle({ registro: { limit: 5, ttl: 3_600_000 } })
  @SkipThrottle({ publico: true })
  registrar(@Body() dto: RegistrarContaDto, @Headers('x-kentro-instancia') instancia?: string) {
    return this.contas.registrar(dto.nome, instancia);
  }

  /** Qualquer chave da conta: as extensões usam para saber se estão configuradas e com qual papel. */
  @Get('conta')
  @UseGuards(ChaveContaGuard)
  dados(@Req() req: RequisicaoDaConta) {
    const { id, nome, status, plano, fuso, moeda } = req.conta;
    return { id, nome, status, plano, fuso, moeda, papel: req.papel, loginMetaDisponivel: this.config.meta !== null };
  }

  @Post('conta/chaves/:tipo/rotacionar')
  @HttpCode(200)
  @UseGuards(ChaveContaGuard)
  @Papeis('admin')
  async rotacionar(
    @Req() req: RequisicaoDaConta,
    @Param('tipo', new ParseEnumPipe(TIPOS_DE_CHAVE, { exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Tipo de chave desconhecido.') }))
    tipo: Papel,
  ) {
    return { chave: await this.contas.rotacionar(req.conta.id, tipo) };
  }
}
