-- CreateEnum
CREATE TYPE "ProductVisibility" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN_BY_SYNC');

-- CreateTable
CREATE TABLE "Collection" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "theme" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "shopeeItemId" UUID,
    "collectionId" UUID NOT NULL,
    "displayTitle" TEXT,
    "blurb" TEXT,
    "conditionPercent" INTEGER,
    "sealStatus" TEXT,
    "qaNotes" JSONB,
    "badges" JSONB NOT NULL DEFAULT '[]',
    "visibility" "ProductVisibility" NOT NULL DEFAULT 'DRAFT',
    "featuredRank" INTEGER,
    "buyUrlOverride" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundClick" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uaHash" TEXT,
    "ipHash" TEXT,
    "referrer" TEXT,

    CONSTRAINT "OutboundClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "Collection_sortOrder_idx" ON "Collection"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopeeItemId_key" ON "Product"("shopeeItemId");

-- CreateIndex
CREATE INDEX "Product_collectionId_visibility_idx" ON "Product"("collectionId", "visibility");

-- CreateIndex
CREATE INDEX "Product_visibility_publishedAt_idx" ON "Product"("visibility", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Product_featuredRank_idx" ON "Product"("featuredRank");

-- CreateIndex
CREATE INDEX "OutboundClick_productId_occurredAt_idx" ON "OutboundClick"("productId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "OutboundClick_occurredAt_idx" ON "OutboundClick"("occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopeeItemId_fkey" FOREIGN KEY ("shopeeItemId") REFERENCES "ShopeeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundClick" ADD CONSTRAINT "OutboundClick_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the two showroom collections (docs/backend/SHOPEE_SHOWROOM_BACKEND.md 3).
-- The storefront's collection tabs are driven by these slugs, so they must
-- exist in every environment. Staff edit the copy through the curation API;
-- they do not create collections.
INSERT INTO "Collection" ("id", "slug", "title", "subtitle", "theme", "sortOrder", "updatedAt")
VALUES
  (
    gen_random_uuid(),
    'pristine-retail',
    'Pristine Retail',
    'Mỹ phẩm mới, nguyên seal - quầy counter tại trung tâm thương mại.',
    '{"eyebrow": "Quầy counter", "note": "Nguyên seal, hoá đơn đầy đủ, đổi trả theo chính sách Shopee.", "conditionLabel": "brand-new"}'::jsonb,
    10,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'curated-preloved',
    'Curated Pre-loved',
    'Mỹ phẩm đã qua sử dụng, được kiểm định và vệ sinh trước khi lên kệ.',
    '{"eyebrow": "Tủ đồ vintage", "note": "Từng món đều được soi kỹ và ghi rõ mức dung tích còn lại.", "conditionLabel": "pre-loved"}'::jsonb,
    20,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("slug") DO NOTHING;
