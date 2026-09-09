import Link from "next/link";

import { GapBar } from "@/components/gap.tsx";
import { SearchTypeahead } from "@/components/search.tsx";
import { db } from "@/db";
import { count, EM_DASH, longDate } from "@/lib/format.ts";
import {
  getFeed,
  getHeldBands,
  getLandingCounts,
  type FeedItem,
} from "@/lib/queries/landing.ts";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<FeedItem["kind"], { text: string; tone: string }> = {
  cold_return: { text: "cold return", tone: "var(--color-gap)" },
  sat_in: { text: "sat in", tone: "var(--color-text-tertiary)" },
  cover_debut: { text: "◇ cover debut", tone: "var(--color-rare)" },
  first_time: { text: "◇ first time played", tone: "var(--color-rare)" },
};

export default async function Landing() {
  const [counts, bands, feed] = await Promise.all([
    getLandingCounts(db),
    getHeldBands(db),
    getFeed(db, 10),
  ]);

  const scaleMax = Math.max(24, ...feed.map((f) => f.stat ?? 0));

  return (
    <main className="mx-auto w-full max-w-[1240px] px-5 pb-24 pt-10 md:px-10">
      {/* Static markup: on screen before any request returns. Only the counts, the feed
          and the band grid depend on data. */}
      <header className="max-w-[74ch]">
        <h1 className="t-page-title text-text-primary">
          What bands actually play live
        </h1>
        <p className="mt-4 t-body text-text-secondary">
          Gap, rotation and rarity across every show we hold. We read setlists — song by
          song, night by night — and count what a band is really playing, not what is on
          the record.
        </p>
      </header>

      <div className="mt-6">
        <SearchTypeahead heldCount={counts.bands} seed={bands.slice(0, 3)} />
      </div>

      <p className="mt-4 t-metadata text-text-tertiary">
        {count(counts.bands)} bands · {count(counts.shows)} shows read ·{" "}
        {count(counts.plays)} song plays
      </p>

      {/* What gap means — explained once, with a real number beside it. */}
      <section className="mt-10 max-w-[74ch] rounded-md border border-border bg-surface-100 p-6">
        <h2 className="t-label text-text-quaternary">what gap means</h2>
        <p className="mt-2 t-body text-text-secondary">
          Gap is the number of shows a band has played since a song last appeared — not
          days, not months. The bigger the count, the more overdue it is.
        </p>
      </section>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_360px]">
        {/* ---- Feed ---- */}
        <section className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="t-section-header text-text-primary">This week on stage</h2>
            <p className="t-metadata text-text-quaternary">
              every band we hold · returns, debuts and sit-ins
            </p>
          </div>

          {feed.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {feed.map((f, i) => {
                const kind = KIND_LABEL[f.kind];
                return (
                  <li key={`${f.kind}-${f.showId}-${f.headline}`}>
                    <Link
                      href={`/artist/${f.artistMbid}/show/${f.showId}`}
                      className="block rounded-md border border-border bg-surface-100 p-5 hover:bg-surface-200"
                      style={{ borderLeft: `3px solid ${kind.tone}` }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="t-label" style={{ color: kind.tone }}>
                            {kind.text}
                          </div>
                          <div className="mt-2 t-section-header text-text-primary">
                            {f.headline}
                          </div>
                          <div className="mt-1 t-metadata text-text-tertiary">
                            {f.artistName}
                            {f.note ? ` · ${f.note}` : ""}
                          </div>
                          <div className="mt-1 t-metadata text-text-quaternary">
                            {longDate(f.eventDate)} ·{" "}
                            {[f.venue, f.city, f.state].filter(Boolean).join(", ") ||
                              EM_DASH}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div className="t-numeric-stat" style={{ color: kind.tone }}>
                            {f.kind === "cold_return"
                              ? count(f.stat)
                              : f.kind === "sat_in"
                                ? count(f.stat)
                                : "1st"}
                          </div>
                          <div className="t-label-sm text-text-quaternary">
                            {f.kind === "cold_return"
                              ? "shows since"
                              : f.kind === "sat_in"
                                ? "shows with"
                                : "ever"}
                          </div>
                        </div>
                      </div>

                      {f.kind === "cold_return" ? (
                        <div className="mt-3">
                          <GapBar gap={f.stat} scaleMax={scaleMax} index={i} />
                        </div>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 t-body text-text-secondary">
              Nothing yet. The feed fills as setlists arrive.
            </p>
          )}

          <p className="mt-4 t-metadata text-text-quaternary">
            every return over 40 shows and every sit-in, as setlists arrive. Debuts appear
            once a band&rsquo;s full history has been read — before that, the earliest
            show we hold is not the first time a song was played.
          </p>
        </section>

        {/* ---- Bands we hold ---- */}
        <aside>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-minor-header text-text-primary">Bands we hold</h2>
            <span className="t-metadata text-text-quaternary">
              {count(bands.length)}
            </span>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {bands.map((b) => (
              <li key={b.mbid}>
                <Link
                  href={`/artist/${b.mbid}`}
                  className="block h-full rounded-md border border-border bg-surface-100 p-3 hover:bg-surface-200"
                >
                  <span className="block truncate t-item-title text-text-primary">
                    {b.name}
                  </span>
                  <span className="mt-1 block t-metadata text-text-quaternary">
                    {count(b.shows)} shows
                  </span>
                  <span className="mt-1 block t-numeric text-gap">
                    {b.maxGap === null ? EM_DASH : count(b.maxGap)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 t-metadata text-text-quaternary">
            Anything else is read on demand and kept.
          </p>
        </aside>
      </div>

      <footer className="mt-16 border-t border-border pt-6">
        <p className="t-metadata text-text-quaternary">
          Setlist data from{" "}
          <a
            href="https://www.setlist.fm/"
            className="text-text-tertiary underline hover:text-text-secondary"
            rel="noreferrer"
          >
            setlist.fm
          </a>
          . Non-commercial use.
        </p>
      </footer>
    </main>
  );
}
