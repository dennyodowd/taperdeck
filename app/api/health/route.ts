import { sql } from "drizzle-orm";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * What the deployed runtime can actually see.
 *
 * The hosting dashboard shows what is *configured*; this shows what has *arrived*. Those
 * differ more often than you would think — most commonly when a variable exists but is
 * not enabled for the Production environment.
 *
 * Returns booleans and lengths only. **Never a value.** A length is enough to catch the
 * classic failure of a pasted secret carrying stray whitespace, which has already cost
 * this project one afternoon (see the setlist.fm 403 in CLAUDE.md).
 */
function present(name: string): { set: boolean; length?: number; trimmed?: boolean } {
  const raw = process.env[name];
  if (!raw) return { set: false };
  return { set: true, length: raw.length, trimmed: raw !== raw.trim() };
}

/** Strip anything that could carry a credential out of an error message. */
function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://<redacted>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<redacted>")
    .split("\n")[0]
    .slice(0, 300);
}

export async function GET() {
  const env = {
    DATABASE_URL: present("DATABASE_URL"),
    SETLIST_API_KEY: present("SETLIST_API_KEY"),
    INGEST_SECRET: present("INGEST_SECRET"),
    // Migrations only — its absence at runtime is expected and not a problem.
    DATABASE_URL_UNPOOLED: present("DATABASE_URL_UNPOOLED"),
  };

  let database: { ok: boolean; detail: string };
  try {
    await db.execute(sql`SELECT 1`);
    database = { ok: true, detail: "connected" };
  } catch (err) {
    database = { ok: false, detail: safeMessage(err) };
  }

  const ok = env.DATABASE_URL.set && database.ok;

  return Response.json(
    {
      ok,
      env,
      database,
      hint: ok
        ? undefined
        : !env.DATABASE_URL.set
          ? "DATABASE_URL has not reached the runtime. In Vercel, check Settings → " +
            "Environment Variables: the variable must be enabled for the Production " +
            "environment specifically, and the project must be redeployed after adding it."
          : "DATABASE_URL is present but the connection failed — check the value itself.",
    },
    { status: ok ? 200 : 503 },
  );
}
