-- AlterTable
ALTER TABLE "ArticleConversion" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "ArticleVisit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "visits" INTEGER NOT NULL,

    CONSTRAINT "ArticleVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleVisit_siteId_date_idx" ON "ArticleVisit"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleVisit_articleId_date_source_key" ON "ArticleVisit"("articleId", "date", "source");

-- AddForeignKey
ALTER TABLE "ArticleVisit" ADD CONSTRAINT "ArticleVisit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleVisit" ADD CONSTRAINT "ArticleVisit_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
