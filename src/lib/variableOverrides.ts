// What a researcher corrects, per variable, about what import inferred: its
// data type (categorical/discrete/continuous) and its question type (single
// answer, multiple response, grid, battery). Read directly off the file at
// import time by default; kept here only where the user has changed it, so
// clearing an override just falls back to the inferred value everywhere it
// is read (the quality report, the crosstab variable picker and engine).
//
// This file touches the database (withTenant/withTenantRead, which import
// pg), so it is server-only. A "use client" component must import the
// shapes and labels from ./variableOverrideTypes instead, never from here -
// importing a runtime value from this file would pull pg into the browser
// bundle.
import { withTenant, withTenantRead } from "./db";
import { cellValue, setCell } from "./rowCells";
import type { VariableType } from "./dataQuality";
import type { VariableDictionary, SetKind } from "./parseStatsFile";
import {
  QUESTION_TYPE_LABEL,
  type QuestionType,
  type VariableOverride,
  type VariableOverrides,
} from "./variableOverrideTypes";

export { QUESTION_TYPE_LABEL, type QuestionType, type VariableOverride, type VariableOverrides };

const VALID_VARIABLE_TYPES = new Set<VariableType>(["categorical", "discrete", "continuous"]);
const VALID_QUESTION_TYPES = new Set<QuestionType>(["single", "multi", "grid", "battery"]);

export async function loadVariableOverrides(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<VariableOverrides> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ variable_overrides: VariableOverrides | null }>(
        "select variable_overrides from documents where id = $1 and run_id = $2",
        [documentId, runId],
      );
      return r.rows[0]?.variable_overrides ?? {};
    });
  } catch (error) {
    // Only the specific, expected shape of failure before migration 0077 is applied
    // (the column itself does not exist yet) falls back to "no overrides saved". Any
    // other failure - a dropped connection, a permissions error, anything unexpected -
    // used to come back indistinguishable from "this document has none", which let
    // calculations quietly proceed as if every saved correction had been cleared.
    // That is wrong in the opposite, more dangerous direction (a transient hiccup
    // erasing real corrections for this one read), so anything else is rethrown.
    const message = error instanceof Error ? error.message : String(error);
    if (/variable_overrides/.test(message) && /column .* does not exist|does not exist/.test(message)) return {};
    throw error;
  }
}

/**
 * Sets or clears one variable's override for one field. Passing `null`
 * clears that field back to the inferred value; a variable left with no
 * fields set is dropped from the stored map entirely, so an untouched file
 * keeps an empty `{}` rather than growing a full copy of its dictionary.
 *
 * A patch that sets (not clears) a field is checked against the file itself before it is
 * saved: the enum value has to be one this app actually understands (a stale client bundle
 * or a hand-built request could otherwise write something no reader expects), the variable
 * has to exist in this document's dictionary, and a question-type correction that groups an
 * otherwise-ungrouped variable (to "multi"/"grid"/"battery") is rejected outright rather than
 * silently accepted and then never applied - see applyQuestionTypeOverrides below for why
 * that direction has no well-defined effect here.
 */
export async function saveVariableOverride(
  tenantId: string,
  runId: string,
  documentId: string,
  variableName: string,
  patch: { type?: VariableType | null; questionType?: QuestionType | null },
): Promise<void> {
  if (patch.type !== undefined && patch.type !== null && !VALID_VARIABLE_TYPES.has(patch.type)) {
    throw new Error(`"${patch.type}" is not a recognised data type.`);
  }
  if (patch.questionType !== undefined && patch.questionType !== null && !VALID_QUESTION_TYPES.has(patch.questionType)) {
    throw new Error(`"${patch.questionType}" is not a recognised question type.`);
  }
  const settingSomething =
    (patch.type !== undefined && patch.type !== null) || (patch.questionType !== undefined && patch.questionType !== null);
  if (settingSomething) {
    // Lazy import: crosstabs.ts imports applyQuestionTypeOverrides from this file, so a
    // top-level import the other way would be circular.
    const { loadVariableDictionary } = await import("./crosstabs");
    let dict: VariableDictionary;
    try {
      dict = await loadVariableDictionary(tenantId, runId, documentId);
    } catch (error) {
      // This dictionary load is the only thing that can confirm the variable actually
      // exists and, for a grouping correction, that it is really in a set. Saving anyway
      // when that check could not run used to mean a correction for a nonexistent
      // variable, or an ungrouped variable set to "multi"/"grid"/"battery" with nothing
      // to group it with, would save successfully during an outage and then silently do
      // nothing (or worse, be read back later as if it meant something). Refusing the
      // save here, rather than treating an unreachable dictionary as "nothing to check
      // against", is what makes the save's success mean what it says.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not verify "${variableName}" against this file right now, so the correction was not saved. Try again. (${message})`);
    }
    const v = dict.variables.find((x) => x.name === variableName);
    if (!v) throw new Error(`"${variableName}" was not found in this file.`);
    if (patch.questionType && patch.questionType !== "single" && !v.inSet) {
      throw new Error(
        `"${variableName}" isn't grouped with other variables, so setting its question type to ${QUESTION_TYPE_LABEL[patch.questionType]} would have no effect here - there's nothing to group it with yet.`,
      );
    }
  }
  await withTenant(tenantId, async (client) => {
    const r = await client.query<{ variable_overrides: VariableOverrides | null }>(
      "select variable_overrides from documents where id = $1 and run_id = $2 for update",
      [documentId, runId],
    );
    // The lookup is the ownership check: a document that does not exist, or exists under a
    // different run, must stop here rather than silently falling back to an empty override
    // map and then writing by document ID alone (which used to let a save for a document
    // outside this run still land, just against whatever that document ID actually is).
    if (r.rows.length === 0) {
      throw new Error("That document was not found in this run.");
    }
    // Variable names are researcher data and any of them can be special to a plain object (TP500-F03):
    // reading current["__proto__"] with no such own entry returns Object.prototype, and assigning
    // updated["__proto__"] = next sets the object's prototype instead of storing the correction, which
    // JSON then drops while the save still reports success. The entry is read as an own property only
    // and written as a defined own property (rowCells.cellValue / setCell), so every name is stored.
    const current: VariableOverrides = r.rows[0].variable_overrides ?? {};
    const existing = cellValue(current, variableName) ?? {};
    const next: VariableOverride = { ...existing };
    if (patch.type === null) delete next.type;
    else if (patch.type !== undefined) next.type = patch.type;
    if (patch.questionType === null) delete next.questionType;
    else if (patch.questionType !== undefined) next.questionType = patch.questionType;

    const updated: VariableOverrides = { ...current };
    if (Object.keys(next).length === 0) delete updated[variableName];
    else setCell(updated, variableName, next);

    // Scoped by run_id too, matching the select above: a write must never reach a document
    // outside the run this call was made for, even if the document ID itself is valid.
    const result = await client.query(
      "update documents set variable_overrides = $1 where id = $2 and run_id = $3",
      [JSON.stringify(updated), documentId, runId],
    );
    if (result.rowCount === 0) {
      throw new Error("That document was not found in this run.");
    }
  });
}

