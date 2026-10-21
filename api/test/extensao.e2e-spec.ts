import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './app';

// Pasta no formato do build (dist/extensao): manifest real + fragmento HTML.
const FONTE = path.join(__dirname, '..', '..', 'extension');
const pasta = mkdtempSync(path.join(tmpdir(), 'kentro-track-extensao-'));
for (const [ext, html] of [['gestao', 'gestao.html'], ['atendimento', 'painel.html']]) {
  mkdirSync(path.join(pasta, ext));
  copyFileSync(path.join(FONTE, ext, 'manifest.json'), path.join(pasta, ext, 'manifest.json'));
  writeFileSync(path.join(pasta, ext, html), '<style></style><div id="app"></div><script></script>');
}

describe('arquivos das extensões', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste({ urlPublica: 'https://track.teste', dirExtensao: pasta });
  });
  afterAll(async () => {
    await app.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it.each(['gestao', 'atendimento'])('serve o manifest de %s com CORS e a URL pública preenchida', async (ext) => {
    const res = await request(app.getHttpServer()).get(`/extensao/${ext}/manifest.json`);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('no-cache');
    const apiUrl = JSON.parse(res.text).config.find((c: { key: string }) => c.key === 'api_url');
    expect(apiUrl.default).toBe('https://track.teste');
  });

  it('serve o HTML com CORS e tipo certo', async () => {
    const res = await request(app.getHttpServer()).get('/extensao/atendimento/painel.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('responde ao preflight', async () => {
    const res = await request(app.getHttpServer()).options('/extensao/gestao/manifest.json');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
  });

  it.each([
    '/extensao/admin/manifest.json',
    '/extensao/gestao/..%2f..%2fpackage.json',
    '/extensao/gestao/%2e%2e%2f%2e%2e%2fapi%2fpackage.json',
    '/extensao/gestao/nao-existe.html',
    '/extensao/gestao/gestao.exe',
  ])('%s dá 404 sem ler nada fora da pasta', async (caminho) => {
    const res = await request(app.getHttpServer()).get(caminho);
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });
});
