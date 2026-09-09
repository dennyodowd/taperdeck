import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Surrogate integer keys for artists and songs, because `performances` reaches tens of
 * thousands of rows per artist and carries both as foreign keys. Natural text keys for
 * shows and venues, because setlist.fm supplies stable ones.
 *
 * Two objects this file cannot express live in `drizzle/0000_song_key_function.sql` and
 * `drizzle/0002_sequencing.sql`: the `taperdeck_song_key` function that `songs.match_key`
 * is generated from, and the triggers that maintain `shows.show_seq`. Read those before
 * changing anything here.
 */

export const artists = pgTable("artists", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  mbid: uuid("mbid").notNull().unique(),
  name: text("name").notNull(),
  sortName: text("sort_name"),
  disambiguation: text("disambiguation"),
  url: text("url"),

  // The envelope's `total` depends on now() and drifts, so it is stored with the moment
  // it was taken rather than presented as a standing fact.
  totalReported: integer("total_reported"),
  totalReportedAt: timestamp("total_reported_at", { withTimezone: true }),

  // Refresh jobs prioritise by this, not alphabetically.
  lastShowDate: date("last_show_date"),

  raw: jsonb("raw"),
  firstIngestedAt: timestamp("first_ingested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
});

export const venues = pgTable("venues", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cityId: text("city_id"),
  cityName: text("city_name"),
  state: text("state"),
  stateCode: text("state_code"),
  countryCode: text("country_code"),
  countryName: text("country_name"),
  lat: doublePrecision("lat"),
  long: doublePrecision("long"),
  raw: jsonb("raw"),
});

export const shows = pgTable(
  "shows",
  {
    // setlist.fm's setlist id. The upsert key: refresh jobs re-fetch the same shows
    // constantly and a rerun must be a no-op.
    id: text("id").primaryKey(),
    // Distinct from `id` — tracks edits to the same show.
    versionId: text("version_id"),

    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    venueId: text("venue_id").references(() => venues.id),

    // Parsed from dd-MM-yyyy by splitting on "-". Never via new Date().
    eventDate: date("event_date").notNull(),
    // Parsed from ISO 8601. A DIFFERENT format from eventDate — two fields, two parsers.
    lastUpdated: timestamp("last_updated", { withTimezone: true }),

    tourName: text("tour_name"),
    info: text("info"),
    url: text("url"),

    // Counts non-tape songs only, so a show consisting entirely of PA music does not
    // count as performed.
    performedSongCount: integer("performed_song_count").notNull().default(0),
    isPerformed: boolean("is_performed").generatedAlwaysAs(
      sql`performed_song_count > 0`,
    ),

    // The per-artist ordinal that turns gap into integer subtraction. NULL for shows
    // that were not performed, so an empty setlist never consumes an ordinal and never
    // inflates a gap. Maintained by trigger — never write it from application code.
    showSeq: integer("show_seq"),

    raw: jsonb("raw").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("shows_artist_date_idx").on(t.artistId, t.eventDate),
    // Plain index, not unique. The uniqueness guarantee is added as a DEFERRABLE
    // constraint in 0002 — a bulk renumber transiently collides on a non-deferred one.
    index("shows_artist_seq_idx").on(t.artistId, t.showSeq),
  ],
);

export const songs = pgTable(
  "songs",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),

    // Canonical display spelling — the first one seen wins.
    name: text("name").notNull(),

    // Identity is enforced by the database, not by application discipline. A cover is
    // the SAME identity as an original: the original performer is an attribute below,
    // not a separate entity. See CLAUDE.md for why.
    matchKey: text("match_key").generatedAlwaysAs(
      sql`taperdeck_song_key(name)`,
    ),

    coverArtistMbid: uuid("cover_artist_mbid"),
    coverArtistName: text("cover_artist_name"),
  },
  (t) => [uniqueIndex("songs_artist_match_key_idx").on(t.artistId, t.matchKey)],
);

export const performances = pgTable(
  "performances",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),

    showId: text("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    songId: integer("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    // Denormalised. Immutable per row (a show never changes artist), and lets
    // artist-scoped statistics skip a join.
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),

    setIndex: integer("set_index").notNull(),
    position: integer("position").notNull(),

    setNameRaw: text("set_name_raw"),
    // Trailing colon stripped: the sample carries "Set 1", "Set 1:" and "Set 2:" for
    // the same concept.
    setName: text("set_name"),
    encore: integer("encore"),

    // Played over the PA, not performed. Retained on the record, excluded from every
    // statistic — see the performances_counted view.
    isTape: boolean("is_tape").notNull().default(false),

    info: text("info"),
    // `with` never appears in sample.json, so its shape is unknown. Stored whole rather
    // than guessed into columns.
    guest: jsonb("guest"),

    // The literal name as it appeared. Makes a normalisation mistake recoverable by
    // reprocessing instead of re-fetching against a 1,440/day API.
    nameRaw: text("name_raw").notNull(),
  },
  (t) => [
    uniqueIndex("performances_show_pos_idx").on(
      t.showId,
      t.setIndex,
      t.position,
    ),
    index("performances_artist_song_idx").on(t.artistId, t.songId),
    index("performances_show_idx").on(t.showId),
  ],
);

export const ingestTrigger = pgEnum("ingest_trigger", [
  "first_lookup",
  "cron",
  "manual",
]);

export const ingestStatus = pgEnum("ingest_status", [
  "running",
  "ok",
  "error",
]);

/**
 * Hosting log retention is short and outside our control, so every ingest writes a row
 * here. An auth error, a rate limit and an artist with genuinely no setlists must stay
 * three distinguishable things — hence a distinct error_code rather than a bare status.
 */
export const ingestRuns = pgTable("ingest_runs", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  artistId: integer("artist_id").references(() => artists.id, {
    onDelete: "set null",
  }),
  // Kept even when the artist could not be resolved, so a failed lookup is still legible.
  artistQuery: text("artist_query"),

  trigger: ingestTrigger("trigger").notNull(),
  status: ingestStatus("status").notNull(),

  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),

  pagesFetched: integer("pages_fetched").notNull().default(0),
  setlistsUpserted: integer("setlists_upserted").notNull().default(0),
  songsUpserted: integer("songs_upserted").notNull().default(0),

  errorCode: text("error_code"),
  requestLog: jsonb("request_log"),
});
