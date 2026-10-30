// D2 (Grant, 29 October 2026): a tracker dashboard's configuration is what the app suggests for this wave's
// file (trackerRoles.ts, from trackerInput.ts) with the researcher's saved choices for the programme on top.
// Suggestions and choices stay apart: a choice is never written by a suggestion, and Reset to suggested
// clears the choices only. Choices are carried to a new wave by identity (brand codes, question groups and
// variable names, never labels or positions): a choice the new file supports is applied; one it does not
// (a variable missing, a brand code no longer in the list) is listed as needing a choice and its old value is
// kept, never dropped. Weighting (Grant: "weight by default"): weighted whenever the file has a weight,
// unless the researcher chose unweighted.
// Pure: no reads or writes. Persistence is trackerDashboards.ts.
import { FUNNEL_STAGES, type FunnelStage, type TrackerRecognition } from "./trackerRoles";
import { isTrackerType, overviewStagesFor, TRACKER_TYPE_LABEL, type TrackerType } from "./trackerType";
import type { TimeWindow } from "./trackerWindows";

/** Which recognition rules produced a suggestion, recorded with saved choices. Raise when trackerRoles.ts changes.
 * r5fmcg: time windows, recent purchase or use as usage, and the tracker type suggestion. */
export const TRACKER_ROLE_RULES = "r5fmcg-2026-10-30";

const STAGES: readonly string[] = FUNNEL_STAGES;
const CSM_SINGLE = ["overallSatisfaction", "recommend0to10", "likelyToStay", "likelyToSwitch", "company"] as const;
type CsmSingle = (typeof CSM_SINGLE)[number];

export type TrackerChoices = {
  /** The client's brand, by its code in the brand list. */
  focalBrandCode?: string;
  /** The client's company in the CSM company question (D3b), by its answer code. */
  focalCompanyCode?: string;
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
  /** The tracker type chosen for the programme (R5): "durables" or "fmcg" (trackerType.ts). Absent: the suggestion
   * applies. Kept as stored text so a value this app does not know is reported, never silently read as a type. */
  trackerType?: string;
};

export type ChoiceSource = "suggested" | "chosen";
export type NeedsChoice = { id: string; text: string };

