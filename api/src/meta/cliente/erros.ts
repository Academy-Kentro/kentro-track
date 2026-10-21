/** Falhas do Graph já classificadas: quem chama decide pelo tipo, não pelo código numérico do Meta. */
export class ErroMeta extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly fbtraceId?: string,
  ) {
    super(mensagem);
  }
}

/** Token revogado, expirado, app removido ou senha trocada (código 190): só reconectando. */
export class TokenInvalido extends ErroMeta {
  constructor(mensagem: string, fbtraceId?: string) {
    super('TOKEN_INVALIDO', mensagem, fbtraceId);
  }
}

/** O token funciona, mas falta permissão ou acesso ao ativo (códigos 10 e 200–299). */
export class PermissaoFaltando extends ErroMeta {
  constructor(mensagem: string, fbtraceId?: string) {
    super('PERMISSAO_FALTANDO', mensagem, fbtraceId);
  }
}

/** Limite de uso da API de Marketing: tentar de novo depois de `esperarSegundos`. */
export class LimiteMeta extends ErroMeta {
  constructor(
    readonly esperarSegundos: number,
    mensagem: string,
    fbtraceId?: string,
  ) {
    super('LIMITE_META', mensagem, fbtraceId);
  }
}

/** Meta fora do ar ou instável depois das novas tentativas. */
export class MetaIndisponivel extends ErroMeta {
  constructor(mensagem: string, fbtraceId?: string) {
    super('META_INDISPONIVEL', mensagem, fbtraceId);
  }
}

/** Qualquer outra recusa (parâmetro inválido, objeto inexistente...), com a mensagem do Meta. */
export class RecusadoPeloMeta extends ErroMeta {
  constructor(mensagem: string, fbtraceId?: string) {
    super('RECUSADO_PELO_META', mensagem, fbtraceId);
  }
}
