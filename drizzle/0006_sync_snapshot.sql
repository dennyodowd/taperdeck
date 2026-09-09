-- Snapshot alignment only. No functional change.
--
-- Migration 0005 dropped performances_artist_id_artists_id_fk as hand-written SQL, which
-- drizzle-kit's snapshot does not see. Without this statement every future
-- `drizzle-kit generate` would keep re-emitting the same DROP, and real changes would be
-- buried in recurring noise.
--
-- IF EXISTS because 0005 has already removed the constraint on any database that has run
-- it; this must be a no-op there rather than an error.

ALTER TABLE "performances" DROP CONSTRAINT IF EXISTS "performances_artist_id_artists_id_fk";
