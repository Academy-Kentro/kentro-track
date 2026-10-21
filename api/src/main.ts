import 'reflect-metadata';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { lerConfig } from './comum/config';
import { configurarApp } from './comum/configurar-app';
import { aplicarMigracoes } from './comum/migracoes';

async function iniciar(): Promise<void> {
  const config = lerConfig(process.env);
  aplicarMigracoes(config.databaseUrl, path.join(__dirname, 'prisma', 'schema.prisma'));
  // rawBody: o webhook do Meta é assinado sobre o corpo exato da requisição (X-Hub-Signature-256).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.com(config), { rawBody: true });
  configurarApp(app);
  await app.listen(config.porta);
}

iniciar().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
