import { sql } from "drizzle-orm";

import { rowsOf, type Db } from "../../db/client.ts";

/**
 * Artist page queries.
 *
 * Everything statistical reads through `performances_counted` or `song_gap`, both of
 * which already exclude tape songs and unperformed shows. Nothing here filters `is_tape`
 * by hand — that is exactly the mistake the views exist to make unreachable.
 */

export type ArtistHeader = {
  id: number;
  mbid: string;
  name: string;
  showsHeld: number;
  showsWithSetlists: number;
  totalReported: number | null;
  firstShow: string | null;
  lastShow: string | null;
  backfillComplete: boolean;
  pagesFetched: number;
  scaleMax: number;
  longestGap: number | null;
  longestGapSong: string | null;
};

export async function getArtistHeader(
  db: Db,
  mbid: string,
): Promise<ArtistHeader | null> {
  const [row] = rowsOf<ArtistHeader>(
    await db.execute(sql`
      SELECT a.id, a.mbid, a.name,
             (SELECT count(*)::int FROM shows WHERE artist_id = a.id) AS "showsHeld",
             (SELECT count(*)::int FROM shows
               WHERE artist_id = a.id AND is_performed) AS "showsWithSetlists",
             a.total_reported AS "totalReported",
             (SELECT min(event_date)::text FROM shows WHERE artist_id = a.id) AS "firstShow",
             (SELECT max(event_date)::text FROM shows WHERE artist_id = a.id) AS "lastShow",
             a.backfill_complete AS "backfillComplete",
             a.pages_fetched AS "pagesFetched",
             sc.scale_max AS "scaleMax",
             sc.longest_gap AS "longestGap",
             sc.longest_gap_song AS "longestGapSong"
        FROM artists a
        LEFT JOIN artist_gap_scale sc ON sc.artist_id = a.id
       WHERE a.mbid = ${mbid}
    `),
  );
  return row ?? null;
}

export type ArtistStats = {
  songsPlayed: number;
  avgPlays: number | null;
};

export async function getArtistStats(db: Db, artistId: number): Promise<ArtistStats> {
  const [row] = rowsOf<ArtistStats>(
    await db.execute(sql`
      SELECT count(*)::int AS "songsPlayed",
             round(avg(times_played), 1)::float8 AS "avgPlays"
        FROM song_gap WHERE artist_id = ${artistId}
    `),
  );
  return row ?? { songsPlayed: 0, avgPlays: null };
}

export type SongRow = {
  songId: number;
  name: string;
  coverArtist: string | null;
  timesPlayed: number;
  currentGap: number | null;
  lastPlayed: string | null;
  lastCity: string | null;
  lastVenue: string | null;
};

/**
 * The whole song list. Not paginated: the design's own note is "357 songs", and the
 * distribution's shape is the point — you cannot feel it 50 rows at a time.
 */
export async function getSongTable(db: Db, artistId: number): Promise<SongRow[]> {
  return rowsOf<SongRow>(
    await db.execute(sql`
      SELECT g.song_id       AS "songId",
             s.name,
             s.cover_artist_name AS "coverArtist",
             g.times_played  AS "timesPlayed",
             g.current_gap   AS "currentGap",
             g.last_played_date::text AS "lastPlayed",
             v.city_name     AS "lastCity",
             v.name          AS "lastVenue"
        FROM song_gap g
        JOIN songs s ON s.id = g.song_id
        LEFT JOIN LATERAL (
          SELECT sh.venue_id
            FROM performances_counted pc
            JOIN shows sh ON sh.id = pc.show_id
           WHERE pc.song_id = g.song_id
           ORDER BY pc.show_seq DESC
           LIMIT 1
        ) last_show ON true
        LEFT JOIN venues v ON v.id = last_show.venue_id
       WHERE g.artist_id = ${artistId}
       ORDER BY g.current_gap DESC, s.name
    `),
  );
}

export type PlayHistoryEntry = {
  showId: string;
  eventDate: string;
  venue: string | null;
  city: string | null;
};

/** Row expansion: every documented play of one song, newest first. */
export async function getPlayHistory(
  db: Db,
  songId: number,
): Promise<PlayHistoryEntry[]> {
  return rowsOf<PlayHistoryEntry>(
    await db.execute(sql`
      SELECT pc.show_id AS "showId",
             pc.event_date::text AS "eventDate",
             v.name AS venue,
             v.city_name AS city
        FROM performances_counted pc
        JOIN shows sh ON sh.id = pc.show_id
        LEFT JOIN venues v ON v.id = sh.venue_id
       WHERE pc.song_id = ${songId}
       ORDER BY pc.show_seq DESC
    `),
  );
}

export type RecentShow = {
  showId: string;
  eventDate: string;
  venue: string | null;
  city: string | null;
  songs: number;
};

export async function getRecentShows(
  db: Db,
  artistId: number,
  limit = 6,
): Promise<RecentShow[]> {
  return rowsOf<RecentShow>(
    await db.execute(sql`
      SELECT sh.id AS "showId",
             sh.event_date::text AS "eventDate",
             v.name AS venue,
             v.city_name AS city,
             sh.performed_song_count AS songs
        FROM shows sh
        LEFT JOIN venues v ON v.id = sh.venue_id
       WHERE sh.artist_id = ${artistId} AND sh.is_performed
       ORDER BY sh.event_date DESC
       LIMIT ${limit}
    `),
  );
}

export type GuestRow = {
  mbid: string;
  name: string;
  shows: number;
};

/**
 * Guests, most frequent first.
 *
 * No instrument: setlist.fm's `with` object carries none. See CLAUDE.md — the v2 designs
 * assumed one ("Marla Quinn on fiddle") and it does not exist.
 */
export async function getGuests(db: Db, artistId: number): Promise<GuestRow[]> {
  return rowsOf<GuestRow>(
    await db.execute(sql`
      SELECT p.guest ->> 'mbid' AS mbid,
             min(p.guest ->> 'name') AS name,
             count(DISTINCT p.show_id)::int AS shows
        FROM performances p
       WHERE p.artist_id = ${artistId} AND p.guest IS NOT NULL
       GROUP BY p.guest ->> 'mbid'
       ORDER BY shows DESC, name
    `),
  );
}

export type GuestSummary = { totalAppearances: number; showsWithGuests: number };

export async function getGuestSummary(
  db: Db,
  artistId: number,
): Promise<GuestSummary> {
  const [row] = rowsOf<GuestSummary>(
    await db.execute(sql`
      SELECT count(*)::int AS "totalAppearances",
             count(DISTINCT show_id)::int AS "showsWithGuests"
        FROM performances
       WHERE artist_id = ${artistId} AND guest IS NOT NULL
    `),
  );
  return row ?? { totalAppearances: 0, showsWithGuests: 0 };
}
