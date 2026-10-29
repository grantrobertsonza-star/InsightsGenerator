// D2 (Grant, 29 October 2026): a tracker dashboard's configuration is what the app suggests for this wave's
// file (trackerRoles.ts, from trackerInput.ts) with the researcher's saved choices for the programme on top.
// Suggestions and choices stay apart: a choice is never written by a suggestion, and Reset to suggested
// clears the choices only. Choices are carried to a new wave by identity (brand codes, question groups and
// variable names, never labels or positions): a choice the new file supports is applied; one it does not
// (a variable missing, a brand code no longer in the list) is listed as needing a choice and its old value is
// kept, never dropped. Weighting (Grant: "weight by default"): weighted whenever the file has a weight,
// unless the researcher chose unweighted.
// Pure: no reads or writes. Persistence is trackerDashboards.ts.
import type { FunnelStage, TrackerRecognition } from "./trackerRoles";

/** Which recognition rules produced a suggestion, recorded with saved choices. Raise when trackerRoles.ts changes. */
export const TRACKER_ROLE_RULES = "d1-2026-10-29";

const STAGES: readonly FunnelStage[] = ["unaided_awareness", "awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition", "repeat", "rejection", "advertising", "word_of_mouth", "moment"];
const CSM_SINGLE = ["overallSatisfaction", "recommend0to10", "likelyToStay", "likelyToSwitch"] as const;
type CsmSingle = (typeof CSM_SINGLE)[number];

export type TrackerChoices = {
  /** The client's brand, by its code in the brand list. */
  focalBrandCode?: string;
  /** The answer codes the researcher confirmed are not brands (replaces the suggested set when given). */
  nonBrandCodes?: string[];
  /** A question's funnel stage by its group, or null for "not a funnel stage". */
  stages?: Record<string, FunnelStage | null>;
  /** CSM roles by variable name; null for "this file has none". */
  csm?: Partial<Record<CsmSingle, string | null>> & { drivers?: string[] };
  /** false: the researcher chose unweighted. Absent: weighted when the file has a weight. */
  weighted?: boolean;
  /** Charts the researcher hid, by chart id. */
  hidden?: string[];
};

export type ChoiceSource = "suggested" | "chosen";
export type NeedsChoice = { id: string; text: string };

export type ResolvedDashboard = {
  type: TrackerRecognition["type"];
  brands: { code: string; label: string }[];
  nonBrandCodes: { code: string; label: string; source: ChoiceSource }[];
  focalBrand: { code: string; label: string; source: ChoiceSource | "prefilled" } | null;
  stages: { group: string; label: string; stage: FunnelStage | null; source: ChoiceSource }[];
  csm: { [K in CsmSingle]: { variable: string | null; source: ChoiceSource } } & { drivers: { variables: string[]; source: ChoiceSource } };
  weightVar: string | null;
  weighted: boolean;
  weightSource: "default" | "chosen";
  hidden: string[];
  /** What the researcher still has to decide for this wave: the recogniser's open questions, and saved choices
   * this file cannot apply (each says why). */
  needsChoice: NeedsChoice[];
};

/** The client brand suggested for "Which brand is yours?" (Grant: ask once, pre-filled): the brand named in the
 * programme or project name, the longest name when several are; null when none is named. Never a choice. */
export function prefilledFocalBrand(brands: { code: string; label: string }[], names: (string | null | undefined)[]): { code: string; label: string } | null {
  const text = ` ${names.filter(Boolean).join(" ").toLowerCase().replace(/[^\p{L}\p{N}&+]+/gu, " ")} `;
  const words = (s: string) => ` ${s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^\p{L}\p{N}&+]+/gu, " ").trim()} `;
  const named = brands.filter((b) => words(b.label).trim() && text.includes(words(b.label)));
  return named.sort((a, b) => b.label.length - a.label.length)[0] ?? null;
}

/**
 * Checks choices before they are saved, against this wave's suggestion and variables. Returns the reasons a
 * choice cannot be saved (empty when all can). A new or changed choice about something this file does not have
 * is refused; one unchanged from `stored` (made against a wave that had it) is kept.
 */
