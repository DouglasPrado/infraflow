-- CreateEnum
CREATE TYPE "run_kind" AS ENUM ('PLAN');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "architectureId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "kind" "run_kind" NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'QUEUED',
    "slug" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "logs" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "runs_slug_key" ON "runs"("slug");

-- CreateIndex
CREATE INDEX "runs_architectureId_createdAt_idx" ON "runs"("architectureId", "createdAt");

-- CreateIndex
CREATE INDEX "runs_status_idx" ON "runs"("status");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_architectureId_fkey" FOREIGN KEY ("architectureId") REFERENCES "architectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "architecture_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
