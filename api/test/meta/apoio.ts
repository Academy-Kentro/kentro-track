import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface Registro {
  contaId: string;
  chaveAdmin: string;
  chaveGestor: string;
  chaveAtendimento: string;
}

let ipSeq = 0;

/** Registra uma conta saindo de um IP novo (o limite de registro é por IP). */
export async function registrarConta(app: INestApplication, nome = 'Empresa Meta'): Promise<Registro> {
  ipSeq += 1;
  const res = await request(app.getHttpServer())
    .post('/v1/contas/registrar')
    .set('X-Forwarded-For', `10.50.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`)
    .send({ nome });
  if (res.status !== 201) throw new Error(`registro falhou: ${res.status} ${res.text}`);
  return res.body;
}

export const comChave = (req: request.Test, chave: string) => req.set('X-Track-Chave', chave);
