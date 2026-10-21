-- CreateEnum
CREATE TYPE "StatusEnvio" AS ENUM ('pendente', 'enviado', 'erro', 'descartado');

-- CreateTable
CREATE TABLE "config_capi" (
    "conta_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "dataset_id" TEXT,
    "dataset_nome" TEXT,
    "token_cifrado" BYTEA,
    "iv" BYTEA,
    "waba_id" TEXT,
    "codigo_teste" TEXT,
    "mapeamento" JSONB NOT NULL DEFAULT '{}',
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_capi_pkey" PRIMARY KEY ("conta_id")
);

-- CreateTable
CREATE TABLE "envios_capi" (
    "id" BIGSERIAL NOT NULL,
    "conta_id" UUID NOT NULL,
    "lead_id" UUID,
    "dataset_id" TEXT NOT NULL,
    "gatilho" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "StatusEnvio" NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_tentativa_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "em_envio_ate" TIMESTAMP(3),
    "teste" BOOLEAN NOT NULL DEFAULT false,
    "erro" TEXT,
    "fbtrace_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_em" TIMESTAMP(3),

    CONSTRAINT "envios_capi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "envios_capi_status_proxima_tentativa_em_idx" ON "envios_capi"("status", "proxima_tentativa_em");

-- CreateIndex
CREATE INDEX "envios_capi_conta_id_criado_em_idx" ON "envios_capi"("conta_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "envios_capi_dataset_id_event_id_key" ON "envios_capi"("dataset_id", "event_id");

-- AddForeignKey
ALTER TABLE "config_capi" ADD CONSTRAINT "config_capi_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_capi" ADD CONSTRAINT "envios_capi_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_capi" ADD CONSTRAINT "envios_capi_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

