CREATE TYPE "public"."ingest_status" AS ENUM('running', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."ingest_trigger" AS ENUM('first_lookup', 'cron', 'manual');--> statement-breakpoint
CREATE TABLE "artists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "artists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mbid" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_name" text,
	"disambiguation" text,
	"url" text,
	"total_reported" integer,
	"total_reported_at" timestamp with time zone,
	"last_show_date" date,
	"raw" jsonb,
	"first_ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ingested_at" timestamp with time zone,
	CONSTRAINT "artists_mbid_unique" UNIQUE("mbid")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"artist_id" integer,
	"artist_query" text,
	"trigger" "ingest_trigger" NOT NULL,
	"status" "ingest_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"setlists_upserted" integer DEFAULT 0 NOT NULL,
	"songs_upserted" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"request_log" jsonb
);
--> statement-breakpoint
CREATE TABLE "performances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "performances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"show_id" text NOT NULL,
	"song_id" integer NOT NULL,
	"artist_id" integer NOT NULL,
	"set_index" integer NOT NULL,
	"position" integer NOT NULL,
	"set_name_raw" text,
	"set_name" text,
	"encore" integer,
	"is_tape" boolean DEFAULT false NOT NULL,
	"info" text,
	"guest" jsonb,
	"name_raw" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text,
	"artist_id" integer NOT NULL,
	"venue_id" text,
	"event_date" date NOT NULL,
	"last_updated" timestamp with time zone,
	"tour_name" text,
	"info" text,
	"url" text,
	"performed_song_count" integer DEFAULT 0 NOT NULL,
	"is_performed" boolean GENERATED ALWAYS AS (performed_song_count > 0) STORED,
	"show_seq" integer,
	"raw" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "songs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"artist_id" integer NOT NULL,
	"name" text NOT NULL,
	"match_key" text GENERATED ALWAYS AS (taperdeck_song_key(name)) STORED,
	"cover_artist_mbid" uuid,
	"cover_artist_name" text
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city_id" text,
	"city_name" text,
	"state" text,
	"state_code" text,
	"country_code" text,
	"country_name" text,
	"lat" double precision,
	"long" double precision,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performances" ADD CONSTRAINT "performances_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performances" ADD CONSTRAINT "performances_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performances" ADD CONSTRAINT "performances_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "performances_show_pos_idx" ON "performances" USING btree ("show_id","set_index","position");--> statement-breakpoint
CREATE INDEX "performances_artist_song_idx" ON "performances" USING btree ("artist_id","song_id");--> statement-breakpoint
CREATE INDEX "performances_show_idx" ON "performances" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "shows_artist_date_idx" ON "shows" USING btree ("artist_id","event_date");--> statement-breakpoint
CREATE INDEX "shows_artist_seq_idx" ON "shows" USING btree ("artist_id","show_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "songs_artist_match_key_idx" ON "songs" USING btree ("artist_id","match_key");