import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema.ts";

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * Explicit factory rather than a module-level singleton, so callers that load env at
 * runtime (scripts) can construct a client after dotenv has run. ESM hoists imports, so
 * a module that reads process.env at import time cannot be used from such a script.
 *
 * Next.js code should import `db` from "@/db" instead.
 */
export function createDb(url: string): Db {
  return drizzle(neon(url), { schema });
}
