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
- [ ] API connection verified (first curl returned 403)
- [ ] Schema
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
parse failure that looks like a broken endpoint. A generic client `User-Agent` may be
rejected, so always send a descriptive one.

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

## Everything in this section is UNVERIFIED

**No successful setlist.fm response has ever been captured.** The first curl returned
`403 Forbidden`. Everything below comes from documentation and third-party wrappers —
not from a payload we have seen. Treat it as a hypothesis to test, never as a spec to
code against.

**First task in this repo: get a successful request, save the response as `sample.json`
in the repo root, then correct this section against it.** After that, `sample.json` is
the source of truth and outranks anything written here. Delete this warning when the
section has been reconciled with a real payload.

### Expected endpoints

- `GET /search/setlists?artistName={name}&p={page}` — setlists by artist name
- `GET /artist/{mbid}/setlists?p={page}` — setlists by MBID, probably the main one
- `GET /search/artists?artistName={name}` — artist lookup
- `GET /setlist/{setlistId}` — a single setlist

### Expected envelope

```
{ "type": "setlists", "itemsPerPage": 20, "page": 1, "total": 1234, "setlist": [...] }
```

Pagination is 20 per page and appears to be fixed.

### Expected setlist object

`id`, `versionId`, `eventDate`, `lastUpdated`, `artist`, `venue`, `tour`, `sets`, `url`,
`info`.

- `artist` — `{ mbid, name, sortName, disambiguation, url }`
- `venue` — `{ id, name, city: { id, name, state, stateCode, coords, country }, url }`
- `tour` — `{ name }`, often absent
- `sets` — `{ set: [ ... ] }`, note the nested `set` key
- each set — optional `name` (e.g. "Acoustic set"), optional `encore` (a number), and
  `song: [ ... ]`
- each song — `name`, optional `info` (free text), optional `cover` (an artist object
  for the original performer), optional `with` (a guest artist), optional `tape`
  (boolean)

### Traps to verify first

**`eventDate` is reportedly `dd-MM-yyyy` — day first.** If true this is the most
dangerous field in the payload: `05-09-2026` parses as May 9th under any US-default
parser and is actually September 5th. Every date before the 13th of a month parses to a
plausible wrong answer. **Verify against a real response before writing any date
handling**, and if confirmed, parse it explicitly rather than handing it to
`new Date()`.

**`tape: true` means the song was played over the PA, not performed.** Walk-out music,
intermission tracks. Exclude these from rotation statistics — a band that plays the same
walk-on track nightly would otherwise look like it has a lock-solid opener it has never
actually performed.

**Setlists can be empty.** A show with no songs entered yet still returns a setlist
object with empty `sets`. Don't treat those as data.

**`tour` is frequently absent**, so tour-based grouping needs a fallback.

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
