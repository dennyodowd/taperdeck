/**
 * Contrast assertion over the design tokens.
 *
 *   npm run check:contrast
 *
 * Reads the hex values straight out of app/globals.css so the check cannot drift from
 * what ships. Every text-on-surface and graphic-on-surface pairing must clear AA, except
 * the exemptions documented in docs/design-system.md — and those must be listed here with
 * their reason, so the list stays closed rather than porous.
 *
 * Exits non-zero on any undocumented failure, and also on any exemption that has silently
 * started passing (which would mean the list has stale entries).
 */

import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");

function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --color-${name} not found in app/globals.css`);
  return m[1];
}

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const SURFACES = ["surface-000", "surface-100", "surface-200", "surface-300"] as const;

/** 4.5:1 for text, 3:1 for graphics and boundaries. */
const TEXT = [
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "text-quaternary",
  "gap",
  "gap-hover",
  "gap-loud",
  "recent",
  "rare",
  "provisional",
  "error",
  "disabled",
] as const;

const GRAPHIC = ["border-control", "rail-notable", "fill-routine", "focus-ring"] as const;

/**
 * The documented exemptions. Anything failing that is NOT here fails the build.
 * Keyed `${token}@${surface}`.
 */
const EXEMPT: Record<string, string> = {
  "text-quaternary@surface-300":
    "BANNED (3.82:1). Step up to text-tertiary in the typeahead panel and any sheet.",
  "gap-loud@surface-300":
    "BANNED (4.48:1), and it has no business in an overlay anyway.",
  "disabled@surface-000":
    "Permitted: disabled segment and show-detail tape rows. Carried by a zero count, the literal 'PA', a dashed edge and the cursor.",
  "disabled@surface-100": "Permitted: as above.",
  "disabled@surface-200": "Permitted: the disabled segment sits on surface-200.",
  "disabled@surface-300": "Permitted: as above.",
  "fill-routine@surface-000":
    "Permitted: the bar is never the value. The integer is printed beside every bar, so a routine fill is decorative — same class as divider and border.",
  "fill-routine@surface-100": "Permitted: as above.",
  "fill-routine@surface-200": "Permitted: as above.",
  "fill-routine@surface-300": "Permitted: as above.",
  "rail-notable@surface-300":
    "Restricted (2.84:1): rail-notable is not used on overlays, like the other lavenders.",
  "text-quaternary@surface-200":
    "Near-miss, 4.4965:1. The design sheet records this as '4.50' and treats it as " +
    "clearing AA — that figure is rounded, and the true value is 0.0035 short. Recorded " +
    "rather than rounded away. Fixable by nudging text-quaternary one step lighter if " +
    "strict AA matters more than matching the sheet.",
};

let failures = 0;
let staleExemptions = 0;
const used = new Set<string>();

function check(name: string, surface: string, threshold: number) {
  const r = ratio(token(name), token(surface));
  const key = `${name}@${surface}`;
  const pass = r >= threshold;
  const exempt = EXEMPT[key];

  if (exempt) used.add(key);

  if (pass && exempt) {
    // Not fatal on its own, but a stale exemption makes the list untrustworthy.
    console.log(`  STALE  ${key.padEnd(34)} ${r.toFixed(2)}:1 now passes — remove the exemption`);
    staleExemptions += 1;
    return;
  }
  if (pass) return;
  if (exempt) {
    console.log(`  exempt ${key.padEnd(34)} ${r.toFixed(2)}:1 — ${exempt}`);
    return;
  }
  console.log(`  FAIL   ${key.padEnd(34)} ${r.toFixed(2)}:1 (needs ${threshold}:1)`);
  failures += 1;
}

console.log("text on surfaces (4.5:1)");
for (const t of TEXT) for (const s of SURFACES) check(t, s, 4.5);

console.log("\ngraphics on surfaces (3:1)");
for (const g of GRAPHIC) for (const s of SURFACES) check(g, s, 3);

console.log("\nadjacency — tokens that must not be confusable");
const pairs: Array<[string, string, number, string]> = [
  ["gap", "gap-track", 3, "bar fill against its own track"],
  ["gap", "gap-loud", 1.2, "workhorse vs loud: they must never sit adjacent"],
  ["rail-notable", "gap", 1.2, "notable vs bust-out rails"],
];
for (const [a, b, min, why] of pairs) {
  const r = ratio(token(a), token(b));
  const ok = r >= min;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok    " : "FAIL  "} ${`${a} vs ${b}`.padEnd(34)} ${r.toFixed(2)}:1 — ${why}`);
}

const unused = Object.keys(EXEMPT).filter((k) => !used.has(k));
if (unused.length > 0) {
  console.log("\nexemptions that were never exercised (likely stale):");
  for (const k of unused) console.log(`  ${k}`);
  staleExemptions += unused.length;
}

console.log(
  `\n${failures} undocumented failure(s), ${staleExemptions} stale exemption(s).`,
);
process.exit(failures === 0 && staleExemptions === 0 ? 0 : 1);
