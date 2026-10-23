import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf, ValidateNested } from 'class-validator';
import { ChaveContaGuard, Papeis, RequisicaoDaConta } from '../contas/chave-conta.guard';
import { etapaPublica, EtapasService, EVENTO_META, MAX_ETAPAS } from './etapas.service';

export class EtapaDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @Length(1, 40)
  nome!: string;

  /** Vêm de volta quando a tela reenvia a lista lida: ignorados (a chave não muda; a ordem é a da lista). */
  @IsOptional()
  @IsString()
  chave?: string;

  @IsOptional()
  @IsInt()
  ordem?: number;

  @IsIn(['andamento', 'venda', 'perda'])
  tipo!: 'andamento' | 'venda' | 'perda';

  @IsOptional()
  @IsBoolean()
  qualificada?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(EVENTO_META, { message: 'Nome de evento do Meta: letras, números e "_", começando por letra.' })
  eventoMeta?: string | null;

  @IsOptional()
  @IsBoolean()
  botaoAtendente?: boolean;

  @IsOptional()
  @IsBoolean()
  noPainel?: boolean;

  @IsOptional()
  @IsBoolean()
  ativa?: boolean;
}

export class EtapasDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ETAPAS)
  @ValidateNested({ each: true })
  @Type(() => EtapaDto)
  etapas!: EtapaDto[];
}

/** Etapas do funil: todo mundo lê (painéis e botões do atendente); só o admin muda. */
@Controller('v1/etapas')
@UseGuards(ChaveContaGuard)
export class EtapasController {
  constructor(private readonly etapas: EtapasService) {}

  @Get()
  @Papeis('admin', 'gestor', 'atendimento')
  async listar(@Req() req: RequisicaoDaConta) {
    return { etapas: (await this.etapas.listar(req.conta.id)).map(etapaPublica) };
  }

  @Put()
  @Papeis('admin')
  async salvar(@Req() req: RequisicaoDaConta, @Body() dto: EtapasDto) {
    return { etapas: (await this.etapas.salvar(req.conta.id, dto.etapas)).map(etapaPublica) };
  }
}
