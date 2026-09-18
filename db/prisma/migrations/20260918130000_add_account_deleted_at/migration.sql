-- AlterTable
-- Soft delete: a non-null `deleted_at` means the card was removed by the user.
-- The row (and its runs/checkouts) is kept; every reader filters on it.
ALTER TABLE "accounts" ADD COLUMN     "deleted_at" TIMESTAMPTZ;