export type ResolvedDashboard = {
  type: TrackerRecognition["type"];
  brands: { code: string; label: string }[];
  nonBrandCodes: { code: string; label: string; source: ChoiceSource }[];
  focalBrand: { code: string; label: string; source: ChoiceSource | "prefilled" } | null;
  stages: { group: string; label: string; stage: FunnelStage | null; source: ChoiceSource; window: TimeWindow }[];
  /** The tracker type in effect (R5): the saved choice, else the suggestion; null when neither gives one. `suggested`
   * and `reason` are the suggestion's, always shown beside the choice. */
  trackerType: { type: TrackerType | null; source: ChoiceSource; suggested: TrackerType | null; reason: string };
  /** The brand overview's stages in order for that type (trackerType.ts overviewStagesFor): the one ordered list the
   * tiles, the funnel rows and the headline charts read. */
  overviewStages: FunnelStage[];
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
export function choiceProblems(
  choices: TrackerChoices,
  rec: TrackerRecognition,
  variableNames: Set<string>,
  weightVar: string | null,
  stored: TrackerChoices = {},
  /** The answer codes of the company question these choices use, or null when it has no answer list (D3b). */
  companyCodes: Set<string> | null = null,
): string[] {
  const problems: string[] = [];
  // Unchanged from the stored choices: kept even when this wave's file cannot apply it (resolveDashboard says so).
  const keptCodes = new Set(stored.nonBrandCodes ?? []);
  const keptVariables = new Set([...Object.values(stored.csm ?? {}).flat().filter((v): v is string => typeof v === "string")]);
  const codes = new Set([...(rec.frame?.brands ?? []), ...(rec.frame?.nonBrandCodes ?? [])].map((c) => c.code));
  if (choices.focalBrandCode !== undefined && choices.focalBrandCode !== stored.focalBrandCode && !rec.frame?.brands.some((b) => b.code === choices.focalBrandCode)) problems.push(`Brand code ${choices.focalBrandCode} is not in this file's brand list.`);
  if (choices.focalCompanyCode !== undefined && choices.focalCompanyCode !== stored.focalCompanyCode && !companyCodes?.has(choices.focalCompanyCode)) problems.push(`Company code ${choices.focalCompanyCode} is not an answer of this file's company question.`);
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
  // An unchanged "weighted" choice made on a wave with a weight is kept on a wave without one (Codex D2A-F03): this
  // wave's results are unweighted and say so (resolveDashboard), and the programme's preference applies again to a
  // later wave that has a weight. Only a new choice of weighting is refused here.
  if (choices.weighted === true && !weightVar && stored.weighted !== true) problems.push("This file has no weight, so it cannot be weighted.");
  if ((choices.hidden ?? []).some((h) => typeof h !== "string" || h.length > 100) || (choices.hidden?.length ?? 0) > 200) problems.push("The hidden charts list is not valid.");
  // A new or changed tracker type must be one this app offers; an unchanged stored value is kept (resolveDashboard
  // reports one it does not know).
  if (choices.trackerType !== undefined && choices.trackerType !== stored.trackerType && !isTrackerType(choices.trackerType)) problems.push(`"${choices.trackerType}" is not a tracker type. Choose Durables or FMCG.`);
  return problems;
}

/** Choices as stored: only known keys, of the right types; anything else is left out. */
export function normaliseChoices(raw: unknown): TrackerChoices {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  const out: TrackerChoices = {};
  if (typeof o.focalBrandCode === "string") out.focalBrandCode = o.focalBrandCode;
  if (typeof o.focalCompanyCode === "string" && o.focalCompanyCode.length <= 50) out.focalCompanyCode = o.focalCompanyCode;
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
  // Any short text is kept as given: choiceProblems refuses a new value that is not a type, and resolveDashboard
  // reports a stored one it does not know, rather than dropping it here unseen.
  if (typeof o.trackerType === "string" && o.trackerType.length <= 40) out.trackerType = o.trackerType;
  else if (o.trackerType !== undefined && o.trackerType !== null) out.trackerType = String(o.trackerType).slice(0, 40);
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

  // The tracker type: the saved choice when it is a type, else the suggestion. A stored value this app does not know
  // is said so, and the suggestion is used until a type is chosen (never read as either type).
  const suggestedType = rec.trackerType.type;
  let trackerType: ResolvedDashboard["trackerType"] = { type: suggestedType, source: "suggested", suggested: suggestedType, reason: rec.trackerType.reason };
  if (choices.trackerType !== undefined) {
    if (isTrackerType(choices.trackerType)) trackerType = { ...trackerType, type: choices.trackerType, source: "chosen" };
    else needsChoice.push({ id: "tracker-type", text: `The tracker type saved for this programme ("${choices.trackerType}") is not one this app knows. ${suggestedType ? `The suggested type, ${TRACKER_TYPE_LABEL[suggestedType]}, is used until you choose one.` : "Choose Durables or FMCG."}` });
  }

  const stages = rec.measures.map((m) => {
    const chosen = choices.stages && Object.prototype.hasOwnProperty.call(choices.stages, m.group);
    return { group: m.group, label: m.label, stage: chosen ? choices.stages![m.group] : m.stage, source: (chosen ? "chosen" : "suggested") as ChoiceSource, window: m.window };
  });
  // A stage that depends on the type (a purchase in the past 12 months: acquisition for Durables, annual penetration
  // for FMCG) takes the type's reading when it is not chosen, and only when no other question already has that stage,
  // so the type never creates a contest the researcher did not have (an FMCG file with P3M and P12M keeps P3M as usage).
  if (trackerType.type) {
    for (const s of stages) {
      const m = rec.measures.find((x) => x.group === s.group)!;
      const typed = m.stageByType?.[trackerType.type];
      if (s.source === "suggested" && typed && typed !== s.stage && !stages.some((o) => o !== s && o.stage === typed)) s.stage = typed;
    }
  }
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
  const csm = { overallSatisfaction: pick("overallSatisfaction"), recommend0to10: pick("recommend0to10"), likelyToStay: pick("likelyToStay"), likelyToSwitch: pick("likelyToSwitch"), company: pick("company"), drivers };

  // A CSM question is answered by an applicable choice of its role (Codex D2A-F04): a variable this file has, or an
  // intentional "none". A carried choice this file cannot apply keeps the question open (its own needs-a-choice
  // entry says why). A question whether a partly labelled list is 0 to 10 is answered only by choosing that very
  // variable as the recommend question, never by choosing another.
  const CSM_QUESTION_ROLE: Record<string, CsmSingle> = { "csm:satisfaction": "overallSatisfaction", "csm:recommend": "recommend0to10", "csm:stay": "likelyToStay", "csm:switch": "likelyToSwitch", "csm:company": "company" };
  const applicable = (role: CsmSingle) => choices.csm !== undefined && Object.prototype.hasOwnProperty.call(choices.csm, role) && (choices.csm[role] === null || variableNames.has(choices.csm[role] as string));
  const csmAnswered = (id: string) => {
    if (CSM_QUESTION_ROLE[id]) return applicable(CSM_QUESTION_ROLE[id]);
    if (id === "csm:drivers") return choices.csm?.drivers !== undefined && choices.csm.drivers.every((d) => variableNames.has(d));
    if (id.startsWith("csm:recommend-scale:")) return applicable("recommend0to10") && choices.csm!.recommend0to10 === id.slice("csm:recommend-scale:".length);
    return false;
  };
  // The recogniser's open questions, less the ones a choice answers.
  const answered = (id: string) =>
    (id === "focal-brand" && choices.focalBrandCode !== undefined) ||
    (id === "non-brand-codes" && choices.nonBrandCodes !== undefined) ||
    (id.startsWith("measure:") && choices.stages !== undefined && Object.prototype.hasOwnProperty.call(choices.stages, id.slice(8))) ||
    (id.startsWith("stage:") && stagesSettled(id.slice(6) as FunnelStage, stages)) ||
    csmAnswered(id);
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
    trackerType,
    overviewStages: [...overviewStagesFor(trackerType.type)],
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
  company: "the company each customer rates",
};

