-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "allowSimilar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clusterId" TEXT,
ADD COLUMN     "discardReason" TEXT,
ADD COLUMN     "similarToArticleId" TEXT;

-- CreateTable
CREATE TABLE "KeywordCluster" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pillarKeywordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalLink" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "fromArticleId" TEXT NOT NULL,
    "toArticleId" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordCluster_siteId_idx" ON "KeywordCluster"("siteId");

-- CreateIndex
CREATE INDEX "InternalLink_siteId_idx" ON "InternalLink"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalLink_fromArticleId_toArticleId_key" ON "InternalLink"("fromArticleId", "toArticleId");

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "KeywordCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordCluster" ADD CONSTRAINT "KeywordCluster_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_fromArticleId_fkey" FOREIGN KEY ("fromArticleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_toArticleId_fkey" FOREIGN KEY ("toArticleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
