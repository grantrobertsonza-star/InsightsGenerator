// The Audience and Media pages of the brand tracking dashboard (Grant's design, 29 October 2026; split into two pages
// with profile questions and comparison controls, 30 October 2026): who recently acquired the client's brand, against
// everyone in the category or another brand's recent acquirers. The contracts are in claude/d2-design-2026-10-29.md,
// "D3f Audience & media":
//   - Recent acquirers of a brand: respondents whose answer to that brand's variable in the question the dashboard maps
//     to the acquisition stage (trackerFigures.stageClaims; the BMW pack's "Past 12 month household acquisition",
//     bought12_b08) is its selected code (trackerFigures.selectedCode, by code). They are selected by an engine filter
//     on that raw code, never by a label.
//   - Profile questions (Audience page): the programme's saved list, else age, gender and income as recognised
//     (trackerDashboard.resolveProfiles). For each answer code, the weighted share giving it among the group's
//     respondents with a valid answer: the recent acquirers, and all eligible respondents (the category). Every answer
//     code is kept, in code order, "Prefer not to say" and "Don't know" included as answers of their own and in the
//     base (excludeDk false); a blank or declared missing value is outside the base. One method for every question
//     (profileRowsFromResults), age included.
//   - Media use (Media page): for each option of the media list (trackerRoles.findMediaList), the weighted share
//     selecting it among the group's respondents with a valid answer to it (selectedShareOf); "None of these" holds 0
//     on every option and stays in the base. Compared with all eligible respondents (the default) or another brand's
//     recent acquirers. Media habits, not advertising effectiveness.
//   - Significance (Media page headline only): the Cross tab engine's own two-proportion test on effective bases, at
//     5%, per medium (mediaTests); no correction across the media. Against all eligible, the acquirers are tested
//     against the eligible respondents who are not acquirers (a group is never tested against a total containing it);
//     against another brand, the two acquirer groups are tested as two groups (pooled shares under the null), a
//     respondent who acquired both counted in both. Run only when both groups have 50 or more respondents.
//   - Small bases (plan: "small bases flagged (n<50) and not inferred (n<30)"): smallBaseLevel.
// Figures come from the Cross tab engine through computeCrosstab (nothing saved), with the dashboard's weight and the
// file's survey design. Unknown stays unknown: a part the file does not have is "not_measured", one that two
// questions claim or that needs the client's brand is "mapping_needed", a figure that cannot be read is n/a with the
// reason. A file that cannot be read throws.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { answersOf, selectedAnswerOf, selectedCode, selectedShareOf, stageClaims } from "./trackerFigures";
import { smallBaseLevel, type BaseLevel, type GroupShare, type MediaRow, type MediaTest, type ProfileRow } from "./trackerAudienceFigures";
import type { CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard, ResolvedProfile } from "./trackerDashboard";
import type { FoundList, FoundQuestion, ProfileQuestion, RoleVariable, TrackerRecognition } from "./trackerRoles";

export { smallBaseLevel, SMALL_BASE, NO_INFERENCE_BASE } from "./trackerAudienceFigures";
export type { GroupShare, ProfileRow, MediaRow, MediaTest } from "./trackerAudienceFigures";

export type Unavailable = { status: "not_measured" | "mapping_needed"; reason: string };

/** One brand's recent acquirers as read from the file. */
export type AcquirerGroup = {
  status: "ok";
  brand: { code: string; label: string };
  /** The acquisition question's wording (the BMW pack: "Past 12 month household acquisition"). */
  label: string;
  variable: string;
  /** The selected code; null when it cannot be told (see `reason`). */
  code: string | null;
  /** Unweighted number of recent acquirers; null when it cannot be told. */
  n: number | null;
  /** Kish effective base of the acquirers when weighted. */
  effectiveBase: number | null;
  level: BaseLevel | null;
  reason?: string;
};
type AcquirerParts = { status: "ok"; brand: { code: string; label: string }; label: string; variable: string };

/** A profile card: a resolved profile question, with its rows when the file has it. */
export type ProfileCard = (Extract<ResolvedProfile, { status: "ok" }> & { rows: ProfileRow[] }) | Exclude<ResolvedProfile, { status: "ok" }>;

