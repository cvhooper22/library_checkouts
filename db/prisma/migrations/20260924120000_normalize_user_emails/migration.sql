-- Emails are now stored trimmed and lowercased (api/src/lib/email.js), so existing
-- rows are brought in line. Two rows that only differ by case or whitespace can't be
-- merged automatically; the migration stops with their addresses instead, and one of
-- them has to be renamed or removed by hand before it runs again.
DO $$
DECLARE
    collisions TEXT;
BEGIN
    SELECT string_agg(emails, '; ')
    INTO collisions
    FROM (
        SELECT string_agg(email, ', ') AS emails
        FROM "users"
        GROUP BY lower(btrim(email))
        HAVING count(*) > 1
    ) dupes;

    IF collisions IS NOT NULL THEN
        RAISE EXCEPTION 'Emails collide once lowercased: %', collisions;
    END IF;
END $$;

UPDATE "users" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

-- Not modeled in schema.prisma (Prisma has no check constraints); it keeps a write that
-- skips normalizeEmail from creating a second, differently-cased account.
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email")));
