@AGENTS.md

# Taperdeck

Explore what an artist actually plays live. Type a band, see which songs are in
rotation right now, which are rare, how the set changes across a tour, and what they
haven't played in years.

The audience is someone with tickets to a show in three weeks. Public, no accounts, no
email. A stranger should get something interesting within ten seconds of landing.

The interesting output is not "here are their setlists" — setlist.fm already shows
that, better. It's the aggregate: which songs are locks, which rotate, **gap** (how
many shows since a song was last played), covers, guests, and how the current tour
differs from the last one. **Gap is the most distinctive thing here** — a song
returning after 200 shows is the moment fans care about, and it's a number you can only
compute with the full history in one place.

## Status

Bare `create-next-app` scaffold. Nothing product-specific exists.

- [x] Next.js scaffold
- [x] Domain live on Vercel, deploys on push to `main`
- [x] Drizzle + Neon installed
- [x] API connection verified — see `sample.json`
- [x] Schema
- [ ] Ingestion
- [ ] Artist page
- [ ] Landing page

## Stack

Next.js **16.3.4** (App Router), React **19.2.8**, TypeScript 5, Tailwind **v4**,
ESLint 9. Postgres on Neon via `drizzle-orm` + `@neondatabase/serverless`, migrations
with `drizzle-kit`.

Database packages as installed:

- `drizzle-orm` **0.45.2** and `@neondatabase/serverless` **1.1.0** (dependencies)
- `drizzle-kit` **0.31.10** and `dotenv` **17.4.2** (dev dependencies)

`drizzle-kit` runs outside Next.js, so it does not get Next's automatic `.env.local`
loading — that is what `dotenv` is for. Point it at `DATABASE_URL_UNPOOLED`, not
`DATABASE_URL`; migrations cannot run through the Neon pooler.

`npm audit` reports 4 moderate advisories, all the same esbuild dev-server issue
(GHSA-67mh-4wv8-2f99) reached through `drizzle-kit`'s deprecated `@esbuild-kit/*`
dependencies. It is a dev-time-only advisory and `npm audit fix --force` would downgrade
`drizzle-kit`, so it is left alone deliberately. Don't "fix" it without reading it first.

Tailwind v4 is configured CSS-first through `@tailwindcss/postcss`. There is no
`tailwind.config.*` file and one should not be added — v4 configuration lives in
`app/globals.css`.

Layout:

- **No `src/` directory.** `app/` is at the repo root.
- `@/*` maps to `./*` (see `tsconfig.json`), so `@/lib/db` resolves to `./lib/db`.

No email, no auth, no multi-tenancy. Don't add them.

## This is not the Next.js in your training data

`AGENTS.md` is imported at the top of this file. It is generated and re-added by
`next dev`, and its warning is real, not boilerplate — this scaffold already uses APIs
that postdate training data:

- `app/layout.tsx` uses the global `LayoutProps<"/">` type rather than a hand-written
  props interface.
- The caching model has moved on: `.next/types/` includes `cache-life.d.ts`, and the
  bundled docs cover `use cache`, `cacheComponents`, `cacheLife`, and `cacheTag`.

**Read the relevant guide under `node_modules/next/dist/docs/` before writing route
handlers, data-fetching, or caching code.** Useful entry points:

- `01-app/01-getting-started/15-route-handlers.md`
- `01-app/01-getting-started/06-fetching-data.md`
- `01-app/01-getting-started/08-caching.md` and `01-app/03-api-reference/01-directives/use-cache.md`
- `01-app/02-guides/environment-variables.md`

If `AGENTS.md` shows as an uncommitted change, commit it with your work rather than
reverting it — `next dev` only writes it back.

## Environment

Secrets go through `process.env`. **No inline keys, no fallback literals** — a fallback
turns a missing-config error into a silent wrong answer.

`.env.local` (gitignored via `.env*`) holds:

- `DATABASE_URL` — Neon **pooled** connection string, for application queries
- `DATABASE_URL_UNPOOLED` — Neon **direct** connection, for `drizzle-kit` migrations,
  which cannot run through the pooler
