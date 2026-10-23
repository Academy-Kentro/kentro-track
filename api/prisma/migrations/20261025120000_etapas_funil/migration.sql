-- CreateEnum
CREATE TYPE "TipoEtapa" AS ENUM ('andamento', 'venda', 'perda');

-- CreateTable
CREATE TABLE "etapas_funil" (
    "id" UUID NOT NULL,
    "conta_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoEtapa" NOT NULL,
    "ordem" INTEGER NOT NULL,
    "qualificada" BOOLEAN NOT NULL DEFAULT false,
    "evento_meta" TEXT,
    "botao_atendente" BOOLEAN NOT NULL DEFAULT true,
    "no_painel" BOOLEAN NOT NULL DEFAULT true,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etapas_funil_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "etapa_id" UUID,
ADD COLUMN "etapas_alcancadas" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateIndex
CREATE UNIQUE INDEX "etapas_funil_conta_id_chave_key" ON "etapas_funil"("conta_id", "chave");
CREATE INDEX "etapas_funil_conta_id_ordem_idx" ON "etapas_funil"("conta_id", "ordem");

-- AddForeignKey
ALTER TABLE "etapas_funil" ADD CONSTRAINT "etapas_funil_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_etapa_id_fkey" FOREIGN KEY ("etapa_id") REFERENCES "etapas_funil"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- As etapas de antes viram a lista inicial de cada conta, com os eventos do Meta que ela já usava.
INSERT INTO "etapas_funil" ("id", "conta_id", "chave", "nome", "tipo", "ordem", "qualificada", "evento_meta")
SELECT gen_random_uuid(), c."id", e.chave, e.nome, e.tipo::"TipoEtapa", e.ordem, e.qualificada,
       CASE WHEN cc."mapeamento" ? e.chave THEN cc."mapeamento"->>e.chave ELSE e.padrao END
FROM "contas" c
LEFT JOIN "config_capi" cc ON cc."conta_id" = c."id"
CROSS JOIN (VALUES
  ('qualificado', 'Qualificado', 'andamento', 1, true, 'QualifiedLead'),
  ('venda', 'Venda', 'venda', 2, false, 'Purchase'),
  ('descartado', 'Descartado', 'perda', 3, false, NULL)
) AS e(chave, nome, tipo, ordem, qualificada, padrao);

-- Cada lead fica na etapa equivalente; o funil passa a contar pelas etapas alcançadas.
UPDATE "leads" l SET "etapa_id" = e."id"
FROM "etapas_funil" e
WHERE e."conta_id" = l."conta_id" AND e."chave" = l."etapa"::text AND l."etapa" IN ('qualificado', 'venda', 'descartado');

UPDATE "leads" l SET "etapas_alcancadas" = ARRAY[e."id"]
FROM "etapas_funil" e
WHERE e."conta_id" = l."conta_id"
  AND ((l."etapa" = 'venda' AND e."chave" = 'venda')
       OR (l."etapa" <> 'venda' AND l."qualificado_em" IS NOT NULL AND e."chave" = 'qualificado'));

UPDATE "leads" SET "etapas_alcancadas" = ARRAY[]::UUID[] WHERE "etapas_alcancadas" IS NULL;
ALTER TABLE "leads" ALTER COLUMN "etapas_alcancadas" SET NOT NULL;
