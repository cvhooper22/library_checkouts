-- AlterTable
-- `slug` is added nullable first so existing rows can be backfilled before the
-- NOT NULL + unique constraints go on.
ALTER TABLE "libraries" ADD COLUMN     "city" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "state" TEXT;

-- Backfill: slugify the name; a numeric suffix keeps duplicates unique.
WITH base AS (
    SELECT
        "id",
        COALESCE(NULLIF(trim(BOTH '-' FROM lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'library') AS "slug_base"
    FROM "libraries"
),
ranked AS (
    SELECT "id", "slug_base", row_number() OVER (PARTITION BY "slug_base" ORDER BY "id") AS "n"
    FROM base
)
UPDATE "libraries" AS l
SET "slug" = CASE WHEN r."n" = 1 THEN r."slug_base" ELSE r."slug_base" || '-' || r."n" END
FROM ranked AS r
WHERE l."id" = r."id";

-- The demo library (adr/0002-demo-mode.md) is never user-selectable.
UPDATE "libraries" SET "is_active" = false WHERE "scraper_type_default" = 'demo';

ALTER TABLE "libraries" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "libraries_slug_key" ON "libraries"("slug");
