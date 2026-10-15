"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { parseObjectiveLines } from "@/lib/objectiveLines";

/**
 * What's selected, carried as both forms at once because the two panes this is shared
 * between don't have the same identity available. ObjectiveReviewTable/ObjectiveList/
 * ObjectiveMiddle render `objective_candidates` rows, which have a stable `id` - that's
 * the only field compared when both sides have one, and it's exact, never ambiguous
 * (OBJ-REV-002: the previous text-only comparison truncated to a normalized 40-character
 * prefix and matched by substring, so two distinct objectives sharing an opening phrase -
 * "Understand how price sensitivity..." vs "Understand how service quality..." past
 * position 40 - compared equal, and selecting one could show another's detail record).
 * ObjectiveCoverage/ObjectiveEvidence render `objective_validations`/`objective_evidence`
 * rows, which carry a linked candidate id only when they were written after migration
 * 0081 (see objectiveEvidence.ts) or not at all for `objective_validations`, which has no
 * candidate-id column yet - those fall back to the text, compared exactly (or against the
 * individual lines of a not-yet-split multi-line candidate blob), never by prefix or
 * substring, so an unrelated objective that merely starts the same way cannot match.
 */
type Selected = { id: string | null; text: string } | null;
type Ctx = { selected: Selected; select: (next: { id: string | null; text: string }) => void; clear: () => void };
const SelectionContext = createContext<Ctx>({ selected: null, select: () => {}, clear: () => {} });

export function ObjectiveSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Selected>(null);
  return (
    <SelectionContext.Provider
      value={{
        selected,
        select: (next) =>
          setSelected((cur) => (cur && sameSelection(cur, next) ? null : next)),
        clear: () => setSelected(null),
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

export function useObjectiveSelection() {
  return useContext(SelectionContext);
}

function sameSelection(a: { id: string | null; text: string }, b: { id: string | null; text: string }): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.text.trim() === b.text.trim();
}

/**
 * True when `candidate` (an id plus its text) is the same item as the current selection.
 * Exact id match when the selection has one; otherwise exact text match, including the
 * case where one side is a single line split out of the other's not-yet-divided blob.
 * Deliberately NOT a prefix or substring match - see the module comment above.
 */
export function sameObjective(selected: Selected, candidate: { id?: string | null; text: string }): boolean {
  if (!selected) return false;
  if (selected.id && candidate.id) return selected.id === candidate.id;
  const a = selected.text.trim();
  const b = candidate.text.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return parseObjectiveLines(b).includes(a) || parseObjectiveLines(a).includes(b);
}