- `SETLIST_API_KEY` — setlist.fm

All three are currently populated.

## Data sources

### setlist.fm

Base URL `https://api.setlist.fm/rest/1.0/`. Owned by Live Nation Entertainment.

Required headers on **every** request:

```
x-api-key: <SETLIST_API_KEY>
Accept: application/json
User-Agent: Taperdeck/0.1
```

`Accept` is not optional — **the API returns XML by default.** Omitting it produces a
parse failure that looks like a broken endpoint. Send a descriptive `User-Agent` too;
it is cheap insurance, though see below on what it does and doesn't explain.

**On 403s.** The API sits behind AWS API Gateway, and a rejected key returns exactly
`{"message":"Forbidden"}` — a 23-byte JSON body, not an HTML error page. If you see
that, suspect the key itself, not the `User-Agent`; an edge/WAF block on `User-Agent`
would show `X-Cache: Error from cloudfront` with no `x-amzn-ErrorType`. Run curl with
`-v` and read the response headers before changing anything.

The first 403 in this project was cleared by sending the key **trimmed**: the value in
`.env.local` carried a trailing whitespace byte (37 bytes stored, 36 real). Always strip
whitespace before putting a secret in a header. Note that this was fixed alongside
adding a `User-Agent`, so the two were never isolated — the trailing byte is the more
probable cause given the gateway evidence, but that is a strong inference, not a
controlled result.

**Never put a personal email address in the `User-Agent`.** MusicBrainz asks for contact
info; use the repo URL unless the owner decides otherwise.

**Rate limits: 1,440 requests/day, 2/second.** This is the standard tier and it's what
we have. The 50,000/day tier needs a manual application that forum reports say can take
months. Design for 1,440.

**The key deactivates after a year with no requests**, and reactivation is a slow manual
review. If this project goes dormant, assume the key is dead when it comes back.

**Terms are non-commercial.** Keep attribution and links back to setlist.fm visible on
any page showing their data.

### MusicBrainz

setlist.fm keys artists by **MusicBrainz ID (MBID)** — a UUID, not a name. Resolving
"Radiohead" to an MBID may mean a MusicBrainz lookup first.

MusicBrainz needs no key but enforces roughly **1 request/second** and requires a
`User-Agent` identifying the app with contact info. Violating either gets you blocked.

setlist.fm's own `/search/artists?artistName=` may make MusicBrainz unnecessary.
**Verify which path is better before building around either.**

## Payload shape

`sample.json` in the repo root is the source of truth and outranks anything written
here. It is a verbatim `GET /search/setlists?artistName=Phish&p=1`, captured
**2026-09-09**, HTTP 200, 84,150 bytes.

Read that scope honestly: **it is one page of 20 recent shows by one active touring
band.** Anything it happens to contain is confirmed. Anything it happens *not* to
contain is not thereby disproved — the "not observed here" list below stays defensive
for exactly that reason.

### Endpoints

`GET /search/setlists?artistName={name}&p={page}` is confirmed working. The others are
documented but not yet exercised:

- `GET /artist/{mbid}/setlists?p={page}` — by MBID, probably the main ingestion path
- `GET /search/artists?artistName={name}` — artist lookup
- `GET /setlist/{setlistId}` — a single setlist

Phish's MBID, handy as a test fixture: `e01646f2-2a04-450d-8bf2-0d993082e058`.

### Envelope

```
{ "type": "setlists", "itemsPerPage": 20, "page": 1, "total": 2221, "setlist": [ … ] }
```

`itemsPerPage` is 20, as expected. `total` was **2,221 for Phish on 2026-09-09** — a
time-sensitive figure, pinned per the convention below; it climbs as shows are added.

### Setlist object

All ten expected fields are present: `id`, `versionId`, `eventDate`, `lastUpdated`,
`artist`, `venue`, `tour`, `sets`, `url`, `info`.

