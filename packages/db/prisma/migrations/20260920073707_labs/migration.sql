-- CreateEnum
CREATE TYPE "lab_status" AS ENUM ('CREATING', 'READY', 'DESTROYING', 'DESTROYED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "run_kind" ADD VALUE 'LAB_APPLY';
ALTER TYPE "run_kind" ADD VALUE 'LAB_DESTROY';

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "labId" UUID;

-- CreateTable
CREATE TABLE "labs" (
    "id" UUID NOT NULL,
    "architectureId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "lab_status" NOT NULL DEFAULT 'CREATING',
    "entryPort" INTEGER,
    "entryUrl" TEXT,
    "containers" JSONB NOT NULL DEFAULT '[]',
    "workdir" TEXT NOT NULL,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "destroyedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labs_slug_key" ON "labs"("slug");

-- CreateIndex
CREATE INDEX "labs_architectureId_createdAt_idx" ON "labs"("architectureId", "createdAt");

-- CreateIndex
CREATE INDEX "labs_status_expiresAt_idx" ON "labs"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "labs" ADD CONSTRAINT "labs_architectureId_fkey" FOREIGN KEY ("architectureId") REFERENCES "architectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labs" ADD CONSTRAINT "labs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "architecture_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_labId_fkey" FOREIGN KEY ("labId") REFERENCES "labs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
