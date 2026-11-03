-- AlterTable
ALTER TABLE "etapas_funil" ADD COLUMN     "frases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "valor_padrao" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "primeira_resposta_em" TIMESTAMP(3),
ADD COLUMN     "segunda_resposta_em" TIMESTAMP(3),
ADD COLUMN     "ultima_mensagem_em" TIMESTAMP(3),
ADD COLUMN     "ultima_mensagem_lead_em" TIMESTAMP(3);
