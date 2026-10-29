// A data file's set-up edit that met a concurrent save (Grant's waves, 29 October 2026: a wave label typed into a
// newly imported file was dropped as "changed elsewhere" because the file's first-view acceptance saved at the same
// moment). The edit is re-applied on top of what is saved when the other save changed none of the fields this edit
// changed; it is still a conflict, shown as before, when both changed the same field. A structure change (what a
// case is, layout, method) still asks for acceptance again, judged against what is saved, so a concurrent acceptance
// never carries over a structure the researcher has not checked.
import type { DataSetup } from "./dataSetupShared";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function rebaseSetupEdit(previous: DataSetup, next: DataSetup, current: DataSetup): DataSetup | null {
  const keys = Object.keys(next) as (keyof DataSetup)[];
  const changed = keys.filter((k) => !same(previous[k], next[k]));
  if (changed.length === 0) return null;
  if (changed.some((k) => !same(previous[k], current[k]))) return null;
  const merged = { ...current } as Record<keyof DataSetup, unknown>;
  for (const k of changed) merged[k] = next[k];
  const result = merged as DataSetup;
  const structureChanged = result.unit !== current.unit || result.layout !== current.layout || result.method !== current.method;
  return structureChanged ? { ...result, accepted: false } : result;
}