type PageBase = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** Kish effective base of all eligible respondents when weighted; null unweighted or not calculated. */
  effectiveBase: number | null;
  /** Unweighted number of all eligible respondents (the table's respondents). */
  categoryN: number | null;
  /** The client's brand's recent acquirers. */
  acquirers: AcquirerGroup | Unavailable;
  dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand">;
};

/** The Audience page. */
export type BrandAudience = PageBase & {
  profiles: ProfileCard[];
  /** "chosen": the programme's saved list; "suggested": the defaults. */
  profilesSource: "chosen" | "suggested";
  /** What "Add a profile question" can offer (trackerRoles.profileQuestionsOf). */
  profileQuestions: ProfileQuestion[];
};

/** The Media page. */
export type BrandMedia = PageBase & {
  /** What the client's brand's acquirers are compared with: all eligible respondents, or another brand's acquirers. */
  comparison: { kind: "category" } | { kind: "brand"; group: AcquirerGroup | Unavailable };
  /** The brands whose recent acquirers can be the comparison (the acquisition question's brands, the client's left out). */
  comparisonBrands: { code: string; label: string }[];
  media:
    | {
        status: "ok";
        label: string;
        /** In the list's order; the screen sorts (trackerAudienceFigures.sortMediaRows). */
        rows: MediaRow[];
        /** Whether the engine's test ran for the page; when not, why (a small base, no acquirers, a failed read). */
        test: { ran: true; method: string } | { ran: false; reason: string };
      }
    | Unavailable;
};

const unavailableOf = (found: FoundQuestion | FoundList, what: string): Unavailable =>
  found.status === "ambiguous" ? { status: "mapping_needed", reason: found.reason } : { status: "not_measured", reason: found.status === "not_found" ? found.reason : `No ${what} question.` };

/** The acquisition question, or why the acquirers cannot be told. */
function acquisitionQuestion(rec: TrackerRecognition, dashboard: ResolvedDashboard): { status: "ok"; measure: TrackerRecognition["measures"][number] } | Unavailable {
  const claims = stageClaims(rec, dashboard, "acquisition");
  if (claims.length === 0) return { status: "not_measured", reason: "This file has no question asking which brands each respondent recently acquired, so the brand's recent acquirers cannot be told." };
  if (claims.length > 1) return { status: "mapping_needed", reason: `Two questions could be recent acquisition (${claims.map((c) => c.label).join(" or ")}). Choose one under Customise.` };
  return { status: "ok", measure: claims[0] };
}

/** One brand's variable in the acquisition question, or why not. */
function brandParts(q: ReturnType<typeof acquisitionQuestion>, brand: { code: string; label: string }): AcquirerParts | Unavailable {
  if (q.status !== "ok") return q;
  const variable = q.measure.byBrand.find((b) => b.code === brand.code)?.variable;
  if (!variable) return { status: "not_measured", reason: `"${q.measure.label}" was not asked about ${brand.label}.` };
  return { status: "ok", brand: { code: brand.code, label: brand.label }, label: q.measure.label, variable };
}

/** The acquisition question and the client's brand's variable in it, or why the acquirers cannot be told. */
export function acquirerParts(rec: TrackerRecognition, dashboard: ResolvedDashboard): AcquirerParts | Unavailable {
  const q = acquisitionQuestion(rec, dashboard);
  if (q.status !== "ok") return q;
  const focal = dashboard.focalBrand;
  if (!focal) return { status: "mapping_needed", reason: "Choose your brand (the Brand chip) to see its recent acquirers." };
  return brandParts(q, focal);
}

/** A brand's acquirers counted from the table of all eligible respondents (which holds the acquisition variable). */
function acquirerGroupOf(parts: AcquirerParts, category: CrosstabResult, variables: Map<string, RoleVariable>): AcquirerGroup {
  const a = selectedAnswerOf(category, parts.variable, variables.get(parts.variable));
  if (a.code === null) return { ...parts, code: null, n: null, effectiveBase: null, level: null, reason: `Which answer means acquired could not be told: ${a.reason ?? "unknown"}` };
  if (a.code.trim() === "" || !Number.isFinite(Number(a.code))) return { ...parts, code: a.code, n: a.selectedN, effectiveBase: null, level: null, reason: "The acquisition answer is not a numeric code, so the acquirers cannot be selected by code." };
  if (a.selectedN === null) return { ...parts, code: a.code, n: null, effectiveBase: null, level: null, reason: "The engine gave no unweighted count for the acquisition answer." };
  return { ...parts, code: a.code, n: a.selectedN, effectiveBase: null, level: smallBaseLevel(a.selectedN), ...(a.selectedN === 0 ? { reason: `No respondent in this file is a recent acquirer of ${parts.brand.label}.` } : {}) };
}

