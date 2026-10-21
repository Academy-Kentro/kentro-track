import { randomBytes } from 'node:crypto';
import { lerConfig } from '../src/comum/config';

const chave32 = randomBytes(32).toString('base64');

function envValido(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://u:s@localhost:5432/db',
    CHAVE_MESTRA_CRIPTO: chave32,
    TOKEN_SUPERADMIN: 'super',
    URL_PUBLICA: 'https://track.exemplo.com',
    ...extra,
  };
}

const META = { META_APP_ID: '123', META_APP_SECRET: 'segredo', META_CONFIG_ID: '456', META_WEBHOOK_VERIFY_TOKEN: 'verifica' };

describe('lerConfig', () => {
  it('lista todas as variáveis obrigatórias ausentes de uma vez', () => {
    expect(() => lerConfig({})).toThrow(/DATABASE_URL.*CHAVE_MESTRA_CRIPTO.*TOKEN_SUPERADMIN.*URL_PUBLICA/s);
  });

  it('recusa chave mestra que não tem 32 bytes', () => {
    expect(() => lerConfig(envValido({ CHAVE_MESTRA_CRIPTO: randomBytes(16).toString('base64') }))).toThrow(/32 bytes/);
  });

  it('remove barras finais da URL pública', () => {
    expect(lerConfig(envValido({ URL_PUBLICA: 'https://track.exemplo.com//' })).urlPublica).toBe('https://track.exemplo.com');
  });

  it('usa a porta 3000 por padrão, aceita PORTA e a PORT que a VPS preenche', () => {
    expect(lerConfig(envValido()).porta).toBe(3000);
    expect(lerConfig(envValido({ PORTA: '8080' })).porta).toBe(8080);
    expect(lerConfig(envValido({ PORT: '4000' })).porta).toBe(4000);
  });

  it('sem as variáveis do Meta, sobe só com o token manual', () => {
    const config = lerConfig(envValido());
    expect(config.meta).toBeNull();
    expect(config.metaVersaoApi).toBe('v24.0');
  });

  it('lê o app do Meta quando as quatro variáveis vêm juntas', () => {
    expect(lerConfig(envValido(META)).meta).toEqual({ appId: '123', appSecret: 'segredo', configId: '456', tokenVerificacaoWebhook: 'verifica' });
  });

  it('recusa o app do Meta incompleto, dizendo o que falta', () => {
    expect(() => lerConfig(envValido({ META_APP_ID: '123', META_APP_SECRET: 's' }))).toThrow(/META_CONFIG_ID, META_WEBHOOK_VERIFY_TOKEN/);
  });

  it('recusa ids do Meta que não são números', () => {
    expect(() => lerConfig(envValido({ ...META, META_APP_ID: 'abc' }))).toThrow(/números/);
  });

  it('aceita outra versão da Graph API e recusa formato errado', () => {
    expect(lerConfig(envValido({ META_API_VERSION: 'v25.0' })).metaVersaoApi).toBe('v25.0');
    expect(() => lerConfig(envValido({ META_API_VERSION: '25' }))).toThrow(/vNN\.N/);
  });
});
