import { db } from "@/db";
import { getPlayHistory } from "@/lib/queries/artist.ts";

export const dynamic = "force-dynamic";

/** Play history for one song, loaded when a row is expanded rather than up front. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/songs/[songId]/history">,
) {
  const { songId } = await ctx.params;
  const id = Number(songId);
  if (!Number.isInteger(id)) {
    return Response.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
  }
  return Response.json({ ok: true, history: await getPlayHistory(db, id) });
}
