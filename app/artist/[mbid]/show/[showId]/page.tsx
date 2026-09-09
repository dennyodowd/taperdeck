import Link from "next/link";
import { notFound } from "next/navigation";

import { GapNumeral } from "@/components/gap.tsx";
import { EmptyState, NoSetlists, ProvisionalChip } from "@/components/data-state.tsx";
import { RowLegend, SetlistRow } from "@/components/setlist-row.tsx";
import { db } from "@/db";
import {
  count,
  dottedDate,
  EM_DASH,
  initials,
  longDate,
  ordinal,
  plural,
  shortDate,
  weekday,
} from "@/lib/format.ts";
import { getArtistHeader } from "@/lib/queries/artist.ts";
import {
  getAdjacentShows,
  getRun,
  getSetlist,
  getShowGuests,
  getShowHeader,
  getShowStats,
} from "@/lib/queries/show.ts";

export const dynamic = "force-dynamic";

/**
 * "The night in one line."
 *
 * Generated from what the data actually supports, which is less than the design's
 * hand-written example. It never claims a set position ("they opened the second set
 * with…") because set names are inconsistent and encores are the only reliably labelled
 * block.
 */
function nightInOneLine(opts: {
  coldest: number | null;
  coldestSong: string | null;
  guests: string[];
  songs: number;
  sets: number;
}): string | null {
  const bits: string[] = [];

  if (opts.coldestSong && opts.coldest !== null && opts.coldest >= 40) {
    bits.push(
      `The coldest thing they played was ${opts.coldestSong}, ${count(opts.coldest)} shows out.`,
    );
  }
  if (opts.guests.length === 1) bits.push(`${opts.guests[0]} sat in.`);
  else if (opts.guests.length > 1) {
    bits.push(`${opts.guests.slice(0, -1).join(", ")} and ${opts.guests.at(-1)} sat in.`);
  }
  if (bits.length === 0 && opts.songs > 0) {
    bits.push(
      `${count(opts.songs)} songs across ${count(opts.sets)} ${opts.sets === 1 ? "set" : "sets"}, nothing far out of rotation.`,
    );
  }
  return bits.length > 0 ? bits.join(" ") : null;
}

