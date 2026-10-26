-- AlterTable
ALTER TABLE "contas" ADD COLUMN     "captura_kentro_url" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "kentro_em_envio_ate" TIMESTAMP(3),
ADD COLUMN     "kentro_enviado_em" TIMESTAMP(3),
ADD COLUMN     "kentro_erro" TEXT,
ADD COLUMN     "kentro_proxima_em" TIMESTAMP(3),
ADD COLUMN     "kentro_status" "StatusEnvio",
ADD COLUMN     "kentro_tentativas" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "formularios_meta" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "id_meta" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT,
    "pagina_id_meta" TEXT NOT NULL,
    "pagina_nome" TEXT NOT NULL,
    "pagina_token_cifrado" BYTEA NOT NULL,
    "pagina_token_iv" BYTEA NOT NULL,
    "perguntas" JSONB NOT NULL DEFAULT '{}',
    "selecionado" BOOLEAN NOT NULL DEFAULT false,
    "lido_ate" TIMESTAMP(3),
    "proxima_leitura_em" TIMESTAMP(3),
    "em_leitura_ate" TIMESTAMP(3),
    "ultima_leitura_em" TIMESTAMP(3),
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formularios_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "formularios_meta_selecionado_proxima_leitura_em_idx" ON "formularios_meta"("selecionado", "proxima_leitura_em");

-- CreateIndex
CREATE UNIQUE INDEX "formularios_meta_conta_id_id_meta_key" ON "formularios_meta"("conta_id", "id_meta");

-- CreateIndex
CREATE INDEX "leads_kentro_status_kentro_proxima_em_idx" ON "leads"("kentro_status", "kentro_proxima_em");

-- AddForeignKey
ALTER TABLE "formularios_meta" ADD CONSTRAINT "formularios_meta_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

