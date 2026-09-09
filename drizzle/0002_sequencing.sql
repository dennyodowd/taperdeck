-- The show ordinal, and the views that make the wrong query unreachable.

-- ---------------------------------------------------------------------------
-- Uniqueness on (artist_id, show_seq), DEFERRED.
--
-- A backfill renumber shifts many rows in one UPDATE (1->2, 2->3, ...). Postgres checks
-- a non-deferrable unique constraint per row as the statement proceeds, so an ordinary
-- unique index collides transiently against rows it has not reached yet. Deferring the
-- check to commit lets the whole renumber land as one consistent state.
-- ---------------------------------------------------------------------------

ALTER TABLE "shows"
  ADD CONSTRAINT "shows_artist_seq_unique"
  UNIQUE ("artist_id", "show_seq")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Resequencing.
--
-- Ingestion fetches recent pages first and backfills OLDER shows later, so new rows
-- insert *below* existing ones. An incrementing counter would be wrong the first time
-- backfill ran. This recomputes row_number() across the artist's whole history instead
-- of appending, which is the entire point.
--
-- Statement-level, not row-level: a 20-row page insert recomputes once, not twenty times.
--
-- Non-performed shows (empty setlists, or nothing but PA music) keep show_seq NULL and
-- are excluded from the window, so they never consume an ordinal and never inflate a
-- gap. The rows are still stored — data is retained, just not counted.
--
-- Attached as a trigger rather than a function someone has to remember to call: it runs
-- inside the ingest transaction whether or not the caller knows it exists.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION taperdeck_resequence_shows()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  affected integer[];
BEGIN
  -- This function UPDATEs shows, which re-fires the UPDATE trigger. Without this guard
  -- it recurses. The IS DISTINCT FROM filter below also makes any second pass a no-op,
  -- but the guard is what makes termination unconditional.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(DISTINCT artist_id) INTO affected FROM changed_shows;

  IF affected IS NULL THEN
    RETURN NULL;
  END IF;

  WITH ranked AS (
    SELECT s.id,
           row_number() OVER (
             PARTITION BY s.artist_id
             -- id breaks ties so two shows on one date order deterministically.
             ORDER BY s.event_date, s.id
           ) AS seq
    FROM shows s
    WHERE s.artist_id = ANY(affected)
      AND s.is_performed
  )
  UPDATE shows s
     SET show_seq = r.seq
    FROM ranked r
   WHERE s.id = r.id
     AND s.show_seq IS DISTINCT FROM r.seq;

  -- A show that loses its songs (edited upstream to empty) must give up its ordinal.
  UPDATE shows s
     SET show_seq = NULL
   WHERE s.artist_id = ANY(affected)
     AND NOT s.is_performed
     AND s.show_seq IS NOT NULL;

  RETURN NULL;
END;
$func$;
--> statement-breakpoint

-- REFERENCING OLD TABLE ... NEW TABLE together is only valid for UPDATE, so this is
-- three triggers over one function rather than one trigger.

CREATE TRIGGER shows_resequence_insert
AFTER INSERT ON "shows"
REFERENCING NEW TABLE AS changed_shows
FOR EACH STATEMENT EXECUTE FUNCTION taperdeck_resequence_shows();
--> statement-breakpoint

CREATE TRIGGER shows_resequence_update
AFTER UPDATE ON "shows"
REFERENCING NEW TABLE AS changed_shows
FOR EACH STATEMENT EXECUTE FUNCTION taperdeck_resequence_shows();
--> statement-breakpoint

CREATE TRIGGER shows_resequence_delete
AFTER DELETE ON "shows"
REFERENCING OLD TABLE AS changed_shows
FOR EACH STATEMENT EXECUTE FUNCTION taperdeck_resequence_shows();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- performances_counted — the only surface statistics should read.
--
-- tape:true means the song went out over the PA and was not performed. A band that plays
-- the same walk-on track nightly would otherwise look like it has a lock-solid opener it
-- has never actually played. The filter is baked in here so that forgetting it is not
-- reachable from a stats query, rather than merely discouraged.
-- ---------------------------------------------------------------------------

CREATE VIEW performances_counted AS
SELECT p.id,
       p.show_id,
       p.song_id,
       p.artist_id,
       p.set_index,
       p.position,
       p.set_name,
       p.encore,
       p.info,
       p.guest,
       p.name_raw,
       s.event_date,
       s.show_seq,
       s.tour_name
  FROM performances p
  JOIN shows s ON s.id = p.show_id
 WHERE NOT p.is_tape
   AND s.is_performed
   AND s.show_seq IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- song_gap — the headline number.
--
-- Because show_seq is materialised on shows, "shows since this song last appeared" is
-- integer subtraction over an indexed grouped scan, not a count over rows in application
-- code.
--
-- CAVEAT: gap is measured against the shows we actually hold. While an artist's history
-- is only partially ingested, this understates real gaps. Do not present it as absolute
-- until backfill for that artist is complete.
-- ---------------------------------------------------------------------------

CREATE VIEW song_gap AS
WITH artist_latest AS (
  SELECT artist_id, max(show_seq) AS latest_seq
    FROM shows
   WHERE show_seq IS NOT NULL
   GROUP BY artist_id
)
SELECT pc.artist_id,
       pc.song_id,
       count(*)::integer                        AS times_played,
       min(pc.show_seq)::integer                AS first_seq,
       max(pc.show_seq)::integer                AS last_seq,
       max(pc.event_date)                       AS last_played_date,
       (al.latest_seq - max(pc.show_seq))::integer AS current_gap
  FROM performances_counted pc
  JOIN artist_latest al ON al.artist_id = pc.artist_id
 GROUP BY pc.artist_id, pc.song_id, al.latest_seq;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- song_gap_history — every historical gap, which is what surfaces "returned after 200
-- shows". Left as a plain view; if it gets slow it can be promoted to a maintained
-- table behind the same name without changing callers.
-- ---------------------------------------------------------------------------

CREATE VIEW song_gap_history AS
SELECT artist_id,
       song_id,
       show_id,
       event_date,
       show_seq,
       (show_seq - lag(show_seq) OVER w - 1)::integer AS gap_before
  FROM performances_counted
WINDOW w AS (PARTITION BY song_id ORDER BY show_seq);
