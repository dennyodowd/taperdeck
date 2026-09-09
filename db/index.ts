import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. It is the Neon pooled connection string; " +
      "migrations use DATABASE_URL_UNPOOLED instead.",
  );
}

export const db = drizzle(neon(url), { schema });

export * from "./schema";
