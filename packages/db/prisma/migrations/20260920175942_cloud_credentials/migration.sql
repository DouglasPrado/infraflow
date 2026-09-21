-- CreateTable
CREATE TABLE "cloud_credentials" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'aws',
    "region" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "cipher" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "accountId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cloud_credentials_projectId_key" ON "cloud_credentials"("projectId");

-- AddForeignKey
ALTER TABLE "cloud_credentials" ADD CONSTRAINT "cloud_credentials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