- `id` and `versionId` — 8-char strings, and **they differ** (`5b4b5734` vs `g30cad0b`).
  Upsert on `id`; `versionId` tracks edits to the same show.
- `artist` — `{ mbid, name, sortName, disambiguation, url }`, as expected
- `venue` — `{ id, name, url, city: { id, name, state, stateCode, country, coords } }`,
  with `coords` as `{ lat, long }`
- `tour` — `{ name }`, e.g. `{"name": "Summer Tour 2026"}`
- `sets` — `{ set: [ … ] }`. The nested `set` key is real.
- each set — `song: [ … ]`, optional `name`, optional `encore`
- each song — `name`, optional `info`, optional `cover`, optional `tape`

`info` appeared on 15 of 20 setlists and is free text about the show, not the songs
(e.g. `Soundcheck: "My Soul", "My Soul jam"`).

### Confirmed traps

**`eventDate` is `dd-MM-yyyy` — day first. This is settled, not inferred.** Two
independent proofs from `sample.json`: twelve of the twenty dates have a first component
above 12 (`31-07-2026`, `29-07-2026`, …), which cannot be a month; and the page is
strictly descending only when read day-first. The dangerous case is live in the sample —
**`05-09-2026` is in there and it is 5 September 2026**, but `new Date("05-09-2026")`
yields 9 May. Every date before the 13th of a month parses to a plausible wrong answer.
**Split on `-` and construct explicitly. Never hand `eventDate` to `new Date()` or to
`Date.parse`.**

**`lastUpdated` is a different format from `eventDate`** — ISO 8601 with offset
(`2026-09-07T15:32:31.848+0000`). Two date fields, two formats, one object. Do not write
a single shared date parser and point it at both.

**`tape: true` is real and confirms the trap.** One of 337 songs in the sample carries
it: `"The Ed Sullivan Show introduction"`, played over the PA before a Beatles cover.
Exclude `tape` songs from all rotation, gap, and opener statistics — they were not
performed.

**`cover` is common — 71 of 337 songs.** Shape is a full artist object for the original
performer (`{ mbid, name, sortName, disambiguation, url }`), e.g. "Melt the Guns" →
XTC. Common enough that covers need deliberate handling, not an afterthought.

**Set names are inconsistently punctuated.** The sample contains `Set 1`, `Set 1:` and
`Set 2:` — same concept, trailing colon sometimes present. Normalise before grouping or
displaying. 40 of 59 sets were named; `encore` appeared on 19 sets, always the number 1.

### Not observed in this sample — stay defensive

None of these are disproved. A page of recent shows from an active band is the *least*
likely place for any of them to appear.

- **Empty `sets`** — 0 of 20 here, but a newly-added show with no songs entered is
  exactly what the search endpoint would not surface. Keep skipping empty setlists.
- **Absent `tour`** — present on 20 of 20 here, because these are all one named tour.
  Older, one-off, and festival shows are the likely gap. Keep the grouping fallback.
- **`with` (guest artist)** — 0 occurrences in 337 songs, so its shape is still
  undocumented. Assume an artist object like `cover` until a real one is seen, and
  re-check against a payload before building the guest-appearances feature.

## Schema

`db/schema.ts` holds the tables. Two things Drizzle cannot express live in SQL and are
load-bearing — **read them before changing the schema**:

- `drizzle/0000_song_key_function.sql` — `taperdeck_song_key()`, which `songs.match_key`
  is generated from.
- `drizzle/0002_sequencing.sql` — the `shows.show_seq` triggers, the deferrable
  uniqueness constraint, and the three views.

Commands: `npm run db:generate`, `npm run db:migrate`, `npm run db:load-sample`.
`drizzle.config.ts` uses `DATABASE_URL_UNPOOLED`; `db/index.ts` uses the pooled
`DATABASE_URL`.

### Four rules that keep gap correct

**Never write `show_seq` from application code.** It is the per-artist show ordinal that
turns gap from a count over rows into integer subtraction, and a trigger owns it. It is a
full `row_number()` recompute, not an increment, because ingestion fetches recent pages
first and backfills *older* shows later — an appended counter would be wrong the first
time backfill ran.