/** Why a group's figures are n/a, or null when they can be read. */
const groupMissing = (g: AcquirerGroup | Unavailable): string | null => (g.status !== "ok" ? g.reason : (g.reason ?? null));
const groupReadable = (g: AcquirerGroup | Unavailable): g is AcquirerGroup & { code: string; n: number } => g.status === "ok" && g.code !== null && g.n !== null && g.n > 0 && !g.reason;

/** What every page needs: the dashboard, the recogniser's input, and a way to compute tables with the dashboard's
 * weight and the file's design. */
async function pageContext(tenantId: string, runId: string, documentId: string) {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  let request: ((vars: string[]) => CrosstabRequest) | null = null;
  const tableRequest = async () => {
    if (request) return request;
    const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
    if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
    if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
    const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
    const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
    request = (vars) => ({ columnVars: [], rowItems: vars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] })), weightVar, design, excludeDk: false });
    return request;
  };
  // Computed, not saved (computeCrosstab).
  const table = async (vars: string[], extra: Partial<CrosstabRequest> = {}) => (await computeCrosstab(tenantId, runId, documentId, { ...(await tableRequest())(vars), ...extra })).result;
  /** A brand's acquirers only, by the raw acquisition code (from the code to itself), never by its label. */
  const acquirersTable = (g: AcquirerGroup & { code: string }, vars: string[]) => table(vars, { filters: [{ variable: g.variable, op: "between", min: Number(g.code), max: Number(g.code) }] });
  return { view, dashboard, rec: view.recognition, weightVar, variables: new Map(input.variables.map((v) => [v.name, v])), table, acquirersTable };
}

/** Rows of one answer-coded profile question for both groups, by raw code in code order (never by share). The one
 * method for every profile card. Pure. */
