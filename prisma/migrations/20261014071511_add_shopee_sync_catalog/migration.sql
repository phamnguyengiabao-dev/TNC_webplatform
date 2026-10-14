-- CreateEnum
CREATE TYPE "ShopeeItemStatus" AS ENUM ('NORMAL', 'UNLIST', 'BANNED', 'DELETED', 'NOT_SEEN');

-- CreateEnum
CREATE TYPE "SyncProvider" AS ENUM ('CSV', 'AFFILIATE', 'OPEN_PLATFORM');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('FULL', 'INCREMENTAL', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "ShopeeShop" (
    "id" UUID NOT NULL,
    "shopeeShopId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'vn',
    "lastSyncAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShopeeShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopeeItem" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "itemId" BIGINT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemStatus" "ShopeeItemStatus" NOT NULL DEFAULT 'NORMAL',
    "price" DECIMAL(12,2),
    "priceMin" DECIMAL(12,2),
    "priceMax" DECIMAL(12,2),
    "stock" INTEGER,
    "hasModel" BOOLEAN NOT NULL DEFAULT false,
    "imageUrls" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "shopeeUpdateTime" TIMESTAMPTZ(6),
    "contentHash" TEXT NOT NULL,
    "raw" JSONB,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShopeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopeeItemModel" (
    "id" UUID NOT NULL,
    "itemRef" UUID NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2),
    "stock" INTEGER,

    CONSTRAINT "ShopeeItemModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" UUID NOT NULL,
    "shopId" UUID,
    "provider" "SyncProvider" NOT NULL,
    "mode" "SyncMode" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB,
    "startedBy" UUID,
    "storageRef" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncError" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "itemRef" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopeeShop_shopeeShopId_key" ON "ShopeeShop"("shopeeShopId");

-- CreateIndex
CREATE INDEX "ShopeeItem_itemStatus_idx" ON "ShopeeItem"("itemStatus");

-- CreateIndex
CREATE INDEX "ShopeeItem_lastSeenAt_idx" ON "ShopeeItem"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopeeItem_shopId_itemId_key" ON "ShopeeItem"("shopId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopeeItemModel_itemRef_modelId_key" ON "ShopeeItemModel"("itemRef", "modelId");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");

-- CreateIndex
CREATE INDEX "SyncError_runId_idx" ON "SyncError"("runId");

-- AddForeignKey
ALTER TABLE "ShopeeItem" ADD CONSTRAINT "ShopeeItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopeeShop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopeeItemModel" ADD CONSTRAINT "ShopeeItemModel_itemRef_fkey" FOREIGN KEY ("itemRef") REFERENCES "ShopeeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopeeShop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncError" ADD CONSTRAINT "SyncError_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
