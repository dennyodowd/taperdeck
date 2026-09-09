/**
 * Ingest orchestration: budget guard, global lock, paging, and the durable run log.
 */

import { eq, sql } from "drizzle-orm";

import type { Db } from "../../db/client.ts";
import { artists, ingestRuns } from "../../db/schema.ts";
import {
  getArtistSetlists,
  searchArtists,
  type RequestLogEntry,
} from "../setlistfm/client.ts";
import { IngestError, type ErrorCode } from "../setlistfm/errors.ts";
import { PayloadShapeError } from "../setlistfm/parse.ts";
import { refreshArtistRollups, upsertArtist, upsertSetlists } from "./upsert.ts";

/** What a first lookup fetches before the page renders. ~100 shows, ~5-8 seconds. */
export const FIRST_PULL_PAGES = 5;

/** No single run may monopolise the budget, however deep the artist's history. */
export const MAX_PAGES_PER_RUN = 10;

/** ~1,200 shows. A hard depth cap — never loop until exhaustion. */
export const MAX_PAGES_PER_ARTIST = 60;

/** Of 1,440. The headroom is deliberate: leave room to debug without going dark. */
export const DAILY_REQUEST_BUDGET = 1200;

/** A run still marked running after this long is treated as crashed. */
const STALE_RUN_MINUTES = 10;

/** Setlists per page on the setlists endpoints. Not 30 — that is /search/artists. */
const SETLISTS_PER_PAGE = 20;

export type IngestTrigger = "first_lookup" | "cron" | "manual";

