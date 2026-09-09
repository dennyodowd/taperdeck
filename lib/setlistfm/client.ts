/**
 * The only place in this codebase that talks to setlist.fm.
 *
 * Budget: 1,440 requests/day, 2/second. Every request is logged — URL, status, page,
 * record count, duration — to the console and into a caller-supplied array that ends up
 * in ingest_runs.request_log, because hosting log retention is short and outside our
 * control.
 */

import { IngestError } from "./errors.ts";
import type { ArtistsEnvelope, SetlistsEnvelope } from "./parse.ts";

const BASE_URL = "https://api.setlist.fm/rest/1.0";

/**
 * setlist.fm documents 2 requests/second. 550ms spacing (~1.8/sec) is inside that on
 * paper and still drew 429s in practice on the first live run — the documented figure is
 * evidently not the whole rule. 1,100ms (~0.9/sec) has proved reliable.
 *
 * The budget, not throughput, is the real constraint here: at 1,440 requests/day we are
 * never going to be limited by how fast we can issue them, so buying reliability with
 * latency is free.
 *
 * This gate is per process, and serverless instances do not share memory, so it is not
 * a complete guarantee on its own — lib/ingest/run.ts serialises runs globally through
 * the database so that only one ingest is in flight at a time, which is what makes this
 * spacing meaningful.
 */
const MIN_REQUEST_SPACING_MS = 1100;

/** Backoff before retrying a 429. Retries cost budget, so there are few of them. */
const RETRY_BACKOFF_MS = [2_000, 5_000];

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RequestLogEntry = {
  url: string;
  status: number;
  page: number | null;
  records: number | null;
  durationMs: number;
  at: string;
};

function apiKey(): string {
  const raw = process.env.SETLIST_API_KEY;
  if (!raw) {
    throw new IngestError("AUTH_FAILED", "SETLIST_API_KEY is not set.");
  }
  // Trimmed deliberately. The stored value carried a trailing whitespace byte, and that
  // is what produced this project's original 403.
  const key = raw.trim();
  if (key.length === 0) {
    throw new IngestError("AUTH_FAILED", "SETLIST_API_KEY is empty after trimming.");
  }
  return key;
}

/**
 * A descriptive User-Agent. Deliberately no email address: MusicBrainz asks for contact
 * info, but that is the owner's decision to make, not ours to insert on their behalf.
 */
const USER_AGENT = "Taperdeck/0.1 (+https://github.com/dennyodowd/taperdeck)";

/**
 * Retry only on 429, and only a couple of times. Every retry is a real request against
 * the daily budget and is logged as one, so this must not become an unbounded loop.
 */
async function request<T>(
  path: string,
  params: Record<string, string | number>,
  log: RequestLogEntry[],
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce<T>(path, params, log);
    } catch (err) {
      const retryable =
        err instanceof IngestError &&
        err.code === "RATE_LIMITED" &&
        attempt < RETRY_BACKOFF_MS.length;
      if (!retryable) throw err;

      const backoff = RETRY_BACKOFF_MS[attempt];
      console.warn(
        `[setlistfm] 429 on ${path}; backing off ${backoff}ms ` +
          `(attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length})`,
      );
      await sleep(backoff);
    }
  }
}

async function requestOnce<T>(
  path: string,
  params: Record<string, string | number>,
  log: RequestLogEntry[],
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  await throttle();
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        // Without Accept, the API returns XML by default and JSON.parse fails in a way
        // that looks like a broken endpoint.
        "x-api-key": apiKey(),
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    });
  } catch (cause) {
    const durationMs = Date.now() - startedAt;
    log.push({
      url: url.toString(),
      status: 0,
      page: null,
      records: null,
      durationMs,
      at: new Date().toISOString(),
    });
    throw new IngestError(
      "UPSTREAM_ERROR",
      `network failure calling ${path}: ${String(cause)}`,
    );
  }

  const durationMs = Date.now() - startedAt;
  const page = Number(params.p) || null;

  const entry: RequestLogEntry = {
    url: url.toString(),
    status: res.status,
    page,
    records: null,
    durationMs,
    at: new Date().toISOString(),
  };
  log.push(entry);

  if (!res.ok) {
    console.error(`[setlistfm] ${res.status} ${url} (${durationMs}ms)`);

    if (res.status === 401 || res.status === 403) {
      throw new IngestError(
        "AUTH_FAILED",
        `setlist.fm rejected the API key (${res.status}). This is a credentials ` +
          `problem, not an empty result.`,
      );
    }
    if (res.status === 429) {
      throw new IngestError("RATE_LIMITED", "setlist.fm rate limit hit (429).");
    }
    if (res.status === 404) {
      // setlist.fm returns 404 for an empty search rather than an empty list. Callers
      // translate this into ARTIST_NOT_FOUND or NO_SETLISTS depending on which endpoint
      // was being called — it must never be mistaken for a transport failure.
      throw new IngestError("NO_SETLISTS", `setlist.fm returned 404 for ${path}.`);
    }
    if (res.status >= 500) {
      throw new IngestError("UPSTREAM_ERROR", `setlist.fm ${res.status} for ${path}.`);
    }
    throw new IngestError("UPSTREAM_ERROR", `setlist.fm ${res.status} for ${path}.`);
  }

  const body = (await res.json()) as T;

  const records =
    (body as { setlist?: unknown[]; artist?: unknown[] }).setlist?.length ??
    (body as { setlist?: unknown[]; artist?: unknown[] }).artist?.length ??
    0;
  entry.records = records;

  console.log(
    `[setlistfm] ${res.status} ${url} page=${page ?? "-"} records=${records} ${durationMs}ms`,
  );

  return body;
}

/**
 * Resolve an artist name to a MusicBrainz ID.
 *
 * setlist.fm returns the mbid directly, so MusicBrainz itself is not needed — confirmed
 * against a real response: "Phish" with sort=relevance returns the correct band ahead of
 * tribute acts, with the expected mbid.
 */
export async function searchArtists(
  artistName: string,
  log: RequestLogEntry[],
): Promise<ArtistsEnvelope> {
  try {
    return await request<ArtistsEnvelope>(
      "/search/artists",
      { artistName, sort: "relevance", p: 1 },
      log,
    );
  } catch (err) {
    // On this endpoint a 404 means no such artist, which is distinct from an artist who
    // exists but has no setlists.
    if (err instanceof IngestError && err.code === "NO_SETLISTS") {
      throw new IngestError(
        "ARTIST_NOT_FOUND",
        `no artist matched ${JSON.stringify(artistName)}.`,
      );
    }
    throw err;
  }
}

/** One page of an artist's setlists, newest first. */
export async function getArtistSetlists(
  mbid: string,
  page: number,
  log: RequestLogEntry[],
): Promise<SetlistsEnvelope> {
  return request<SetlistsEnvelope>(`/artist/${mbid}/setlists`, { p: page }, log);
}
