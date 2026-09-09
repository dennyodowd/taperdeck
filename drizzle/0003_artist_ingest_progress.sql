ALTER TABLE "artists" ADD COLUMN "pages_fetched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "backfill_complete" boolean DEFAULT false NOT NULL;