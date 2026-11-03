-- AlterTable
ALTER TABLE "contas" ADD COLUMN     "chave_api_hash" TEXT,
ADD COLUMN     "inspetor_ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inspetor_mes" TEXT,
ADD COLUMN     "inspetor_usadas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "config_capi" ADD COLUMN     "enviar_organicos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "etapas_funil" ADD COLUMN     "eventos_extras" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "fbclid" TEXT,
ADD COLUMN     "gbraid" TEXT,
ADD COLUMN     "gclid" TEXT,
ADD COLUMN     "inspecionado_em" TIMESTAMP(3),
ADD COLUMN     "link_id" UUID,
ADD COLUMN     "utm_campaign" TEXT,
ADD COLUMN     "utm_content" TEXT,
ADD COLUMN     "utm_medium" TEXT,
ADD COLUMN     "utm_source" TEXT,
ADD COLUMN     "utm_term" TEXT,
ADD COLUMN     "wbraid" TEXT;

-- CreateTable
CREATE TABLE "links_rastreaveis" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "computador_web" BOOLEAN NOT NULL DEFAULT true,
    "titulo_espera" TEXT NOT NULL,
    "mensagem_espera" TEXT NOT NULL,
    "codigo_visivel" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "links_rastreaveis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitas_link" (
    "id" BIGSERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "conta_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "fbclid" TEXT,
    "anuncio_id_meta" TEXT,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitas_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversoes_sugeridas" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "confianca" TEXT NOT NULL,
    "evidencia" TEXT NOT NULL,
    "evidencia_em" TIMESTAMP(3),
    "valor_sugerido" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "decidido_em" TIMESTAMP(3),
    "decidido_por" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversoes_sugeridas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks_saida" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "url_criada" TEXT,
    "url_alterada" TEXT,
    "url_mensagem" TEXT,
    "url_origem" TEXT,
    "origens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "motivo_desativado" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_saida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_webhook" (
    "id" BIGSERIAL NOT NULL,
    "conta_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "lead_id" UUID,
    "evento" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "StatusEnvio" NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_tentativa_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "em_envio_ate" TIMESTAMP(3),
    "resposta_status" INTEGER,
    "erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_em" TIMESTAMP(3),

    CONSTRAINT "envios_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contas_chave_api_hash_key" ON "contas"("chave_api_hash");
CREATE INDEX "leads_conta_id_link_id_idx" ON "leads"("conta_id", "link_id");
CREATE UNIQUE INDEX "links_rastreaveis_codigo_key" ON "links_rastreaveis"("codigo");
CREATE INDEX "links_rastreaveis_conta_id_idx" ON "links_rastreaveis"("conta_id");
CREATE UNIQUE INDEX "visitas_link_conta_id_codigo_key" ON "visitas_link"("conta_id", "codigo");
CREATE INDEX "visitas_link_link_id_em_idx" ON "visitas_link"("link_id", "em");
CREATE INDEX "visitas_link_em_idx" ON "visitas_link"("em");
CREATE INDEX "conversoes_sugeridas_conta_id_status_criado_em_idx" ON "conversoes_sugeridas"("conta_id", "status", "criado_em");
CREATE INDEX "conversoes_sugeridas_lead_id_idx" ON "conversoes_sugeridas"("lead_id");
CREATE INDEX "webhooks_saida_conta_id_idx" ON "webhooks_saida"("conta_id");
CREATE INDEX "envios_webhook_status_proxima_tentativa_em_idx" ON "envios_webhook"("status", "proxima_tentativa_em");
CREATE INDEX "envios_webhook_conta_id_criado_em_idx" ON "envios_webhook"("conta_id", "criado_em");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links_rastreaveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "links_rastreaveis" ADD CONSTRAINT "links_rastreaveis_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visitas_link" ADD CONSTRAINT "visitas_link_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visitas_link" ADD CONSTRAINT "visitas_link_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links_rastreaveis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversoes_sugeridas" ADD CONSTRAINT "conversoes_sugeridas_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversoes_sugeridas" ADD CONSTRAINT "conversoes_sugeridas_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhooks_saida" ADD CONSTRAINT "webhooks_saida_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "envios_webhook" ADD CONSTRAINT "envios_webhook_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "envios_webhook" ADD CONSTRAINT "envios_webhook_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks_saida"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "envios_webhook" ADD CONSTRAINT "envios_webhook_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
