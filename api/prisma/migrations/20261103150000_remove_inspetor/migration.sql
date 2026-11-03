-- O Inspetor de Vendas saiu do produto. As vendas já aprovadas continuam nos leads.
DROP TABLE "conversoes_sugeridas";

ALTER TABLE "contas"
  DROP COLUMN "inspetor_ativo",
  DROP COLUMN "inspetor_mes",
  DROP COLUMN "inspetor_usadas";

ALTER TABLE "leads" DROP COLUMN "inspecionado_em";
