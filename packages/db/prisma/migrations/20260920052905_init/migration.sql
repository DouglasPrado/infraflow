-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "architectures" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "architectures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "architecture_versions" (
    "id" UUID NOT NULL,
    "architectureId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "architecture_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "architectures_projectId_name_key" ON "architectures"("projectId", "name");

-- CreateIndex
CREATE INDEX "architecture_versions_architectureId_createdAt_idx" ON "architecture_versions"("architectureId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "architecture_versions_architectureId_number_key" ON "architecture_versions"("architectureId", "number");

-- AddForeignKey
ALTER TABLE "architectures" ADD CONSTRAINT "architectures_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "architecture_versions" ADD CONSTRAINT "architecture_versions_architectureId_fkey" FOREIGN KEY ("architectureId") REFERENCES "architectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;
