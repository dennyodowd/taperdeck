/**
 * The database write path for ingested setlists.
 *
 * Shared by the live pipeline and by scripts/load-sample.mts. The fixture loader must go
 * through this code, not a copy of it, or it stops proving anything about production.
 *
 * Two rules this module exists to enforce:
 *   - It never writes shows.show_seq. A trigger owns the ordinal.
 *   - It resolves song ids by asking Postgres for taperdeck_song_key(), never by
 *     reimplementing normalisation in TypeScript. Two normalisers drift, and the failure
 *     is a wrong gap number with nothing visibly broken.
 */

import { eq, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { artists, performances, shows, venues } from "../../db/schema.ts";
import {
  countPerformedSongs,
  normaliseSetName,
  parseEventDate,
  parseLastUpdated,
  type ApiArtist,
  type ApiSetlist,
  type ApiSong,
} from "../setlistfm/parse.ts";

/** neon-http returns rows directly in some paths and {rows} in others. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

export async function upsertArtist(
  db: Db,
  apiArtist: ApiArtist,
  opts: { totalReported?: number; capturedAt?: Date } = {},
): Promise<number> {
  const capturedAt = opts.capturedAt ?? new Date();

  const [row] = await db
    .insert(artists)
    .values({
      mbid: apiArtist.mbid,
      name: apiArtist.name,
      sortName: apiArtist.sortName,
      disambiguation: apiArtist.disambiguation,
      url: apiArtist.url,
      // `total` depends on now() and drifts, so it is stored with the moment it was
      // taken rather than presented as a standing fact.
      totalReported: opts.totalReported,
      totalReportedAt: opts.totalReported === undefined ? undefined : capturedAt,
      raw: apiArtist,
      lastIngestedAt: capturedAt,
    })
    .onConflictDoUpdate({
      target: artists.mbid,
      set: {
        name: apiArtist.name,
        sortName: apiArtist.sortName,
        disambiguation: apiArtist.disambiguation,
        url: apiArtist.url,
        ...(opts.totalReported === undefined
          ? {}
          : { totalReported: opts.totalReported, totalReportedAt: capturedAt }),
        lastIngestedAt: capturedAt,
      },
    })
    .returning({ id: artists.id });

  return row.id;
}

export type UpsertCounts = {
  shows: number;
  performances: number;
  songs: number;
};

/**
 * Upsert one page of setlists for an already-resolved artist.
 *
 * Idempotent: upserts on shows.id, and replaces a show's performances wholesale rather
 * than merging, because a show edited upstream can lose or reorder songs and stale rows
 * would quietly distort every statistic.
 */
export async function upsertSetlists(
  db: Db,
  artistId: number,
  setlists: ApiSetlist[],
): Promise<UpsertCounts> {
  if (setlists.length === 0) {
    return { shows: 0, performances: 0, songs: 0 };
  }

  // -- venues --------------------------------------------------------------
  const venueRows = new Map<string, typeof venues.$inferInsert>();
  for (const sl of setlists) {
    const v = sl.venue;
    if (!v) continue;
    venueRows.set(v.id, {
      id: v.id,
      name: v.name,
      cityId: v.city?.id,
      cityName: v.city?.name,
      state: v.city?.state,
      stateCode: v.city?.stateCode,
      countryCode: v.city?.country?.code,
      countryName: v.city?.country?.name,
      lat: v.city?.coords?.lat,
      long: v.city?.coords?.long,
      raw: v,
    });
  }
  if (venueRows.size > 0) {
    await db
      .insert(venues)
      .values([...venueRows.values()])
      .onConflictDoUpdate({
        target: venues.id,
        set: { name: sql`excluded.name`, raw: sql`excluded.raw` },
      });
  }

  // -- shows ---------------------------------------------------------------
  // show_seq is deliberately absent from both the insert and the update set.
  const showRows = setlists.map(
    (sl) =>
      ({
        id: sl.id,
        versionId: sl.versionId,
        artistId,
        venueId: sl.venue?.id,
        eventDate: parseEventDate(sl.eventDate),
        lastUpdated: parseLastUpdated(sl.lastUpdated),
        tourName: sl.tour?.name,
        info: sl.info,
        url: sl.url,
        performedSongCount: countPerformedSongs(sl),
        raw: sl,
      }) satisfies typeof shows.$inferInsert,
  );

  await db
    .insert(shows)
    .values(showRows)
    .onConflictDoUpdate({
      target: shows.id,
      set: {
        versionId: sql`excluded.version_id`,
        eventDate: sql`excluded.event_date`,
        lastUpdated: sql`excluded.last_updated`,
        tourName: sql`excluded.tour_name`,
        info: sql`excluded.info`,
        url: sql`excluded.url`,
        performedSongCount: sql`excluded.performed_song_count`,
        raw: sql`excluded.raw`,
      },
    });

  // -- songs ---------------------------------------------------------------
  // A cover is the SAME identity as an original; the original performer is an attribute.
  const distinctNames = new Map<string, ApiSong>();
  for (const sl of setlists) {
    for (const set of sl.sets.set ?? []) {
      for (const song of set.song ?? []) {
        if (!distinctNames.has(song.name)) distinctNames.set(song.name, song);
      }
    }
  }

  const songValues = [...distinctNames.values()].map((s) => ({
    name: s.name,
    mbid: s.cover?.mbid ?? null,
    cover: s.cover?.name ?? null,
  }));

  if (songValues.length > 0) {
    // DISTINCT ON the match key server-side: two different raw spellings can collapse to
    // one identity, and ON CONFLICT DO UPDATE cannot touch the same row twice in one
    // statement. Deduplicating in TypeScript would need a second normaliser.
    await db.execute(sql`
      INSERT INTO songs (artist_id, name, cover_artist_mbid, cover_artist_name)
      SELECT DISTINCT ON (taperdeck_song_key(v.name))
             ${artistId}, v.name, v.mbid, v.cover
        FROM jsonb_to_recordset(${JSON.stringify(songValues)}::jsonb)
          AS v(name text, mbid uuid, cover text)
       ORDER BY taperdeck_song_key(v.name), v.name
      ON CONFLICT (artist_id, match_key) DO NOTHING
    `);
  }

  // Map raw name -> song id with the key computed by the database.
  const names = [...distinctNames.keys()];
  const keyed = rowsOf<{ raw_name: string; song_id: number }>(
    await db.execute(sql`
      SELECT v.name AS raw_name, s.id AS song_id
        FROM jsonb_array_elements_text(${JSON.stringify(names)}::jsonb) AS v(name)
        JOIN songs s
          ON s.artist_id = ${artistId}
         AND s.match_key = taperdeck_song_key(v.name)
    `),
  );

  const songIdByName = new Map<string, number>();
  for (const r of keyed) songIdByName.set(r.raw_name, Number(r.song_id));

  // -- performances --------------------------------------------------------
  const perfRows: Array<typeof performances.$inferInsert> = [];
  for (const sl of setlists) {
    (sl.sets.set ?? []).forEach((set, setIndex) => {
      (set.song ?? []).forEach((song, position) => {
        const songId = songIdByName.get(song.name);
        if (songId === undefined) {
          throw new Error(
            `no song id resolved for ${JSON.stringify(song.name)} — ` +
              `taperdeck_song_key lookup missed`,
          );
        }
        perfRows.push({
          showId: sl.id,
          songId,
          artistId,
          setIndex,
          position,
          setNameRaw: set.name,
          setName: normaliseSetName(set.name),
          encore: set.encore,
          isTape: song.tape === true,
          info: song.info,
          guest: song.with ?? null,
          nameRaw: song.name,
        });
      });
    });
  }

  const showIds = showRows.map((s) => s.id);
  const deleteStale = db.execute(
    sql`DELETE FROM performances WHERE show_id IN (${sql.join(
      showIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );

  // Batched so a page's performances are replaced atomically rather than leaving a
  // window where a show has been emptied but not refilled.
  if (perfRows.length > 0) {
    await db.batch([deleteStale, db.insert(performances).values(perfRows)]);
  } else {
    await deleteStale;
  }

  return {
    shows: showRows.length,
    performances: perfRows.length,
    songs: songIdByName.size,
  };
}

/** Recompute the denormalised rollups the refresh scheduler and UI read. */
export async function refreshArtistRollups(
  db: Db,
  artistId: number,
  pagesFetched: number,
  maxPagesPerArtist: number,
): Promise<{ lastShowDate: string | null; backfillComplete: boolean }> {
  const [row] = rowsOf<{ last_show_date: string | null; total_reported: number | null }>(
    await db.execute(sql`
      SELECT (SELECT max(event_date)::text FROM shows WHERE artist_id = ${artistId})
               AS last_show_date,
             (SELECT total_reported FROM artists WHERE id = ${artistId})
               AS total_reported
    `),
  );

  const expectedPages =
    row?.total_reported == null
      ? maxPagesPerArtist
      : Math.min(Math.ceil(row.total_reported / 20), maxPagesPerArtist);

  const backfillComplete = pagesFetched >= expectedPages;

  await db
    .update(artists)
    .set({
      lastShowDate: row?.last_show_date ?? null,
      pagesFetched,
      backfillComplete,
    })
    .where(eq(artists.id, artistId));

  return { lastShowDate: row?.last_show_date ?? null, backfillComplete };
}
