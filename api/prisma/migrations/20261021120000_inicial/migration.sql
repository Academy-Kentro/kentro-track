-- CreateEnum
CREATE TYPE "StatusConta" AS ENUM ('pendente_conexao', 'ativa', 'reconectar', 'bloqueada');

-- CreateTable
CREATE TABLE "contas" (
    "id" UUID NOT NULL,
    "nome" TEXT,
    "instancia_kentro" TEXT,
    "chave_admin_hash" TEXT NOT NULL,
    "chave_gestor_hash" TEXT NOT NULL,
    "chave_atendimento_hash" TEXT NOT NULL,
    "status" "StatusConta" NOT NULL DEFAULT 'pendente_conexao',
    "plano" TEXT NOT NULL DEFAULT 'gratis',
    "limites" JSONB NOT NULL DEFAULT '{}',
    "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contas_chave_admin_hash_key" ON "contas"("chave_admin_hash");

-- CreateIndex
CREATE UNIQUE INDEX "contas_chave_gestor_hash_key" ON "contas"("chave_gestor_hash");

-- CreateIndex
CREATE UNIQUE INDEX "contas_chave_atendimento_hash_key" ON "contas"("chave_atendimento_hash");