export function profileRowsFromResults(category: CrosstabResult, acquirers: CrosstabResult | null, variable: string, v: RoleVariable | undefined, acquirersMissing: string | null): ProfileRow[] {
  const all = answersOf(category, variable);
  const sub = acquirers ? answersOf(acquirers, variable) : null;
  const labels = v?.valueLabels ?? {};
  const codes = [...new Set([...Object.keys(labels), ...all.answers.map((a) => a.code), ...(sub?.answers.map((a) => a.code) ?? [])])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const read = (r: ReturnType<typeof answersOf> | null, code: string, missing: string | null): GroupShare => {
    if (!r) return { share: null, base: null, reason: missing ?? "No figures were calculated." };
    if (r.reason) return { share: null, base: null, reason: r.reason };
    if (!r.base) return { share: null, base: r.base ?? null, reason: "No valid answers." };
    const a = r.answers.find((x) => x.code === code);
    // An answer on the list that nobody in the group gave is 0 of a known base; a suppressed one is not available.
    if (a && a.share === null) return { share: null, base: r.base, reason: "Suppressed for a small base." };
    return { share: a ? (a.share as number) : 0, base: r.base };
  };
  return codes.map((code) => ({ key: code, label: labels[code] ?? all.answers.find((a) => a.code === code)?.label ?? code, acquirers: read(sub, code, acquirersMissing), category: read(all, code, null) }));
}

/** The media options for the focal group and the comparison group, in the list's order, with no test yet. Pure. */
export function mediaRowsFromResults(
  focal: CrosstabResult | null,
  comparison: CrosstabResult | null,
  list: Extract<FoundList, { status: "found" }>,
  variables: Map<string, RoleVariable>,
  focalMissing: string | null,
  comparisonMissing: string | null,
): Omit<MediaRow, "test">[] {
  const share = (r: CrosstabResult | null, variable: string, missing: string | null): GroupShare => (r ? selectedShareOf(r, variable, variables.get(variable)) : { share: null, base: null, reason: missing ?? "No figures were calculated." });
  return list.options.map((o) => ({ key: o.variable, label: o.label, focal: share(focal, o.variable, focalMissing), comparison: share(comparison, o.variable, comparisonMissing) }));
}

/** The engine's test settings for the Media page: every medium on its own at 5%, no correction across them. */
const TEST_SETTINGS: Partial<CrosstabRequest> = { correction: "none" };
const UNTESTED = "The engine did not test this medium: a group has fewer than 30 respondents (or an effective base below 30) answering it.";

/**
 * Each medium's test, read from the engine's table (pure). `kind` "category": the table's banner is the focal brand's
 * acquisition variable; the focal column (by variable and raw code) carries the engine's test against the rest of the
 * banner, the eligible respondents who are not acquirers (p and sig). `kind` "brand": the banner is the acquisition
 * question's multiple-response set; the two brands' columns are found by their member variable and compared by the
 * engine's column-pair letters (pooled two-proportion test on effective bases). A pair is read as untested when either
 * column was not testable (its p is null: the engine's own base rule) or, under a survey design, either share is 0% or
 * 100% (the engine leaves such a pair untested).
 */
export function mediaTests(
  result: CrosstabResult,
  kind: "category" | "brand",
  focal: { variable: string; code: string },
  comparison: { variable: string } | null,
  options: string[],
  variables: Map<string, RoleVariable>,
): Map<string, MediaTest> {
  const out = new Map<string, MediaTest>();
  const kf = kind === "category" ? result.columns.findIndex((c) => c.var === focal.variable && c.rawCode === focal.code) : result.columns.findIndex((c) => c.var === focal.variable);
  const kc = kind === "brand" && comparison ? result.columns.findIndex((c) => c.var === comparison.variable) : -1;
  for (const variable of options) {
    const q = result.questions.find((x) => x.key === variable);
    const cats = (q?.rows ?? []).filter((r) => !r.isBase && !r.isNet && !r.isMean && !r.isScore && r.rawCode !== undefined);
    const code = selectedCode(variables.get(variable) ?? {}, cats.map((r) => r.rawCode as string));
    const row = cats.find((r) => r.rawCode === code);
    if (kf < 0 || (kind === "brand" && kc < 0)) {
      out.set(variable, { status: "untested", reason: "The groups were not found among the engine's columns." });
      continue;
    }
    if (!row) {
      out.set(variable, { status: "untested", reason: "Which answer means selected could not be told." });
      continue;
    }
    if (kind === "category") {
      const p = row.p[kf];
      out.set(variable, p === null || p === undefined ? { status: "untested", reason: UNTESTED } : { status: row.sig[kf] > 0 ? "higher" : row.sig[kf] < 0 ? "lower" : "no_difference" });
      continue;
    }
    const share = (k: number) => row.pctExact?.[k] ?? row.pct[k];
    const degenerate = result.notes?.designApplied === true && [share(kf), share(kc)].some((s) => s === 0 || s === 100);
    if (row.p[kf] === null || row.p[kc] === null || degenerate) {
      out.set(variable, { status: "untested", reason: degenerate ? "Under the survey design a share of 0% or 100% is not tested." : UNTESTED });
      continue;
    }
    const letters = row.letters ?? [];
    const higher = (letters[kf] ?? "").includes(result.columns[kc].letter ?? "\u0000");
    const lower = (letters[kc] ?? "").includes(result.columns[kf].letter ?? "\u0000");
    out.set(variable, { status: higher ? "higher" : lower ? "lower" : "no_difference" });
  }
  return out;
}

/** The engine's set key of a multiple-response question from its members' names (the engine's NAME_1/NAME_2 stem,
 * `_SET_NAME_RE` in api/parse-stats-file.py): every member must share it, else null. */
export function setKeyOf(variables: string[]): string | null {
  const stems = new Set(variables.map((v) => /^(.+?)_([A-Za-z]{0,3}\d+)$/.exec(v)?.[1] ?? null));
  const [stem] = [...stems];
  return stems.size === 1 && stem ? stem : null;
}

/**
 * The Audience page for one data file: the programme's profile questions (or age, gender and income) for the client's
 * brand's recent acquirers and all eligible respondents. Throws with the reason when the file's dictionary, set-up or a
 * table cannot be read; never returns an empty page for a failure.
 */
export async function loadBrandAudience(tenantId: string, runId: string, documentId: string): Promise<BrandAudience> {
  const ctx = await pageContext(tenantId, runId, documentId);
  const { dashboard, rec, variables } = ctx;
  const parts = acquirerParts(rec, dashboard);
  const profileVars = [...new Set(dashboard.audienceProfiles.flatMap((p) => (p.status === "ok" ? [p.variable] : [])))];
  let category: CrosstabResult | null = null;
  let sub: CrosstabResult | null = null;
  let acquirers: AcquirerGroup | Unavailable = parts.status === "ok" ? { ...parts, code: null, n: null, effectiveBase: null, level: null } : parts;
  if (profileVars.length > 0 || parts.status === "ok") {
    // All eligible respondents first, with the acquisition answer to read the acquirers' code and count.
    category = await ctx.table([...(parts.status === "ok" ? [parts.variable] : []), ...profileVars]);
    if (parts.status === "ok") {
      acquirers = acquirerGroupOf(parts, category, variables);
      if (groupReadable(acquirers) && profileVars.length > 0) {
        sub = await ctx.acquirersTable(acquirers, profileVars);
        acquirers.effectiveBase = ctx.weightVar ? (sub.total?.nEff ?? null) : null;
      }
    }
  }
  const missing = groupMissing(acquirers);
  const profiles = dashboard.audienceProfiles.map((p): ProfileCard => (p.status === "ok" ? { ...p, rows: profileRowsFromResults(category!, sub, p.variable, variables.get(p.variable), missing) } : p));
  return {
    documentId,
    weighted: ctx.weightVar !== null,
    weightVar: ctx.weightVar,
    effectiveBase: ctx.weightVar && category ? (category.total?.nEff ?? null) : null,
    categoryN: category?.total?.n ?? null,
    acquirers,
    dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand },
    profiles,
    profilesSource: dashboard.audienceProfilesSource,
    profileQuestions: rec.profileQuestions,
  };
}

