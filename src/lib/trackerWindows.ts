// The time window of a per-brand tracker measure (R5, Grant, 30 October 2026: "yes, we need it ... don't want to over
// complicate"): the period a purchase, use or ownership question asks about ("Bought in the past 3 months" is penetration
// in three months, "Ever bought" is trial, "Currently own" is the current base). Read from the question's wording, else
// from its answer labels; never from a variable name's position or a guess. Pure and import-free so the dashboard screen
// can word a stage with its window ("Usage, past 3 months") and apply the same comparison rule as the server.
// Contract: claude/tracker-roles.md (rule 3a); owner of the rule in claude/rules-registry.md.

/** Every window a measure can have. "unknown": the wording and the answer labels state none, or state two. */
export const TIME_WINDOWS = ["past_week", "past_month", "past_3_months", "past_6_months", "past_12_months", "ever", "currently", "unknown"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

/** Short wording of each window, for a tile, a funnel row label, a conversion step or a chart. */
export const WINDOW_TEXT: Record<TimeWindow, string> = {
  past_week: "past week",
  past_month: "past month",
  past_3_months: "past 3 months",
  past_6_months: "past 6 months",
  past_12_months: "past 12 months",
  ever: "ever",
  currently: "currently",
  unknown: "window not stated",
};

/** Windows a purchase or use question counts as recent (FMCG penetration), rather than a 12-month acquisition. */
export const RECENT_WINDOWS: readonly TimeWindow[] = ["past_week", "past_month", "past_3_months", "past_6_months"];

// A stated period, by the words researchers and questionnaires use ("past", "last", "previous" and "in the" before it;
// the P3M-style short forms). Months and weeks are kept apart, so "12 weeks" is three months and "12 months" a year.
const PERIOD = "(?:past|last|previous|recent|latest|in the|within the|during the)";
const SPANS: [Exclude<TimeWindow, "ever" | "currently" | "unknown">, RegExp][] = [
  ["past_week", new RegExp(`\\b(?:p1w|pw)\\b|\\b${PERIOD}\\s+(?:7|seven)\\s+days\\b|\\b${PERIOD}\\s+(?:1\\s+|one\\s+)?week\\b|\\bthis week\\b`, "i")],
  ["past_month", new RegExp(`\\b(?:p1m|p4w|p30d)\\b|\\b${PERIOD}\\s+(?:1\\s+|one\\s+)?month\\b|\\b${PERIOD}\\s+(?:4|four)\\s+weeks\\b|\\b${PERIOD}\\s+(?:30|thirty)\\s+days\\b|\\bthis month\\b`, "i")],
  ["past_3_months", new RegExp(`\\b(?:p3m|p13w|p12w|p90d)\\b|\\b${PERIOD}\\s+(?:3|three)\\s+months?\\b|\\b${PERIOD}\\s+(?:12|13|twelve|thirteen)\\s+weeks\\b|\\b${PERIOD}\\s+(?:90|ninety)\\s+days\\b|\\b${PERIOD}\\s+quarter\\b`, "i")],
  ["past_6_months", new RegExp(`\\b(?:p6m|p26w)\\b|\\b${PERIOD}\\s+(?:6|six)\\s+months?\\b|\\b${PERIOD}\\s+(?:26|twenty[- ]six)\\s+weeks\\b|\\b${PERIOD}\\s+(?:180)\\s+days\\b`, "i")],
  ["past_12_months", new RegExp(`\\b(?:p12m|p52w|p1y)\\b|\\b${PERIOD}\\s+(?:12|twelve)\\s+months?\\b|\\b${PERIOD}\\s+(?:1\\s+|one\\s+)?year\\b|\\b${PERIOD}\\s+(?:52|fifty[- ]two)\\s+weeks\\b|\\b${PERIOD}\\s+(?:365)\\s+days\\b|\\b(?:12|twelve)[- ]month\\b`, "i")],
];
const EVER = /\bever\b/i;
/** Owning or using now: "currently", "own", "owner", "use now", "these days", "at present". */
const CURRENTLY = /\b(current(ly)?|nowadays|at present|these days|right now|own|owns|owner|owners|ownership|now)\b/i;

/** The window one piece of wording states, with the words that decided it; null when it states none. */
function windowIn(text: string): { window: TimeWindow; reason: string } | null {
  const spans = SPANS.map(([w, re]) => ({ w, m: re.exec(text) })).filter((x) => x.m);
  const distinct = [...new Set(spans.map((s) => s.w))];
  if (distinct.length > 1) return { window: "unknown", reason: `the wording names more than one period (${spans.map((s) => `"${s.m![0].trim()}"`).join(", ")})` };
  if (distinct.length === 1) return { window: distinct[0], reason: `"${spans[0].m![0].trim()}"` };
  const ever = EVER.exec(text);
  if (ever) return { window: "ever", reason: `"${ever[0]}"` };
  const now = CURRENTLY.exec(text);
  if (now) return { window: "currently", reason: `"${now[0]}"` };
  return null;
}

/**
 * A measure's window: the one its wording (the question with the brand taken out) states; else the one its answer
 * labels state, when they agree on exactly one ("Bought in the past 4 weeks" as the yes answer); else unknown, with
 * the reason. Unknown is never read as any period.
 */
export function windowOf(wording: string, answerLabels: string[] = []): { window: TimeWindow; reason: string } {
  const fromWording = windowIn(wording);
  if (fromWording) return { window: fromWording.window, reason: fromWording.window === "unknown" ? fromWording.reason : `the question says ${fromWording.reason}` };
  const fromLabels = answerLabels.map((l) => windowIn(l)).filter((x): x is { window: TimeWindow; reason: string } => x !== null && x.window !== "unknown");
  const distinct = [...new Set(fromLabels.map((x) => x.window))];
  if (distinct.length === 1) return { window: distinct[0], reason: `its answers say ${fromLabels[0].reason}` };
  if (distinct.length > 1) return { window: "unknown", reason: `its answers name more than one period (${distinct.map((w) => WINDOW_TEXT[w]).join(", ")})` };
  return { window: "unknown", reason: "neither the question nor its answers state a period" };
}

/** Stages whose meaning depends on a period: an unknown window is shown for these ("window not stated"), never hidden. */
const BEHAVIOUR_STAGES = new Set(["trial", "usage", "frequent_usage", "acquisition", "repeat"]);

/**
 * The compact wording after a stage's name: ", past 3 months" for a known window, ", window not stated" for a
 * behaviour stage without one, and nothing for an awareness or opinion stage that states no period.
 */
export function windowSuffix(stage: string | null, window: TimeWindow | null | undefined): string {
  if (!window || (window === "unknown" && !(stage && BEHAVIOUR_STAGES.has(stage)))) return "";
  return `, ${WINDOW_TEXT[window]}`;
}

/**
 * Whether two waves' figures for one stage may be compared: only with the same window (R5). Two unknown windows are
 * treated as the same, since the question (same stage, same variable) states no period in either wave; a known window
 * against an unknown one is not. Returns null when comparable, else the reason, worded for the screen.
 */
export function windowChangeReason(current: TimeWindow, previous: TimeWindow): string | null {
  if (current === previous) return null;
  return `The time window changed (${WINDOW_TEXT[previous]} in the previous wave, ${WINDOW_TEXT[current]} now), so it is not compared.`;
}
