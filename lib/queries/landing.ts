import { sql } from "drizzle-orm";

import { rowsOf, type Db } from "../../db/client.ts";

/** Landing page queries: the counts, the band grid, the search, and the feed. */

export type LandingCounts = {
  bands: number;
  shows: number;
  plays: number;
};

export async function getLandingCounts(db: Db): Promise<LandingCounts> {
  const [row] = rowsOf<LandingCounts>(
    await db.execute(sql`
      SELECT (SELECT count(*)::int FROM artists) AS bands,
             (SELECT count(*)::int FROM shows WHERE is_performed) AS shows,
             (SELECT count(*)::int FROM performances_counted) AS plays
    `),
  );
  return row ?? { bands: 0, shows: 0, plays: 0 };
}

export type HeldBand = {
  mbid: string;
  name: string;
  shows: number;
  maxGap: number | null;
  backfillComplete: boolean;
};

export async function getHeldBands(db: Db): Promise<HeldBand[]> {
  return rowsOf<HeldBand>(
    await db.execute(sql`
      SELECT a.mbid, a.name,
             (SELECT count(*)::int FROM shows WHERE artist_id = a.id AND is_performed) AS shows,
             sc.longest_gap AS "maxGap",
             a.backfill_complete AS "backfillComplete"
        FROM artists a
        LEFT JOIN artist_gap_scale sc ON sc.artist_id = a.id
       ORDER BY shows DESC, a.name
    `),
  );
}

/**
 * Typeahead over bands we already hold. Each result carries its longest gap, so the list
 * previews the product rather than just routing to it.
 */
export async function searchHeldBands(db: Db, q: string): Promise<HeldBand[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  return rowsOf<HeldBand>(
    await db.execute(sql`
      SELECT a.mbid, a.name,
             (SELECT count(*)::int FROM shows WHERE artist_id = a.id AND is_performed) AS shows,
             sc.longest_gap AS "maxGap",
             a.backfill_complete AS "backfillComplete"
        FROM artists a
        LEFT JOIN artist_gap_scale sc ON sc.artist_id = a.id
       WHERE a.name ILIKE ${"%" + trimmed + "%"}
       ORDER BY (lower(a.name) = lower(${trimmed})) DESC,
                (lower(a.name) LIKE lower(${trimmed + "%"})) DESC,
                a.name
       LIMIT 6
    `),
  );
}

export type FeedKind = "cold_return" | "sat_in" | "cover_debut" | "first_time";

export type FeedItem = {
  kind: FeedKind;
  artistMbid: string;
  artistName: string;
  showId: string;
  eventDate: string;
  headline: string;
  note: string | null;
  stat: number | null;
  venue: string | null;
  city: string | null;
  state: string | null;
};

/**
 * "This week on stage" — every band we hold, newest first.
 *
 * Four item types, and two of them are gated:
 *
 *   cold_return  — gap_before >= 40. Always available.
 *   sat_in       — a guest appearance. Available, but WITHOUT an instrument: the API
 *                  carries none, so the headline is "‹Name› sat in".
 *   cover_debut  — first held play of a cover.        } gated on backfill_complete
 *   first_time   — first held play of an original.    } see below
 *
 * The gate is the point. `gap_before IS NULL` means "first play in the history we hold",
 * which for a partially backfilled artist is not a debut at all — it is simply the
 * earliest page we happen to have fetched. Emitting a "first time played" badge for such
 * an artist would produce a confident, entirely plausible lie. So those two types are
 * suppressed until that artist's backfill is complete.
 *
 * Consequence worth knowing: while no artist is backfill_complete, the feed carries only
 * cold returns and sit-ins. That is correct, not a bug.
 */
export async function getFeed(db: Db, limit = 12): Promise<FeedItem[]> {
  return rowsOf<FeedItem>(
    await db.execute(sql`
      WITH cold AS (
        SELECT 'cold_return'::text AS kind, a.mbid AS "artistMbid", a.name AS "artistName",
               sh.id AS "showId", sh.event_date, s.name AS headline,
               CASE WHEN s.cover_artist_name IS NOT NULL
                    THEN 'cover · ' || s.cover_artist_name END AS note,
               h.gap_before AS stat
          FROM song_gap_history h
          JOIN shows sh ON sh.id = h.show_id
          JOIN songs s ON s.id = h.song_id
          JOIN artists a ON a.id = h.artist_id
         WHERE h.gap_before >= 40
      ),
      guests AS (
        SELECT DISTINCT ON (p.show_id, p.guest ->> 'mbid')
               'sat_in'::text, a.mbid, a.name,
               sh.id, sh.event_date,
               (p.guest ->> 'name') || ' sat in',
               (SELECT count(*)::int || ' songs'
                  FROM performances p2
                 WHERE p2.show_id = p.show_id
                   AND p2.guest ->> 'mbid' = p.guest ->> 'mbid'),
               (SELECT count(DISTINCT p3.show_id)::int
                  FROM performances p3
                 WHERE p3.artist_id = p.artist_id
                   AND p3.guest ->> 'mbid' = p.guest ->> 'mbid')
          FROM performances p
          JOIN shows sh ON sh.id = p.show_id
          JOIN artists a ON a.id = p.artist_id
         WHERE p.guest IS NOT NULL
      ),
      debuts AS (
        SELECT CASE WHEN s.cover_artist_name IS NOT NULL
                    THEN 'cover_debut' ELSE 'first_time' END::text,
               a.mbid, a.name, sh.id, sh.event_date, s.name,
               s.cover_artist_name,
               NULL::int
          FROM song_gap_history h
          JOIN shows sh ON sh.id = h.show_id
          JOIN songs s ON s.id = h.song_id
          JOIN artists a ON a.id = h.artist_id
         WHERE h.gap_before IS NULL
           -- The gate. Without a complete backfill this is "earliest page fetched",
           -- not "first time played".
           AND a.backfill_complete
      ),
      merged AS (
        SELECT * FROM cold UNION ALL SELECT * FROM guests UNION ALL SELECT * FROM debuts
      )
      SELECT m.kind, m."artistMbid", m."artistName", m."showId",
             m.event_date::text AS "eventDate",
             m.headline, m.note, m.stat,
             v.name AS venue, v.city_name AS city, v.state
        FROM merged m
        JOIN shows sh ON sh.id = m."showId"
        LEFT JOIN venues v ON v.id = sh.venue_id
       ORDER BY m.event_date DESC, m.stat DESC NULLS LAST
       LIMIT ${limit}
    `),
  );
}