export function choiceProblems(choices: TrackerChoices, rec: TrackerRecognition, variableNames: Set<string>, weightVar: string | null, stored: TrackerChoices = {}): string[] {
  const problems: string[] = [];
  // Unchanged from the stored choices: kept even when this wave's file cannot apply it (resolveDashboard says so).
  const keptCodes = new Set(stored.nonBrandCodes ?? []);
  const keptVariables = new Set([...Object.values(stored.csm ?? {}).flat().filter((v): v is string => typeof v === "string")]);
  const codes = new Set([...(rec.frame?.brands ?? []), ...(rec.frame?.nonBrandCodes ?? [])].map((c) => c.code));
  if (choices.focalBrandCode !== undefined && choices.focalBrandCode !== stored.focalBrandCode && !rec.frame?.brands.some((b) => b.code === choices.focalBrandCode)) problems.push(`Brand code ${choices.focalBrandCode} is not in this file's brand list.`);
  for (const c of choices.nonBrandCodes ?? []) if (!codes.has(c) && !keptCodes.has(c)) problems.push(`Answer code ${c} is not in this file's brand list.`);
  const groups = new Set(rec.measures.map((m) => m.group));
  for (const [group, stage] of Object.entries(choices.stages ?? {})) {
    const unchanged = stored.stages !== undefined && Object.prototype.hasOwnProperty.call(stored.stages, group) && stored.stages[group] === stage;
    if (!groups.has(group) && !unchanged) problems.push(`Question ${group} is not a per-brand question in this file.`);
    if (stage !== null && !STAGES.includes(stage)) problems.push(`"${stage}" is not a funnel stage.`);
  }
  for (const role of CSM_SINGLE) {
    const v = choices.csm?.[role];
    if (v && !variableNames.has(v) && !keptVariables.has(v)) problems.push(`${v} is not a variable in this file.`);
  }
  for (const v of choices.csm?.drivers ?? []) if (!variableNames.has(v) && !keptVariables.has(v)) problems.push(`${v} is not a variable in this file.`);
  if (choices.weighted === true && !weightVar) problems.push("This file has no weight, so it cannot be weighted.");
  if ((choices.hidden ?? []).some((h) => typeof h !== "string" || h.length > 100) || (choices.hidden?.length ?? 0) > 200) problems.push("The hidden charts list is not valid.");
  return problems;
}

/** Choices as stored: only known keys, of the right types; anything else is left out. */
export function normaliseChoices(raw: unknown): TrackerChoices {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  const out: TrackerChoices = {};
  if (typeof o.focalBrandCode === "string") out.focalBrandCode = o.focalBrandCode;
  const nb = strs(o.nonBrandCodes);
  if (nb) out.nonBrandCodes = nb;
  if (o.stages && typeof o.stages === "object" && !Array.isArray(o.stages)) {
    out.stages = Object.fromEntries(Object.entries(o.stages as Record<string, unknown>).filter(([, s]) => s === null || typeof s === "string")) as Record<string, FunnelStage | null>;
  }
  if (o.csm && typeof o.csm === "object" && !Array.isArray(o.csm)) {
    const c = o.csm as Record<string, unknown>;
    const csm: NonNullable<TrackerChoices["csm"]> = {};
    for (const role of CSM_SINGLE) if (c[role] === null || typeof c[role] === "string") csm[role] = c[role] as string | null;
    const d = strs(c.drivers);
    if (d) csm.drivers = d;
    out.csm = csm;
  }
  if (typeof o.weighted === "boolean") out.weighted = o.weighted;
  const hidden = strs(o.hidden);
  if (hidden) out.hidden = hidden;
  return out;
}

