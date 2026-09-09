/**
 * Payload types and pure parsers for setlist.fm responses.
 *
 * No I/O. These are shared by the live ingestion pipeline and by
 * scripts/load-sample.mts, deliberately: if the fixture loader had its own copy of the
 * date parser, the fixture would stop proving anything about production.
 *
 * Shapes are verified against sample.json. See CLAUDE.md for what is confirmed and what
 * is still unobserved.
 */

export type ApiArtist = {
  mbid: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  url?: string;
};

export type ApiSong = {
  name: string;
  info?: string;
  tape?: boolean;
  cover?: ApiArtist;
  with?: unknown;
};

export type ApiSet = { name?: string; encore?: number; song?: ApiSong[] };

export type ApiSetlist = {
  id: string;
  versionId?: string;
  eventDate: string;
  lastUpdated?: string;
  artist: ApiArtist;
  venue?: {
    id: string;
    name: string;
    url?: string;
    city?: {
      id?: string;
      name?: string;
      state?: string;
      stateCode?: string;
      country?: { code?: string; name?: string };
      coords?: { lat?: number; long?: number };
    };
  };
  tour?: { name?: string };
  sets: { set?: ApiSet[] };
  url?: string;
  info?: string;
};

/** Envelope for /search/setlists and /artist/{mbid}/setlists. itemsPerPage is 20. */
export type SetlistsEnvelope = {
  type: string;
  itemsPerPage: number;
  page: number;
  total: number;
  setlist?: ApiSetlist[];
};

/**
 * Envelope for /search/artists. Note itemsPerPage is 30 here, NOT 20 — pagination size
 * is not uniform across the API, so never hard-code 20 as a global constant.
 */
export type ArtistsEnvelope = {
  type: string;
  itemsPerPage: number;
  page: number;
  total: number;
  artist?: ApiArtist[];
};

/** Thrown when the payload stops matching what we verified. Maps to PARSE_ERROR. */
export class PayloadShapeError extends Error {}

/**
 * eventDate is dd-MM-yyyy — day first. Proven against sample.json, where twelve of
 * twenty dates have a first component above 12, and where "05-09-2026" means
 * 5 September. new Date() reads that as 9 May, with no error and nothing downstream that
 * looks wrong. Split explicitly; never hand this field to a Date constructor.
 *
 * Returns an ISO yyyy-MM-dd string for the `date` column.
 */
export function parseEventDate(value: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) {
    throw new PayloadShapeError(
      `eventDate is not dd-MM-yyyy: ${JSON.stringify(value)}`,
    );
  }

  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);

  // If setlist.fm ever flips to month-first, this throws on the first date past the 12th
  // rather than silently producing plausible wrong answers for a year.
  if (month < 1 || month > 12) {
    throw new PayloadShapeError(
      `month out of range in eventDate ${value} — the date format may have changed`,
    );
  }
  if (day < 1 || day > 31) {
    throw new PayloadShapeError(`day out of range in eventDate ${value}`);
  }

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * lastUpdated is ISO 8601 with an offset — a DIFFERENT format from eventDate. This is
 * the only date field in the payload that may go through Date parsing, which is exactly
 * why it gets its own function rather than sharing one.
 */
export function parseLastUpdated(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new PayloadShapeError(
      `lastUpdated is not parseable ISO 8601: ${JSON.stringify(value)}`,
    );
  }
  return d;
}

/** "Set 1", "Set 1:" and "Set 2:" are the same concept in the payload. */
export function normaliseSetName(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s*:\s*$/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Non-tape song count. A show of nothing but PA music is not a performed show. */
export function countPerformedSongs(setlist: ApiSetlist): number {
  return (setlist.sets.set ?? []).reduce(
    (n, s) => n + (s.song ?? []).filter((sg) => sg.tape !== true).length,
    0,
  );
}
