ALTER TYPE "SyncProvider" ADD VALUE 'META';

CREATE TYPE "SocialMediaPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM');
CREATE TYPE "SocialMediaVisibility" AS ENUM ('PENDING', 'PUBLIC', 'HIDDEN');

CREATE TABLE "SocialMediaItem" (
    "id" UUID NOT NULL,
    "platform" "SocialMediaPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "caption" TEXT,
    "mediaType" TEXT NOT NULL,
    "mediaUrls" JSONB NOT NULL DEFAULT '[]',
    "selectedMediaUrls" JSONB NOT NULL DEFAULT '[]',
    "permalink" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "visibility" "SocialMediaVisibility" NOT NULL DEFAULT 'PENDING',
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "raw" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "SocialMediaItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialMediaItem_platform_externalId_key" ON "SocialMediaItem"("platform", "externalId");
CREATE INDEX "SocialMediaItem_visibility_publishedAt_idx" ON "SocialMediaItem"("visibility", "publishedAt" DESC);
CREATE INDEX "SocialMediaItem_platform_publishedAt_idx" ON "SocialMediaItem"("platform", "publishedAt" DESC);

ALTER TABLE "SocialMediaItem" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE "SocialMediaItem" FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE "SocialMediaItem" FROM authenticated;
    END IF;
END $$;
