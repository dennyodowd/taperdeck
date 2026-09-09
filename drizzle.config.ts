import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so it gets none of Next's automatic .env.local
// loading. Load it explicitly.
loadEnv({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;

if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Migrations use Neon's direct connection — " +
      "they cannot run through the pooled DATABASE_URL.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
