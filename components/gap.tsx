import { barWidth, count, gapText } from "@/lib/format.ts";

/**
 * Gap primitives.
 *
 * Three rules from docs/design-system.md are enforced here rather than left to callers:
 *   - the bar scales to THIS ARTIST'S longest gap, never a global maximum
 *   - the bar is never the value, so the integer is always printed beside it
 *   - gap 0 renders no fill at all, plus a green dot and the words "last night"
 */

export function GapBar({
  gap,
  scaleMax,
  index = 0,
  className = "",
}: {
  gap: number | null;
  scaleMax: number;
  /** Row index. Only the first 8 rows stagger; beyond that the effect is noise. */
  index?: number;
  className?: string;
}) {
  const width = barWidth(gap, scaleMax);

  return (
    <div
      className={`h-[3px] w-full overflow-hidden rounded-full bg-gap-track ${className}`}
      aria-hidden="true"
    >
      {width > 0 && (
        <div
          className="h-full origin-left rounded-full bg-gap motion-safe:animate-[td-bar-fill_420ms_var(--ease-gap-fill)_both]"
          style={{
            width: `${width}%`,
            animationDelay: index < 8 ? `${index * 24}ms` : "0ms",
          }}
        />
      )}
    </div>
  );
}

/**
 * The printed gap. `loud` is capped at one per screen by convention and is only ever
 * applied to a display-scale numeral — never inline in a sentence.
 */
export function GapNumeral({
  gap,
  loud = false,
  size = "numeric",
}: {
  gap: number | null;
  loud?: boolean;
  size?: "numeric" | "display" | "stat";
}) {
  const g = gapText(gap);

  if (g.isUnknown) {
    return (
      <span className="t-numeric text-text-quaternary" title="not known">
        {g.value}
      </span>
    );
  }

  // Gap 0 is "last night", never the digit 0, and carries the green dot as its second
  // signal so the meaning survives without hue.
  if (g.isRecent && gap === 0) {
    return (
      <span className="t-metadata inline-flex items-center gap-1.5 text-recent">
        <span aria-hidden="true">●</span>
        last night
      </span>
    );
  }

  const cls =
    size === "display"
      ? `t-display ${loud ? "text-gap-loud gap-halo" : "text-gap"}`
      : size === "stat"
        ? `t-numeric-stat ${loud ? "text-gap-loud gap-halo" : "text-gap"}`
        : `t-numeric ${loud ? "text-gap-loud gap-halo" : "text-gap"}`;

  return (
    <span className={cls} style={{ fontVariantNumeric: "tabular-nums" }}>
      {count(gap)}
    </span>
  );
}

/**
 * Every list that draws bars states its own scale, because the scale moves between
 * artists and a bar therefore means nothing on its own.
 */
export function ScaleNote({
  scaleMax,
  longestGapSong,
}: {
  scaleMax: number;
  longestGapSong?: string | null;
}) {
  return (
    <p className="t-metadata text-text-quaternary">
      bars scale against this band&rsquo;s longest, {count(scaleMax)} shows
      {longestGapSong ? ` (${longestGapSong})` : ""}
    </p>
  );
}