**Read statistics from `performances_counted`, never from `performances`.** The
`NOT is_tape` filter is baked into the view so forgetting it is unreachable rather than
merely discouraged. `tape` songs went out over the PA and were not performed.

**There is exactly one song normaliser, and it lives in Postgres.** Do not reimplement
`taperdeck_song_key` in TypeScript, even for a quick dedupe — two implementations drift,
and the failure is a wrong gap number with nothing visibly broken. `scripts/load-sample.mts`
resolves names to song ids by asking the database.

**A cover is the same song identity as an original.** One row per `(artist, match_key)`
with the original performer as an attribute. Gap means "shows since *this artist* last
played this". 20 of the 71 covers in `sample.json` are Phish side projects (Trey
Anastasio, TAB, Ghosts of The Forest, Vida Blue); separate identities would exile a chunk
of the band's own repertoire from its own rotation stats.

### Gap is relative to the shows we hold

`current_gap` counts shows **in our database**, not shows that happened. While an
artist's history is only partially ingested, every gap is understated — and it will look
entirely plausible while being wrong. **Do not present a gap as absolute until backfill
for that artist is complete.** Either finish backfill before showing the number, or say
what it is counted against.

### Verification

`npm run db:load-sample` loads the committed `sample.json` and asserts 21 properties
against it — that `05-09-2026` stores as 5 September, that a backfilled older show
renumbers everything beneath it, that an empty setlist consumes no ordinal, that the one
`tape` row is excluded from `song_gap`, and that re-running changes nothing. It is a test
fixture, not the ingestion pipeline: no network, no pagination, no run log.

Note the deliberate off-by-one in those assertions: 192 songs are stored but 191 reach
`song_gap`, and 105 songs were played once but gap sees 104. Both gaps are the same
tape-only row being correctly excluded. If those numbers ever match, the tape filter has
stopped working.

## Architecture: lazy ingestion, then cache

**Never query setlist.fm per visitor.** 1,440 requests/day disappears immediately under
any traffic.

**On first lookup of an artist:** fetch their setlists, store everything including raw
payloads, and serve from our database from then on. Show a loading state — the first
pull is slow and that's fine.

**Cap the initial pull** with a hard maximum page count. Some artists have thousands of
setlists across decades at 20 per page. Fetch the most recent N pages and let a
background job backfill deeper over time.

**A scheduled job refreshes artists we already hold** so touring bands stay current.
Prioritise by recency of last show, not alphabetically.

**Seed a handful of artists before launch** so the landing page shows something without
the visitor typing anything. Pick bands with genuinely variable setlists.

## Conventions

These are carried over deliberately from a previous project. They are not suggestions.

**Store the full raw JSON in a `raw` jsonb column on every ingested record.** Parsing
bugs then get fixed by reprocessing stored data instead of re-fetching against a
rate-limited API. This convention paid for itself twice on the previous project.

**Upsert on the setlist `id`.** Refresh jobs re-fetch the same shows constantly and a
rerun must be a no-op.

**Cap all pagination** with a `MAX_PAGES` constant. Never loop until exhaustion.

**Log every outbound request** — URL, status, page, record count, duration — to both the
console and a durable run-log table.

**Durable run logs.** Hosting log retention is short and outside our control. Every
ingest writes a row with trigger, status, counts, pages fetched, error code, and the
request log.

**Every scheduled job is also callable manually** with a secret in the query string.
Waiting for a cron to test a cron is not workable.

**Fail loudly.** An auth error, a rate limit, and an artist with genuinely no setlists
are three different things. If error handling collapses them into an empty result, a
broken key looks exactly like an obscure band. Throw, return non-2xx, record a distinct
error code.

**Pin any figure that came from a time-sensitive query.** Counts that depend on `now()`
drift, and they drift silently, because the number was correct when it was taken.

**A screenshot is evidence about the screenshot. A DOM measurement is evidence about the
layout.** Don't diagnose a rendering bug from a capture.
