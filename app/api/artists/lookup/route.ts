import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { artists } from "@/db/schema.ts";
import { FIRST_PULL_PAGES, ingestArtist } from "@/lib/ingest/run.ts";
import { httpStatusFor, IngestError } from "@/lib/setlistfm/errors.ts";

// Reads the database and may trigger an outbound fetch; never cacheable.
export const dynamic = "force-dynamic";

/**
 * The lazy-ingestion entry point.
 *
 * A visitor searching for an artist we do not hold is what triggers the first pull —
 * there is no preloaded list. If we already hold the artist we serve from our database
 * and spend nothing, which is the whole point: never query setlist.fm per visitor.
 */
export async function POST(request: Request) {
  let name: string | undefined;
  try {
    const body = (await request.json()) as { name?: string };
    name = body.name?.trim();
  } catch {
    // fall through to the validation below
  }

  if (!name) {
    return Response.json(
      { ok: false, error: "BAD_REQUEST", message: "Body must be {\"name\": \"...\"}." },
      { status: 400 },
    );
  }

  // Already held? Serve it and spend no budget.
  const held = await db
    .select({
      id: artists.id,
      mbid: artists.mbid,
      name: artists.name,
      pagesFetched: artists.pagesFetched,
      backfillComplete: artists.backfillComplete,
      lastShowDate: artists.lastShowDate,
    })
    .from(artists)
    .where(sql`lower(${artists.name}) = lower(${name})`)
    .limit(1);

  if (held.length > 0) {
    return Response.json({ ok: true, source: "database", artist: held[0] });
  }

  try {
    const result = await ingestArtist(db, {
      artistName: name,
      trigger: "first_lookup",
      maxPages: FIRST_PULL_PAGES,
    });

    const [artist] = await db
      .select({
        id: artists.id,
        mbid: artists.mbid,
        name: artists.name,
        pagesFetched: artists.pagesFetched,
        backfillComplete: artists.backfillComplete,
        lastShowDate: artists.lastShowDate,
      })
      .from(artists)
      .where(eq(artists.id, result.artistId));

    return Response.json({
      ok: true,
      source: "ingested",
      artist,
      // Gap counts shows we hold, not shows that happened. Until backfill completes it
      // is understated, so the client is told rather than left to assume.
      gapIsProvisional: !result.backfillComplete,
      requestsUsed: result.requestsUsed,
    });
  } catch (err) {
    // An auth failure, a rate limit and an artist with genuinely no setlists stay three
    // distinguishable answers. Never a 200 with an empty list.
    if (err instanceof IngestError) {
      return Response.json(
        { ok: false, error: err.code, message: err.message },
        { status: httpStatusFor(err.code) },
      );
    }
    throw err;
  }
}