export default async function ShowPage(
  props: PageProps<"/artist/[mbid]/show/[showId]">,
) {
  const { mbid, showId } = await props.params;

  const [show, artist] = await Promise.all([
    getShowHeader(db, showId),
    getArtistHeader(db, mbid),
  ]);
  if (!show || !artist || show.artistMbid !== mbid) notFound();

  const [stats, setlist, guests, run, adjacent] = await Promise.all([
    getShowStats(db, showId),
    getSetlist(db, showId),
    getShowGuests(db, showId, show.artistId),
    getRun(db, show.artistId, showId),
    getAdjacentShows(db, show.artistId, show.eventDate),
  ]);

  // "First play in our file" only means "debut" once the whole history is in. Until then
  // it means "earliest page we happened to fetch", which is not the same claim.
  const treatAsDebut = artist.backfillComplete;

  const oneLine = nightInOneLine({
    coldest: stats.coldest,
    coldestSong: stats.coldestSong,
    guests: guests.map((g) => g.name),
    songs: stats.songs,
    sets: stats.sets,
  });

  // Group by set, preserving play order. Position numbers skip tape rows.
  const sets: Array<{ index: number; name: string | null; encore: number | null; rows: typeof setlist }> = [];
  for (const entry of setlist) {
    let bucket = sets.find((s) => s.index === entry.setIndex);
    if (!bucket) {
      bucket = { index: entry.setIndex, name: entry.setName, encore: entry.encore, rows: [] };
      sets.push(bucket);
    }
    bucket.rows.push(entry);
  }
  let played = 0;

  const location = [show.city, show.state].filter(Boolean).join(", ");

  return (
    <main className="mx-auto w-full max-w-[1240px] px-5 pb-24 pt-8 md:px-10">
      {/* Breadcrumb + adjacent shows */}
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <div className="t-metadata text-text-tertiary">
          <Link href="/" className="text-text-tertiary hover:text-text-secondary">
            Taperdeck
          </Link>
          {" / "}
          <Link
            href={`/artist/${mbid}`}
            className="text-text-secondary hover:text-text-primary"
          >
            {show.artistName}
          </Link>
          {" / "}
          <span className="text-text-primary">{longDate(show.eventDate)}</span>
        </div>
        <div className="flex items-center gap-4 t-metadata">
          {adjacent.prev ? (
            <Link
              href={`/artist/${mbid}/show/${adjacent.prev.showId}`}
              className="text-text-tertiary hover:text-text-primary"
            >
              ← {shortDate(adjacent.prev.eventDate)}
              {adjacent.prev.city ? ` · ${adjacent.prev.city}` : ""}
            </Link>
          ) : null}
          {adjacent.next ? (
            <Link
              href={`/artist/${mbid}/show/${adjacent.next.showId}`}
              className="text-text-tertiary hover:text-text-primary"
            >
              {shortDate(adjacent.next.eventDate)}
              {adjacent.next.city ? ` · ${adjacent.next.city}` : ""} →
            </Link>
          ) : null}
        </div>
      </nav>

      {/* Header. Shared with the artist page, so it does not animate between them. */}
      <header className="mt-8 border-b border-border pb-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="t-page-title text-text-primary">{show.artistName}</h1>
            <div className="mt-3 flex flex-wrap items-baseline gap-3">
              <span className="t-numeric text-text-primary">
                {dottedDate(show.eventDate)}
              </span>
              <span className="t-metadata text-text-tertiary">
                {weekday(show.eventDate)}
              </span>
              {show.showSeq ? (
                <span className="t-metadata text-text-quaternary">
                  show {count(show.showSeq)} of {count(show.totalShows)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 t-item-title text-text-secondary">
              {show.venue ?? EM_DASH}
            </p>
            <p className="t-metadata text-text-tertiary">{location || EM_DASH}</p>
          </div>

          {/* The one loud element on this screen: a display numeral with its halo, on a
              top-decile gap. Nothing else here may use gap-loud. */}
          <div className="flex items-end gap-8">
            {/* Nothing written down is UNKNOWN, not zero. 0 songs would be a claim
                about the night; an em dash and a reason is the truth. */}
            <Stat
              label="songs"
              value={show.isPerformed ? count(stats.songs) : null}
              sub={show.isPerformed ? plural(stats.sets, "set") : "not entered"}
            />
            <Stat
              label="guests"
              value={show.isPerformed ? count(stats.guests) : null}
              sub={show.isPerformed ? plural(stats.guestSongs, "song") : "not entered"}
            />
            <div>
              <div className="t-label text-text-quaternary">coldest</div>
              <div className="mt-1">
                <GapNumeral
                  gap={stats.coldest}
                  size="display"
                  loud={stats.coldest !== null && stats.coldest >= 100}
                />
              </div>
              <div className="t-label-sm text-text-quaternary">
                {stats.coldest === null ? "not known" : "shows out"}
              </div>
            </div>
          </div>
        </div>

        {!artist.backfillComplete ? (
          <div className="mt-5">
            <ProvisionalChip firstShow={artist.firstShow} />
          </div>
        ) : null}
      </header>

      {oneLine ? (
        <section className="mt-8">
          <h2 className="t-label text-gap">the night in one line</h2>
          <p className="mt-2 max-w-[60ch] text-text-primary" style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.4, fontWeight: 500 }}>
            {oneLine}
          </p>
        </section>
      ) : null}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px]">
        {/* ---- Setlist ---- */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="t-section-header text-text-primary">Setlist</h2>
            <p className="t-metadata text-text-quaternary">
              gap shown is how it stood that night, not today
            </p>
          </div>

          {show.isPerformed && setlist.length > 0 ? (
            <>
              <div className="mt-4">
                <RowLegend />
              </div>
              <div className="mt-4 overflow-hidden rounded-md border border-border">
                {sets.map((set) => (
                  <div key={set.index}>
                    <div className="flex items-baseline justify-between border-b border-divider bg-surface-100 px-4 py-2">
                      <span
                        className="t-label"
                        style={{
                          color: set.encore
                            ? "var(--color-rare)"
                            : set.name
                              ? "var(--color-text-tertiary)"
                              : "var(--color-gap)",
                        }}
                      >
                        {set.name ?? `Set ${set.index + 1}`}
                      </span>
                      <span className="t-metadata text-text-quaternary">
                        {plural(set.rows.filter((r) => !r.isTape).length, "song")}
                      </span>
                    </div>
                    <ul>
                      {set.rows.map((entry, i) => {
                        const pos = entry.isTape ? null : ++played;
                        return (
                          <SetlistRow
                            key={`${entry.setIndex}-${entry.position}`}
                            entry={entry}
                            position={pos}
                            scaleMax={show.scaleMax}
                            index={i}
                            treatAsDebut={treatAsDebut}
                          />
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 space-y-4">
              <EmptyState heading="Nobody has written this one down">
                The show is documented — date and venue both come from the archives. What
                was played is not.
              </EmptyState>
              <NoSetlists
                showsHeld={artist.showsHeld}
                withSetlists={artist.showsWithSetlists}
                firstShow={artist.firstShow}
                lastShow={artist.lastShow}
              />
            </div>
          )}
        </section>

        {/* ---- Rail ---- */}
        <aside className="space-y-8">
          {guests.length > 0 ? (
            <section>
              <h2 className="t-minor-header text-text-primary">Who sat in</h2>
              <ul className="mt-3 space-y-3">
                {guests.map((g) => (
                  <li key={g.mbid} className="flex items-start gap-3">
                    {/* Initials, never a fake portrait — we hold no photos. */}
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-100 t-label-sm text-text-tertiary">
                      {initials(g.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block t-item-title text-text-primary">{g.name}</span>
                      <span className="block t-metadata text-text-tertiary">
                        {g.showsWithArtist === 1
                          ? `first time with ${show.artistName}`
                          : `${ordinal(g.showsWithArtist)} show with ${show.artistName}`}
                      </span>
                      <span className="block t-metadata text-text-quaternary">
                        {g.songs.join(" · ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {run.length > 1 ? (
            <section>
              <h2 className="t-minor-header text-text-primary">This run</h2>
              <p className="mt-1 t-metadata text-text-quaternary">
                night {count(run.position)} of {count(run.length)}
              </p>
              <ul className="mt-3 space-y-2">
                {run.shows.map((r) => (
                  <li key={r.showId}>
                    <Link
                      href={`/artist/${mbid}/show/${r.showId}`}
                      className={`flex items-baseline justify-between gap-3 rounded-md border px-3 py-2 ${
                        r.isCurrent
                          ? "border-gap/50 bg-surface-100"
                          : "border-border hover:bg-surface-100"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block t-metadata text-text-secondary">
                          {shortDate(r.eventDate)}
                        </span>
                        <span className="block truncate t-metadata text-text-quaternary">
                          {[r.venue, r.city].filter(Boolean).join(", ") || EM_DASH}
                        </span>
                      </span>
                      <span className="t-numeric text-text-tertiary">{count(r.songs)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Link
            href={`/artist/${mbid}`}
            className="inline-block t-label text-gap hover:text-gap-hover"
          >
            all {count(artist.showsHeld)} {show.artistName} shows →
          </Link>
        </aside>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | null;
  sub: string;
}) {
  return (
    <div>
      <div className="t-label text-text-quaternary">{label}</div>
      <div className="mt-1 t-numeric-stat text-text-primary">{value ?? EM_DASH}</div>
      <div className="t-metadata text-text-tertiary">{sub}</div>
    </div>
  );
}
