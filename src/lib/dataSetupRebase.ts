// A data file's set-up edit that met a concurrent save (Grant's waves, 29 October 2026: a wave label typed into a
// newly imported file was dropped as "changed elsewhere" because the file's first-view acceptance saved at the same
// moment). The edit is re-applied on top of what is saved when the other save changed none of the fields this edit
// changed; it is still a conflict, shown as before, when both changed the same field.
//
// Acceptance is of a structure (what a case is, layout, header row, method), so it is judged in both directions (Codex E1-F02):
//   - this edit changes the structure: the result asks for acceptance again, whatever the other save accepted;
//   - the other save changed the structure and this edit accepts: the acceptance was given to the structure this
//     researcher saw, not the one now saved, so it is a conflict and the latest version is shown to be reviewed.
// An edit that neither changes the structure nor accepts (a wave label) still merges onto a changed structure, and
// keeps that structure's own acceptance state.
import type { DataSetup } from "./dataSetupShared";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields an acceptance is given to: changing any of them means the file must be reviewed and accepted again. */
export const SETUP_STRUCTURE_KEYS = ["unit", "layout", "headerRowsSkipped", "method"] as const satisfies readonly (keyof DataSetup)[];
/** The fields that decide how the file is read: changing either reads the stored table again. */
const SETUP_READ_KEYS = ["layout", "headerRowsSkipped"] as const satisfies readonly (keyof DataSetup)[];
const sameStructure = (a: DataSetup, b: DataSetup) => SETUP_STRUCTURE_KEYS.every((k) => same(a[k], b[k]));

/** Whether going from one set-up to another changes what the data is, which asks for acceptance again. The one rule
 * the Import screen's save and the rebase use. */
export function setupStructureChanged(from: DataSetup, to: DataSetup): boolean {
  return !sameStructure(from, to);
}

/** Whether going from one set-up to another changes how the file is read (the layout or the header row), so the
 * stored table is read again. */
export function setupReadChanged(from: DataSetup, to: DataSetup): boolean {
  return SETUP_READ_KEYS.some((k) => !same(from[k], to[k]));
}

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
 * what is saved, never the edit. `savedOver` is the version the saved setup replaced (for "must the file be read again").
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

export type QueuedSetupEditOutcome = SetupEditOutcome & {
  /** True when no edit was made on this file after this one: only then may the screen show this outcome's setup
   * (an earlier edit's answer must not replace a newer edit already on screen). */
  latest: boolean;
};

export type SetupEditQueue = {
  /** Sends one edit, made on `view` (what the screen showed) to `next`, after every earlier edit of this file has
   * been answered. */
  edit(view: DataSetup, next: DataSetup): Promise<QueuedSetupEditOutcome>;
  /** Records what is now known to be saved (the file's first-view acceptance, or what a conflict reported). */
  adopt(saved: DataSetup): void;
};

/**
 * One file's Setup edits, sent one at a time (R3e1, Codex's E1R waves-in-project receipt). Each edit is applied to
 * what the previous edit actually saved, never to the screen's optimistic view of it: before this, a fieldwork month
 * and an inclusion choice made while the wave label's save was still on its way were each sent with that unconfirmed
 * label as the expected value. When the label's save had to be re-applied (the form's view was behind what was saved),
 * the later saves met a value they did not expect, re-applied themselves on a version read before the label landed,
 * conflicted again and were dropped (persisted: wave set, month null, still included).
 *
 * The edit is the fields that differ between `view` and `next`. rebaseSetupEdit applies them to the last known saved
 * version (null, a conflict, when one of those fields was changed by an earlier edit or elsewhere, or when an
 * acceptance was given to a structure that is no longer saved), and saveSetupEdit sends it as a compare-and-swap, so a
 * change made in another tab is still detected. A save that throws (a lost response) is a failed edit, never "saved",
 * and the next edit's compare-and-swap finds out what is stored.
 */
export function createSetupEditQueue(save: SaveSetup, saved: DataSetup | null): SetupEditQueue {
  let known = saved;
  let tail: Promise<unknown> = Promise.resolve();
  let issued = 0;
  const run = async (view: DataSetup, next: DataSetup): Promise<SetupEditOutcome> => {
    const base = known ?? view;
    const changed = (Object.keys(next) as (keyof DataSetup)[]).some((k) => !same(view[k], next[k]));
    if (!changed) return { status: "saved", setup: base, savedOver: base };
    const target = rebaseSetupEdit(view, next, base);
    if (!target) return { status: "conflict", current: base };
    let r: SetupEditOutcome;
    try {
      r = await saveSetupEdit(save, base, target);
    } catch (e) {
      r = { status: "failed", error: e instanceof Error ? e.message : String(e), current: null };
    }
    if (r.status === "saved") known = r.setup;
    else if (r.current) known = r.current;
    return r;
  };
  return {
    edit(view, next) {
      const seq = ++issued;
      const outcome = tail.then(() => run(view, next));
      tail = outcome.catch(() => {});
      return outcome.then((r) => ({ ...r, latest: seq === issued }));
    },
    adopt(setup) {
      known = setup;
    },
  };
}
