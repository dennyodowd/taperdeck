"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { GapBar, GapNumeral } from "@/components/gap.tsx";
import { AlertMeSoon } from "@/components/data-state.tsx";
import { count, EM_DASH, longDate, plural } from "@/lib/format.ts";
import type { PlayHistoryEntry, SongRow } from "@/lib/queries/artist.ts";

/**
 * The song list.
 *
 * Two axes, two controls, deliberately: filters are a segmented strip, sort is a menu.
 * Mixing them into one control is what makes 357 rows unmanageable.
 *
 * Rows crossfade in place at 180ms and never animate into new positions — reordering
 * hundreds of rows is noise, not feedback.
 */

type SortKey = "gap" | "plays" | "name" | "date";
type FilterKey = "all" | "cold" | "covers" | "rare";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "gap", label: "gap" },
  { key: "plays", label: "times played" },
  { key: "name", label: "song name" },
  { key: "date", label: "last played" },
];

export function SongTable({
  songs,
  scaleMax,
  artistName,
  artistMbid,
}: {
  songs: SongRow[];
  scaleMax: number;
  artistName: string;
  artistMbid: string;
}) {
  const [sort, setSort] = useState<SortKey>("gap");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, PlayHistoryEntry[]>>({});
  const [fading, startFade] = useTransition();

  const counts = useMemo(
    () => ({
      all: songs.length,
      cold: songs.filter((s) => (s.currentGap ?? 0) >= 40).length,
      covers: songs.filter((s) => s.coverArtist).length,
      rare: songs.filter((s) => s.timesPlayed <= 2).length,
    }),
    [songs],
  );

  const rows = useMemo(() => {
    const filtered = songs.filter((s) => {
      if (filter === "cold") return (s.currentGap ?? 0) >= 40;
      if (filter === "covers") return Boolean(s.coverArtist);
      if (filter === "rare") return s.timesPlayed <= 2;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "plays") return b.timesPlayed - a.timesPlayed;
      if (sort === "date") return (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "");
      return (b.currentGap ?? -1) - (a.currentGap ?? -1);
    });
    return sorted;
  }, [songs, filter, sort]);

  async function toggle(songId: number) {
    if (openId === songId) {
      setOpenId(null);
      return;
    }
    setOpenId(songId);
    if (!history[songId]) {
      const res = await fetch(`/api/songs/${songId}/history`);
      if (res.ok) {
        const json = (await res.json()) as { history: PlayHistoryEntry[] };
        setHistory((h) => ({ ...h, [songId]: json.history }));
      }
    }
  }

  const filters: Array<{ key: FilterKey; label: string; n: number }> = [
    { key: "all", label: "all songs", n: counts.all },
    { key: "cold", label: "cold 40+", n: counts.cold },
    { key: "covers", label: "covers", n: counts.covers },
    { key: "rare", label: "played once or twice", n: counts.rare },
  ];

  return (
    <div>
      {/* Filters: a segmented strip. Counts are part of the label so a fan knows the
          size of each pile before tapping. */}
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const selected = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => startFade(() => setFilter(f.key))}
              aria-pressed={selected}
              disabled={f.n === 0}
              className={`rounded-md border px-3 py-2 t-label transition-[background-color,border-color] duration-(--duration-press) ${
                selected
                  ? "border-gap bg-gap text-surface-000"
                  : f.n === 0
                    ? "cursor-not-allowed border-border bg-surface-200 text-disabled"
                    : "border-border-control bg-surface-200 text-text-secondary hover:bg-surface-300"
              }`}
            >
              {f.label} {count(f.n)}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <label className="t-label text-text-quaternary" htmlFor="sort">
            sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => startFade(() => setSort(e.target.value as SortKey))}
            className="rounded-md border border-border-control bg-surface-200 px-3 py-2 t-label text-text-secondary"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* A filter is never silent: the count restates itself. */}
      <p className="mt-3 t-metadata text-text-tertiary" aria-live="polite">
        {count(rows.length)} of {plural(songs.length, "song")}
        {filter !== "all" ? `, filtered to ${filters.find((f) => f.key === filter)?.label}` : ""}
        , sorted by {SORTS.find((s) => s.key === sort)?.label}.
      </p>

      <ul
        className="mt-4 overflow-hidden rounded-md border border-border transition-opacity duration-(--duration-sort)"
        style={{ opacity: fading ? 0.4 : 1 }}
      >
        {rows.map((song, i) => {
          const open = openId === song.songId;
          return (
            <li key={song.songId} className="border-b border-divider last:border-b-0">
              <button
                type="button"
                onClick={() => toggle(song.songId)}
                aria-expanded={open}
                className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-200"
                style={{ borderLeft: open ? "3px solid var(--color-gap)" : "3px solid transparent" }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate t-item-title text-text-primary">
                    {song.name}
                  </span>
                  <span className="mt-0.5 block truncate t-metadata text-text-tertiary">
                    {[
                      song.coverArtist ? `cover · ${song.coverArtist}` : null,
                      `${count(song.timesPlayed)}×`,
                      song.lastPlayed ? longDate(song.lastPlayed) : null,
                      song.lastCity,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-2 block max-w-[240px]">
                    <GapBar gap={song.currentGap} scaleMax={scaleMax} index={i} />
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end">
                  <GapNumeral gap={song.currentGap} />
                  {song.currentGap && song.currentGap > 0 ? (
                    <span className="t-label-sm text-text-quaternary">shows since</span>
                  ) : null}
                </span>
              </button>

              {open ? (
                <div className="border-t border-divider bg-surface-100 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="t-label text-text-quaternary">play history</h3>
                    <AlertMeSoon />
                  </div>
                  {history[song.songId] ? (
                    <ul className="mt-3 space-y-1">
                      {history[song.songId].map((h) => (
                        <li key={h.showId} className="t-metadata text-text-tertiary">
                          <Link
                            href={`/artist/${artistMbid}/show/${h.showId}`}
                            className="text-text-secondary hover:text-text-primary"
                          >
                            {longDate(h.eventDate)}
                          </Link>
                          {" · "}
                          {[h.venue, h.city].filter(Boolean).join(", ") || EM_DASH}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 t-metadata text-text-quaternary">loading…</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {rows.length === 0 ? (
        <p className="mt-4 t-body text-text-secondary">
          No songs match that filter for {artistName}.
        </p>
      ) : null}
    </div>
  );
}
