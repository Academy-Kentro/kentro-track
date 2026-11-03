-- O webhook de saída passa a ser um endereço por conta, que recebe os leads de campanha.
-- A fila antiga leva eventos que deixam de existir, em outro formato: não é enviada.
DELETE FROM "envios_webhook";

-- Só a URL de "conversa criada" tem o mesmo sentido de agora; vale a mais antiga de cada conta.
DELETE FROM "webhooks_saida" WHERE "url_criada" IS NULL;
DELETE FROM "webhooks_saida" w
USING "webhooks_saida" o
WHERE w."conta_id" = o."conta_id" AND (o."criado_em", o."id") < (w."criado_em", w."id");

ALTER TABLE "webhooks_saida" RENAME COLUMN "url_criada" TO "url";
ALTER TABLE "webhooks_saida" ALTER COLUMN "url" SET NOT NULL;
ALTER TABLE "webhooks_saida"
  DROP COLUMN "nome",
  DROP COLUMN "url_alterada",
  DROP COLUMN "url_mensagem",
  DROP COLUMN "url_origem",
  DROP COLUMN "origens",
  DROP COLUMN "ativo",
  DROP COLUMN "motivo_desativado";

DROP INDEX "webhooks_saida_conta_id_idx";
CREATE UNIQUE INDEX "webhooks_saida_conta_id_key" ON "webhooks_saida"("conta_id");

ALTER TABLE "envios_webhook"
  DROP COLUMN "evento",
  DROP COLUMN "url";

-- Cada lead sai uma vez só, mesmo que a origem dele mude depois.
CREATE UNIQUE INDEX "envios_webhook_webhook_id_lead_id_key" ON "envios_webhook"("webhook_id", "lead_id");
