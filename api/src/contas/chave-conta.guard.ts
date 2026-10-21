import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Conta } from '@prisma/client';
import { Request } from 'express';
import { ErroApi } from '../comum/erros';
import { ContasService, Papel } from './contas.service';

const CHAVE_PAPEIS = 'papeisAceitos';

/** Papéis aceitos na rota. Sem o decorator, qualquer chave válida da conta passa. */
export const Papeis = (...papeis: Papel[]) => SetMetadata(CHAVE_PAPEIS, papeis);

export interface RequisicaoDaConta extends Request {
  conta: Conta;
  papel: Papel;
}

const SEM_PERMISSAO: Record<Papel, string> = {
  admin: 'Esta ação é só para o administrador (Kentro Track — Gestão com a chave de admin).',
  gestor: 'Esta tela é da extensão Kentro Track — Gestão.',
  atendimento: 'Esta ação é do painel do atendimento (Kentro Track — Atendimento).',
};

@Injectable()
export class ChaveContaGuard implements CanActivate {
  constructor(
    private readonly contas: ContasService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoDaConta>();
    const chave = req.header('X-Track-Chave')?.trim();
    const encontrada = chave ? await this.contas.buscarPorChave(chave) : null;
    if (!encontrada) {
      throw new ErroApi(401, 'CHAVE_INVALIDA', 'Chave do Kentro Track inválida. Confira a configuração da extensão.');
    }
    if (encontrada.conta.status === 'bloqueada') {
      throw new ErroApi(403, 'CONTA_BLOQUEADA', 'Esta conta está bloqueada no Kentro Track. Fale com o suporte.');
    }
    const aceitos = this.reflector.getAllAndOverride<Papel[] | undefined>(CHAVE_PAPEIS, [contexto.getHandler(), contexto.getClass()]);
    if (aceitos && !aceitos.includes(encontrada.papel)) {
      throw new ErroApi(403, 'PERMISSAO_NEGADA', SEM_PERMISSAO[aceitos[0]]);
    }
    req.conta = encontrada.conta;
    req.papel = encontrada.papel;
    return true;
  }
}
