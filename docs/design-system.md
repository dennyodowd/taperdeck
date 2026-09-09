# Taperdeck design system v2.0

Token **values** live in `app/globals.css`. This file holds the **rules**, which matter
more — a token used correctly is worth nothing if the rule around it is broken.

Source: the Claude Design project "Taperdeck" (`27c94d72-ee0b-47ad-890e-a4b29ce641d4`),
design system v2 plus three screens. Where a screen and the system disagreed, the
resolution is recorded at the bottom of this file.

---

## The one idea

Gap — shows elapsed since a song was last played — is the number the interface exists to
serve. **It owns the lavender, the tabular mono, and the largest numeral on any screen.**
Everything else is deliberately quiet.

---

## Accent discipline

**Gap is the only thing that gets the accent colour.** Two strengths, and the list is
closed.

- **`gap` `#B79CED` is the workhorse.** A fan sees it hundreds of times per page: every
  row numeral, every bar fill, every cold-song emphasis. Its chroma is held low on
  purpose so a 357-row list doesn't vibrate.
- **`gap-loud` `#AC7DFF` is for genuine standout moments.** Same hue, +70% chroma. **At
  most one element per screen**, and only on a gap in that artist's own top decile — the
  193-show return, the hero numeral. Never in a list row. Never adjacent to the
  workhorse: they sit 1.26:1 apart, so proximity reads as an accident rather than as
  emphasis. Always paired with the 18px halo (`.gap-halo`), which is the signal that
  actually carries at a glance.
- **Only the `display` type role may carry the loud accent.** Not inline text, not a
  heading, not a sentence. It is a display-scale numeral, a halo, and the words "shows
  since" / "shows out".

> **If either lavender appears on a button, a link, a brand mark or a nav item, that is a
> bug.** Buttons are `surface-200` with a `border-control` edge. The only filled element
> on a screen besides a gap bar is the selected segment.

Semantics are teal, green, gold and red — `provisional`, `recent`, `rare`, `error` — and
that list is closed too.

---

## Colour is never load-bearing alone

Every semantic state ships a word or a glyph as well as a hue:

| State | Hue | Second signal — mandatory |
|---|---|---|
| gap | lavender | the printed integer |
| recent | green | "last night" / "2 shows ago" + ● filled dot |
| rare | gold | hollow ◇ + literal count (`1×`) |
| provisional | teal | **1px dashed edge** + "at least" / "since ‹year›" |
| error | red | ✕ glyph + a retry action |

> **Removing all hue must leave the page still readable.**

Selection is a **3px left edge — position, not colour**. Sorted column heads carry a
lavender ▼ *and* announce the sort in the list note for screen readers.

`recent` green means "you will hear this", so it never appears on a song with a
meaningful gap. `error` red is for failure only — **never for "no data"**. Missing
history is *provisional*; conflating the two makes an archive gap look like a bug.

---

## The AA exemptions

`npm run check:contrast` enforces this list against the real token values in
`app/globals.css`. Anything failing that is not listed here fails; anything listed here
that starts passing is reported as stale. The list stays closed by being checked, not by
being asserted.

Three came from the design system. Two were added deliberately when the screens were
implemented, and a sixth was discovered by the check itself — all added to the list
rather than left to drift.

1. **`text-quaternary` `#8A8A8A` on `surface-300` — 3.82:1 — BANNED.**
   Inside the typeahead panel and any sheet, step up to `text-tertiary`.
2. **`gap-loud` `#AC7DFF` on `surface-300` — 4.48:1 — BANNED**, and it has no business in
   an overlay anyway.
3. **Disabled segment `#5A5A5A` — 2.87:1 — permitted**, and only on the segmented
   control, because the disabled state is *also* carried by a zero count and a
   non-interactive cursor.
4. **`#5A5A5A` on show-detail tape rows — 2.87:1 — permitted.** Same token, same
   argument: the state is carried by the literal "PA" in the numeral column, the words
   "over the PA before the set · not performed, not counted", a dashed left edge, and an
   em-dash in place of a position number. Colour is the last of five signals, not the
   first.
5. **`fill-routine` `#3A3A3A` as a bar fill — 1.74:1 on page — permitted.** The system
   states that **the bar is never the value** and prints the integer beside every bar, so
   a routine row's bar is decorative and redundant — the same class as `divider` and
   `border`. **It must never become the sole carrier of a magnitude.**

6. **`text-quaternary` on `surface-200` — 4.4965:1 — a rounding artifact, not a
   decision.** The design sheet records this pairing as "4.50" with no ✕ and treats it as
   clearing AA. The true value is 0.0035 short, which the contrast check caught. It is
   recorded rather than rounded away. If strict AA matters more than matching the sheet,
   nudging `text-quaternary` one step lighter fixes it — the token is used for
   placeholders and unit labels, which the system already says are "never the only
   carrier of a fact".

`border` `#1F1F1F` is separately structural and exempt from 3:1.

**`rail-notable` `#7C6BA8` is not an exemption** — it clears 3:1 on surfaces 000–200
(4.27 / 3.90 / 3.35). It fails on `surface-300` (2.84:1) and carries the same
restriction as the other lavenders. It also sits only 1.99:1 from the workhorse, so hue
must never be the only difference between two rows — which the row-weight rule below
already guarantees.

