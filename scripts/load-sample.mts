/**
 * Loads the committed sample.json into the database and asserts the schema behaves.
 *
 * This is a TEST FIXTURE, not the ingestion pipeline. No network, no pagination, no
 * run-log orchestration, no rate limiting. It exists so the schema is proven against the
 * real payload before ingestion is built on top of it.
 *
 *   node scripts/load-sample.mts
 *
 * Re-running must be a no-op. That is one of the assertions.
 */

import { readFileSync } from "node:fs";

import { neon } from "@neondatabase/serverless";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";

import { artists, performances, shows, venues } from "../db/schema.ts";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const db = drizzle(neon(url));

/**
 * The moment sample.json was captured. `total` is a now()-dependent figure, so it is
 * pinned to when it was taken rather than to when this script happens to run.
 */
const CAPTURED_AT = new Date("2026-09-09T16:05:44Z");

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

/**
 * eventDate is dd-MM-yyyy — day first. Proven against sample.json, where twelve of
 * twenty dates have a first component above 12, and where "05-09-2026" means
 * 5 September. new Date() reads that as 9 May, with no error and nothing downstream
 * that looks wrong. Split explicitly; never hand this field to a Date constructor.
 */
function parseEventDate(value: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) throw new Error(`eventDate is not dd-MM-yyyy: ${JSON.stringify(value)}`);

  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);

  // If setlist.fm ever flips to month-first, this throws on the first date past the
  // 12th rather than silently producing plausible wrong answers for a year.
  if (month < 1 || month > 12) {
    throw new Error(`month out of range in eventDate ${value} — format may have changed`);
  }
  if (day < 1 || day > 31) {
    throw new Error(`day out of range in eventDate ${value}`);
  }

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * lastUpdated is ISO 8601 with an offset — a DIFFERENT format from eventDate. This is
 * the only date field in the payload that may go through Date parsing, which is exactly
 * why it gets its own function rather than sharing one.
 */
function parseLastUpdated(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`lastUpdated is not parseable ISO 8601: ${JSON.stringify(value)}`);
  }
  return d;
}

/** "Set 1", "Set 1:" and "Set 2:" are the same concept in the payload. */
function normaliseSetName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s*:\s*$/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

// --------------------------------------------------------------------------
// Payload types — only the fields this fixture touches.
// --------------------------------------------------------------------------

type ApiArtist = {
  mbid: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  url?: string;
};

type ApiSong = {
  name: string;
  info?: string;
  tape?: boolean;
  cover?: ApiArtist;
  with?: unknown;
};

type ApiSet = { name?: string; encore?: number; song?: ApiSong[] };

type ApiSetlist = {
  id: string;
  versionId?: string;
  eventDate: string;
  lastUpdated?: string;
  artist: ApiArtist;
  venue?: {
    id: string;
    name: string;
    url?: string;
    city?: {
      id?: string;
      name?: string;
      state?: string;
      stateCode?: string;
      country?: { code?: string; name?: string };
      coords?: { lat?: number; long?: number };
    };
  };
  tour?: { name?: string };
  sets: { set?: ApiSet[] };
  url?: string;
  info?: string;
};

type ApiEnvelope = { total: number; setlist: ApiSetlist[] };

// --------------------------------------------------------------------------
// Load
// --------------------------------------------------------------------------

