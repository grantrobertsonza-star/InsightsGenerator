import type { ObjectiveRow } from "./ObjectiveReviewTable";

/**
 * One colour per objective, so the same objective carries the same colour in the left list, the
 * scores table in the middle and its detail card (Grant, 2026-10-26: the table rows are rolled up,
 * and the colour is what tells you which objective a row is). Display only: the colour follows the
 * objective's position in the left list, never its identity in the data.
 */
export const OBJECTIVE_ACCENTS = [
  { bar: "border-l-indigo-400", tint: "bg-indigo-50", softTint: "bg-indigo-50/40", chip: "bg-indigo-100 text-indigo-800" },
  { bar: "border-l-emerald-400", tint: "bg-emerald-50", softTint: "bg-emerald-50/40", chip: "bg-emerald-100 text-emerald-800" },
  { bar: "border-l-amber-400", tint: "bg-amber-50", softTint: "bg-amber-50/40", chip: "bg-amber-100 text-amber-800" },
  { bar: "border-l-sky-400", tint: "bg-sky-50", softTint: "bg-sky-50/40", chip: "bg-sky-100 text-sky-800" },
  { bar: "border-l-rose-400", tint: "bg-rose-50", softTint: "bg-rose-50/40", chip: "bg-rose-100 text-rose-800" },
  { bar: "border-l-violet-400", tint: "bg-violet-50", softTint: "bg-violet-50/40", chip: "bg-violet-100 text-violet-800" },
] as const;

export function objectiveAccent(index: number) {
  return OBJECTIVE_ACCENTS[((index % OBJECTIVE_ACCENTS.length) + OBJECTIVE_ACCENTS.length) % OBJECTIVE_ACCENTS.length];
}

/** The order the left list shows objectives that are not stated lines: accepted first, then AI suggestions; rejected ones are not listed. */
export function orderedObjectives(rows: ObjectiveRow[]): ObjectiveRow[] {
  const order = (r: ObjectiveRow) => (r.status === "accepted" ? 0 : 1) * 2 + (r.source === "ai_suggested" ? 1 : 0);
  return rows.filter((r) => r.status !== "rejected").sort((a, b) => order(a) - order(b));
}

/**
 * Each objective's position in the left list, by candidate id: stated lines first, in their own
 * order (statedIds[i] is the candidate a stated line stands for, or null), then the rest in
 * orderedObjectives order. A rejected row that is not a stated line is not listed, so it has no position and no colour.
 */
export function objectiveListPositions(statedIds: (string | null)[], rows: ObjectiveRow[]): Record<string, number> {
  // A plain object, not a Map, so the server page can hand it to client components.
  const positions: Record<string, number> = {};
  statedIds.forEach((id, i) => {
    if (id && !(id in positions)) positions[id] = i;
  });
  const others = orderedObjectives(rows.filter((r) => !(r.id in positions)));
  others.forEach((r, i) => (positions[r.id] = statedIds.length + i));
  return positions;
}

/**
 * Rows in the left list's order (Grant, 2026-10-26: the scores table listed stated objectives in the
 * order they were stored, so its colours ran out of step with the cards). Rows with a position come by
 * position; any without one (rejected suggestions) follow in orderedObjectives order.
 */
export function inListOrder(rows: ObjectiveRow[], positions: Record<string, number> | undefined): ObjectiveRow[] {
  const ordered = orderedObjectives(rows);
  if (!positions) return ordered;
  const at = (r: ObjectiveRow) => positions[r.id] ?? Number.POSITIVE_INFINITY;
  return ordered.map((r, i) => ({ r, i })).sort((a, b) => at(a.r) - at(b.r) || a.i - b.i).map((x) => x.r);
}

/** Splits "Label: text" or "Label - text" into a short label and the rest. No label if the line has none. */
export function splitObjectiveLabel(text: string): { label: string | null; body: string } {
  const m = text.match(/^(.{3,48}?)\s*(?::|\s[-\u2013\u2014]\s)\s*([\s\S]+)$/);
  if (m && m[1].split(/\s+/).length <= 6) return { label: m[1].trim(), body: m[2].trim() };
  return { label: null, body: text };
}
