import { createDb, type Db } from "./client.ts";

/**
 * The application database handle.
 *
 * Deliberately LAZY. Reading `process.env.DATABASE_URL` at module scope broke the
 * production build: Next evaluates page and route modules during "Collecting page data",
 * even for `force-dynamic` routes, so a module-scope throw fails the whole build on any
 * host that has not set the variable yet. That failure surfaces as "no deployment
 * appeared", which looks like a git or CI problem and is neither.
 *
 * Deferring the read to first use means a missing variable fails at request time, on the
 * request that needed it, with a message naming the variable — loudly, in the right
 * place, without taking the static parts of the site down with it.
 *
 * The Proxy keeps the call sites unchanged: `db.select(...)`, `db.execute(...)` and the
 * rest behave exactly as before.
 */

let instance: Db | null = null;

function connection(): Db {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. It is the Neon pooled connection string " +
        "(migrations use DATABASE_URL_UNPOOLED instead). In production this must be set " +
        "in the hosting project's environment variables — .env.local is gitignored and " +
        "never ships.",
    );
  }

  instance = createDb(url);
  return instance;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = connection() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    // Bind so methods keep their `this` when destructured off the proxy.
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type { Db } from "./client.ts";
export * from "./schema.ts";