async function load() {
  const payload = JSON.parse(
    readFileSync("sample.json", "utf8"),
  ) as ApiEnvelope;

  const setlists = payload.setlist;
  const apiArtist = setlists[0].artist;

  // -- artist ------------------------------------------------------------
  const [artist] = await db
    .insert(artists)
    .values({
      mbid: apiArtist.mbid,
      name: apiArtist.name,
      sortName: apiArtist.sortName,
      disambiguation: apiArtist.disambiguation,
      url: apiArtist.url,
      totalReported: payload.total,
      totalReportedAt: CAPTURED_AT,
      raw: apiArtist,
      lastIngestedAt: CAPTURED_AT,
    })
    .onConflictDoUpdate({
      target: artists.mbid,
      set: {
        name: apiArtist.name,
        totalReported: payload.total,
        totalReportedAt: CAPTURED_AT,
        lastIngestedAt: CAPTURED_AT,
      },
    })
    .returning({ id: artists.id });

  const artistId = artist.id;

  // -- venues ------------------------------------------------------------
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

  // -- shows -------------------------------------------------------------
  // performed_song_count counts non-tape songs only, so a show that is nothing but PA
  // music does not count as performed and never consumes an ordinal.
  const showRows = setlists.map((sl) => {
    const performedSongCount = (sl.sets.set ?? []).reduce(
      (n, s) => n + (s.song ?? []).filter((sg) => sg.tape !== true).length,
      0,
    );
    return {
      id: sl.id,
      versionId: sl.versionId,
      artistId,
      venueId: sl.venue?.id,
      eventDate: parseEventDate(sl.eventDate),
      lastUpdated: parseLastUpdated(sl.lastUpdated),
      tourName: sl.tour?.name,
      info: sl.info,
      url: sl.url,
      performedSongCount,
      raw: sl,
    } satisfies typeof shows.$inferInsert;
  });

  // Upsert on the setlist id: refresh jobs re-fetch the same shows constantly and a
  // rerun must be a no-op. show_seq is deliberately absent — the trigger owns it.
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
        performedSongCount: sql`excluded.performed_song_count`,
        raw: sql`excluded.raw`,
      },
    });

  // -- songs -------------------------------------------------------------
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

  // DISTINCT ON the match key server-side: two different raw spellings can collapse to
  // one identity, and ON CONFLICT DO UPDATE cannot touch the same row twice in one
  // statement. Deduplicating in JS would need a second implementation of the normaliser,
  // which could drift from the database's. There is only ever one normaliser.
  await db.execute(sql`
    INSERT INTO songs (artist_id, name, cover_artist_mbid, cover_artist_name)
    SELECT DISTINCT ON (taperdeck_song_key(v.name))
           ${artistId}, v.name, v.mbid, v.cover
      FROM jsonb_to_recordset(${JSON.stringify(songValues)}::jsonb)
        AS v(name text, mbid uuid, cover text)
     ORDER BY taperdeck_song_key(v.name), v.name
    ON CONFLICT (artist_id, match_key) DO NOTHING
  `);

  // Map raw name -> song id, with the key computed by the database so there is no
  // second implementation to drift.
  const keyed = (await db.execute(sql`
    SELECT v.name AS raw_name, s.id AS song_id
      FROM unnest(${sql.raw(
        `ARRAY[${[...distinctNames.keys()]
          .map((n) => `'${n.replace(/'/g, "''")}'`)
          .join(",")}]::text[]`,
      )}) AS v(name)
      JOIN songs s
        ON s.artist_id = ${artistId}
       AND s.match_key = taperdeck_song_key(v.name)
  `)) as unknown as { rows?: Array<{ raw_name: string; song_id: number }> };

  const rows = Array.isArray(keyed) ? keyed : (keyed.rows ?? []);
  const songIdByName = new Map<string, number>();
  for (const r of rows as Array<{ raw_name: string; song_id: number }>) {
    songIdByName.set(r.raw_name, Number(r.song_id));
  }

  // -- performances ------------------------------------------------------
  // Replace rather than upsert: a show edited upstream can lose or reorder songs, and
  // stale rows would quietly distort every statistic. Cascades on show delete.
  const showIds = showRows.map((s) => s.id);
  await db.execute(
    sql`DELETE FROM performances WHERE show_id IN (${sql.join(
      showIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );

  const perfRows: Array<typeof performances.$inferInsert> = [];
  for (const sl of setlists) {
    (sl.sets.set ?? []).forEach((set, setIndex) => {
      (set.song ?? []).forEach((song, position) => {
        const songId = songIdByName.get(song.name);
        if (songId === undefined) {
          throw new Error(`no song id resolved for ${JSON.stringify(song.name)}`);
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

  if (perfRows.length > 0) {
    await db.insert(performances).values(perfRows);
  }

  // -- artist rollup -----------------------------------------------------
  await db
    .update(artists)
    .set({
      lastShowDate: sql`(SELECT max(event_date) FROM shows WHERE artist_id = ${artistId})`,
    })
    .where(eq(artists.id, artistId));

  return { artistId, showCount: showRows.length, perfCount: perfRows.length };
}

// --------------------------------------------------------------------------
// Assertions
// --------------------------------------------------------------------------

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${e}\n        actual   ${a}`}`);
}

async function one<T>(query: ReturnType<typeof sql>): Promise<T> {
  const res = (await db.execute(query)) as unknown;
  const rows = (Array.isArray(res) ? res : ((res as { rows: unknown[] }).rows)) as T[];
  return rows[0];
}

async function verify(artistId: number) {
  console.log("\n--- dates ---");

  const sept5 = await one<{ event_date: string }>(sql`
    SELECT event_date::text FROM shows
     WHERE artist_id = ${artistId} AND raw->>'eventDate' = '05-09-2026'
  `);
  check("05-09-2026 stored as 5 September, not 9 May", sept5?.event_date, "2026-09-05");

  const range = await one<{ lo: string; hi: string }>(sql`
    SELECT min(event_date)::text AS lo, max(event_date)::text AS hi
      FROM shows WHERE artist_id = ${artistId}
  `);
  check("date range", [range?.lo, range?.hi], ["2026-07-08", "2026-09-06"]);

  console.log("\n--- ordinal ---");

  const seq = await one<{ n: number; lo: number; hi: number; distinct: number }>(sql`
    SELECT count(*)::int AS n, min(show_seq)::int AS lo,
           max(show_seq)::int AS hi, count(DISTINCT show_seq)::int AS distinct
      FROM shows WHERE artist_id = ${artistId} AND show_seq IS NOT NULL
  `);
  check("20 shows numbered 1..20, contiguous", [seq?.n, seq?.lo, seq?.hi, seq?.distinct], [20, 1, 20, 20]);

  const ordered = await one<{ ok: boolean }>(sql`
    SELECT bool_and(ok) AS ok FROM (
      SELECT show_seq = row_number() OVER (ORDER BY event_date, id) AS ok
        FROM shows WHERE artist_id = ${artistId} AND show_seq IS NOT NULL
    ) t
  `);
  check("ordinal follows event_date order", ordered?.ok, true);

  console.log("\n--- ordinal recompute on backfill (the case that silently drifts) ---");

  // An OLDER show, as a backfill page would deliver. Everything must shift.
  await db.execute(sql`
    INSERT INTO shows (id, artist_id, event_date, performed_song_count, raw)
    VALUES ('zzbackfil', ${artistId}, DATE '2020-01-01', 5, '{"synthetic":true}'::jsonb)
  `);

  const after = await one<{ n: number; hi: number; backfill_seq: number; ok: boolean }>(sql`
    SELECT count(*)::int AS n, max(show_seq)::int AS hi,
           max(show_seq) FILTER (WHERE id = 'zzbackfil')::int AS backfill_seq,
           bool_and(show_seq = rn) AS ok
      FROM (
        SELECT id, show_seq, row_number() OVER (ORDER BY event_date, id) AS rn
          FROM shows WHERE artist_id = ${artistId} AND show_seq IS NOT NULL
      ) t
  `);
  check("backfilled older show takes seq 1", after?.backfill_seq, 1);
  check("all 21 shows renumbered contiguously", [after?.n, after?.hi, after?.ok], [21, 21, true]);

  // An empty setlist must not consume an ordinal.
  await db.execute(sql`
    INSERT INTO shows (id, artist_id, event_date, performed_song_count, raw)
    VALUES ('zzempty01', ${artistId}, DATE '2021-01-01', 0, '{"synthetic":true}'::jsonb)
  `);
  const empty = await one<{ seq: number | null; total: number }>(sql`
    SELECT (SELECT show_seq FROM shows WHERE id = 'zzempty01') AS seq,
           (SELECT count(*)::int FROM shows WHERE artist_id = ${artistId} AND show_seq IS NOT NULL) AS total
  `);
  check("empty setlist gets no ordinal", empty?.seq, null);
  check("empty setlist does not shift the count", empty?.total, 21);

  await db.execute(sql`DELETE FROM shows WHERE id IN ('zzbackfil','zzempty01')`);
  const restored = await one<{ n: number; hi: number; ok: boolean }>(sql`
    SELECT count(*)::int AS n, max(show_seq)::int AS hi, bool_and(show_seq = rn) AS ok
      FROM (
        SELECT show_seq, row_number() OVER (ORDER BY event_date, id) AS rn
          FROM shows WHERE artist_id = ${artistId} AND show_seq IS NOT NULL
      ) t
  `);
  check("delete renumbers back to 1..20", [restored?.n, restored?.hi, restored?.ok], [20, 20, true]);

  console.log("\n--- tape exclusion ---");

  const tape = await one<{ total: number; tape: number; counted: number }>(sql`
    SELECT (SELECT count(*)::int FROM performances WHERE artist_id = ${artistId}) AS total,
           (SELECT count(*)::int FROM performances WHERE artist_id = ${artistId} AND is_tape) AS tape,
           (SELECT count(*)::int FROM performances_counted WHERE artist_id = ${artistId}) AS counted
  `);
  check("337 performances, 1 tape, 336 counted", [tape?.total, tape?.tape, tape?.counted], [337, 1, 336]);

  const edSullivan = await one<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM song_gap g JOIN songs s ON s.id = g.song_id
     WHERE g.artist_id = ${artistId} AND s.name LIKE 'The Ed Sullivan%'
  `);
  check("tape-only song absent from song_gap", edSullivan?.n, 0);

  console.log("\n--- song identity ---");

  const songCount = await one<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM songs WHERE artist_id = ${artistId}
  `);
  check("192 distinct songs", songCount?.n, 192);

  const melt = await one<{ n: number; cover: string }>(sql`
    SELECT count(*)::int AS n, min(cover_artist_name) AS cover
      FROM songs WHERE artist_id = ${artistId} AND name = 'Melt the Guns'
  `);
  check("cover is one song with an attribute, not a separate entity", [melt?.n, melt?.cover], [1, "XTC"]);

  const trey = await one<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM song_gap g JOIN songs s ON s.id = g.song_id
     WHERE g.artist_id = ${artistId} AND s.cover_artist_name = 'Trey Anastasio'
  `);
  check("side-project songs appear in the artist's own rotation", (trey?.n ?? 0) > 0, true);

  console.log("\n--- gap ---");

  const possum = await one<{ played: number; gap: number }>(sql`
    SELECT g.times_played AS played, g.current_gap AS gap
      FROM song_gap g JOIN songs s ON s.id = g.song_id
     WHERE g.artist_id = ${artistId} AND s.name = 'Possum'
  `);
  check("Possum played 5 times in 20 shows", possum?.played, 5);
  check("Possum current gap is small", (possum?.gap ?? 99) < 20, true);

  const spread = await one<{ max_gap: number; once: number; in_gap: number }>(sql`
    SELECT max(current_gap)::int AS max_gap,
           count(*) FILTER (WHERE times_played = 1)::int AS once,
           count(*)::int AS in_gap
      FROM song_gap WHERE artist_id = ${artistId}
  `);
  // 192 songs are stored but only 191 reach song_gap. The missing one is the Ed Sullivan
  // intro, whose single performance is tape:true. Likewise the raw payload has 105 songs
  // played exactly once and gap sees 104 — the 105th is that same tape row. The
  // off-by-one IS the tape exclusion reaching the statistics, so it is asserted rather
  // than smoothed over.
  check("191 of 192 songs reach song_gap; the tape-only one does not", spread?.in_gap, 191);
  check("104 songs played exactly once (105th is the tape row)", spread?.once, 104);
  check("largest gap is within the 20-show window", (spread?.max_gap ?? 0) < 20, true);

  const history = await one<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM song_gap_history
     WHERE artist_id = ${artistId} AND gap_before IS NOT NULL
  `);
  check("gap history produces intervals", (history?.n ?? 0) > 0, true);
}

// --------------------------------------------------------------------------

const first = await load();
console.log(
  `loaded: ${first.showCount} shows, ${first.perfCount} performances, artist_id=${first.artistId}`,
);

await verify(first.artistId);

console.log("\n--- idempotency: second load must change nothing ---");
const before = await one<{ shows: number; perfs: number; songs: number }>(sql`
  SELECT (SELECT count(*)::int FROM shows) AS shows,
         (SELECT count(*)::int FROM performances) AS perfs,
         (SELECT count(*)::int FROM songs) AS songs
`);
await load();
const afterSecond = await one<{ shows: number; perfs: number; songs: number }>(sql`
  SELECT (SELECT count(*)::int FROM shows) AS shows,
         (SELECT count(*)::int FROM performances) AS perfs,
         (SELECT count(*)::int FROM songs) AS songs
`);
check("re-running the loader is a no-op", afterSecond, before);

console.log(failures === 0 ? "\nAll assertions passed." : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
