// The tracker type (R5, Grant, 30 October 2026): Durables or FMCG, suggested from the file's per-brand questions with
// the reason, and replaceable by one saved programme choice (trackerDashboard.ts `trackerType`). The type sets which
// funnel stages the brand overview shows by default, and in what order; it never changes which question a stage reads
// (the researcher maps any question to any stage, as before). Pure: types only from trackerRoles.ts, so the screen can
// import the labels. Contract: claude/tracker-roles.md (rule 7a). "Services" may follow; it is not offered yet.
import type { FunnelStage, PerBrandMeasure } from "./trackerRoles";
import { RECENT_WINDOWS, WINDOW_TEXT } from "./trackerWindows";

export const TRACKER_TYPES = ["durables", "fmcg"] as const;
export type TrackerType = (typeof TRACKER_TYPES)[number];
export const TRACKER_TYPE_LABEL: Record<TrackerType, string> = { durables: "Durables", fmcg: "FMCG" };

export function isTrackerType(v: unknown): v is TrackerType {
  return typeof v === "string" && (TRACKER_TYPES as readonly string[]).includes(v);
}

/**
 * The brand overview's stages, in order, for each type (Grant's funnels): Durables reads awareness, consideration,
 * shortlist, first choice, then owner/usage and acquisition; FMCG reads awareness, consideration, ever tried (trial),
 * bought in a window (usage, e.g. P3M) and bought most often (frequent usage, BUMO). With no type (none suggested and
 * none chosen), the overview keeps the list it had before tracker types, so nothing is hidden on a guess.
 */
export const OVERVIEW_STAGES_BY_TYPE: Record<TrackerType, readonly FunnelStage[]> = {
  durables: ["awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition"],
  fmcg: ["awareness", "consideration", "trial", "usage", "frequent_usage"],
};
export const OVERVIEW_STAGES_UNTYPED: readonly FunnelStage[] = ["awareness", "consideration", "shortlist", "first_choice", "trial", "usage", "frequent_usage"];

export function overviewStagesFor(type: TrackerType | null): readonly FunnelStage[] {
  return type ? OVERVIEW_STAGES_BY_TYPE[type] : OVERVIEW_STAGES_UNTYPED;
}

/** The tracker type the questions suggest, and why; `type` null when they settle neither. */
export type TrackerTypeSuggestion = { type: TrackerType | null; reason: string };

type SignalMeasure = Pick<PerBrandMeasure, "label" | "stage" | "window">;

/**
 * Suggested from the recognised stages and windows of the per-brand questions:
 *   - FMCG signals: a purchase or use question in a recent window of 3 months or less (usage, past week, month or
 *     3 months), or a bought-most-often question (frequent usage, "most often", BUMO);
 *   - Durables signals: a shortlist or first choice question, current ownership or use (usage, currently), or an
 *     acquisition in the past 12 months.
 * FMCG when it has an FMCG signal and no shortlist or first choice (those are the considered-purchase funnel);
 * otherwise Durables when it has a Durables signal; otherwise no suggestion, with the reason. A suggestion is only a
 * default: the researcher's saved choice replaces it.
 */
export function suggestTrackerType(measures: SignalMeasure[]): TrackerTypeSuggestion {
  const named = (ms: SignalMeasure[]) => ms.map((m) => `"${m.label}"`).join(", ");
  const recent = measures.filter((m) => m.stage === "usage" && RECENT_WINDOWS.includes(m.window) && m.window !== "past_6_months");
  const most = measures.filter((m) => m.stage === "frequent_usage");
  const considered = measures.filter((m) => m.stage === "shortlist" || m.stage === "first_choice");
  const owned = measures.filter((m) => m.stage === "usage" && m.window === "currently");
  const yearAcquired = measures.filter((m) => m.stage === "acquisition" && m.window === "past_12_months");
  if ((recent.length > 0 || most.length > 0) && considered.length === 0) {
    const parts = [
      recent.length > 0 ? `a purchase or use question in a recent window (${recent.map((m) => `"${m.label}", ${WINDOW_TEXT[m.window]}`).join("; ")})` : null,
      most.length > 0 ? `a bought most often question (${named(most)})` : null,
    ].filter(Boolean);
    return { type: "fmcg", reason: `Suggested from the questions: ${parts.join(" and ")}, and no shortlist or first choice question.` };
  }
  if (considered.length > 0 || owned.length > 0 || yearAcquired.length > 0) {
    const parts = [
      considered.length > 0 ? `a shortlist or first choice question (${named(considered)})` : null,
      owned.length > 0 ? `current ownership or use (${named(owned)})` : null,
      yearAcquired.length > 0 ? `an acquisition in the past 12 months (${named(yearAcquired)})` : null,
    ].filter(Boolean);
    return { type: "durables", reason: `Suggested from the questions: ${parts.join(", ")}.` };
  }
  return { type: null, reason: "The questions do not suggest a type: no recent purchase window or bought most often question (FMCG), and no shortlist, first choice, ownership or 12-month acquisition question (Durables). Choose one." };
}