/** This wave's dashboard: the suggestion with the saved choices applied where this file supports them. */
export function resolveDashboard(
  rec: TrackerRecognition,
  variableNames: Set<string>,
  weightVar: string | null,
  choices: TrackerChoices,
  prefill: { code: string; label: string } | null = null,
): ResolvedDashboard {
  const needsChoice: NeedsChoice[] = [];
  const brands = rec.frame?.brands ?? [];
  const listed = [...brands, ...(rec.frame?.nonBrandCodes ?? [])];
  const labelOf = (code: string) => listed.find((c) => c.code === code)?.label ?? code;

  // Answers that are not brands: the chosen set when given (codes this file still lists), else the suggestion.
  let nonBrandCodes: ResolvedDashboard["nonBrandCodes"];
  let brandList = brands;
  if (choices.nonBrandCodes) {
    const missing = choices.nonBrandCodes.filter((c) => !listed.some((l) => l.code === c));
    if (missing.length) needsChoice.push({ id: "non-brand-codes", text: `Answer code${missing.length === 1 ? "" : "s"} ${missing.join(", ")}, chosen as not brands in an earlier wave, ${missing.length === 1 ? "is" : "are"} not in this file's brand list. Check the answers left out of brand results.` });
    const chosen = new Set(choices.nonBrandCodes);
    nonBrandCodes = listed.filter((c) => chosen.has(c.code)).map((c) => ({ code: c.code, label: c.label, source: "chosen" as const }));
    brandList = listed.filter((c) => !chosen.has(c.code));
  } else {
    nonBrandCodes = (rec.frame?.nonBrandCodes ?? []).map((c) => ({ code: c.code, label: c.label, source: "suggested" as const }));
  }

  let focalBrand: ResolvedDashboard["focalBrand"] = null;
  if (choices.focalBrandCode !== undefined) {
    if (brandList.some((b) => b.code === choices.focalBrandCode)) focalBrand = { code: choices.focalBrandCode, label: labelOf(choices.focalBrandCode), source: "chosen" };
    else needsChoice.push({ id: "focal-brand", text: `The main brand chosen in an earlier wave (code ${choices.focalBrandCode}) is not in this file's brand list. Which brand is your client's?` });
  } else if (rec.frame) {
    focalBrand = prefill && brandList.some((b) => b.code === prefill.code) ? { ...prefill, source: "prefilled" } : null;
  }

  const stages = rec.measures.map((m) => {
    const chosen = choices.stages && Object.prototype.hasOwnProperty.call(choices.stages, m.group);
    return { group: m.group, label: m.label, stage: chosen ? choices.stages![m.group] : m.stage, source: (chosen ? "chosen" : "suggested") as ChoiceSource };
  });
  for (const group of Object.keys(choices.stages ?? {})) {
    if (!rec.measures.some((m) => m.group === group)) needsChoice.push({ id: `stage:${group}`, text: `Question ${group}, given a funnel stage in an earlier wave, is not in this file.` });
  }

  const pick = (role: CsmSingle) => {
    const chosen = choices.csm && Object.prototype.hasOwnProperty.call(choices.csm, role);
    if (!chosen) return { variable: rec.csm[role], source: "suggested" as ChoiceSource };
    const v = choices.csm![role] ?? null;
    if (v !== null && !variableNames.has(v)) {
      needsChoice.push({ id: `csm:${role}`, text: `${v}, chosen in an earlier wave, is not in this file. Choose the variable for ${CSM_ROLE_TEXT[role]}.` });
      return { variable: null, source: "chosen" as ChoiceSource };
    }
    return { variable: v, source: "chosen" as ChoiceSource };
  };
  let drivers: ResolvedDashboard["csm"]["drivers"] = { variables: rec.csm.drivers, source: "suggested" };
  if (choices.csm?.drivers) {
    const missing = choices.csm.drivers.filter((d) => !variableNames.has(d));
    if (missing.length) needsChoice.push({ id: "csm:drivers", text: `Driver${missing.length === 1 ? "" : "s"} ${missing.join(", ")}, chosen in an earlier wave, ${missing.length === 1 ? "is" : "are"} not in this file.` });
    drivers = { variables: choices.csm.drivers.filter((d) => variableNames.has(d)), source: "chosen" };
  }
  const csm = { overallSatisfaction: pick("overallSatisfaction"), recommend0to10: pick("recommend0to10"), likelyToStay: pick("likelyToStay"), likelyToSwitch: pick("likelyToSwitch"), drivers };

  // The recogniser's open questions, less the ones a choice answers.
  const answered = (id: string) =>
    (id === "focal-brand" && choices.focalBrandCode !== undefined) ||
    (id === "non-brand-codes" && choices.nonBrandCodes !== undefined) ||
    (id.startsWith("measure:") && choices.stages !== undefined && Object.prototype.hasOwnProperty.call(choices.stages, id.slice(8))) ||
    (id.startsWith("stage:") && stagesSettled(id.slice(6) as FunnelStage, stages)) ||
    (id === "csm:satisfaction" && choices.csm?.overallSatisfaction !== undefined) ||
    (id === "csm:drivers" && choices.csm?.drivers !== undefined);
  const open = rec.questions.filter((q) => !answered(q.id) && !needsChoice.some((n) => n.id === q.id));

  const weightChosen = choices.weighted !== undefined;
  if (choices.weighted === true && !weightVar) needsChoice.push({ id: "weight", text: "Weighted results were chosen in an earlier wave, but this file has no weight. Results are unweighted." });
  return {
    type: rec.type,
    brands: brandList,
    nonBrandCodes,
    focalBrand,
    stages,
    csm,
    weightVar,
    weighted: weightVar !== null && choices.weighted !== false,
    weightSource: weightChosen ? "chosen" : "default",
    hidden: choices.hidden ?? [],
    needsChoice: [...open, ...needsChoice],
  };
}

/** A stage two questions claimed (the recogniser asks which) is settled once at most one question has it; only a
 * choice can bring that about. */
function stagesSettled(stage: FunnelStage, stages: { stage: FunnelStage | null }[]): boolean {
  return stages.filter((s) => s.stage === stage).length <= 1;
}

const CSM_ROLE_TEXT: Record<CsmSingle, string> = {
  overallSatisfaction: "overall satisfaction",
  recommend0to10: "likelihood to recommend (0 to 10)",
  likelyToStay: "likelihood to stay",
  likelyToSwitch: "likelihood to switch",
};

