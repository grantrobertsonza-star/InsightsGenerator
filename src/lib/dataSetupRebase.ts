// A data file's set-up edit that met a concurrent save (Grant's waves, 29 October 2026: a wave label typed into a
// newly imported file was dropped as "changed elsewhere" because the file's first-view acceptance saved at the same
// moment). The edit is re-applied on top of what is saved when the other save changed none of the fields this edit
// changed; it is still a conflict, shown as before, when both changed the same field.
//
// Acceptance is of a structure (what a case is, layout, method), so it is judged in both directions (Codex E1-F02):
//   - this edit changes the structure: the result asks for acceptance again, whatever the other save accepted;
//   - the other save changed the structure and this edit accepts: the acceptance was given to the structure this
//     researcher saw, not the one now saved, so it is a conflict and the latest version is shown to be reviewed.
// An edit that neither changes the structure nor accepts (a wave label) still merges onto a changed structure, and
// keeps that structure's own acceptance state.
import type { DataSetup } from "./dataSetupShared";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields an acceptance is given to: changing any of them means the file must be reviewed and accepted again. */
export const SETUP_STRUCTURE_KEYS = ["unit", "layout", "method"] as const satisfies readonly (keyof DataSetup)[];
const sameStructure = (a: DataSetup, b: DataSetup) => SETUP_STRUCTURE_KEYS.every((k) => same(a[k], b[k]));

export function rebaseSetupEdit(previous: DataSetup, next: DataSetup, current: DataSetup): DataSetup | null {
  const keys = Object.keys(next) as (keyof DataSetup)[];
  const changed = keys.filter((k) => !same(previous[k], next[k]));
  if (changed.length === 0) return null;
  if (changed.some((k) => !same(previous[k], current[k]))) return null;
  if (next.accepted && changed.includes("accepted") && !sameStructure(previous, current)) return null;
  const merged = { ...current } as Record<keyof DataSetup, unknown>;
  for (const k of changed) merged[k] = next[k];
  const result = merged as DataSetup;
  return sameStructure(result, current) ? result : { ...result, accepted: false };
}

type SaveSetup = (
  setup: DataSetup,
  expected: { kind: "value"; setup: DataSetup },
) => Promise<{ ok: true } | { ok: false; error: string; conflict?: boolean; current?: DataSetup | null }>;

export type SetupEditOutcome =
  | { status: "saved"; setup: DataSetup; savedOver: DataSetup }
  | { status: "conflict"; current: DataSetup | null }
  | { status: "failed"; error: string; current: DataSetup | null };

/**
 * Saves a set-up edit made from `previous` (the version the researcher saw), compare-and-swap; on a conflict, applies
 * the edit once more on top of what is saved when rebaseSetupEdit allows it, and otherwise reports the conflict with
 * what is saved, never the edit. `savedOver` is the version the saved setup replaced (for "was the layout changed").
 * The Setup tab calls this through saveDataSetupAction; tests call it with saveDataSetup itself.
 */
export async function saveSetupEdit(save: SaveSetup, previous: DataSetup, next: DataSetup): Promise<SetupEditOutcome> {
  const first = await save(next, { kind: "value", setup: previous });
  if (first.ok) return { status: "saved", setup: next, savedOver: previous };
  if (!first.conflict) return { status: "failed", error: first.error, current: null };
  const current = first.current ?? null;
  const rebased = current ? rebaseSetupEdit(previous, next, current) : null;
  if (!rebased || !current) return { status: "conflict", current };
  const again = await save(rebased, { kind: "value", setup: current });
  if (again.ok) return { status: "saved", setup: rebased, savedOver: current };
  if (!again.conflict) return { status: "failed", error: again.error, current };
  return { status: "conflict", current: again.current ?? current };
}
