import { Module } from '@nestjs/common';
import { ChaveContaGuard } from './chave-conta.guard';
import { ContasController } from './contas.controller';
import { ContasService } from './contas.service';

@Module({
  controllers: [ContasController],
  providers: [ContasService, ChaveContaGuard],
  exports: [ContasService, ChaveContaGuard],
})
export class ContasModule {}
