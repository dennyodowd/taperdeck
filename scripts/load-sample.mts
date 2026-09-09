/**
 * Loads the committed sample.json into the database and asserts the schema behaves.
 *
 * This is a TEST FIXTURE, not the ingestion pipeline. No network, no pagination, no
 * rate limiting, no run log.
 *
 *   npm run db:load-sample
 *
 * It deliberately goes through the SAME lib/ code the live pipeline uses — the parsers
 * in lib/setlistfm/parse.ts and the write path in lib/ingest/upsert.ts. If it had its own
 * copies, it would stop proving anything about production.
 *
 * Re-running must be a no-op. That is one of the assertions.
 */

import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";

import { createDb } from "../db/client.ts";
import { MAX_PAGES_PER_ARTIST } from "../lib/ingest/run.ts";
import {
  refreshArtistRollups,
  upsertArtist,
  upsertSetlists,
} from "../lib/ingest/upsert.ts";
import type { SetlistsEnvelope } from "../lib/setlistfm/parse.ts";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const db = createDb(url);

/**
 * The moment sample.json was captured. `total` is a now()-dependent figure, so it is
 * pinned to when it was taken rather than to when this script happens to run.
 */
const CAPTURED_AT = new Date("2026-09-09T16:05:44Z");

/** sample.json is exactly one page, so pagesFetched is 1. */
const SAMPLE_PAGES = 1;

/**
 * The fixture is loaded under its own synthetic artist identity, NOT under real Phish.
 *
 * Every assertion below is about a known, fixed 20-show page — "exactly 20 shows numbered
 * 1..20", "192 songs", "337 performances". Live ingestion deepens real Phish past 200
 * shows, which would break all of them and make the suite look broken when nothing is.
 * Isolating the fixture keeps its assertions exact and repeatable, and keeps it from
 * writing over ingested data.
 */
const FIXTURE_MBID = "00000000-0000-4000-8000-000000000001";
const FIXTURE_NAME = "Phish (sample.json fixture)";

/**
 * Show ids are namespaced too. shows.id is the primary key, so without this the sample's
 * twenty rows would collide with the same twenty shows already held under real Phish and
 * stay attached to that artist — leaving the fixture artist empty and every assertion
 * failing for a reason that has nothing to do with the schema.
 */
const FIXTURE_ID_PREFIX = "fx";

async function load() {
  const payload = JSON.parse(
    readFileSync("sample.json", "utf8"),
  ) as SetlistsEnvelope;

  const setlists = payload.setlist ?? [];
  const artistId = await upsertArtist(
    db,
    { ...setlists[0].artist, mbid: FIXTURE_MBID, name: FIXTURE_NAME },
    { totalReported: payload.total, capturedAt: CAPTURED_AT },
  );

  const counts = await upsertSetlists(
    db,
    artistId,
    setlists.map((sl) => ({ ...sl, id: `${FIXTURE_ID_PREFIX}${sl.id}` })),
  );
  await refreshArtistRollups(db, artistId, SAMPLE_PAGES, MAX_PAGES_PER_ARTIST);

  return {
    artistId,
    showCount: counts.shows,
    perfCount: counts.performances,
  };
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
// Scoped to the fixture artist, not global: other artists are being ingested live, so a
// global count would drift for reasons that have nothing to do with idempotency.
const countsFor = (id: number) => sql`
  SELECT (SELECT count(*)::int FROM shows WHERE artist_id = ${id}) AS shows,
         (SELECT count(*)::int FROM performances WHERE artist_id = ${id}) AS perfs,
         (SELECT count(*)::int FROM songs WHERE artist_id = ${id}) AS songs
`;

type Counts = { shows: number; perfs: number; songs: number };
const before = await one<Counts>(countsFor(first.artistId));
await load();
const afterSecond = await one<Counts>(countsFor(first.artistId));
check("re-running the loader is a no-op", afterSecond, before);

console.log(failures === 0 ? "\nAll assertions passed." : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