---

## The three faces

| Face | Job |
|---|---|
| **Space Grotesk** | Display and UI — artist names, song titles, section headers, buttons, labels. Anything short. Its slightly odd geometry gives the product a record-shop character a neutral grotesque would flatten. |
| **Inter** | Body copy, **the moment text runs past two lines** — explainers, empty states, callouts. Space Grotesk gets tiring in paragraphs. |
| **JetBrains Mono** | Every number and every piece of metadata. Monospaced figures are inherently tabular, so gap columns align without further work. |

Every numeric and metadata role declares `font-variant-numeric: tabular-nums`
**explicitly**. JetBrains Mono is fixed-pitch already — the declaration is there so the
alignment survives a fallback to a proportional system font.

---

## Three row weights (show detail)

Significance is never carried by colour alone, and this is the clearest expression of it:
**size, font weight, background, left edge and colour all move together.** Thresholds are
on gap-at-the-time-of-play.

| Weight | Condition | Name | Numeral | Bar fill | Left edge | Background |
|---|---|---|---|---|---|---|
| routine | gap < 40 | 15px / 500 | 13px `text-quaternary` | `fill-routine` | none | none |
| notable | 40–99 | 15.5px / 500 | 16px `gap-hover` | `rail-notable` | 3px `rail-notable` | none |
| bust-out | ≥ 100 | 19px / 700 | 21–24px `gap` | `gap` | 3px `gap` | `surface-100` |
| debut | first ever play | 15.5px / 500 | `1st` / `ever` in `rare` | dashed gold, full | 3px `rare` | none |
| tape | `is_tape` | 14px / 400 `text-quaternary` | `PA` in `disabled` | none | 3px dashed `#3A3A3A` | none |

Unit label is "shows out" for a bust-out, "out" otherwise.

---

## Gap bar

- **Scaled against that artist's own longest gap, never a global maximum.** A full bar
  means "the coldest thing this band has", which is the only comparison a fan is making.
- **Floor of 24**, so a band whose longest gap is 6 doesn't render three-quarter bars for
  a two-show absence.
- **The bar is never the value.** Because the scale moves, the integer is printed beside
  every bar, and each list states its scale in a note above it — "against this band's
  longest, 219 shows".
- Minimum fill 2%, so a gap of 1 is still a visible mark.
- **Gap 0 renders no fill at all**, plus a green ● and the words "last night".

---

## Numbers

- **Never round, never abbreviate.** 219 not 220. 357 not 350+. 34/100 not 34%.
- **Gap 0 renders as "last night", never as `0`.**
- **Unknown renders as an em dash, never as `0`** — 0 is a real gap value and must never
  stand in for "unknown".
- An empty stat block renders an em dash **and a reason**.

---

## Provisional data

Gap counts shows **in Taperdeck**, not shows the band played. Until an artist's backfill
is complete, every gap is a floor.

- Wording is always a date range, never a warning: **"since 2019 in our records"**, not
  "incomplete data".
- The real signal is the **1px dashed edge**; the teal only tints it.
- Once dismissed, the callout persists as a chip beside the shows count. **The caveat is
  never fully removable, because the number is never fully certain.**
- **Missing history is content, not failure.** It gets a heading, a real count and a
  ledger, and it sits at the top of the page rather than being hidden. The error variant
  is visually distinct so the two are never confused.

---

## Motion

Motion exists to show where a number came from or where content went. **Nothing loops,
nothing bounces, nothing animates on scroll.**

- Gap bars fill once on mount (420ms, staggered 24ms for the **first 8 rows only**),
  never on re-sort.
- **Rows do not reorder visibly** on sort — reordering 357 rows is noise, not feedback.
  The list crossfades in place at 180ms.
- Skeletons match their component's exact height so nothing shifts at swap, are never
  shown for under 300ms, and shimmer only one element per group. Shimmer pauses after 10s
  so a stalled request doesn't leave a flashing page.
- **The focus ring is never transitioned** — it must appear on the same frame as the
  keystroke.
- All of it sits behind `prefers-reduced-motion`.

---

## Resolutions where the screens and the system disagreed

Recorded so the reasoning survives:

| Disagreement | Resolution |
|---|---|
| `#7C6BA8` and `#3A3A3A` used but undocumented | **Added as named tokens.** They carry a real semantic weight nothing else covers; the alternative was collapsing three row weights into two. The "closed list" rule governs lavenders and semantics — a mid-tone rail is not an accent. |
| Show detail put `gap-loud` on an inline word in a sentence | **System wins.** Moved to the header's "coldest" stat as a display numeral with halo. Inline in a Space Grotesk sentence is exactly what the one-per-screen rule exists to prevent. |
| `#5A5A5A` used on tape rows, outside its documented scope | **Exemption extended explicitly** (#4 above) rather than left to drift. |
| Provisional teal used on named set labels | **Changed.** Teal means incomplete data. Named sets use `text-tertiary`; encore keeps `rare` gold. |
| Numeral sizes 13/16/24 vs the system's 20/28 | **Screens win.** The progression is load-bearing, so it joins the `numeric` role as named variants. |
| `body{background:#070707}` on all three screens | **Canvas artifact.** Uses `surface-000` `#0A0A0A`. |
