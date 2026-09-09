import { sql } from "drizzle-orm";

import { rowsOf, type Db } from "../../db/client.ts";

/**
 * Show detail queries.
 *
 * The defining one is the setlist: every row carries the gap **as it stood that night**,
 * not the gap today. `song_gap_history.gap_before` answers that directly — verified
 * against Goose's coldest held night, where "Me and My Uncle" reads 67 shows that night
 * against 2 today.
 *
 * The setlist reads `performances` directly, NOT `performances_counted`, because tape
 * rows are displayed — marked "over the PA before the set · not performed, not counted"
 * rather than hidden. Stats on this page still come from the counted view.
 */

export type ShowHeader = {
  showId: string;
  artistId: number;
  artistMbid: string;
  artistName: string;
  eventDate: string;
  venue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  tourName: string | null;
  info: string | null;
  showSeq: number | null;
  isPerformed: boolean;
  totalShows: number;
  scaleMax: number;
};

export async function getShowHeader(
  db: Db,
  showId: string,
): Promise<ShowHeader | null> {
  const [row] = rowsOf<ShowHeader>(
    await db.execute(sql`
      SELECT sh.id AS "showId",
             a.id AS "artistId", a.mbid AS "artistMbid", a.name AS "artistName",
             sh.event_date::text AS "eventDate",
             v.name AS venue, v.city_name AS city, v.state, v.country_name AS country,
             sh.tour_name AS "tourName", sh.info,
             sh.show_seq AS "showSeq",
             sh.is_performed AS "isPerformed",
             (SELECT count(*)::int FROM shows WHERE artist_id = a.id) AS "totalShows",
             COALESCE(sc.scale_max, 24) AS "scaleMax"
        FROM shows sh
        JOIN artists a ON a.id = sh.artist_id
        LEFT JOIN venues v ON v.id = sh.venue_id
        LEFT JOIN artist_gap_scale sc ON sc.artist_id = a.id
       WHERE sh.id = ${showId}
    `),
  );
  return row ?? null;
}

export type SetlistEntry = {
  setIndex: number;
  setName: string | null;
  encore: number | null;
  position: number;
  songId: number;
  name: string;
  coverArtist: string | null;
  guestName: string | null;
  info: string | null;
  isTape: boolean;
  gapThatNight: number | null;
  isFirstHeld: boolean;
};

/**
 * The setlist, in play order, with gap at the time of play.
 *
 * `isFirstHeld` is true when this is the earliest play in our history. That is NOT the
 * same as a debut unless the artist's backfill is complete — the caller gates on that,
 * because a debut badge on a song the band has played for twenty years would look
 * entirely plausible.
 */
export async function getSetlist(db: Db, showId: string): Promise<SetlistEntry[]> {
  return rowsOf<SetlistEntry>(
    await db.execute(sql`
      SELECT p.set_index AS "setIndex",
             p.set_name  AS "setName",
             p.encore,
             p.position,
             p.song_id   AS "songId",
             s.name,
             s.cover_artist_name AS "coverArtist",
             p.guest ->> 'name'  AS "guestName",
             p.info,
             p.is_tape   AS "isTape",
             h.gap_before AS "gapThatNight",
             (h.show_id IS NOT NULL AND h.gap_before IS NULL) AS "isFirstHeld"
        FROM performances p
        JOIN songs s ON s.id = p.song_id
        LEFT JOIN song_gap_history h
               ON h.show_id = p.show_id AND h.song_id = p.song_id
       WHERE p.show_id = ${showId}
       ORDER BY p.set_index, p.position
    `),
  );
}

export type ShowStats = {
  songs: number;
  sets: number;
  guests: number;
  guestSongs: number;
  coldest: number | null;
  coldestSong: string | null;
};

export async function getShowStats(db: Db, showId: string): Promise<ShowStats> {
  const [row] = rowsOf<ShowStats>(
    await db.execute(sql`
      SELECT (SELECT count(*)::int FROM performances_counted WHERE show_id = ${showId}) AS songs,
             (SELECT count(DISTINCT set_index)::int FROM performances WHERE show_id = ${showId}) AS sets,
             (SELECT count(DISTINCT guest ->> 'mbid')::int FROM performances
               WHERE show_id = ${showId} AND guest IS NOT NULL) AS guests,
             (SELECT count(*)::int FROM performances
               WHERE show_id = ${showId} AND guest IS NOT NULL) AS "guestSongs",
             (SELECT max(gap_before)::int FROM song_gap_history WHERE show_id = ${showId}) AS coldest,
             (SELECT s.name FROM song_gap_history h JOIN songs s ON s.id = h.song_id
               WHERE h.show_id = ${showId} AND h.gap_before IS NOT NULL
               ORDER BY h.gap_before DESC LIMIT 1) AS "coldestSong"
    `),
  );
  return row ?? { songs: 0, sets: 0, guests: 0, guestSongs: 0, coldest: null, coldestSong: null };
}

export type AdjacentShow = {
  showId: string;
  eventDate: string;
  city: string | null;
  state: string | null;
};

