-- CreateEnum
CREATE TYPE "TipoConexaoMeta" AS ENUM ('token_manual', 'login_empresa');

-- CreateEnum
CREATE TYPE "StatusConexaoMeta" AS ENUM ('ativa', 'reconectar');

-- CreateTable
CREATE TABLE "conexoes_meta" (
    "conta_id" UUID NOT NULL,
    "tipo" "TipoConexaoMeta" NOT NULL,
    "token_cifrado" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "usuario_meta_id" TEXT NOT NULL,
    "usuario_meta_nome" TEXT NOT NULL,
    "escopos" TEXT[],
    "status" "StatusConexaoMeta" NOT NULL DEFAULT 'ativa',
    "verificado_em" TIMESTAMP(3) NOT NULL,
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexoes_meta_pkey" PRIMARY KEY ("conta_id")
);

-- CreateTable
CREATE TABLE "contas_anuncio" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "id_meta" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "moeda" TEXT NOT NULL,
    "fuso" TEXT NOT NULL,
    "status_meta" INTEGER,
    "empresa" TEXT,
    "selecionada" BOOLEAN NOT NULL DEFAULT false,
    "definicao_lead" TEXT[] DEFAULT ARRAY['formulario', 'conversa']::TEXT[],
    "carga_concluida_em" TIMESTAMP(3),
    "proxima_horaria_em" TIMESTAMP(3),
    "proximo_recalculo_em" TIMESTAMP(3),
    "proxima_entidades_em" TIMESTAMP(3),
    "em_execucao_ate" TIMESTAMP(3),
    "ultima_sincronizacao_em" TIMESTAMP(3),
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_anuncio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanhas" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "conta_anuncio_id" UUID NOT NULL,
    "id_meta" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT,
    "status_efetivo" TEXT,
    "objetivo" TEXT,
    "orcamento_diario" DECIMAL(14,2),
    "orcamento_total" DECIMAL(14,2),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campanhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conjuntos" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "conta_anuncio_id" UUID NOT NULL,
    "id_meta" TEXT NOT NULL,
    "campanha_id_meta" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT,
    "status_efetivo" TEXT,
    "orcamento_diario" DECIMAL(14,2),
    "orcamento_total" DECIMAL(14,2),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anuncios" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "conta_anuncio_id" UUID NOT NULL,
    "id_meta" TEXT NOT NULL,
    "conjunto_id_meta" TEXT NOT NULL,
    "campanha_id_meta" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT,
    "status_efetivo" TEXT,
    "criativo_id_meta" TEXT,
    "miniatura_url" TEXT,
    "titulo" TEXT,
    "texto" TEXT,
    "object_story_id" TEXT,
    "permalink" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anuncios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights_diarios" (
    "conta_id" UUID NOT NULL,
    "conta_anuncio_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "anuncio_id_meta" TEXT NOT NULL,
    "conjunto_id_meta" TEXT NOT NULL,
    "campanha_id_meta" TEXT NOT NULL,
    "investimento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impressoes" INTEGER NOT NULL DEFAULT 0,
    "alcance" INTEGER NOT NULL DEFAULT 0,
    "cliques" INTEGER NOT NULL DEFAULT 0,
    "cliques_link" INTEGER NOT NULL DEFAULT 0,
    "leads_formulario" INTEGER NOT NULL DEFAULT 0,
    "leads_site" INTEGER NOT NULL DEFAULT 0,
    "conversas" INTEGER NOT NULL DEFAULT 0,
    "acoes" JSONB NOT NULL DEFAULT '{}',
    "valores_acoes" JSONB NOT NULL DEFAULT '{}',
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insights_diarios_pkey" PRIMARY KEY ("conta_anuncio_id","anuncio_id_meta","data")
);

-- CreateTable
CREATE TABLE "chamadas_meta" (
    "id" BIGSERIAL NOT NULL,
    "conta_id" UUID,
    "operacao" TEXT NOT NULL,
    "status_http" INTEGER,
    "ms" INTEGER NOT NULL,
    "erro_codigo" TEXT,
    "uso" JSONB,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chamadas_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contas_anuncio_conta_id_id_meta_key" ON "contas_anuncio"("conta_id", "id_meta");

-- CreateIndex
CREATE UNIQUE INDEX "campanhas_conta_anuncio_id_id_meta_key" ON "campanhas"("conta_anuncio_id", "id_meta");

-- CreateIndex
CREATE UNIQUE INDEX "conjuntos_conta_anuncio_id_id_meta_key" ON "conjuntos"("conta_anuncio_id", "id_meta");

-- CreateIndex
CREATE UNIQUE INDEX "anuncios_conta_anuncio_id_id_meta_key" ON "anuncios"("conta_anuncio_id", "id_meta");

-- CreateIndex
CREATE INDEX "insights_diarios_conta_id_data_idx" ON "insights_diarios"("conta_id", "data");

-- CreateIndex
CREATE INDEX "chamadas_meta_conta_id_em_idx" ON "chamadas_meta"("conta_id", "em");

-- AddForeignKey
ALTER TABLE "conexoes_meta" ADD CONSTRAINT "conexoes_meta_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_anuncio" ADD CONSTRAINT "contas_anuncio_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conjuntos" ADD CONSTRAINT "conjuntos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anuncios" ADD CONSTRAINT "anuncios_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights_diarios" ADD CONSTRAINT "insights_diarios_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamadas_meta" ADD CONSTRAINT "chamadas_meta_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

