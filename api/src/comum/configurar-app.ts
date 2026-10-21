import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { FiltroDeErros } from './erros';

export function configurarApp(app: NestExpressApplication): void {
  // A VPS fica atrás de um proxy: o IP real do cliente vem no X-Forwarded-For.
  app.set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new FiltroDeErros());
}
