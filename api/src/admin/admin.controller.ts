import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Conta, Prisma } from '@prisma/client';
import { IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { SuperadminGuard } from './superadmin.guard';

const STATUS = ['pendente_conexao', 'ativa', 'reconectar', 'bloqueada'] as const;

export class AtualizarContaDto {
  @IsOptional()
  @IsIn(STATUS)
  status?: (typeof STATUS)[number];

  @IsOptional()
  @IsString()
  @Length(1, 40)
  plano?: string;

  @IsOptional()
  @IsObject()
  limites?: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publica({ id, nome, instanciaKentro, status, plano, limites, criadoEm }: Conta) {
  return { id, nome, instanciaKentro, status, plano, limites, criadoEm };
}

@Controller('v1/admin/contas')
@UseGuards(SuperadminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar() {
    const contas = await this.prisma.conta.findMany({ orderBy: { criadoEm: 'desc' } });
    return contas.map(publica);
  }

  @Patch(':id')
  async atualizar(@Param('id') id: string, @Body() dto: AtualizarContaDto) {
    const naoEncontrada = new ErroApi(404, 'NAO_ENCONTRADO', 'Conta não encontrada.');
    if (!UUID.test(id)) throw naoEncontrada;
    try {
      const conta = await this.prisma.conta.update({
        where: { id },
        data: { status: dto.status, plano: dto.plano, limites: dto.limites as Prisma.InputJsonValue | undefined },
      });
      return publica(conta);
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025') throw naoEncontrada;
      throw erro;
    }
  }
}