const MIN_SET_SIZE: Record<SetKind, number> = { multi: 2, grid: 3, battery: 3 };

/**
 * Folds question-type overrides into a loaded variable dictionary, so the
 * cross tab tool (and anything else built on loadVariableDictionary) sees
 * the researcher's correction too, not just the Import screen.
 *
 * Two directions are handled differently because they are not symmetric:
 *  - Overriding a grouped variable to "single" is well defined: it is taken
 *    out of its group. If that drops the group below its minimum size (2 for
 *    multiple response, 3 for a grid or battery), the whole group is
 *    dissolved rather than left malformed.
 *  - Overriding a grouped variable's kind (say "grid" to "battery") is also
 *    well defined: since the kind describes the whole group, not just one
 *    member, it is applied to the group as a whole.
 *  - Overriding an UNGROUPED variable to "multi"/"grid"/"battery" has no
 *    well-defined effect here: there is no information about which other
 *    variables it should be grouped with, so it is left ungrouped. Doing
 *    that grouping is a separate feature (picking the other members), not
 *    something one variable's override alone can resolve.
 */
export function applyQuestionTypeOverrides(
  dict: VariableDictionary,
  overrides: VariableOverrides,
): VariableDictionary {
  // Sorted by variable name before anything is applied, so the result never depends on the
  // order the overrides happen to sit in the stored JSON object (itself just whatever order
  // they were saved in over time) - the same set of overrides always resolves the same way.
  const relevant = Object.entries(overrides)
    .filter(([, o]) => o.questionType !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  if (relevant.length === 0) return dict;

  const sets = (dict.sets ?? []).map((s) => ({ ...s, vars: [...s.vars] }));
  const setByKey = new Map(sets.map((s) => [s.key, s]));
  const variables = dict.variables.map((v) => ({ ...v }));
  const byName = new Map(variables.map((v) => [v.name, v]));

  // Tracks which sets already had their kind decided in this pass, so a second (or third...)
  // member asking for a different kind cannot silently override what an earlier member already
  // settled - without this, the loop below would just apply whichever came last.
  const kindDecided = new Set<string>();
  for (const [name, o] of relevant) {
    const v = byName.get(name);
    if (!v || !v.inSet) continue; // not in a set: nothing here can group it (see above)
    const set = setByKey.get(v.inSet);
    if (!set) continue;
    if (o.questionType === "single") {
      set.vars = set.vars.filter((n) => n !== name);
      v.inSet = undefined;
    } else if (!kindDecided.has(set.key)) {
      // Two members of the same set disagreeing on what the group's kind should become is a
      // real conflict, not just one override to apply: since `relevant` is sorted by variable
      // name, the first (alphabetically earliest) member to state a kind for the group is the
      // one that wins, and it wins the same way every time this runs, however many other
      // members also asked for something else. That includes a first member who simply
      // restates the group's current kind: that is still a deliberate "keep it as this" call
      // and has to lock the group the same way a change would, or a later member's differing
      // override could still overturn a choice the first member already settled.
      set.kind = o.questionType;
      kindDecided.add(set.key);
    }
  }

  const survivingKeys = new Set<string>();
  for (const s of sets) {
    if (s.vars.length >= MIN_SET_SIZE[s.kind ?? "multi"]) survivingKeys.add(s.key);
  }
  for (const v of variables) {
    if (v.inSet && !survivingKeys.has(v.inSet)) v.inSet = undefined;
  }

  return { ...dict, variables, sets: sets.filter((s) => survivingKeys.has(s.key)) };
}
