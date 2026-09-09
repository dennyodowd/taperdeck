"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { count } from "@/lib/format.ts";
import type { HeldBand } from "@/lib/queries/landing.ts";

/**
 * Search with typeahead.
 *
 * Fires at 2 characters with a 220ms debounce. The match run is lavender, never bold —
 * weight is reserved for hierarchy.
 *
 * Each result carries its longest gap, so the list previews the product rather than just
 * routing to it. A miss is never a bare "0 results": it offers to read the band's history,
 * with the dashed provisional edge, because a band we don't hold is missing data, not a
 * failure.
 */
export function SearchTypeahead({
  heldCount,
  seed,
}: {
  heldCount: number;
  /** Shown when the field is focused but empty — an empty focused field is where people abandon. */
  seed: HeldBand[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<HeldBand[] | null>(null);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const trimmed = q.trim();

  // Clearing on a too-short query happens in the change handler, not here: resetting
  // state synchronously inside an effect causes a cascading render.
  function onChange(value: string) {
    setQ(value);
    if (value.trim().length < 2) {
      setResults(null);
      setPending(false);
    }
  }

  // Query fires at 2 characters, 220ms debounce.
  useEffect(() => {
    if (trimmed.length < 2) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      setPending(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const json = (await res.json()) as { results: HeldBand[] };
        if (!cancelled) setResults(json.results);
      } finally {
        if (!cancelled) setPending(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trimmed]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function readHistory() {
    setReading(trimmed);
    setError(null);
    try {
      const res = await fetch("/api/artists/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        artist?: { mbid: string };
        error?: string;
        message?: string;
      };
      if (json.ok && json.artist) {
        router.push(`/artist/${json.artist.mbid}`);
        return;
      }
      // An auth failure and an unknown band are different things, and the copy says so.
      setError(
        json.error === "ARTIST_NOT_FOUND"
          ? `No band called “${trimmed}” in the setlist archives. Check the spelling, or try their full name.`
          : (json.message ?? "Something went wrong reading that band."),
      );
    } catch {
      setError("Couldn’t reach the archive. Try again in a moment.");
    } finally {
      setReading(null);
    }
  }

  const shown = trimmed.length < 2 ? seed : (results ?? []);
  const showPanel = open && (shown.length > 0 || trimmed.length >= 2);

  return (
    <div ref={box} className="relative max-w-[560px]">
      <label htmlFor="band-search" className="sr-only">
        Search for a band
      </label>
      <input
        id="band-search"
        type="search"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Search for a band"
        autoComplete="off"
        className="w-full rounded-md border border-border-control bg-surface-200 px-4 py-3 text-text-primary placeholder:text-text-quaternary"
        style={{ fontFamily: "var(--font-display)", fontSize: 15 }}
      />
      {/* The held count sits inside the field: the smallest honest promise the page can
          make, and it tells a first-time visitor the archive is finite before they type. */}
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 t-metadata text-text-quaternary">
        {pending || reading ? "reading…" : `${count(heldCount)} bands held`}
      </span>

      {showPanel ? (
        <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-md border border-border bg-surface-300 shadow-lg">
          {shown.length > 0 ? (
            <ul>
              {shown.map((b) => (
                <li key={b.mbid}>
                  <button
                    type="button"
                    onClick={() => router.push(`/artist/${b.mbid}`)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-200"
                  >
                    <span className="min-w-0">
                      {/* text-tertiary, not quaternary: quaternary is banned on
                          surface-300 at 3.82:1. */}
                      <span className="block truncate t-item-title text-text-primary">
                        <Highlight text={b.name} query={trimmed} />
                      </span>
                      <span className="block t-metadata text-text-tertiary">
                        {count(b.shows)} shows
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block t-numeric text-gap">
                        {b.maxGap === null ? "—" : count(b.maxGap)}
                      </span>
                      <span className="block t-label-sm text-text-tertiary">max gap</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {trimmed.length >= 2 && shown.length === 0 && !pending ? (
            <div className="border-t border-dashed border-provisional/60 p-4">
              <div className="t-label text-provisional">Not in our file yet</div>
              <p className="mt-2 t-body text-text-secondary">
                We can read <strong className="text-text-primary">{trimmed}</strong>’s
                history from the setlist archives now. About 100 shows, five to eight
                seconds. It stays in the file afterwards, for everyone.
              </p>
              {/* Error ships a glyph as well as a hue, and the retry sits directly
                  below it. Colour is never load-bearing alone. */}
              {error ? (
                <p role="alert" className="mt-2 flex gap-2 t-body text-error">
                  <span aria-hidden="true">✕</span>
                  <span>{error}</span>
                </p>
              ) : null}
              <button
                type="button"
                onClick={readHistory}
                disabled={reading !== null}
                className="mt-3 rounded-md border border-border-control bg-surface-200 px-3 py-2 t-label text-text-primary hover:bg-surface-100 disabled:cursor-wait disabled:text-text-tertiary"
              >
                {reading ? `Reading ${reading}…` : "Read their history"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The match run is lavender, not bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (query.length < 2) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-gap">{text.slice(i, i + query.length)}</span>
      {text.slice(i + query.length)}
    </>
  );
}
