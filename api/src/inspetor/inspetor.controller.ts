import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { gestorDa } from '../leads/leads.controller';
import { FiltroDto } from '../painel/painel.controller';
import { InspetorService } from './inspetor.service';

export class LigarInspetorDto {
  @IsBoolean()
  ativo!: boolean;
}

export class MensagemDto {
  @IsString()
  @Length(1, 60)
  id!: string;

  @IsString()
  @Length(1, 20)
  direcao!: string;

  @IsString()
  @MaxLength(5000)
  texto!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  em?: string;
}

export class AnalisarDto {
  @IsUUID()
  leadId!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MensagemDto)
  mensagens!: MensagemDto[];
}

export class AprovarDto {
  /** Id da etapa, ou a chave. */
  @IsString()
  @Length(1, 60)
  etapa!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  valor?: number;
}

export class EstadoDto {
  @IsOptional()
  @IsIn(['pendente', 'aprovada', 'recusada'])
  status?: string;
}

const uuid = new ParseUUIDPipe({ exceptionFactory: () => new ErroApi(404, 'NAO_ENCONTRADO', 'Sugestão não encontrada.') });

@Controller('v1/inspetor')
@UseGuards(ChaveContaGuard)
@Papeis('admin', 'gestor')
export class InspetorController {
  constructor(private readonly inspetor: InspetorService) {}

  @Get()
  estado(@Req() req: RequisicaoDaConta, @Query() q: EstadoDto) {
    return this.inspetor.estado(req.conta.id, q.status);
  }

  /** Ligar manda conversas para a IA: decisão de quem responde pela conta. */
  @Put('ligado')
  @Papeis('admin')
  ligar(@Req() req: RequisicaoDaConta, @Body() dto: LigarInspetorDto) {
    return this.inspetor.ligar(req.conta.id, dto.ativo);
  }

  @Get('candidatos')
  candidatos(@Req() req: RequisicaoDaConta, @Query() filtro: FiltroDto) {
    return this.inspetor.candidatos(req.conta.id, filtro);
  }

  @Post('analisar')
  @HttpCode(200)
  analisar(@Req() req: RequisicaoDaConta, @Body() dto: AnalisarDto) {
    return this.inspetor.analisar(req.conta.id, dto.leadId, dto.mensagens);
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string, @Body() dto: AprovarDto) {
    return this.inspetor.aprovar(req.conta.id, id, dto.etapa, dto.valor, gestorDa(req));
  }

  @Post(':id/recusar')
  @HttpCode(200)
  recusar(@Req() req: RequisicaoDaConta, @Param('id', uuid) id: string) {
    return this.inspetor.recusar(req.conta.id, id, gestorDa(req));
  }
}
