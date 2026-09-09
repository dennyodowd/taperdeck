-- performances.artist_id must agree with its show's artist_id.
--
-- artist_id is denormalised onto performances so artist-scoped statistics can skip a
-- join. Nothing enforced that it matched the show it points at, and it silently drifted
-- in practice: a run that loaded the same setlists under a second artist identity left
-- 337 performance rows carrying one artist_id while their shows carried another.
--
-- Every gap, rotation and cover statistic reads through performances_counted, which
-- filters on performances.artist_id. Rows attributed to the wrong artist therefore
-- corrupt those numbers while looking entirely normal — the same right-looking, silently
-- false failure class this schema keeps guarding against.
--
-- A composite foreign key makes the invariant structural rather than a convention. It
-- needs a unique key on (id, artist_id) to point at; id is already the primary key, so
-- that constraint is redundant for uniqueness and free in practice, existing only to be
-- referenced.

ALTER TABLE "shows"
  ADD CONSTRAINT "shows_id_artist_unique" UNIQUE ("id", "artist_id");
--> statement-breakpoint

ALTER TABLE "performances"
  DROP CONSTRAINT IF EXISTS "performances_artist_id_artists_id_fk";
--> statement-breakpoint

-- Replaces the plain artist_id -> artists FK. Reaching artists through shows is still
-- guaranteed, because shows.artist_id itself references artists.
ALTER TABLE "performances"
  ADD CONSTRAINT "performances_show_artist_fk"
  FOREIGN KEY ("show_id", "artist_id")
  REFERENCES "shows" ("id", "artist_id")
  ON DELETE CASCADE;
