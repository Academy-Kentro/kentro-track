import { Injectable } from '@nestjs/common';
import { Conta } from '@prisma/client';
import { gerarSegredo, hashSegredo, TipoSegredo } from '../comum/cripto';
import { PrismaService } from '../comum/prisma.service';

/** O papel vem da chave usada: admin configura, gestor só lê os painéis, atendimento só o painel do chat. */
export type Papel = TipoSegredo;

const CAMPO_DO_HASH: Record<Papel, 'chaveAdminHash' | 'chaveGestorHash' | 'chaveAtendimentoHash'> = {
  admin: 'chaveAdminHash',
  gestor: 'chaveGestorHash',
  atendimento: 'chaveAtendimentoHash',
};

export interface ChavesNovas {
  contaId: string;
  chaveAdmin: string;
  chaveGestor: string;
  chaveAtendimento: string;
}

@Injectable()
export class ContasService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(nome: string | undefined, instanciaKentro: string | undefined): Promise<ChavesNovas> {
    const chaveAdmin = gerarSegredo('admin');
    const chaveGestor = gerarSegredo('gestor');
    const chaveAtendimento = gerarSegredo('atendimento');
    const conta = await this.prisma.conta.create({
      data: {
        nome: nome?.trim() || null,
        instanciaKentro: instanciaKentro?.trim().toLowerCase().slice(0, 200) || null,
        chaveAdminHash: hashSegredo(chaveAdmin),
        chaveGestorHash: hashSegredo(chaveGestor),
        chaveAtendimentoHash: hashSegredo(chaveAtendimento),
      },
    });
    return { contaId: conta.id, chaveAdmin, chaveGestor, chaveAtendimento };
  }

  async buscarPorChave(chave: string): Promise<{ conta: Conta; papel: Papel } | null> {
    const hash = hashSegredo(chave);
    const conta = await this.prisma.conta.findFirst({
      where: { OR: [{ chaveAdminHash: hash }, { chaveGestorHash: hash }, { chaveAtendimentoHash: hash }] },
    });
    if (!conta) return null;
    const papel = (Object.keys(CAMPO_DO_HASH) as Papel[]).find((p) => conta[CAMPO_DO_HASH[p]] === hash)!;
    return { conta, papel };
  }

  async rotacionar(contaId: string, papel: Papel): Promise<string> {
    const chave = gerarSegredo(papel);
    await this.prisma.conta.update({ where: { id: contaId }, data: { [CAMPO_DO_HASH[papel]]: hashSegredo(chave) } });
    return chave;
  }
}
