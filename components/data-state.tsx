import type { ReactNode } from "react";

import { count, dateRange, EM_DASH, provisionalSince } from "@/lib/format.ts";

/**
 * Components for the states the data is actually in.
 *
 * The governing rule: missing history is CONTENT, not failure. It gets a heading, a real
 * count and a ledger, and it sits at the top of the page rather than being hidden. Error
 * is visually distinct so the two are never confused — conflating them makes an archive
 * gap look like a bug.
 */

export function StatBlock({
  label,
  value,
  sub,
  /** Reason the value is unknown. Required when value is null — an em dash alone is a shrug. */
  emptyReason,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  emptyReason?: string;
  accent?: boolean;
}) {
  const isEmpty = value === null || value === undefined;

  return (
    <div
      className={`rounded-md border border-border bg-surface-100 p-5 ${
        accent ? "border-l-[3px] border-l-gap" : ""
      }`}
    >
      <div className="t-label text-text-quaternary">{label}</div>
      <div className="mt-2 t-numeric-stat text-text-primary">
        {isEmpty ? EM_DASH : value}
      </div>
      {/* Never a bare em dash: 0 is a real value, so "unknown" has to say why. */}
      <div className="mt-1 t-metadata text-text-tertiary">
        {isEmpty ? (emptyReason ?? "not known") : sub}
      </div>
    </div>
  );
}

/**
 * The provisional callout. Wording is always a date range, never a warning —
 * "since 2019 in our records", not "incomplete data". The dashed edge is the real
 * signal; the teal only tints it.
 */
export function ProvisionalCallout({
  firstShow,
  showsHeld,
  totalReported,
  size = "md",
}: {
  firstShow: string | null;
  showsHeld: number;
  totalReported: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const pad = size === "lg" ? "p-6" : size === "sm" ? "p-3" : "p-5";

  return (
    <aside
      className={`rounded-md border border-dashed border-provisional/60 bg-surface-100 ${pad}`}
    >
      <div className="t-label text-provisional">{provisionalSince(firstShow)}</div>
      <p className="mt-2 t-body text-text-secondary">
        We count shows in Taperdeck, not shows the band played. Our file holds{" "}
        {count(showsHeld)}
        {totalReported ? ` of about ${count(totalReported)}` : ""} shows
        {firstShow ? `, beginning ${firstShow.slice(0, 4)}` : ""}. Anything last played
        before that reads as a longer silence than it was, so every gap here is at least
        that many shows.
      </p>
    </aside>
  );
}

/** Persists after the callout is dismissed. The caveat is never fully removable. */
export function ProvisionalChip({ firstShow }: { firstShow: string | null }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-provisional/60 px-2.5 py-1 t-label-sm text-provisional">
      {provisionalSince(firstShow)}
    </span>
  );
}

/** Missing history: a heading, a real count, and a ledger. Not an apology. */
export function NoSetlists({
  showsHeld,
  withSetlists,
  firstShow,
  lastShow,
}: {
  showsHeld: number;
  withSetlists: number;
  firstShow: string | null;
  lastShow: string | null;
}) {
  return (
    <section className="rounded-md border border-dashed border-provisional/60 bg-surface-100 p-6">
      <h2 className="t-minor-header text-text-primary">What we do know</h2>
      <p className="mt-2 t-body text-text-secondary">
        We hold {count(showsHeld)} dates across {dateRange(firstShow, lastShow)}.{" "}
        {count(withSetlists)} of them have a setlist. The other{" "}
        {count(showsHeld - withSetlists)} are confirmed shows with nothing written down.
        Everything counted here is counted across the {count(withSetlists)}.
      </p>
    </section>
  );
}

/** Failure only. Never used for "no data". */
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-error/50 bg-surface-100 p-5"
    >
      <div className="t-label inline-flex items-center gap-2 text-error">
        <span aria-hidden="true">✕</span>
        couldn&rsquo;t load
      </div>
      <p className="mt-2 t-body text-text-secondary">{message}</p>
      {retry ? <div className="mt-3">{retry}</div> : null}
    </div>
  );
}

export function EmptyState({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-100 p-6">
      <h3 className="t-minor-header text-text-primary">{heading}</h3>
      <p className="mt-2 t-body text-text-secondary">{children}</p>
    </div>
  );
}

/**
 * The alert affordance from the designs, rendered honestly.
 *
 * It needs identity and a delivery channel; this project has neither by design (no
 * email, no auth, no multi-tenancy — see CLAUDE.md). Shipping a control that silently
 * does nothing is worse than showing it is not built yet, so it is visibly disabled and
 * says so.
 *
 * Uses `disabled` #5A5A5A under documented AA exemption 3: the state is also carried by
 * the word "soon", the `disabled` attribute and the cursor.
 */
export function AlertMeSoon({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={`inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-border bg-surface-200 px-3 py-2 t-label text-disabled ${className}`}
      title="Not built yet — Taperdeck has no accounts or email."
    >
      Alert me when a cold one returns
      <span className="rounded-full border border-disabled px-1.5 py-0.5 t-label-sm">
        soon
      </span>
    </button>
  );
}
