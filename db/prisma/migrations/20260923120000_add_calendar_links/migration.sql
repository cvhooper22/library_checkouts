-- CreateTable
-- One Google Calendar per household, connected through one member's OAuth grant.
-- calendar_revocations queues disconnects for the worker, which alone decrypts tokens.
CREATE TABLE "calendar_links" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "connected_user_id" UUID NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "reminder_time" INTEGER NOT NULL DEFAULT 480,
    "time_zone" TEXT NOT NULL,
    "show_titles" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_revocations" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "delete_calendar" BOOLEAN NOT NULL DEFAULT false,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,

    CONSTRAINT "calendar_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_links_household_id_key" ON "calendar_links"("household_id");

-- AddForeignKey
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_connected_user_id_fkey" FOREIGN KEY ("connected_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_revocations" ADD CONSTRAINT "calendar_revocations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

