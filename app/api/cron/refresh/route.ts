import { db } from "@/db";
import { isAuthorised, unauthorised } from "@/lib/ingest/auth.ts";
import {
  artistsDueForRefresh,
  ingestArtist,
  MAX_PAGES_PER_RUN,
  requestsUsedToday,
  DAILY_REQUEST_BUDGET,
} from "@/lib/ingest/run.ts";
import { IngestError } from "@/lib/setlistfm/errors.ts";

export const dynamic = "force-dynamic";

/**
 * Scheduled refresh and backfill.
 *
 * Deepens incomplete backfills first, then refreshes held artists, prioritised by
 * recency of last show rather than alphabetically — a band on tour changes nightly and
 * a band that split in 1994 does not.
 *
 * Callable by hand with the same secret as /api/ingest.
 */
export async function GET(request: Request) {
  if (!isAuthorised(request)) return unauthorised();

  const used = await requestsUsedToday(db);
  if (used >= DAILY_REQUEST_BUDGET) {
    return Response.json(
      {
        ok: false,
        error: "BUDGET_EXHAUSTED",
        message: `${used} of ${DAILY_REQUEST_BUDGET} requests used in the last 24h.`,
      },
      { status: 503 },
    );
  }

  // One artist per invocation. The global ingest lock permits only one run at a time
  // anyway, and a single cron tick must not be able to drain the day's budget.
  const [due] = await artistsDueForRefresh(db, 1);
  if (!due) {
    return Response.json({ ok: true, message: "No artists held yet; nothing to refresh." });
  }

  try {
    const result = await ingestArtist(db, {
      mbid: due.mbid,
      trigger: "cron",
      // An incomplete artist gets deepened from where it left off; a complete one gets
      // its most recent pages re-checked for edits and new shows.
      startPage: due.backfillComplete ? 1 : due.pagesFetched + 1,
      maxPages: due.backfillComplete ? 2 : MAX_PAGES_PER_RUN,
    });
    return Response.json({ ok: true, refreshed: due.name, ...result });
  } catch (err) {
    if (err instanceof IngestError) {
      // Non-2xx deliberately: a silently failing cron is how a dead key goes unnoticed
      // for a month.
      return Response.json(
        { ok: false, artist: due.name, error: err.code, message: err.message },
        { status: 500 },
      );
    }
    throw err;
  }
}
