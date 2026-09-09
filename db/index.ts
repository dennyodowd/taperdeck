import { createDb } from "./client.ts";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. It is the Neon pooled connection string; " +
      "migrations use DATABASE_URL_UNPOOLED instead.",
  );
}

export const db = createDb(url);

export type { Db } from "./client.ts";
export * from "./schema.ts";
