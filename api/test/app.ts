import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule, OpcoesApp } from '../src/app.module';
import { ConfigApp } from '../src/comum/config';
import { configurarApp } from '../src/comum/configurar-app';

export const TOKEN_SUPERADMIN_TESTE = 'super-teste';

export function configDeTeste(sobrescrever: Partial<ConfigApp> = {}): ConfigApp {
  return {
    porta: 0,
    databaseUrl: process.env.DATABASE_URL ?? '',
    chaveMestra: randomBytes(32),
    tokenSuperadmin: TOKEN_SUPERADMIN_TESTE,
    urlPublica: 'https://track.teste',
    dirExtensao: path.join(__dirname, '..', '..', 'extension'),
    meta: null,
    metaVersaoApi: 'v24.0',
    sincronizacaoAutomatica: false,
    ...sobrescrever,
  };
}

export async function criarAppDeTeste(sobrescrever: Partial<ConfigApp> = {}, opcoes: OpcoesApp = {}): Promise<INestApplication> {
  const config = configDeTeste(sobrescrever);
  const modulo = await Test.createTestingModule({ imports: [AppModule.com(config, { esperar: async () => {}, ...opcoes })] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ rawBody: true });
  configurarApp(app);
  await app.init();
  return app;
}
