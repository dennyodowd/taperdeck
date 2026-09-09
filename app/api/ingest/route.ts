import { sql } from "drizzle-orm";

import { db } from "@/db";
import { isAuthorised, unauthorised } from "@/lib/ingest/auth.ts";
import {
  ingestArtist,
  MAX_PAGES_PER_RUN,
  requestsUsedToday,
  DAILY_REQUEST_BUDGET,
} from "@/lib/ingest/run.ts";
import { httpStatusFor, IngestError } from "@/lib/setlistfm/errors.ts";

export const dynamic = "force-dynamic";

/**
 * Manual ingest trigger.
 *
 *   POST /api/ingest?secret=...   { "name": "Phish", "pages": 5 }
 *   POST /api/ingest?secret=...   { "mbid": "...", "startPage": 6, "pages": 10 }
 *
 * Exists because waiting for a cron to test a cron is not workable.
 */
export async function POST(request: Request) {
  if (!isAuthorised(request)) return unauthorised();

  let body: { name?: string; mbid?: string; pages?: number; startPage?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body is fine for the budget-only query below
  }

  if (!body.name && !body.mbid) {
    const used = await requestsUsedToday(db);
    return Response.json({
      ok: false,
      error: "BAD_REQUEST",
      message: 'Supply {"name": "..."} or {"mbid": "..."}.',
      budget: { used, limit: DAILY_REQUEST_BUDGET, remaining: DAILY_REQUEST_BUDGET - used },
    }, { status: 400 });
  }

  try {
    const result = await ingestArtist(db, {
      artistName: body.name,
      mbid: body.mbid,
      trigger: "manual",
      maxPages: Math.min(body.pages ?? MAX_PAGES_PER_RUN, MAX_PAGES_PER_RUN),
      startPage: body.startPage,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof IngestError) {
      return Response.json(
        { ok: false, error: err.code, message: err.message },
        { status: httpStatusFor(err.code) },
      );
    }
    throw err;
  }
}

/** Budget and recent-run visibility, so the log is readable without a database client. */
export async function GET(request: Request) {
  if (!isAuthorised(request)) return unauthorised();

  const used = await requestsUsedToday(db);
  // neon-http returns rows directly on some paths and {rows} on others; normalise so the
  // response shape does not depend on which.
  const result = await db.execute(sql`
    SELECT id, trigger, status, error_code, artist_query, pages_fetched,
           setlists_upserted, started_at, finished_at,
           jsonb_array_length(COALESCE(request_log, '[]'::jsonb)) AS requests
      FROM ingest_runs ORDER BY started_at DESC LIMIT 20
  `);
  const recent = Array.isArray(result)
    ? result
    : ((result as unknown as { rows?: unknown[] }).rows ?? []);

  return Response.json({
    ok: true,
    budget: { used, limit: DAILY_REQUEST_BUDGET, remaining: DAILY_REQUEST_BUDGET - used },
    recent,
  });
}
