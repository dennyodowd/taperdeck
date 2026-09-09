/**
 * Distinct failure codes.
 *
 * This is the convention that matters most in this project: an auth error, a rate limit,
 * and an artist with genuinely no setlists are three different things. If error handling
 * collapses them into an empty result, a broken key looks exactly like an obscure band —
 * and that is a wrong answer nobody notices.
 *
 * Every one of these is recorded on the ingest_runs row and returned as a non-2xx.
 */
export const ERROR_CODES = [
  "AUTH_FAILED", // 401/403 — the key is rejected
  "RATE_LIMITED", // 429
  "ARTIST_NOT_FOUND", // the search returned no artists
  "NO_SETLISTS", // artist resolved, but has no setlists
  "BUDGET_EXHAUSTED", // our own guard, tripped before any request went out
  "RUN_IN_PROGRESS", // another ingest holds the lock
  "UPSTREAM_ERROR", // 5xx
  "PARSE_ERROR", // a date or field shape stopped matching
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class IngestError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = 500) {
    super(message);
    this.name = "IngestError";
    this.code = code;
    this.status = status;
  }
}

/** HTTP status to return for each code. Never 200 — failures must be loud. */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case "AUTH_FAILED":
      return 502; // our credentials failed upstream, not the caller's
    case "RATE_LIMITED":
      return 429;
    case "ARTIST_NOT_FOUND":
    case "NO_SETLISTS":
      return 404;
    case "BUDGET_EXHAUSTED":
    case "RUN_IN_PROGRESS":
      return 503;
    case "UPSTREAM_ERROR":
    case "PARSE_ERROR":
      return 502;
  }
}
