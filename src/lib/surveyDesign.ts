import type { VariableDictionary } from "./parseStatsFile";

/**
 * ANA-NPS-003: the survey-design heuristic shared by every caller that can guess a PSU/strata
 * variable from a dictionary's variable names - the manual Cross tabs workspace (a client
 * component) and the automatic NPS/Objectives/brand-health/CSM/wave-tracking actions (server-only
 * modules) alike. This file deliberately imports nothing beyond plain types, so it is safe to pull
 * into a "use client" component without dragging in the server-only database client those other
 * callers' own modules (crosstabs.ts, db.ts) depend on - the reason the workspace previously carried
 * its own duplicate copy of this same regex heuristic instead of importing the shared one.
 */

export type DetectedDesign = {
  /** An unambiguous single match, or null when none or more than one candidate was found. A
   * design can have a PSU with no strata (or, in principle, be asked for with strata alone -
   * see resolveSurveyDesign below): the two are resolved independently, never gated on each
   * other, so a PSU-only or strata-only file has as defined an auto-detection path as one with
   * both. */
  psu: string | null;
  strata: string | null;
  /** Every candidate name the heuristic found for each role, however many. More than one means
   * `psu`/`strata` above is deliberately null - an ambiguous pick is never silently guessed -
   * and the caller/UI can use this list to let a person resolve it explicitly. */
  psuCandidates: string[];
  strataCandidates: string[];
};

export function detectSurveyDesign(dict: Pick<VariableDictionary, "variables">): DetectedDesign {
  const names = dict.variables.map((v) => v.name);
  const psuCandidates = names.filter((n) => /^(ea_?code|ea|psu|cluster|enumeration)/i.test(n));
  const strataCandidates = names.filter((n) => /(^|_)(strat|stratum|strata)/i.test(n));
  return {
    psu: psuCandidates.length === 1 ? psuCandidates[0] : null,
    strata: strataCandidates.length === 1 ? strataCandidates[0] : null,
    psuCandidates,
    strataCandidates,
  };
}

export type SurveyDesignChoice = { psu: string | null; strata?: string | null };
export type ResolvedSurveyDesign = {
  /** ANA-NPS-003 (second counter-review): `psu` is nullable - a strata-only design (a
   * stratification variable with no separate clustering variable) is a supported, distinct
   * outcome from `design: null` ("no design at all"), matching the engine's own treatment
   * (_Design.build in api/parse-stats-file.py: each case becomes its own primary sampling unit
   * within its stratum when no PSU variable is given but a stratum variable is). Previously this
   * function collapsed a strata-only result - whether detected or explicitly chosen - into "no
   * design", silently discarding real stratification the engine was fully able to use. */
  design: { psu: string | null; strata: string | null } | null;
  /** Candidate names the heuristic could not tell apart, by role - populated only when `source`
   * is "auto" and a role had more than one candidate; empty whenever an explicit choice was
   * supplied (an explicit pick is never second-guessed) or none were found at all. */
  ambiguous: { psu: string[]; strata: string[] };
  /** "explicit": the caller supplied its own choice (including a deliberate "no design"), which
   * always wins over the heuristic. "auto": no explicit choice was supplied, so the heuristic's
   * own unambiguous match (if any) was used. "none": no explicit choice, and the heuristic found
   * either nothing or an ambiguous set of candidates - this is never silently guessed into a
   * design. */
  source: "explicit" | "auto" | "none";
};

/**
 * The one place that decides which survey design (if any) applies, for every caller - the
 * defined input path Codex found missing from the NPS and Objectives actions (crosstabs.ts:154,
 * npsActions.ts:118): `explicit`, when supplied (including as `null`, a deliberate "no design"),
 * always wins over the heuristic below it, exactly matching "explicit researcher configuration
 * wins over heuristic detection." Leaving `explicit` undefined (no researcher choice has been
 * made for this call) falls back to the heuristic.
 *
 * ANA-NPS-003 (second counter-review): PSU and strata are resolved independently of each other on
 * both the explicit and the heuristic path - a strata-only outcome (no PSU, a stratum variable
 * present) is a real, supported design, not "no design". An ambiguous or absent PSU candidate
 * still never becomes a guessed PSU; it only means `design.psu` stays null while `design.strata`
 * can still carry an unambiguous stratum match, with the PSU ambiguity itself still surfaced via
 * `ambiguous.psu` so a caller can qualify or let a researcher resolve it explicitly, exactly as
 * before. `design` is null only when NEITHER role resolved to anything at all.
 */
/**
 * ANA-NPS-003 (second counter-review): combines a caller's own per-call design choice, if any,
 * with the document's PERSISTED setting (DataSetup.design, see dataSetupShared.ts), so a caller
 * with no opinion of its own (the on-demand NPS tool and Objectives' batch evaluator, neither of
 * which expose their own design picker) defers to whatever a researcher already chose for this
 * document - in Cross tabs, say - instead of only ever falling back to the bare name-pattern
 * heuristic. This is how "persist the choice... and use it consistently across analytical tools
 * and Objectives" is satisfied without each tool needing its own copy of the persisted setting's
 * three-way semantics: they all go through this one function before calling resolveSurveyDesign.
 *
 * Returns the same three-way shape resolveSurveyDesign's own `explicit` parameter takes:
 *  - the caller's own choice, unchanged, whenever it supplied one (including `null` for an
 *    explicit "no design" for this one call) - a caller's own choice is never second-guessed;
 *  - otherwise, derived from the persisted setting: `undefined` when there is none or it is
 *    "auto" (falls through to resolveSurveyDesign's heuristic, unchanged from before this
 *    existed); `null` when it is "none" (explicit no design); the concrete `{psu, strata}` when
 *    it is "explicit".
 * Takes the loosely-typed shape DataDesignChoice has (rather than importing that type) so this
 * file keeps its own "no imports beyond plain types" property intact.
 */
export function effectiveDesignChoice(
  persisted: { mode: "auto" | "explicit" | "none"; psu: string | null; strata: string | null } | null | undefined,
  callerChoice: SurveyDesignChoice | null | undefined,
): SurveyDesignChoice | null | undefined {
  if (callerChoice !== undefined) return callerChoice;
  if (!persisted || persisted.mode === "auto") return undefined;
  if (persisted.mode === "none") return null;
  return { psu: persisted.psu, strata: persisted.strata };
}

export function resolveSurveyDesign(
  dict: Pick<VariableDictionary, "variables">,
  explicit?: SurveyDesignChoice | null,
): ResolvedSurveyDesign {
  const detected = detectSurveyDesign(dict);
  const ambiguous = {
    psu: detected.psuCandidates.length > 1 ? detected.psuCandidates : [],
    strata: detected.strataCandidates.length > 1 ? detected.strataCandidates : [],
  };
  if (explicit !== undefined) {
    if (!explicit || (!explicit.psu && !explicit.strata)) {
      return { design: null, ambiguous: { psu: [], strata: [] }, source: "explicit" };
    }
    return { design: { psu: explicit.psu ?? null, strata: explicit.strata ?? null }, ambiguous: { psu: [], strata: [] }, source: "explicit" };
  }
  if (detected.psu || detected.strata) {
    return { design: { psu: detected.psu, strata: detected.strata }, ambiguous, source: "auto" };
  }
  return { design: null, ambiguous, source: "none" };
}
