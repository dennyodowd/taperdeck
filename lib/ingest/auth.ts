import { timingSafeEqual } from "node:crypto";

/**
 * Shared secret for the manually-callable job endpoints.
 *
 * Every scheduled job is also callable by hand — waiting for a cron to test a cron is
 * not workable. Accepts the secret either as `?secret=` (convenient from a terminal) or
 * as an `Authorization: Bearer` header (what Vercel Cron sends).
 */
export function isAuthorised(request: Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected) return false;

  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths first — the length of
  // a secret is not itself sensitive.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unauthorised(): Response {
  return Response.json(
    { ok: false, error: "UNAUTHORISED", message: "Missing or invalid secret." },
    { status: 401 },
  );
}
