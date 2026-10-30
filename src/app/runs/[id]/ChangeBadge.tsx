"use client";

// R5 waves: one figure's change against the compared wave, compact. The figure, its test and every reason come from
// src/lib (trackerWaveChange.ts); this component only formats them. A significant change is marked by an arrow and
// bold type with a written label for assistive technology, never by colour alone. A change that could not be tested,
// or whose test failed, says so in its label and tooltip; it is never shown as "not significant".
import type { ChangeTest } from "@/lib/trackerWaveChange";

export type ChangeLike = { changePp: number | null; reason?: string; test?: ChangeTest } | null | undefined;

/** A change in points to one decimal; one that rounds to zero is "±0.0", never "-0.0". */
export function signedPoints(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return "±0.0";
  return `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(1)}`;
}

/** The test's verdict in words, for the label and the tooltip. */
export function testWords(test: ChangeTest | undefined): string {
  if (!test) return "no significance test";
  if (test.status === "untested") return `not tested: ${test.reason}`;
  if (test.status === "failed") return `test not run: ${test.reason}`;
  const p = test.p < 0.001 ? "p < 0.001" : `p = ${test.p.toFixed(3)}`;
  return test.significant ? `significant at 95% (${p})` : `not significant at 95% (${p})`;
}

export function ChangeBadge({
  change,
  against,
  compact = false,
  arrowOnly = false,
  testId = "wave-change",
}: {
  change: ChangeLike;
  against: string | null;
  compact?: boolean;
  /** Only the significance arrow (a shaded cell): the change itself in the label and tooltip. Inherits the colour. */
  arrowOnly?: boolean;
  testId?: string;
}) {
  if (!change || !against) return null;
  if (change.changePp === null) {
    // Not compared: compact cells say nothing visible (the tooltip and label give the reason); rows say so briefly.
    return (
      <span className={compact ? "sr-only" : "text-[11px] text-slate-400"} title={change.reason} data-testid={testId} data-state="not-compared">
        {compact ? `Not compared with ${against}: ${change.reason ?? ""}` : "not compared"}
      </span>
    );
  }
  const sig = change.test?.status === "tested" && change.test.significant;
  const arrow = sig ? (change.test as { direction: number }).direction > 0 ? "▲" : "▼" : "";
  const words = `${signedPoints(change.changePp)} points against ${against}, ${testWords(change.test)}`;
  if (arrowOnly)
    return (
      <span className="ml-1 text-[10px] font-bold" title={words} aria-label={words} role="img" data-testid={testId} data-state={sig ? "significant" : change.test?.status === "tested" ? "not-significant" : (change.test?.status ?? "no-test")}>
        <span aria-hidden="true">{arrow}</span>
      </span>
    );
  return (
    <span
      className={`whitespace-nowrap tabular-nums ${compact ? "text-[10px]" : "text-[11px]"} ${sig ? "font-bold text-slate-900" : "text-slate-500"}`}
      title={change.reason ?? words}
      data-testid={testId}
      data-state={sig ? "significant" : change.test?.status === "tested" ? "not-significant" : (change.test?.status ?? "no-test")}
    >
      <span className="sr-only">{words}</span>
      <span aria-hidden="true">
        {arrow && `${arrow} `}
        {signedPoints(change.changePp)}
        {compact ? "" : " pts"}
        {change.test && change.test.status !== "tested" ? "*" : ""}
      </span>
    </span>
  );
}