/**
 * The Media page for one data file: media use of the client's brand's recent acquirers compared with all eligible
 * respondents (`compareBrandCode` null) or with another brand's recent acquirers (its code in the brand list), with the
 * engine's test of each medium when both groups have 50 or more respondents. Throws with the reason when the file or a
 * table cannot be read.
 */
export async function loadBrandMedia(tenantId: string, runId: string, documentId: string, compareBrandCode: string | null): Promise<BrandMedia> {
  const ctx = await pageContext(tenantId, runId, documentId);
  const { dashboard, rec, variables } = ctx;
  const question = acquisitionQuestion(rec, dashboard);
  const parts = acquirerParts(rec, dashboard);
  const comparisonBrands = question.status === "ok" ? dashboard.brands.filter((b) => b.code !== dashboard.focalBrand?.code && question.measure.byBrand.some((x) => x.code === b.code)) : [];
  let comparisonParts: AcquirerParts | Unavailable | null = null;
  if (compareBrandCode !== null) {
    const brand = dashboard.brands.find((b) => b.code === compareBrandCode);
    comparisonParts = !brand
      ? { status: "not_measured", reason: `Brand code ${compareBrandCode} is not in this file's brand list.` }
      : brand.code === dashboard.focalBrand?.code
        ? { status: "mapping_needed", reason: "Choose a brand other than your own to compare with." }
        : brandParts(question, brand);
  }
  const media = rec.mediaUse.status === "found" ? rec.mediaUse : null;
  const mediaVars = media?.options.map((o) => o.variable) ?? [];
  const acquisitionVars = [parts, comparisonParts].flatMap((p) => (p?.status === "ok" ? [p.variable] : []));

  let category: CrosstabResult | null = null;
  let acquirers: AcquirerGroup | Unavailable = parts.status === "ok" ? { ...parts, code: null, n: null, effectiveBase: null, level: null } : parts;
  let comparisonGroup: AcquirerGroup | Unavailable | null = comparisonParts?.status === "ok" ? { ...comparisonParts, code: null, n: null, effectiveBase: null, level: null } : comparisonParts;
  let focalTable: CrosstabResult | null = null;
  let comparisonTable: CrosstabResult | null = null;
  if (mediaVars.length > 0 || acquisitionVars.length > 0) {
    category = await ctx.table([...acquisitionVars, ...mediaVars]);
    if (parts.status === "ok") acquirers = acquirerGroupOf(parts, category, variables);
    if (comparisonParts?.status === "ok") comparisonGroup = acquirerGroupOf(comparisonParts, category, variables);
    if (mediaVars.length > 0) {
      if (groupReadable(acquirers)) {
        focalTable = await ctx.acquirersTable(acquirers, mediaVars);
        acquirers.effectiveBase = ctx.weightVar ? (focalTable.total?.nEff ?? null) : null;
      }
      if (comparisonGroup && groupReadable(comparisonGroup)) {
        comparisonTable = await ctx.acquirersTable(comparisonGroup, mediaVars);
        comparisonGroup.effectiveBase = ctx.weightVar ? (comparisonTable.total?.nEff ?? null) : null;
      }
    }
  }
  const categoryN = category?.total?.n ?? null;

  let mediaOut: BrandMedia["media"];
  if (!media) mediaOut = unavailableOf(rec.mediaUse, "media use");
  else {
    const byBrand = compareBrandCode !== null;
    const rows = mediaRowsFromResults(focalTable, byBrand ? comparisonTable : category, media, variables, groupMissing(acquirers), byBrand ? (comparisonGroup ? groupMissing(comparisonGroup) : null) : null);
    const comparisonLevel = byBrand ? (comparisonGroup?.status === "ok" ? comparisonGroup.level : null) : categoryN === null ? null : smallBaseLevel(categoryN);
    const focalLevel = acquirers.status === "ok" ? acquirers.level : null;
    let test: Extract<BrandMedia["media"], { status: "ok" }>["test"];
    let tests = new Map<string, MediaTest>();
    if (!groupReadable(acquirers) || (byBrand && !(comparisonGroup && groupReadable(comparisonGroup)))) test = { ran: false, reason: "No test: a group's recent acquirers cannot be told." };
    else if (focalLevel !== "ok" || comparisonLevel !== "ok") test = { ran: false, reason: "No test: a group has fewer than 50 respondents." };
    else if (!byBrand) {
      const banner = await ctx.table(mediaVars, { columnVars: [acquirers.variable], ...TEST_SETTINGS });
      tests = mediaTests(banner, "category", { variable: acquirers.variable, code: acquirers.code }, null, mediaVars, variables);
      test = { ran: true, method: `Each medium tested at the 5% level, ${acquirers.brand.label} recent acquirers against the eligible respondents who are not (the engine's two-proportion test on effective bases); no correction across the media.` };
    } else {
      const other = comparisonGroup as AcquirerGroup & { code: string };
      const key = setKeyOf(question.status === "ok" ? question.measure.byBrand.map((b) => b.variable) : []);
      if (!key) test = { ran: false, reason: "No test: the acquisition question's variables do not share one name stem, so the engine cannot compare the two brands' acquirers." };
      else {
        const banner = await ctx.table(mediaVars, { columnVars: [`set:${key}`], ...TEST_SETTINGS }).catch((e: unknown) => e as Error);
        if (banner instanceof Error) test = { ran: false, reason: `No test: ${banner.message}` };
        else {
          tests = mediaTests(banner, "brand", { variable: acquirers.variable, code: acquirers.code }, { variable: other.variable }, mediaVars, variables);
          test = { ran: true, method: `Each medium tested at the 5% level, ${acquirers.brand.label} recent acquirers against ${other.brand.label} recent acquirers as two groups (the engine's pooled two-proportion test on effective bases; a respondent who acquired both counts in both); no correction across the media.` };
        }
      }
    }
    const noTest: MediaTest = { status: "untested", reason: test.ran ? UNTESTED : test.reason };
    mediaOut = { status: "ok", label: media.label, rows: rows.map((r) => ({ ...r, test: tests.get(r.key) ?? noTest })), test };
  }
  return {
    documentId,
    weighted: ctx.weightVar !== null,
    weightVar: ctx.weightVar,
    effectiveBase: ctx.weightVar && category ? (category.total?.nEff ?? null) : null,
    categoryN,
    acquirers,
    dashboard: { brands: dashboard.brands, focalBrand: dashboard.focalBrand },
    comparison: compareBrandCode === null ? { kind: "category" } : { kind: "brand", group: comparisonGroup! },
    comparisonBrands,
    media: mediaOut,
  };
}
