import { DynamicModule, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { ExtensaoController } from './arquivos-extensao/extensao.controller';
import { ConfigApp, CONFIG_APP } from './comum/config';
import { ESPERAR, Esperar, esperarDeVerdade, Fetch, FETCH } from './comum/fetch';
import { PrismaService } from './comum/prisma.service';
import { ContasModule } from './contas/contas.module';
import { MetaModule } from './meta/meta.module';
import { SaudeController } from './saude/saude.controller';

export interface OpcoesApp {
  /** Substitui o fetch de produção (os testes usam um Meta falso). */
  fetch?: Fetch;
  /** Substitui as esperas entre tentativas (os testes não esperam). */
  esperar?: Esperar;
}

@Module({})
export class AppModule {
  static com(config: ConfigApp, opcoes: OpcoesApp = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        // O ThrottlerModule é global: todos os limites nomeados ficam aqui. Cada rota pula os que não são dela.
        ThrottlerModule.forRoot([
          { name: 'registro', limit: 5, ttl: 3_600_000 },
          { name: 'publico', limit: 120, ttl: 60_000 },
        ]),
        ContasModule,
        AdminModule,
        MetaModule,
      ],
      providers: [
        { provide: CONFIG_APP, useValue: config },
        { provide: FETCH, useValue: opcoes.fetch ?? fetch },
        { provide: ESPERAR, useValue: opcoes.esperar ?? esperarDeVerdade },
        PrismaService,
      ],
      exports: [CONFIG_APP, FETCH, ESPERAR, PrismaService],
      controllers: [SaudeController, ExtensaoController],
    };
  }
}
