import { searchHeldBands } from "@/lib/queries/cached.ts";

export const dynamic = "force-dynamic";

/**
 * Typeahead over bands we already hold. Costs no setlist.fm budget — it never leaves our
 * database. A miss is answered by /api/artists/lookup, which does spend budget, and only
 * when the visitor asks for it.
 */
export async function GET(request: Request) {
  // The query matches case-insensitively throughout, so folding case here changes no
  // result and lets "Goose" and "goose" share one cache entry.
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  return Response.json({ ok: true, results: await searchHeldBands(q) });
}
