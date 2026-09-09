/**
 * The number rules from the design system, in one place.
 *
 * These are not cosmetic. "Numbers never round or abbreviate", "gap 0 renders as last
 * night, never 0", and "unknown renders as an em dash, never 0" all exist because 0 is a
 * real gap value — a song played last night — and using it to mean "we don't know" makes
 * a wrong answer look like a fact.
 *
 * See docs/design-system.md.
 */

export const EM_DASH = "—";

/** Row-weight thresholds, on gap at the time of play. */
export const BUST_OUT_THRESHOLD = 100;
export const NOTABLE_THRESHOLD = 40;

export type RowWeight = "routine" | "notable" | "bust" | "debut" | "tape";

export function rowWeight(opts: {
  gap: number | null;
  isTape: boolean;
  isDebut: boolean;
}): RowWeight {
  if (opts.isTape) return "tape";
  if (opts.isDebut || opts.gap === null) return "debut";
  if (opts.gap >= BUST_OUT_THRESHOLD) return "bust";
  if (opts.gap >= NOTABLE_THRESHOLD) return "notable";
  return "routine";
}

/**
 * Never abbreviated, never rounded: 219 not 220, 357 not 350+.
 * Thousands separators are fine — they don't change the value.
 */
export function count(n: number | null | undefined): string {
  if (n === null || n === undefined) return EM_DASH;
  return n.toLocaleString("en-GB");
}

/**
 * Gap as a fan reads it. 0 is "last night" — never the digit 0 — and unknown is an em
 * dash. The two must stay distinguishable.
 */
export function gapText(gap: number | null | undefined): {
  value: string;
  unit: string;
  isRecent: boolean;
  isUnknown: boolean;
} {
  if (gap === null || gap === undefined) {
    return { value: EM_DASH, unit: "", isRecent: false, isUnknown: true };
  }
  if (gap === 0) {
    return { value: "last night", unit: "", isRecent: true, isUnknown: false };
  }
  return {
    value: count(gap),
    unit: gap === 1 ? "show since" : "shows since",
    isRecent: gap <= 2,
    isUnknown: false,
  };
}

/**
 * Bar width as a percentage of the artist's own scale.
 *
 * Minimum fill 2% so a gap of 1 is still a visible mark; gap 0 renders NO fill at all,
 * because "played last night" is not a short bar, it is the absence of one.
 */
export function barWidth(gap: number | null | undefined, scaleMax: number): number {
  if (gap === null || gap === undefined || gap <= 0) return 0;
  const pct = Math.round((gap / Math.max(scaleMax, 1)) * 100);
  return Math.min(100, Math.max(2, pct));
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * `event_date` arrives as an ISO yyyy-MM-dd string from Postgres. Parsed by parts, not
 * by `new Date(str)` — the same discipline the ingestion parser uses, and for the same
 * reason: a timezone shift on a date-only value can move it a day.
 */
function parts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** "12 Jul 2022" */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const p = parts(iso);
  if (!p) return EM_DASH;
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "12 Jul" — for adjacent-show navigation, where the year is already established. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const p = parts(iso);
  if (!p) return EM_DASH;
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

/** "30.08.26" — the show-detail header treatment. */
export function dottedDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const p = parts(iso);
  if (!p) return EM_DASH;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.d)}.${pad(p.m)}.${String(p.y).slice(2)}`;
}

/** "Sunday". Uses UTC so a date-only value cannot drift across a timezone boundary. */
export function weekday(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const p = parts(iso);
  if (!p) return EM_DASH;
  return DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
}

/** "Apr 2019 – Aug 2026" */
export function dateRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (!from || !to) return EM_DASH;
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return EM_DASH;
  return `${MONTHS[a.m - 1]} ${a.y} – ${MONTHS[b.m - 1]} ${b.y}`;
}

/** "since 2019 in our records" — a date range, never a warning. */
export function provisionalSince(iso: string | null | undefined): string {
  const p = iso ? parts(iso) : null;
  return p ? `since ${p.y} in our records` : "partial history in our records";
}

/** Initials for a guest. Never a fake portrait — we hold no photos. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** `plural(1, "song")` → "1 song". Counts are never abbreviated, so this only fixes the noun. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${count(n)} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/** "14th show with Goose" — ordinal, no instrument (the API carries none). */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
