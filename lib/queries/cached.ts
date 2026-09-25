import { revalidateTag, unstable_cache } from "next/cache";

import type { Db } from "../../db/client.ts";
import { db } from "../../db/index.ts";
import * as artist from "./artist.ts";
import * as landing from "./landing.ts";
import * as show from "./show.ts";

/**
 * The read path pages and GET routes use: every screen query, cached.
 *
 * Why this exists: every page is `force-dynamic`, and a single visit to the landing page
 * used to run the heaviest queries in the app. Bots on a public URL were enough to keep
 * the Neon compute awake around the clock. Our data only changes when an ingest runs, so
 * results are cached until one does, and repeat visits never reach Postgres.
 *
 * Why `unstable_cache` and not `use cache`: Next 16 marks it as replaced, but plain
 * `use cache` is in-memory per instance and does not survive between serverless
 * requests, and the durable variant needs Cache Components, which means rebuilding every
 * route. `unstable_cache` is shared across instances and still works under
 * `force-dynamic` (only an explicit `fetchCache = "force-no-store"` bypasses it).
 *
 * Three rules:
 *
 * - Invalidation is `invalidateData()`, called by every route that ingests. A write from
 *   outside Next (scripts/ingest-artists.mts) cannot invalidate; the 24h `revalidate`
 *   is the backstop for that, not the mechanism.
 * - Entries SURVIVE DEPLOYS. If a deploy changes what a query returns, bump
 *   CACHE_VERSION or visitors are served the old shape.
 * - Results are stored as JSON, so a query here must return only JSON-safe values — no
 *   `Date`, `Map` or `Set`. Every query was checked against live data when this was
 *   added; a new one needs the same check.
 *
 * `lib/queries/*` stay uncached and take `db` as an argument so scripts can use them.
 */

export const DATA_TAG = "taperdeck-data";

const CACHE_VERSION = "v1";

const ONE_DAY = 86_400;

function cached<A extends unknown[], R>(
  name: string,
  query: (db: Db, ...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  // The key is the stringified function plus these parts plus the arguments. Every
  // wrapper stringifies identically, so `name` is what keeps them apart.
  return unstable_cache((...args: A) => query(db, ...args), [CACHE_VERSION, name], {
    tags: [DATA_TAG],
    revalidate: ONE_DAY,
  });
}

/**
 * Expire everything now, not stale-while-revalidate: the visitor who triggered a first
 * lookup is sent straight to that artist's page, which must not serve a cached "not
 * held" from before the ingest.
 *
 * Takes effect only if the route handler RETURNS a response. Next applies pending
 * revalidations after the handler completes and discards them when it throws — checked
 * against the 16.3 source (app-route/module.js) and by test. So an ingest that dies on
 * an unexpected, rethrown error leaves the cache stale (not wrong) until the next
 * successful ingest or the 24h backstop. Handled failures (IngestError) return a
 * response and do invalidate.
 */
export function invalidateData(): void {
  revalidateTag(DATA_TAG, { expire: 0 });
}

export const getLandingCounts = cached("landingCounts", landing.getLandingCounts);
export const getHeldBands = cached("heldBands", landing.getHeldBands);
export const getFeed = cached("feed", landing.getFeed);
export const searchHeldBands = cached("searchHeldBands", landing.searchHeldBands);

export const getArtistHeader = cached("artistHeader", artist.getArtistHeader);
export const getArtistStats = cached("artistStats", artist.getArtistStats);
export const getSongTable = cached("songTable", artist.getSongTable);
export const getPlayHistory = cached("playHistory", artist.getPlayHistory);
export const getRecentShows = cached("recentShows", artist.getRecentShows);
export const getGuests = cached("guests", artist.getGuests);
export const getGuestSummary = cached("guestSummary", artist.getGuestSummary);

export const getShowHeader = cached("showHeader", show.getShowHeader);
export const getSetlist = cached("setlist", show.getSetlist);
export const getShowStats = cached("showStats", show.getShowStats);
export const getAdjacentShows = cached("adjacentShows", show.getAdjacentShows);
export const getRun = cached("run", show.getRun);
export const getShowGuests = cached("showGuests", show.getShowGuests);
