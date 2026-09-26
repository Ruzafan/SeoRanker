-- CreateTable
CREATE TABLE "AiVisibilityCheck" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL,
    "cited" BOOLEAN NOT NULL,
    "competitors" TEXT[],
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiVisibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiVisibilityCheck_siteId_createdAt_idx" ON "AiVisibilityCheck"("siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiVisibilityCheck" ADD CONSTRAINT "AiVisibilityCheck_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
