import { barWidth, count, EM_DASH, rowWeight, type RowWeight } from "@/lib/format.ts";
import type { SetlistEntry } from "@/lib/queries/show.ts";

/**
 * A setlist row, in one of five weights.
 *
 * Significance is never carried by colour alone: size, font weight, background, left edge
 * and colour all move together, so the hierarchy survives with hue removed. Thresholds
 * are on gap AT THE TIME OF PLAY, not gap today.
 *
 * Tape rows are shown, not hidden — a song that went out over the PA is part of the night
 * even though it is excluded from every statistic.
 */

type Style = {
  nameSize: string;
  nameWeight: number;
  nameColor: string;
  numClass: string;
  numColor: string;
  fill: string | null;
  edge: string;
  bg: string;
  subColor: string;
};

const STYLES: Record<RowWeight, Style> = {
  routine: {
    nameSize: "15px",
    nameWeight: 500,
    nameColor: "var(--color-text-primary)",
    numClass: "t-numeric-row-routine",
    numColor: "var(--color-text-quaternary)",
    fill: "var(--color-fill-routine)",
    edge: "3px solid transparent",
    bg: "transparent",
    subColor: "var(--color-text-secondary)",
  },
  notable: {
    nameSize: "15.5px",
    nameWeight: 500,
    nameColor: "var(--color-text-primary)",
    numClass: "t-numeric-row-notable",
    numColor: "var(--color-gap-hover)",
    fill: "var(--color-rail-notable)",
    edge: "3px solid var(--color-rail-notable)",
    bg: "transparent",
    subColor: "var(--color-text-secondary)",
  },
  bust: {
    nameSize: "19px",
    nameWeight: 700,
    nameColor: "var(--color-text-primary)",
    numClass: "t-numeric-row-bust",
    numColor: "var(--color-gap)",
    fill: "var(--color-gap)",
    edge: "3px solid var(--color-gap)",
    bg: "var(--color-surface-100)",
    subColor: "var(--color-gap)",
  },
  debut: {
    nameSize: "15.5px",
    nameWeight: 500,
    nameColor: "var(--color-text-primary)",
    numClass: "t-numeric-row-notable",
    numColor: "var(--color-rare)",
    // Dashed rather than solid: a debut has no magnitude, so a full solid bar would read
    // as the largest gap on the page.
    fill: "repeating-linear-gradient(90deg,var(--color-rare) 0 2px,transparent 2px 6px)",
    edge: "3px solid var(--color-rare)",
    bg: "transparent",
    subColor: "var(--color-rare)",
  },
  tape: {
    nameSize: "14px",
    nameWeight: 400,
    nameColor: "var(--color-text-quaternary)",
    numClass: "t-numeric-row-routine",
    numColor: "var(--color-disabled)",
    fill: null,
    edge: "3px dashed var(--color-fill-routine)",
    bg: "transparent",
    subColor: "var(--color-disabled)",
  },
};

function subLine(entry: SetlistEntry, weight: RowWeight): string | null {
  if (weight === "tape") return "over the PA before the set · not performed, not counted";

  const parts: string[] = [];
  if (entry.coverArtist) parts.push(`cover · ${entry.coverArtist}`);
  // No instrument: setlist.fm carries none. See CLAUDE.md.
  if (entry.guestName) parts.push(`with ${entry.guestName}`);
  if (weight === "debut") parts.push("◇ first time in our file");
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function SetlistRow({
  entry,
  position,
  scaleMax,
  index,
  treatAsDebut,
}: {
  entry: SetlistEntry;
  /** 1-based play position. Tape rows take an em dash and consume no number. */
  position: number | null;
  scaleMax: number;
  index: number;
  /** Only true when the artist's backfill is complete — otherwise "first held" is not a debut. */
  treatAsDebut: boolean;
}) {
  const weight = rowWeight({
    gap: entry.gapThatNight,
    isTape: entry.isTape,
    isDebut: treatAsDebut && entry.isFirstHeld,
  });
  const s = STYLES[weight];
  const sub = subLine(entry, weight);

  const numeral =
    weight === "tape"
      ? { value: "PA", unit: "" }
      : weight === "debut"
        ? { value: "1st", unit: "ever" }
        : {
            value: count(entry.gapThatNight),
            unit: weight === "bust" ? "shows out" : "out",
          };

  const width =
    weight === "debut" ? 100 : weight === "tape" ? 0 : barWidth(entry.gapThatNight, scaleMax);

  return (
    <li
      className="flex items-start gap-4 border-b border-divider px-4 py-3 last:border-b-0"
      style={{ borderLeft: s.edge, background: s.bg }}
    >
      <span
        className="t-metadata w-6 shrink-0 pt-1 text-right"
        style={{ color: weight === "tape" ? "var(--color-disabled)" : "var(--color-text-quaternary)" }}
      >
        {position ?? EM_DASH}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: s.nameSize,
            fontWeight: s.nameWeight,
            color: s.nameColor,
            lineHeight: 1.3,
          }}
        >
          {entry.name}
        </span>
        {sub ? (
          <span className="mt-1 block t-metadata" style={{ color: s.subColor }}>
            {sub}
          </span>
        ) : null}

        {/* Bar under the title on every width: the name never truncates against it. */}
        {s.fill && width > 0 ? (
          <span
            className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-gap-track"
            aria-hidden="true"
          >
            <span
              className="block h-full origin-left rounded-full motion-safe:animate-[td-bar-fill_420ms_var(--ease-gap-fill)_both]"
              style={{
                width: `${width}%`,
                background: s.fill,
                animationDelay: index < 8 ? `${index * 24}ms` : "0ms",
              }}
            />
          </span>
        ) : null}
      </span>

      {/* The integer is always printed: the bar is never the value. */}
      <span className="flex shrink-0 flex-col items-end pt-0.5">
        <span
          className={s.numClass}
          style={{ color: s.numColor, fontVariantNumeric: "tabular-nums" }}
        >
          {numeral.value}
        </span>
        {numeral.unit ? (
          <span className="t-label-sm" style={{ color: "var(--color-text-quaternary)" }}>
            {numeral.unit}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** The legend above a setlist. Explains the weights without relying on colour. */
export function RowLegend() {
  const items: Array<[RowWeight, string]> = [
    ["bust", "100+ shows out"],
    ["notable", "40–99"],
    ["routine", "routine"],
    ["debut", "debut or cover"],
    ["tape", "PA, not performed"],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map(([w, label]) => (
        <li key={w} className="flex items-center gap-2">
          <span
            className="h-3 w-[3px] rounded-full"
            style={{
              background:
                w === "tape" ? "var(--color-disabled)" : (STYLES[w].fill ?? "transparent"),
            }}
            aria-hidden="true"
          />
          <span className="t-metadata text-text-quaternary">{label}</span>
        </li>
      ))}
    </ul>
  );
}
