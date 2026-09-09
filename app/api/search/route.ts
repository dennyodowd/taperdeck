import { db } from "@/db";
import { searchHeldBands } from "@/lib/queries/landing.ts";

export const dynamic = "force-dynamic";

/**
 * Typeahead over bands we already hold. Costs no setlist.fm budget — it never leaves our
 * database. A miss is answered by /api/artists/lookup, which does spend budget, and only
 * when the visitor asks for it.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ ok: true, results: await searchHeldBands(db, q) });
}
