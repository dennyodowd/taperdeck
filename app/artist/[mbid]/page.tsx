import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AlertMeSoon,
  NoSetlists,
  ProvisionalCallout,
  ProvisionalChip,
  StatBlock,
} from "@/components/data-state.tsx";
import { GapNumeral, ScaleNote } from "@/components/gap.tsx";
import { SongTable } from "@/components/song-table.tsx";
import { db } from "@/db";
import { count, dateRange, EM_DASH, initials, longDate, plural } from "@/lib/format.ts";
import {
  getArtistHeader,
  getArtistStats,
  getGuestSummary,
  getGuests,
  getRecentShows,
  getSongTable,
} from "@/lib/queries/artist.ts";

export const dynamic = "force-dynamic";

export default async function ArtistPage(props: PageProps<"/artist/[mbid]">) {
  const { mbid } = await props.params;

  const artist = await getArtistHeader(db, mbid);
  if (!artist) notFound();

  const [stats, songs, recent, guests, guestSummary] = await Promise.all([
    getArtistStats(db, artist.id),
    getSongTable(db, artist.id),
    getRecentShows(db, artist.id, 6),
    getGuests(db, artist.id),
    getGuestSummary(db, artist.id),
  ]);

  const coldest = songs[0] ?? null;
  const alsoCold = songs.filter(
    (s) => s.songId !== coldest?.songId && (s.currentGap ?? 0) >= 40,
  ).length;

  return (
    <main className="mx-auto w-full max-w-[1240px] px-5 pb-24 pt-8 md:px-10">
      <nav className="t-metadata text-text-tertiary">
        <Link href="/" className="hover:text-text-secondary">
          Taperdeck
        </Link>
        {" / "}
        <span className="text-text-primary">{artist.name}</span>
      </nav>

      <header className="mt-6 border-b border-border pb-8">
        <h1 className="t-page-title text-text-primary">{artist.name}</h1>
        <p className="mt-3 t-metadata text-text-tertiary">
          {count(artist.showsHeld)} shows dated · {count(artist.showsWithSetlists)} with
          setlists · {dateRange(artist.firstShow, artist.lastShow)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!artist.backfillComplete ? (
            <ProvisionalChip firstShow={artist.firstShow} />
          ) : null}
          <AlertMeSoon />
        </div>
      </header>

      {/* Missing history is content, not failure — so it sits at the top, with a real
          count and a ledger, rather than being hidden. */}
      {artist.showsWithSetlists < artist.showsHeld ? (
        <section className="mt-8">
          <NoSetlists
            showsHeld={artist.showsHeld}
            withSetlists={artist.showsWithSetlists}
            firstShow={artist.firstShow}
            lastShow={artist.lastShow}
          />
        </section>
      ) : null}

      <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBlock
          label="shows on file"
          value={count(artist.showsHeld)}
          sub={dateRange(artist.firstShow, artist.lastShow)}
        />
        <StatBlock
          label="longest gap"
          value={artist.longestGap === null ? null : count(artist.longestGap)}
          sub={artist.longestGapSong}
          emptyReason="needs two documented plays of one song"
          accent
        />
        <StatBlock
          label="songs played"
          value={count(stats.songsPlayed)}
          sub={stats.avgPlays ? `${stats.avgPlays} plays each` : undefined}
        />
        <StatBlock
          label="with setlists"
          value={`${count(artist.showsWithSetlists)} / ${count(artist.showsHeld)}`}
          sub="gap counted across these"
        />
      </section>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {/* ---- Cold a long time. The one loud element on this page. ---- */}
          {coldest && (coldest.currentGap ?? 0) > 0 ? (
            <section className="mb-10">
              <h2 className="t-section-header text-text-primary">Cold a long time</h2>
              <div className="mt-1">
                <ScaleNote scaleMax={artist.scaleMax} />
              </div>

              <div className="mt-4 rounded-md border border-border border-l-[3px] border-l-gap bg-surface-100 p-6">
                <div className="t-label text-text-quaternary">coldest on file</div>
                <div className="mt-2 flex flex-wrap items-baseline gap-4">
                  <GapNumeral
                    gap={coldest.currentGap}
                    size="display"
                    loud={(coldest.currentGap ?? 0) >= 100}
                  />
                  <span className="t-label text-text-quaternary">shows since</span>
                </div>
                <p className="mt-3 t-section-header text-text-primary">{coldest.name}</p>
                <p className="mt-1 t-metadata text-text-tertiary">
                  {[
                    plural(coldest.timesPlayed, "play"),
                    coldest.lastPlayed ? `last ${longDate(coldest.lastPlayed)}` : null,
                    [coldest.lastVenue, coldest.lastCity].filter(Boolean).join(", ") || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {alsoCold > 0 ? (
                  <p className="mt-3 t-body text-text-secondary">
                    {count(alsoCold)} more over 40 shows out. The full list below opens on
                    this sort.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* ---- The list ---- */}
          <section>
            <h2 className="sr-only">All songs</h2>
            {songs.length > 0 ? (
              <SongTable
                songs={songs}
                scaleMax={artist.scaleMax}
                artistName={artist.name}
                artistMbid={artist.mbid}
              />
            ) : (
              <p className="t-body text-text-secondary">
                We know {artist.name} has played, but nobody has written down a night. Gap
                needs two documented shows to mean anything.
              </p>
            )}
          </section>
        </div>

        {/* ---- Rail ---- */}
        <aside className="space-y-10">
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="t-minor-header text-text-primary">Recent shows</h2>
              <span className="t-metadata text-text-quaternary">
                all {count(artist.showsHeld)}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {recent.map((s) => (
                <li key={s.showId}>
                  <Link
                    href={`/artist/${mbid}/show/${s.showId}`}
                    className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-surface-100"
                  >
                    <span className="min-w-0">
                      <span className="block t-metadata text-text-secondary">
                        {longDate(s.eventDate)}
                      </span>
                      <span className="block truncate t-metadata text-text-quaternary">
                        {[s.venue, s.city].filter(Boolean).join(", ") || EM_DASH}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block t-numeric text-text-tertiary">
                        {count(s.songs)}
                      </span>
                      <span className="block t-label-sm text-text-quaternary">
                        {s.songs === 1 ? "song" : "songs"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="t-minor-header text-text-primary">Who sits in</h2>
            {guests.length > 0 ? (
              <>
                <p className="mt-1 t-metadata text-text-quaternary">
                  {count(guestSummary.totalAppearances)} appearances across{" "}
                  {count(guestSummary.showsWithGuests)} shows
                </p>
                <ul className="mt-3 space-y-3">
                  {guests.slice(0, 6).map((g) => (
                    <li key={g.mbid} className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-100 t-label-sm text-text-tertiary">
                        {initials(g.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate t-item-title text-text-primary">
                          {g.name}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {/* Guest frequency is a rarity signal on the same axis as gap, so
                            a single appearance takes the rare gold and a hollow marker. */}
                        <span
                          className="block t-numeric"
                          style={{
                            color: g.shows === 1 ? "var(--color-rare)" : "var(--color-gap)",
                          }}
                        >
                          {g.shows === 1 ? "◇ 1" : count(g.shows)}
                        </span>
                        <span className="block t-label-sm text-text-quaternary">
                          {g.shows === 1 ? "once" : "shows"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {guests.length > 6 ? (
                  <p className="mt-3 t-metadata text-text-quaternary">
                    and {count(guests.length - 6)} more who sat in
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 t-body text-text-secondary">
                No one has sat in across these {count(artist.showsWithSetlists)} shows.
              </p>
            )}
          </section>

          {!artist.backfillComplete ? (
            <ProvisionalCallout
              firstShow={artist.firstShow}
              showsHeld={artist.showsHeld}
              totalReported={artist.totalReported}
              size="sm"
            />
          ) : null}
        </aside>
      </div>
    </main>
  );
}