export async function getAdjacentShows(
  db: Db,
  artistId: number,
  eventDate: string,
): Promise<{ prev: AdjacentShow | null; next: AdjacentShow | null }> {
  const rows = rowsOf<AdjacentShow & { dir: string }>(
    await db.execute(sql`
      (SELECT 'prev' AS dir, sh.id AS "showId", sh.event_date::text AS "eventDate",
              v.city_name AS city, v.state
         FROM shows sh LEFT JOIN venues v ON v.id = sh.venue_id
        WHERE sh.artist_id = ${artistId} AND sh.event_date < ${eventDate}::date
        ORDER BY sh.event_date DESC LIMIT 1)
      UNION ALL
      (SELECT 'next', sh.id, sh.event_date::text, v.city_name, v.state
         FROM shows sh LEFT JOIN venues v ON v.id = sh.venue_id
        WHERE sh.artist_id = ${artistId} AND sh.event_date > ${eventDate}::date
        ORDER BY sh.event_date ASC LIMIT 1)
    `),
  );
  return {
    prev: rows.find((r) => r.dir === "prev") ?? null,
    next: rows.find((r) => r.dir === "next") ?? null,
  };
}

export type RunShow = {
  showId: string;
  eventDate: string;
  venue: string | null;
  city: string | null;
  state: string | null;
  songs: number;
  isCurrent: boolean;
};

export type Run = {
  shows: RunShow[];
  /** 1-based position of this show within the whole run. */
  position: number;
  /** Total shows in the run, which may exceed `shows.length`. */
  length: number;
};

/**
 * "This run" — where this show sits among the ones around it.
 *
 * setlist.fm has no run concept, so it is derived in two steps, and the second step
 * matters. Chaining shows separated by two days or less identifies a *tour leg*, not a
 * run: a working band plays every other night, so on real Goose data that chain ran to
 * sixteen shows across three weeks. The design's "This run" is a short strip of local
 * context — four entries — so the display is windowed to ±2 shows around this one.
 *
 * `length` and `position` describe the whole leg, which is what makes "night 2 of a
 * 4-night run" sayable; `shows` is only what fits on screen.
 */
export async function getRun(
  db: Db,
  artistId: number,
  showId: string,
  window = 2,
): Promise<Run> {
  const rows = rowsOf<RunShow & { rn: number; runLength: number }>(
    await db.execute(sql`
      WITH ordered AS (
        SELECT sh.id, sh.event_date, sh.venue_id, sh.performed_song_count,
               sh.event_date - lag(sh.event_date) OVER (ORDER BY sh.event_date) AS gap_days
          FROM shows sh
         WHERE sh.artist_id = ${artistId}
      ), grouped AS (
        SELECT *,
               sum(CASE WHEN gap_days IS NULL OR gap_days > 2 THEN 1 ELSE 0 END)
                 OVER (ORDER BY event_date) AS run_id
          FROM ordered
      ), leg AS (
        SELECT g.*,
               row_number() OVER (ORDER BY g.event_date) AS rn,
               count(*) OVER () AS run_length
          FROM grouped g
         WHERE g.run_id = (SELECT run_id FROM grouped WHERE id = ${showId})
      ), cur AS (
        SELECT rn FROM leg WHERE id = ${showId}
      )
      SELECT l.id AS "showId",
             l.event_date::text AS "eventDate",
             v.name AS venue, v.city_name AS city, v.state,
             l.performed_song_count AS songs,
             (l.id = ${showId}) AS "isCurrent",
             l.rn::int AS rn,
             l.run_length::int AS "runLength"
        FROM leg l
        LEFT JOIN venues v ON v.id = l.venue_id
        CROSS JOIN cur
       WHERE l.rn BETWEEN cur.rn - ${window} AND cur.rn + ${window}
       ORDER BY l.event_date
    `),
  );

  const current = rows.find((r) => r.isCurrent);
  return {
    shows: rows.map(({ ...r }) => r),
    position: current?.rn ?? 1,
    length: rows[0]?.runLength ?? rows.length,
  };
}

export type ShowGuest = {
  mbid: string;
  name: string;
  songs: string[];
  showsWithArtist: number;
};

export async function getShowGuests(
  db: Db,
  showId: string,
  artistId: number,
): Promise<ShowGuest[]> {
  // The jsonb extraction happens in a CTE so `mbid` is a plain grouped column. Grouping
  // by the raw `guest ->> 'mbid'` expression and then correlating a subquery against it
  // is rejected — Postgres does not recognise the two expressions as the same column.
  return rowsOf<ShowGuest>(
    await db.execute(sql`
      WITH g AS (
        SELECT p.guest ->> 'mbid' AS mbid,
               p.guest ->> 'name' AS name,
               s.name AS song,
               p.set_index, p.position
          FROM performances p
          JOIN songs s ON s.id = p.song_id
         WHERE p.show_id = ${showId} AND p.guest IS NOT NULL
      )
      SELECT g.mbid,
             min(g.name) AS name,
             array_agg(g.song ORDER BY g.set_index, g.position) AS songs,
             (SELECT count(DISTINCT p2.show_id)::int
                FROM performances p2
               WHERE p2.artist_id = ${artistId}
                 AND p2.guest ->> 'mbid' = g.mbid) AS "showsWithArtist"
        FROM g
       GROUP BY g.mbid
       ORDER BY name
    `),
  );
}
