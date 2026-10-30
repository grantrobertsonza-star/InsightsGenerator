// The Audience and Media pages of the brand tracking dashboard (Grant, 29 and 30 October 2026), the parts a screen may
// run: the small-base rule, and the Media page's index, sort and headline worked out from figures the server already
// calculated (trackerAudience.ts). Pure: no reads, no statistics of its own. The significance decision each headline
// names comes from the Cross tab engine's own proportion test (trackerAudience.mediaTests); this module only words it.
// Contract: claude/d2-design-2026-10-29.md, "D3f Audience & media" (R5 additions).

/** The plan's small-base rule: below 50 flagged, below 30 descriptive only (no inference). By the unweighted count. */
export const SMALL_BASE = 50;
export const NO_INFERENCE_BASE = 30;
export type BaseLevel = "ok" | "small" | "very_small";
export function smallBaseLevel(n: number): BaseLevel {
  return n < NO_INFERENCE_BASE ? "very_small" : n < SMALL_BASE ? "small" : "ok";
}

/** A figure for one group: its weighted share (percent) and unweighted base, or n/a with the reason. */
export type GroupShare = { share: number | null; base: number | null; reason?: string };
/** One answer of a profile question: the client's brand's recent acquirers and all eligible respondents. */
export type ProfileRow = { key: string; label: string; acquirers: GroupShare; category: GroupShare };

/**
 * The engine's test of one medium, the focal group against the comparison (trackerAudience.mediaTests): "higher" or
 * "lower" when the difference passes at the 5% level, "no_difference" when it was tested and does not, "untested" with
 * the reason (a base too small for the engine to test, or no test run for the page).
 */
export type MediaTest = { status: "higher" | "lower" | "no_difference" } | { status: "untested"; reason: string };
/** One medium on the Media page: the focal group's share, the comparison group's, and the test. */
export type MediaRow = { key: string; label: string; focal: GroupShare; comparison: GroupShare; test: MediaTest };

/**
 * The index of one medium: focal share / comparison share x 100. Withheld (null, with the reason) when either share is
 * unknown, the comparison share is 0 (no ratio), or either group's base is small (below 50 unweighted: the plan's
 * rule; an index magnifies the noise of a small base).
 */
export function mediaIndex(row: Pick<MediaRow, "focal" | "comparison">, focalLevel: BaseLevel | null, comparisonLevel: BaseLevel | null): { index: number | null; reason?: string } {
  if (focalLevel !== "ok" || comparisonLevel !== "ok") return { index: null, reason: "Withheld: a base below 50." };
  if (row.focal.share === null || row.comparison.share === null) return { index: null, reason: row.focal.reason ?? row.comparison.reason ?? "Not available." };
  if (row.comparison.share === 0) return { index: null, reason: "Withheld: the comparison share is 0%." };
  return { index: (row.focal.share / row.comparison.share) * 100 };
}

export type MediaSort = "focal" | "difference";

/**
 * Media rows in display order: by the focal group's share, highest first (the default), or by the difference (focal
 * minus comparison, in points, most over-represented first). Rows without the figure sorted on go last; ties keep the
 * list's order.
 */
export function sortMediaRows(rows: MediaRow[], by: MediaSort): MediaRow[] {
  const keyOf = (r: MediaRow) => (by === "focal" ? r.focal.share : r.focal.share === null || r.comparison.share === null ? null : r.focal.share - r.comparison.share);
  return rows
    .map((r, i) => ({ r, i, k: keyOf(r) }))
    .sort((a, b) => (a.k === null ? (b.k === null ? a.i - b.i : 1) : b.k === null ? -1 : b.k - a.k || a.i - b.i))
    .map((x) => x.r);
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * The Media page's one-line headline: the media where the focal group is clearly higher or lower than the comparison,
 * naming only differences the engine's test passed (MediaRow.test), largest first, at most three each way. "No clear
 * differences" when the test ran and nothing passed. Null (no headline) when either group's base is small (below 50),
 * or when the test did not run: then nothing may be claimed.
 */
export function mediaHeadline(
  rows: MediaRow[],
  focalName: string,
  comparisonName: string,
  focalLevel: BaseLevel | null,
  comparisonLevel: BaseLevel | null,
  testRan: boolean,
): { text: string; higher: string[]; lower: string[] } | null {
  if (!testRan || focalLevel !== "ok" || comparisonLevel !== "ok") return null;
  const gap = (r: MediaRow) => Math.abs((r.focal.share ?? 0) - (r.comparison.share ?? 0));
  const pick = (s: "higher" | "lower") => rows.filter((r) => r.test.status === s && r.focal.share !== null && r.comparison.share !== null).sort((a, b) => gap(b) - gap(a)).slice(0, 3);
  const higher = pick("higher");
  const lower = pick("lower");
  const named = (r: MediaRow) => `${r.label} (${pct(r.focal.share!)} vs ${pct(r.comparison.share!)})`;
  if (higher.length === 0 && lower.length === 0) return { text: `No clear differences in media use between ${focalName} and ${comparisonName}.`, higher: [], lower: [] };
  const parts = [higher.length ? `more likely to use ${list(higher.map(named))}` : null, lower.length ? `less likely to use ${list(lower.map(named))}` : null].filter(Boolean);
  return { text: `${focalName} are ${parts.join(", and ")} than ${comparisonName}.`, higher: higher.map((r) => r.key), lower: lower.map((r) => r.key) };
}
