import { DynamicModule, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { ExtensaoController } from './arquivos-extensao/extensao.controller';
import { ConfigApp, CONFIG_APP } from './comum/config';
import { PrismaService } from './comum/prisma.service';
import { ContasModule } from './contas/contas.module';
import { SaudeController } from './saude/saude.controller';

@Module({})
export class AppModule {
  static com(config: ConfigApp): DynamicModule {
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
      ],
      providers: [{ provide: CONFIG_APP, useValue: config }, PrismaService],
      exports: [CONFIG_APP, PrismaService],
      controllers: [SaudeController, ExtensaoController],
    };
  }
}
