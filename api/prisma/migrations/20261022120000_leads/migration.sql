-- CreateEnum
CREATE TYPE "OrigemLead" AS ENUM ('ctwa', 'formulario', 'link', 'organico');

-- CreateEnum
CREATE TYPE "EtapaLead" AS ENUM ('novo', 'em_atendimento', 'qualificado', 'venda', 'descartado');

-- AlterTable
ALTER TABLE "contas" ADD COLUMN     "versao_webhook" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "origem" "OrigemLead" NOT NULL,
    "etapa" "EtapaLead" NOT NULL DEFAULT 'novo',
    "telefone" TEXT,
    "telefone_chave" TEXT,
    "nome" TEXT,
    "email" TEXT,
    "respostas" JSONB NOT NULL DEFAULT '[]',
    "chat_id" TEXT,
    "contato_id" TEXT,
    "atendente_id" TEXT,
    "atendente_nome" TEXT,
    "conta_anuncio_id" UUID,
    "campanha_id_meta" TEXT,
    "conjunto_id_meta" TEXT,
    "anuncio_id_meta" TEXT,
    "vinculo_anuncio" TEXT,
    "anuncio_url" TEXT,
    "anuncio_titulo" TEXT,
    "anuncio_texto" TEXT,
    "ctwa_clid" TEXT,
    "leadgen_id" TEXT,
    "formulario_id_meta" TEXT,
    "valor_venda" DECIMAL(14,2),
    "motivo_descarte" TEXT,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendido_em" TIMESTAMP(3),
    "qualificado_em" TIMESTAMP(3),
    "venda_em" TIMESTAMP(3),
    "descartado_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_lead" (
    "id" BIGSERIAL NOT NULL,
    "lead_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "autor_nome" TEXT,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_conta_id_telefone_chave_idx" ON "leads"("conta_id", "telefone_chave");

-- CreateIndex
CREATE INDEX "leads_conta_id_recebido_em_idx" ON "leads"("conta_id", "recebido_em");

-- CreateIndex
CREATE UNIQUE INDEX "leads_conta_id_chat_id_key" ON "leads"("conta_id", "chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_conta_id_leadgen_id_key" ON "leads"("conta_id", "leadgen_id");

-- CreateIndex
CREATE INDEX "eventos_lead_lead_id_em_idx" ON "eventos_lead"("lead_id", "em");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_lead" ADD CONSTRAINT "eventos_lead_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

