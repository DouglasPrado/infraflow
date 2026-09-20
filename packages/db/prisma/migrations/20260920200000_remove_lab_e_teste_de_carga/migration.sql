-- O laboratório efêmero e o teste de carga saem do produto: a capacidade passa
-- a vir só do motor de análise. Execuções desses tipos descrevem uma
-- funcionalidade que deixou de existir, então saem com ela.
DELETE FROM "runs" WHERE "kind" IN ('LAB_APPLY', 'LAB_DESTROY', 'LOAD_TEST');

-- A execução não aponta mais para laboratório nenhum.
ALTER TABLE "runs" DROP CONSTRAINT "runs_labId_fkey";
ALTER TABLE "runs" DROP COLUMN "labId";

DROP TABLE "labs";
DROP TYPE "lab_status";

-- Postgres não remove valor de enum em uso: o tipo é recriado sem eles.
ALTER TYPE "run_kind" RENAME TO "run_kind_old";
CREATE TYPE "run_kind" AS ENUM ('PLAN');
ALTER TABLE "runs" ALTER COLUMN "kind" TYPE "run_kind" USING ("kind"::text::"run_kind");
DROP TYPE "run_kind_old";
