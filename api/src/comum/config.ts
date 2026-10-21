import * as path from 'node:path';

export const CONFIG_APP = Symbol('CONFIG_APP');

export interface ConfigApp {
  porta: number;
  databaseUrl: string;
  chaveMestra: Buffer;
  tokenSuperadmin: string;
  urlPublica: string;
  dirExtensao: string;
  /** App do Meta da Kentro (Login for Business). null = só o token manual funciona. */
  meta: ConfigMeta | null;
  /** Versão da Graph API, ex.: "v24.0". Vale também para o token manual. */
  metaVersaoApi: string;
  /** Agenda de sincronização com o Meta rodando neste processo. SINCRONIZACAO=desligada para desligar. */
  sincronizacaoAutomatica: boolean;
}

export interface ConfigMeta {
  appId: string;
  appSecret: string;
  /** Id da configuração do Facebook Login for Business (token de usuário do sistema). */
  configId: string;
  /** Texto que o Meta devolve na verificação do webhook (hub.verify_token). */
  tokenVerificacaoWebhook: string;
}

const OBRIGATORIAS = ['DATABASE_URL', 'CHAVE_MESTRA_CRIPTO', 'TOKEN_SUPERADMIN', 'URL_PUBLICA'] as const;
const VARIAVEIS_META = ['META_APP_ID', 'META_APP_SECRET', 'META_CONFIG_ID', 'META_WEBHOOK_VERIFY_TOKEN'] as const;

export function lerConfig(env: NodeJS.ProcessEnv): ConfigApp {
  const ausentes = OBRIGATORIAS.filter((nome) => !env[nome]?.trim());
  if (ausentes.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${ausentes.join(', ')}.`);
  }

  const chaveMestra = Buffer.from(env.CHAVE_MESTRA_CRIPTO!.trim(), 'base64');
  if (chaveMestra.length !== 32) {
    throw new Error('CHAVE_MESTRA_CRIPTO precisa ser o base64 de exatamente 32 bytes.');
  }

  const metaVersaoApi = env.META_API_VERSION?.trim() || 'v24.0';
  if (!/^v\d+\.\d+$/.test(metaVersaoApi)) {
    throw new Error('META_API_VERSION precisa estar no formato vNN.N (ex.: v24.0).');
  }

  // No build, este arquivo fica em dist/comum; extensao/ fica em dist/.
  const dist = path.join(__dirname, '..');
  return {
    // PORT é a "porta interna" que a VPS injeta; PORTA fica para uso local.
    porta: Number(env.PORTA || env.PORT || 3000),
    databaseUrl: env.DATABASE_URL!.trim(),
    chaveMestra,
    tokenSuperadmin: env.TOKEN_SUPERADMIN!.trim(),
    urlPublica: env.URL_PUBLICA!.trim().replace(/\/+$/, ''),
    dirExtensao: env.DIR_EXTENSAO || path.join(dist, 'extensao'),
    meta: lerMeta(env),
    metaVersaoApi,
    sincronizacaoAutomatica: env.SINCRONIZACAO?.trim().toLowerCase() !== 'desligada',
  };
}

/** As quatro variáveis do app do Meta vêm juntas ou nenhuma (até o app existir, só o token manual funciona). */
function lerMeta(env: NodeJS.ProcessEnv): ConfigMeta | null {
  const valores = VARIAVEIS_META.map((nome) => env[nome]?.trim() ?? '');
  if (valores.every((v) => !v)) return null;
  const faltando = VARIAVEIS_META.filter((_, i) => !valores[i]);
  if (faltando.length > 0) {
    throw new Error(`App do Meta incompleto: defina também ${faltando.join(', ')} (ou nenhuma das quatro).`);
  }
  const [appId, appSecret, configId, tokenVerificacaoWebhook] = valores;
  if (!/^\d+$/.test(appId) || !/^\d+$/.test(configId)) {
    throw new Error('META_APP_ID e META_CONFIG_ID são números (painel do app no Meta for Developers).');
  }
  return { appId, appSecret, configId, tokenVerificacaoWebhook };
}
