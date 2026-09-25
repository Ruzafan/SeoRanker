-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "decayDetectedAt" TIMESTAMP(3),
ADD COLUMN     "remoteStatus" TEXT;

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "cpc" DOUBLE PRECISION,
ADD COLUMN     "difficulty" INTEGER,
ADD COLUMN     "gscClicks" INTEGER,
ADD COLUMN     "gscImpressions" INTEGER,
ADD COLUMN     "gscPosition" DOUBLE PRECISION,
ADD COLUMN     "volume" INTEGER;

-- CreateTable
CREATE TABLE "SearchConsoleConnection" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "googleEmail" TEXT,
    "propertyUrl" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchConsoleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleMetric" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ArticleMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleConversion" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchConsoleConnection_siteId_key" ON "SearchConsoleConnection"("siteId");

-- CreateIndex
CREATE INDEX "ArticleMetric_siteId_date_idx" ON "ArticleMetric"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleMetric_articleId_date_key" ON "ArticleMetric"("articleId", "date");

-- CreateIndex
CREATE INDEX "ArticleConversion_siteId_orderedAt_idx" ON "ArticleConversion"("siteId", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleConversion_siteId_orderId_key" ON "ArticleConversion"("siteId", "orderId");

-- AddForeignKey
ALTER TABLE "SearchConsoleConnection" ADD CONSTRAINT "SearchConsoleConnection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleMetric" ADD CONSTRAINT "ArticleMetric_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleMetric" ADD CONSTRAINT "ArticleMetric_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleConversion" ADD CONSTRAINT "ArticleConversion_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleConversion" ADD CONSTRAINT "ArticleConversion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
