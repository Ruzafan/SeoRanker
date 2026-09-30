-- AlterTable
ALTER TABLE "UsageRecord" ADD COLUMN     "products" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "remoteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "issues" TEXT[],
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSuggestion" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ProductSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_siteId_score_idx" ON "Product"("siteId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Product_siteId_remoteId_key" ON "Product"("siteId", "remoteId");

-- CreateIndex
CREATE INDEX "ProductSuggestion_productId_status_idx" ON "ProductSuggestion"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductSuggestion_siteId_status_idx" ON "ProductSuggestion"("siteId", "status");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSuggestion" ADD CONSTRAINT "ProductSuggestion_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSuggestion" ADD CONSTRAINT "ProductSuggestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
