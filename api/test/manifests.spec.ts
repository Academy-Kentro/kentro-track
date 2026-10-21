import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

interface CampoConfig { key: string; type: string; required?: boolean; default?: string }
interface Contribuicao { id: string; type: string; url?: string; visibility?: { userTypes?: number[] } }
interface Manifest {
  manifestVersion: number;
  id: string;
  version: string;
  name: string;
  config: CampoConfig[];
  contributions: Contribuicao[];
}

const DIR = path.join(__dirname, '..', '..', 'extension');
const EXTENSOES: { pasta: string; html: string }[] = JSON.parse(readFileSync(path.join(DIR, 'extensoes.json'), 'utf8'));
const ler = (ext: string): Manifest => JSON.parse(readFileSync(path.join(DIR, ext, 'manifest.json'), 'utf8'));
const campo = (m: Manifest, chave: string) => m.config.find((c) => c.key === chave);

describe.each(EXTENSOES)('manifest da extensão $pasta', ({ pasta, html }) => {
  const m = ler(pasta);

  it('segue as regras de formato da Kentro', () => {
    expect(m.manifestVersion).toBe(1);
    expect(m.id).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.name).toBeTruthy();
    expect(m.contributions.length).toBeGreaterThan(0);
  });

  it('a contribuição aponta para o HTML que o build gera e o código dela existe', () => {
    expect(m.contributions.map((c) => c.url)).toEqual([html]);
    expect(existsSync(path.join(DIR, pasta, 'src', 'main.tsx'))).toBe(true);
  });

  it('api_url é obrigatório e vem preenchido com a URL pública', () => {
    expect(campo(m, 'api_url')).toMatchObject({ type: 'url', required: true, default: '__URL_PUBLICA__' });
  });
});

describe('separação gestão / atendimento', () => {
  it('gestão: tela cheia no menu do topo, só para administradores e supervisores, chave secreta opcional', () => {
    const m = ler('gestao');
    expect(m.id).toBe('kentro.track-gestao');
    expect(m.contributions).toHaveLength(1);
    expect(m.contributions[0]).toMatchObject({ type: 'topMenu', visibility: { userTypes: [0, 1] } });
    // Opcional: na primeira instalação a chave ainda não existe (a tela cria a conta).
    expect(campo(m, 'chave')).toMatchObject({ type: 'secret', required: false });
  });

  it('atendimento: só o painel do chat, com chave_atendimento secreta e obrigatória', () => {
    const m = ler('atendimento');
    expect(m.id).toBe('kentro.track');
    expect(m.contributions).toHaveLength(1);
    expect(m.contributions[0].type).toBe('chatPanel');
    expect(campo(m, 'chave_atendimento')).toMatchObject({ type: 'secret', required: true });
  });
});
