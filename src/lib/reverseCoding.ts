// Reverse-coded battery items (import step 3, Grant 26 October 2026; contract claude/codebook-import.md).
//
// An item worded in the opposite direction to the rest of its battery ("I would not recommend the
// brand" among "I trust the brand", "I like the brand") has to be turned around before the battery's
// means and top-box scores mean anything. The app suggests such items from two separate signs, wording
// and a negative item-rest correlation (the engine's respondent check, _reversal_suggestions); the
// researcher confirms. A confirmed item gets a new derived variable (`<name>_r`) computed by the engine
// on the scale's declared points as (min + max) - code; non-answer codes and blanks are kept as they
// were, and the original column is never changed. The derived variable takes the original's place in its
// battery, so battery tables use it; the original stays available on its own. The confirmation is stored
// on the variable's corrections (documents.variable_overrides) with the evidence it was confirmed on.
import { withTenant } from "./db";
import { cellValue, setCell } from "./rowCells";
import type { VariableDictionary } from "./parseStatsFile";
import type { VariableOverride, VariableOverrides } from "./variableOverrideTypes";

export type ReversalEvidence = {
  /** The wording that suggested it (a negation or negative word in the label), or null. */
  wording: string | null;
  /** Item-rest correlation when it could be computed, else null (never 0). */
  itemRest: number | null;
  cases: number | null;
  /** Whether the app suggested it; false when the researcher reversed an item with no suggestion. */
  suggested: boolean;
};

export type ReverseCoding = { derived: string; min: number; max: number; evidence: ReversalEvidence; confirmedAt: string };

/** What every calculation needs: the source, the derived name and the scale's declared range. */
export type Reversal = { variable: string; derived: string; min: number; max: number };

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** The confirmed reversals in a file's corrections, sorted by variable so the result never depends on storage order. */
export function reversalsOf(overrides: VariableOverrides): Reversal[] {
  return Object.entries(overrides)
    .map(([variable, o]) => ({ variable, r: o.reverse }))
    .filter((x): x is { variable: string; r: ReverseCoding } => !!x.r && typeof x.r.derived === "string" && isFiniteNumber(x.r.min) && isFiniteNumber(x.r.max) && x.r.min < x.r.max)
    .sort((a, b) => a.variable.localeCompare(b.variable))
    .map(({ variable, r }) => ({ variable, derived: r.derived, min: r.min, max: r.max }));
}

/** `<variable>_r`, or the first free `<variable>_r2`, `_r3`... so a derived name never takes an existing variable's name. */
export function derivedNameFor(variable: string, taken: Set<string>): string {
  let name = `${variable}_r`;
  for (let i = 2; taken.has(name); i++) name = `${variable}_r${i}`;
  return name;
}

/**
 * Adds each reversed item's derived variable to the dictionary, and puts it in its battery in place of
 * the original (which stays listed on its own, out of the set). A reversal whose source is not in the
 * file is left out (the engine reports it too). Pure.
 */
export function applyReversals(dict: VariableDictionary, reversals: Reversal[]): VariableDictionary {
  if (reversals.length === 0) return dict;
  const variables = [...dict.variables];
  const sets = (dict.sets ?? []).map((s) => ({ ...s, vars: [...s.vars] }));
  for (const r of reversals) {
    const at = variables.findIndex((v) => v.name === r.variable);
    if (at < 0 || variables.some((v) => v.name === r.derived)) continue;
    const src = variables[at];
    const set = src.inSet ? sets.find((s) => s.key === src.inSet) : undefined;
    variables.splice(at + 1, 0, { ...src, name: r.derived, label: `${src.label || src.name} (reversed)` });
    if (set) {
      set.vars = set.vars.map((v) => (v === r.variable ? r.derived : v));
      const { inSet: _left, ...ungrouped } = src;
      variables[at] = ungrouped;
    }
  }
  return { ...dict, variables, sets };
}

type GridForReversal = { stem: string; items: string[]; points: number[]; reversalSuggestions?: { variable: string; wording: string | null; itemRest: number | null; cases: number }[] };

/**
 * Confirms one item as reversed. The battery and its scale come from the engine's own reading of the
 * file (the respondent check), never from the request: the item must be in a battery the engine found,
 * and the scale's declared points give min and max. The derived name is checked against the file's
 * variables. Written under the document's row lock with the other corrections; confirming an item that
 * is already reversed changes nothing.
 */
export async function confirmReversal(tenantId: string, runId: string, documentId: string, variable: string): Promise<{ derived: string }> {
  const [{ loadRespondentQuality }, { loadFileOwnVariableDictionary }] = await Promise.all([import("./respondentQuality"), import("./crosstabs")]);
  const quality = await loadRespondentQuality(tenantId, runId, documentId);
  const grid = (quality.straightlining.grids as GridForReversal[]).find((g) => g.items.includes(variable));
  if (!grid) throw new Error(`"${variable}" is not in a battery this file was read as having, so it cannot be reversed against one. Nothing was saved.`);
  const points = grid.points.filter(isFiniteNumber);
  if (points.length < 3) throw new Error(`The battery ${grid.stem} has no usable answer scale, so "${variable}" was not reversed. Nothing was saved.`);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const suggestion = grid.reversalSuggestions?.find((s) => s.variable === variable);
  const evidence: ReversalEvidence = suggestion
    ? { wording: suggestion.wording, itemRest: suggestion.itemRest, cases: suggestion.cases, suggested: true }
    : { wording: null, itemRest: null, cases: null, suggested: false };
  const dict = await loadFileOwnVariableDictionary(tenantId, runId, documentId);
  const taken = new Set(dict.variables.map((v) => v.name));
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ variable_overrides: VariableOverrides | null }>(
      "select variable_overrides from documents where id = $1 and run_id = $2 and tenant_id = $3 for update",
      [documentId, runId, tenantId],
    );
    if (r.rows.length === 0) throw new Error("That data file was not found in this project.");
    const current: VariableOverrides = r.rows[0].variable_overrides ?? {};
    const existing = cellValue(current, variable) ?? {};
    const already = existing.reverse;
    if (already) return { derived: already.derived };
    for (const other of reversalsOf(current)) taken.add(other.derived);
    const derived = derivedNameFor(variable, taken);
    const next: VariableOverride = { ...existing, reverse: { derived, min, max, evidence, confirmedAt: new Date().toISOString() } };
    const updated: VariableOverrides = { ...current };
    setCell(updated, variable, next);
    await client.query("update documents set variable_overrides = $1 where id = $2 and run_id = $3", [JSON.stringify(updated), documentId, runId]);
    return { derived };
  });
}

/** Withdraws a reversal: the derived variable goes; tables built with it are marked changed by their corrections snapshot. */
export async function removeReversal(tenantId: string, runId: string, documentId: string, variable: string): Promise<{ removed: boolean }> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ variable_overrides: VariableOverrides | null }>(
      "select variable_overrides from documents where id = $1 and run_id = $2 and tenant_id = $3 for update",
      [documentId, runId, tenantId],
    );
    if (r.rows.length === 0) throw new Error("That data file was not found in this project.");
    const current: VariableOverrides = r.rows[0].variable_overrides ?? {};
    const existing = cellValue(current, variable) ?? {};
    if (!existing.reverse) return { removed: false };
    const { reverse: _gone, ...rest } = existing;
    const updated: VariableOverrides = { ...current };
    if (Object.keys(rest).length === 0) delete updated[variable];
    else setCell(updated, variable, rest);
    await client.query("update documents set variable_overrides = $1 where id = $2 and run_id = $3", [JSON.stringify(updated), documentId, runId]);
    return { removed: true };
  });
}
