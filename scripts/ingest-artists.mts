/**
 * Live ingestion verification.
 *
 *   node scripts/ingest-artists.mts "Goose" "Dua Lipa" ...
 *
 * Spends real requests against the 1,440/day budget and reports what each artist
 * actually exercised. With no arguments it runs the default profile set and then the two
 * error paths.
 */

import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";

import { createDb } from "../db/client.ts";
import {
  DAILY_REQUEST_BUDGET,
  FIRST_PULL_PAGES,
  ingestArtist,
  requestsUsedToday,
} from "../lib/ingest/run.ts";
import { IngestError } from "../lib/setlistfm/errors.ts";

loadEnv({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const db = createDb(url);

function rowsOf<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** What this artist's data actually exercised, reported rather than assumed. */
async function profile(artistId: number) {
  const [p] = rowsOf<Record<string, number | string | null>>(
    await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM shows WHERE artist_id = ${artistId}) AS shows,
        (SELECT count(*)::int FROM shows WHERE artist_id = ${artistId} AND show_seq IS NULL) AS unsequenced,
        (SELECT count(*)::int FROM shows WHERE artist_id = ${artistId} AND tour_name IS NULL) AS no_tour,
        (SELECT count(*)::int FROM songs WHERE artist_id = ${artistId}) AS songs,
        (SELECT count(*)::int FROM performances WHERE artist_id = ${artistId}) AS perfs,
        (SELECT count(*)::int FROM performances WHERE artist_id = ${artistId} AND is_tape) AS tape,
        (SELECT count(*)::int FROM performances WHERE artist_id = ${artistId} AND guest IS NOT NULL) AS guests,
        (SELECT count(*)::int FROM songs WHERE artist_id = ${artistId} AND cover_artist_mbid IS NOT NULL) AS covers,
        (SELECT max(current_gap)::int FROM song_gap WHERE artist_id = ${artistId}) AS max_gap,
        (SELECT round(avg(times_played), 2)::text FROM song_gap WHERE artist_id = ${artistId}) AS avg_plays,
        (SELECT total_reported FROM artists WHERE id = ${artistId}) AS total_reported,
        (SELECT backfill_complete::text FROM artists WHERE id = ${artistId}) AS backfill_complete
    `),
  );

  // Contiguity of the ordinal, checked per artist rather than assumed.
  const [seq] = rowsOf<{ ok: boolean | null }>(
    await db.execute(sql`
      SELECT bool_and(show_seq = rn) AS ok FROM (
        SELECT show_seq, row_number() OVER (ORDER BY event_date, id) AS rn
          FROM shows WHERE artist_id = ${artistId} AND show_seq IS NOT NULL
      ) t
    `),
  );

  console.log(`  shows=${p.shows} (of ${p.total_reported} reported)  songs=${p.songs}  perfs=${p.perfs}`);
  console.log(`  covers=${p.covers}  tape=${p.tape}  guests(with)=${p.guests}  no_tour=${p.no_tour}  empty_setlists=${p.unsequenced}`);
  console.log(`  max_gap=${p.max_gap}  avg_plays=${p.avg_plays}  backfill_complete=${p.backfill_complete}`);
  console.log(`  ordinal contiguous: ${seq?.ok === true ? "yes" : seq?.ok === null ? "n/a (no shows)" : "NO"}`);

  return p;
}

async function run(name: string) {
  console.log(`\n=== ${name} ===`);
  try {
    const r = await ingestArtist(db, {
      artistName: name,
      trigger: "manual",
      maxPages: FIRST_PULL_PAGES,
    });
    console.log(
      `  resolved ${r.name} (${r.mbid}) — ${r.pagesFetched} pages, ${r.requestsUsed} requests`,
    );
    return await profile(r.artistId);
  } catch (err) {
    if (err instanceof IngestError) {
      console.log(`  ${err.code}: ${err.message}`);
      return null;
    }
    throw err;
  }
}

const DEFAULTS = ["Goose", "Dua Lipa", "The Velvet Underground", "Bill Ryder-Jones"];
const names = process.argv.slice(2);
const targets = names.length > 0 ? names : DEFAULTS;

console.log(`budget before: ${await requestsUsedToday(db)} / ${DAILY_REQUEST_BUDGET}`);

for (const n of targets) await run(n);

if (names.length === 0) {
  // -- error paths, proven rather than assumed ------------------------------
  console.log("\n=== error paths ===");

  console.log("\n-- nonsense artist name --");
  try {
    await ingestArtist(db, {
      artistName: "zzzz not a real band zzzz",
      trigger: "manual",
      maxPages: 1,
    });
    console.log("  UNEXPECTED: no error thrown");
  } catch (err) {
    console.log(`  ${err instanceof IngestError ? err.code : "non-IngestError"}`);
  }

  console.log("\n-- corrupted API key --");
  const realKey = process.env.SETLIST_API_KEY;
  process.env.SETLIST_API_KEY = "0000000000000000000000000000000000000";
  try {
    await ingestArtist(db, { artistName: "Phish", trigger: "manual", maxPages: 1 });
    console.log("  UNEXPECTED: no error thrown");
  } catch (err) {
    console.log(`  ${err instanceof IngestError ? err.code : "non-IngestError"}`);
  } finally {
    process.env.SETLIST_API_KEY = realKey;
  }

  console.log("\n=== run log ===");
  const runs = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT trigger, status, error_code, artist_query, pages_fetched, setlists_upserted,
             jsonb_array_length(COALESCE(request_log, '[]'::jsonb)) AS requests
        FROM ingest_runs ORDER BY started_at DESC LIMIT 10
    `),
  );
  for (const r of runs) {
    console.log(
      `  ${String(r.status).padEnd(5)} ${String(r.error_code ?? "-").padEnd(18)} ` +
        `${String(r.artist_query ?? "-").padEnd(26)} pages=${r.pages_fetched} ` +
        `shows=${r.setlists_upserted} reqs=${r.requests}`,
    );
  }
}

console.log(`\nbudget after: ${await requestsUsedToday(db)} / ${DAILY_REQUEST_BUDGET}`);