export type IngestResult = {
  runId: number;
  artistId: number;
  mbid: string;
  name: string;
  pagesFetched: number;
  requestsUsed: number;
  backfillComplete: boolean;
  counts: { shows: number; performances: number; songs: number };
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

/**
 * Requests actually issued in the last 24 hours, counted from the request logs rather
 * than from page counts — a resolve call and a failed call both cost budget too.
 */
export async function requestsUsedToday(db: Db): Promise<number> {
  const [row] = rowsOf<{ used: number }>(
    await db.execute(sql`
      SELECT COALESCE(SUM(jsonb_array_length(COALESCE(request_log, '[]'::jsonb))), 0)::int
             AS used
        FROM ingest_runs
       WHERE started_at > now() - interval '24 hours'
    `),
  );
  return Number(row?.used ?? 0);
}

/**
 * Claim the global ingest lock.
 *
 * A partial unique index on (status) WHERE status = 'running' means Postgres itself
 * permits only one running row, so two concurrent invocations cannot both win — a
 * check-then-insert would race. Serialising runs globally is also what makes the
 * client's in-process 2 req/sec spacing meaningful, since serverless instances do not
 * share memory.
 */
async function claimRun(
  db: Db,
  trigger: IngestTrigger,
  artistQuery: string | null,
): Promise<number> {
  // Release anything left running by a crashed invocation, or the lock wedges forever.
  await db.execute(sql`
    UPDATE ingest_runs
       SET status = 'error', error_code = 'RUN_TIMEOUT', finished_at = now()
     WHERE status = 'running'
       AND started_at < now() - (${STALE_RUN_MINUTES} || ' minutes')::interval
  `);

  try {
    const [row] = await db
      .insert(ingestRuns)
      .values({ trigger, status: "running", artistQuery })
      .returning({ id: ingestRuns.id });
    return row.id;
  } catch {
    throw new IngestError(
      "RUN_IN_PROGRESS",
      "another ingest is already running; try again shortly.",
    );
  }
}

async function finishRun(
  db: Db,
  runId: number,
  patch: {
    status: "ok" | "error";
    errorCode?: string;
    pagesFetched: number;
    setlistsUpserted: number;
    songsUpserted: number;
    requestLog: RequestLogEntry[];
    artistId?: number;
  },
): Promise<void> {
  await db
    .update(ingestRuns)
    .set({
      status: patch.status,
      errorCode: patch.errorCode,
      finishedAt: new Date(),
      pagesFetched: patch.pagesFetched,
      setlistsUpserted: patch.setlistsUpserted,
      songsUpserted: patch.songsUpserted,
      requestLog: patch.requestLog,
      artistId: patch.artistId,
    })
    .where(eq(ingestRuns.id, runId));
}

export type IngestOptions = {
  artistName?: string;
  mbid?: string;
  trigger: IngestTrigger;
  /** Pages to fetch in this run. Clamped to MAX_PAGES_PER_RUN. */
  maxPages?: number;
  /** 1-based. Backfill resumes from artists.pages_fetched + 1. */
  startPage?: number;
};

export async function ingestArtist(
  db: Db,
  opts: IngestOptions,
): Promise<IngestResult> {
  const log: RequestLogEntry[] = [];
  const query = opts.artistName ?? opts.mbid ?? null;

  // Guard before anything goes out, so an exhausted budget is a distinct, cheap failure
  // rather than a burst of 429s.
  const used = await requestsUsedToday(db);
  if (used >= DAILY_REQUEST_BUDGET) {
    throw new IngestError(
      "BUDGET_EXHAUSTED",
      `${used} requests used in the last 24h, budget is ${DAILY_REQUEST_BUDGET}.`,
    );
  }

  const runId = await claimRun(db, opts.trigger, query);

  let pagesFetched = 0;
  let totals = { shows: 0, performances: 0, songs: 0 };
  let artistId: number | undefined;

  try {
    // -- resolve -----------------------------------------------------------
    let mbid = opts.mbid;
    let apiArtist;

    if (!mbid) {
      if (!opts.artistName) {
        throw new IngestError("ARTIST_NOT_FOUND", "no artistName or mbid supplied.");
      }
      const found = await searchArtists(opts.artistName, log);
      const hit = found.artist?.[0];
      if (!hit) {
        throw new IngestError(
          "ARTIST_NOT_FOUND",
          `no artist matched ${JSON.stringify(opts.artistName)}.`,
        );
      }
      mbid = hit.mbid;
      apiArtist = hit;
    }

    // -- pages -------------------------------------------------------------
    const startPage = Math.max(1, opts.startPage ?? 1);
    const budgetPages = Math.min(
      opts.maxPages ?? FIRST_PULL_PAGES,
      MAX_PAGES_PER_RUN,
      Math.max(0, MAX_PAGES_PER_ARTIST - (startPage - 1)),
    );

    let totalPages = Infinity;

    for (let i = 0; i < budgetPages; i += 1) {
      const page = startPage + i;
      if (page > totalPages) break;

      let envelope;
      try {
        envelope = await getArtistSetlists(mbid, page, log);
      } catch (err) {
        // A 404 on page 1 means this artist has no setlists at all, which is a real and
        // distinct answer — not an auth problem and not a transport failure.
        if (
          err instanceof IngestError &&
          err.code === "NO_SETLISTS" &&
          page === startPage
        ) {
          throw new IngestError(
            "NO_SETLISTS",
            `artist ${mbid} resolved but has no setlists.`,
          );
        }
        // A 404 past the first page just means we ran off the end.
        if (err instanceof IngestError && err.code === "NO_SETLISTS") break;
        throw err;
      }

      const batch = envelope.setlist ?? [];
      if (batch.length === 0) break;

      if (!Number.isFinite(totalPages)) {
        totalPages = Math.ceil((envelope.total || 0) / SETLISTS_PER_PAGE);
      }

      if (artistId === undefined) {
        artistId = await upsertArtist(db, apiArtist ?? batch[0].artist, {
          totalReported: envelope.total,
        });
      }

      const counts = await upsertSetlists(db, artistId, batch);
      totals = {
        shows: totals.shows + counts.shows,
        performances: totals.performances + counts.performances,
        songs: Math.max(totals.songs, counts.songs),
      };
      pagesFetched = page;
    }

    if (artistId === undefined) {
      throw new IngestError("NO_SETLISTS", `artist ${mbid} returned no usable setlists.`);
    }

    const rollup = await refreshArtistRollups(
      db,
      artistId,
      pagesFetched,
      MAX_PAGES_PER_ARTIST,
    );

    await finishRun(db, runId, {
      status: "ok",
      pagesFetched,
      setlistsUpserted: totals.shows,
      songsUpserted: totals.songs,
      requestLog: log,
      artistId,
    });

    const [row] = await db
      .select({ name: artists.name, mbid: artists.mbid })
      .from(artists)
      .where(eq(artists.id, artistId));

    return {
      runId,
      artistId,
      mbid: row.mbid,
      name: row.name,
      pagesFetched,
      requestsUsed: log.length,
      backfillComplete: rollup.backfillComplete,
      counts: totals,
    };
  } catch (err) {
    const code: ErrorCode =
      err instanceof IngestError
        ? err.code
        : err instanceof PayloadShapeError
          ? "PARSE_ERROR"
          : "UPSTREAM_ERROR";

    await finishRun(db, runId, {
      status: "error",
      errorCode: code,
      pagesFetched,
      setlistsUpserted: totals.shows,
      songsUpserted: totals.songs,
      requestLog: log,
      artistId,
    });

    if (err instanceof IngestError) throw err;
    throw new IngestError(code, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Artists due for a refresh or a deeper backfill, most recently active first.
 * Prioritised by recency of last show, not alphabetically.
 */
export async function artistsDueForRefresh(
  db: Db,
  limit: number,
): Promise<Array<{ id: number; mbid: string; name: string; pagesFetched: number; backfillComplete: boolean }>> {
  return rowsOf(
    await db.execute(sql`
      SELECT id, mbid, name, pages_fetched AS "pagesFetched",
             backfill_complete AS "backfillComplete"
        FROM artists
       ORDER BY backfill_complete ASC, last_show_date DESC NULLS LAST
       LIMIT ${limit}
    `),
  );
}
