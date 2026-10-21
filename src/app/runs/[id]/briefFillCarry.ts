import type { RunContextSaveResult } from "@/lib/runContextActions";

type FailedFillResponse = Extract<NonNullable<RunContextSaveResult["fill"]>, { status: "failed" }>;

/**
 * What the Set objectives form knows after its latest save: the save's own result, and a failed
 * fill that could not be recorded (R500-R01, Codex 2026-10-21).
 *
 * A failure that was recorded is read back from storage with every save (`unresolvedFailure`), so
 * it survives ordinary saves and reloads on its own. One that could not be recorded exists only in
 * the response that reported it, so the open form carries it forward: through ordinary saves (no
 * document chosen), until a newer failed fill replaces it or a fill succeeds. A reload cannot bring
 * it back; that limit is shown on the form ("not recorded").
 */
export type BriefFillFormState = {
  result: RunContextSaveResult | null;
  unrecordedFailure: FailedFillResponse | null;
};

export const INITIAL_BRIEF_FILL_FORM_STATE: BriefFillFormState = { result: null, unrecordedFailure: null };

export function nextBriefFillFormState(prev: BriefFillFormState, result: RunContextSaveResult): BriefFillFormState {
  const fill = result.fill;
  if (fill?.status === "failed") return { result, unrecordedFailure: fill.recorded ? null : fill };
  if (fill?.status === "filled") return { result, unrecordedFailure: null };
  return { result, unrecordedFailure: prev.unrecordedFailure };
}
