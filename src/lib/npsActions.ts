"use server";

import { revalidatePath } from "next/cache";

import { buildCrosstab, loadCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { resolveSurveyDesign, effectiveDesignChoice, type SurveyDesignChoice } from "./surveyDesign";
import { loadDataSetupWithStatus } from "./dataSetup";
import { withTenant } from "./db";
import { recordHumanReview } from "./findingProvenance";
import { defaultWeight } from "./starterTables";
import { baseOf, computeNps, leadingNumber } from "./descriptiveFindings";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

export type NpsSegment = {
  name: string;
  /** ANA-NPS-002: kept for existing callers - this is the effective (Kish) base, same number `n`
   * has always held. Prefer rawN/weightedBase/effectiveN below for anything that needs to tell
   * these apart; this field alone cannot. */
  n: number;
  /** Unweighted respondent count in this segment. */
  rawN: number;
  /** Sum of weights in this segment (the weighted base), lost entirely before this fix. */
  weightedBase: number;
  /** Kish effective base in this segment - the same number `n` above holds, named explicitly. */
  effectiveN: number;
  nps: number;
  lo: number;
  hi: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** True when this segment's interval used a cluster-design-effect correction (ANA-NPS-003) rather than the plain SRS formula. */
  designBased: boolean;
  /** True specifically when that correction was the exact design-based promoters-minus-detractors
   * contrast SE (not the average-design-effect approximation). See computeNps in descriptiveFindings.ts. */
  designExact: boolean;
  /** Share choosing each point 0-10 within this segment, same shape as NpsResult.scale, so the full ring/breakdown view can be drawn per segment too. */
  scale: { value: number; pct: number }[];
  // Overnight queue, package 4: a demographic group split (the other producer of NpsSegment,
  // below) shares one file and one resolved design across every segment, so these three stay
  // meaningful only at the whole-result level there and these fields are left undefined for
  // that path. A wave-trend segment is a DIFFERENT file per entry, so its own design detection
  // can genuinely differ wave to wave (one wave's PSU/strata variables present, another's
  // absent or ambiguous) - runWaveNpsAction below populates these per wave from each wave's own
  // NpsResult, which previously computed them and then discarded them when flattening into
  // NpsSegment, instead of carrying them so each wave's card can show its own caveats.
  /** Same meaning as NpsResult.casesMissingDesign, scoped to this one wave/segment's own file. */
  casesMissingDesign?: number | null;
  /** Same meaning as NpsResult.designAmbiguous, scoped to this one wave/segment's own file. */
  designAmbiguous?: { psu: string[]; strata: string[] } | null;
  /** Same meaning as NpsResult.intervalMethod, scoped to this one wave/segment's own file. */
  intervalMethod?: string | null;
};

export type NpsResult = {
  variable: string;
  label: string;
  /** ANA-NPS-002: kept for existing callers - this is the effective (Kish) base, same as it has
   * always been. Prefer rawN/weightedBase/effectiveN below for anything that needs to tell these
   * apart; this field alone conflates them (a weighted 6-person reading used to display "n=5",
   * the rounded effective base, with the real raw n of 6 and the weighted base of 10 nowhere in
   * the record at all). */
  n: number;
  /** Unweighted respondent count the reading is based on. */
  rawN: number;
  /** Sum of weights (the weighted base) - distinct from both the raw n and the effective n below. */
  weightedBase: number;
  /** Kish effective base - the same number `n` above holds, named explicitly. */
  effectiveN: number;
  weighted: boolean;
  /** The actual weight variable used, or null when the table was unweighted. Previously collapsed
   * to the literal string "weighted" (losing which variable it was) whenever `weighted` was true. */
  weightVariable: string | null;
  nps: number;
  lo: number;
  hi: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Share choosing each point 0-10, in order, for the per-point breakdown row under the ring. Overall only. */
  scale: { value: number; pct: number }[];
  /** True when the interval above used a cluster-design-effect correction (ANA-NPS-003) rather than the plain SRS formula. */
  designBased: boolean;
  /** True specifically when that correction was the exact design-based promoters-minus-detractors
   * contrast SE (not the average-design-effect approximation). See computeNps in descriptiveFindings.ts. */
  designExact: boolean;
  groupVariable: string | null;
  groupLabel: string | null;
  /** One entry per category of the group variable, same promoters/detractors math as the overall score. */
  segments: NpsSegment[] | null;
  /** ANA-NPS-003: how many cases were missing the design variable(s) this table was built with -
   * null when no design was requested at all. casesMissingDesign equal to the table's own base
   * means the engine found no usable clustering information and silently fell back to the plain
   * weighted formula (api/parse-stats-file.py's _Design.build degenerate-design guard); any
   * smaller non-zero count still means the design was only partially applied. Previously computed
   * server-side but dropped before it ever reached this result or a committed finding. */
  casesMissingDesign: number | null;
  /** Present only when no explicit design was supplied and the file's variable names matched more
   * than one PSU and/or strata candidate: the heuristic cannot tell them apart, so no design was
   * guessed, and these are the candidates a person would need to resolve between explicitly. */
  designAmbiguous: { psu: string[]; strata: string[] } | null;
  /** The confidence-interval method actually used for this reading's bounds (lo/hi), persisted as
   * explicit metadata rather than only living in code comments - see api/parse-stats-file.py's
   * "intervalMethod" note. */
  intervalMethod: string | null;
};

type Fail = { ok: false; error: string };

/**
 * Runs NPS for one chosen question, on demand, reusing the same crosstab engine and the same
 * promoters/detractors math as the automatic descriptive-findings funnel (computeNps in
 * descriptiveFindings.ts) so this never drifts from what a committed table would have said.
 * The underlying table is built with status "evidence": it answers this one question and is kept
 * out of the Cross tabs list, so picking variables here never clutters it.
 */
export async function runNpsAction(
  runId: string,
  documentId: string,
  variable: string,
  // undefined means "not specified, pick the inferred default weight for me";
  // null means the researcher explicitly chose no weight. The two must stay
  // distinct here, or an explicit "None" silently gets the default back.
  weightVar: string | null | undefined,
  groupVar: string | null = null,
  // ANA-NPS-003: the explicit design-input path this action previously lacked entirely. undefined
  // (the default) means "no researcher choice has been made for this call", which falls back to
  // the same heuristic Cross tabs' own workspace uses (resolveSurveyDesign) - never more. Passing
  // an explicit value, including `null` for a deliberate "no design", always wins over the
  // heuristic; passing `{ psu, strata: null }` is a PSU-only design, a defined input path of its
  // own, not gated on a strata variable also being supplied.
  design?: SurveyDesignChoice | null,
): Promise<{ ok: true; result: NpsResult } | Fail> {
  try {
    // ANA-NPS-003 (Brief 37 repair): the dictionary's build/cache path depends on the
    // document's persisted layout - a required saved input distinct from design. An explicit
    // design argument bypasses the DESIGN lookup (see effectiveDesignChoice below), but it was
    // never meant to let this one go unchecked too - overriding design alone must not authorize
    // defaulting unrelated saved inputs, so this fails visibly regardless of whether `design`
    // was supplied.
    const dictStatus = await loadVariableDictionaryWithStatus(TENANT_ID, runId, documentId);
    if (!dictStatus.ok) {
      return { ok: false, error: `This file's saved set-up could not be read: ${dictStatus.error}` };
    }
    const dict = dictStatus.dictionary;
    // ANA-NPS-003 (second counter-review): when this call didn't bring its own explicit choice,
    // defer to whatever the researcher already persisted for this document (Cross tabs' own
    // "Survey design" control, once it saves there - see CrosstabWorkspace.tsx) before falling
    // back to the bare heuristic, so this on-demand tool and the document's own Cross tabs
    // workspace never silently disagree about which design applies.
    // Codex re-review, package 4 (cross-tab handover repair): effectiveDesignChoice ignores the
    // persisted setup entirely whenever this call brought its own explicit `design` (including an
    // explicit `null` for "no design this time") - in that case a failed lookup of the document's
    // PERSISTED setting literally cannot change the resolved design, so it would be wrong to
    // block this call on it. Only when `design` is undefined - this call has no opinion of its
    // own and defers entirely to whatever was persisted - does a lookup failure matter, and only
    // then does it need to fail actionably rather than silently falling back to the bare
    // heuristic while believing it had honestly checked for a persisted choice.
    const setupStatus = await loadDataSetupWithStatus(TENANT_ID, documentId);
    if (!setupStatus.ok && design === undefined) {
      return { ok: false, error: `This file's saved survey-design set-up could not be read: ${setupStatus.error}` };
    }
    const resolvedDesign = resolveSurveyDesign(dict, effectiveDesignChoice(setupStatus.setup.design, design));
    const v = dict.variables.find((x) => x.name === variable);
    if (!v) return { ok: false, error: "That variable was not found in this file." };
    const g = groupVar ? dict.variables.find((x) => x.name === groupVar) : null;
    if (groupVar && !g) return { ok: false, error: "That grouping variable was not found in this file." };

    const built = await buildCrosstab(
      TENANT_ID,
      runId,
      documentId,
      {
        columnVars: g ? [g.name] : [],
        rowItems: [{ key: variable, label: v.label || variable, vars: [variable] }],
        weightVar: weightVar === undefined ? defaultWeight(dict) : weightVar,
        source: "ask",
        // ANA-NPS-003: an ordinary NPS request previously exposed no design argument at all and
        // always ran its own blind auto-detect, ignoring any explicit choice a caller supplied -
        // resolveSurveyDesign (./surveyDesign) now gives this an explicit input path (the
        // `design` parameter above), with the shared heuristic only as a fallback when no
        // explicit choice was made, and only when it found an unambiguous PSU candidate.
        design: resolvedDesign.design ?? undefined,
      },
      { status: "evidence" },
    );
    const { result } = await loadCrosstab(TENANT_ID, runId, built.tableId);
    if (!result || result.questions.length === 0) return { ok: false, error: "This question could not be tabulated." };

    const q = result.questions[0];
    const dataRows = q.rows.filter((r) => !r.isBase && !r.isEffBase);
    const answers = dataRows.filter((r) => !r.isNet && !r.isScore && !r.isMean && r.total.pct !== null && r.total.pct !== undefined);
    if (answers.length === 0) return { ok: false, error: "This question has no answer categories to read." };
    const n0 = baseOf(answers[0]);
    if (n0 === null) return { ok: false, error: "This question has no usable base." };
    // ANA-NPS-002: the row's own CellBase already keeps raw n, weighted base (w) and effective n
    // (nEff) as three distinct numbers; baseOf collapses them to one (nEff || n) for the actual
    // NPS maths below, which is correct for that maths, but the full base is kept here too so the
    // displayed/saved record never has to guess which of the three a bare "n" meant.
    const totalBase = answers[0].total.base;

    // ANA-NPS-003: row.se is design-based only per banner column; with no real banner variable
    // (g is null here) the table has exactly one column (the synthetic "All respondents"), and
    // that column's se[0] is this same overall reading's own design-based standard error. With a
    // group variable chosen there's no single column standing for "everyone", so the overall
    // figure below falls back to the plain SRS variance (segments, read separately below, each
    // get their own column's se).
    const singleCol = result.columns.length === 1;
    // ANA-NPS-003: prefer the table's own exact design-based contrast SE (Total column) when the
    // engine computed one for this question; computeNps falls back to its approximation when it
    // didn't (no sampling design, or this table isn't an 11-point 0-10 scale).
    const contrastSe = q.npsContrastSe?.total ?? undefined;
    // ANA-NPS-003 (second counter-review): a row's `se` falls back to a plain SRS/Kish formula
    // whenever the design was not actually applied (never requested, or requested but abandoned
    // because every case was missing its design info), and that fallback is not distinguishable
    // from a genuine design-based category SE just by its presence - see parseStatsFile.ts's
    // designApplied comment. Gate on it so an abandoned design is never mislabelled design-based.
    const designApplied = result.notes?.designApplied === true;
    const nps = computeNps(answers, n0, (r) => r.total.pct, singleCol && designApplied ? (r) => r.se?.[0] ?? null : () => null, contrastSe);
    if (!nps) {
      return {
        ok: false,
        error: "This doesn't look like an 11-point 0 to 10 scale (needs an answer coded 0, one coded 10, and 11 answers in between).",
      };
    }
    // ANA-NPS-001: a suppressed scale point (small base) is not a usable 0% - it would silently
    // understate whichever side it falls on and change the reported score. Surface this as an
    // explicit unavailable state rather than posting a Net Promoter Score computed by treating
    // the missing point as zero.
    if (nps.suppressed) {
      return {
        ok: false,
        error: "One or more points on this 0 to 10 scale are suppressed for a small base, so the Net Promoter Score can't be computed reliably from this table.",
      };
    }
    const scale = answers
      .map((r) => ({ value: leadingNumber(r.label), pct: r.total.pct ?? 0 }))
      .filter((x): x is { value: number; pct: number } => x.value !== null && x.value >= 0 && x.value <= 10)
      .sort((a, b) => a.value - b.value);

    let segments: NpsSegment[] | null = null;
    if (g) {
      const baseAt = (r: (typeof answers)[number], i: number): { n: number; w: number; nEff: number; eff: number } | null => {
        const b = r.base[i];
        if (!b) return null;
        const eff = b.nEff || b.n;
        return eff > 0 ? { n: b.n, w: b.w, nEff: b.nEff, eff } : null;
      };
      segments = result.columns
        .map((c, i) => {
          const segBase = baseAt(answers[0], i);
          if (segBase === null) return null;
          const nI = segBase.eff;
          const segContrastSe = q.npsContrastSe?.columns?.[i] ?? undefined;
          const segNps = computeNps(answers, nI, (r) => r.pct[i] ?? null, designApplied ? (r) => r.se?.[i] ?? null : () => null, segContrastSe);
          // A suppressed point within this one segment makes only this segment's reading
          // unavailable (ANA-NPS-001); the segment is dropped rather than shown with a score
          // that silently treated the missing point as 0.
          if (!segNps || segNps.suppressed) return null;
          const segScale = answers
            .map((r) => ({ value: leadingNumber(r.label), pct: r.pct[i] ?? 0 }))
            .filter((x): x is { value: number; pct: number } => x.value !== null && x.value >= 0 && x.value <= 10)
            .sort((a, b) => a.value - b.value);
          const { suppressed: _segSuppressed, ...segNpsFields } = segNps;
          return {
            name: c.name,
            n: Math.round(nI),
            rawN: segBase.n,
            weightedBase: segBase.w,
            effectiveN: Math.round(nI),
            scale: segScale,
            ...segNpsFields,
          };
        })
        .filter((x): x is NpsSegment => x !== null);
    }

    const { suppressed: _overallSuppressed, ...npsFields } = nps;
    return {
      ok: true,
      result: {
        variable,
        label: v.label || variable,
        n: Math.round(n0),
        rawN: totalBase.n,
        weightedBase: totalBase.w,
        effectiveN: Math.round(n0),
        weighted: !!result.weightVar,
        weightVariable: result.weightVar ?? null,
        scale,
        groupVariable: g?.name ?? null,
        groupLabel: g ? g.label || g.name : null,
        segments,
        casesMissingDesign: result.notes?.designUsed?.casesMissingDesign ?? null,
        designAmbiguous:
          resolvedDesign.ambiguous.psu.length > 0 || resolvedDesign.ambiguous.strata.length > 0 ? resolvedDesign.ambiguous : null,
        intervalMethod: result.notes?.intervalMethod ?? null,
        ...npsFields,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}


/**
 * Commits an on-demand NPS reading to findings, the same way a committed Cross tabs table would have
 * produced one (descriptiveFindings.ts, patternType "level", testType "nps") so it shows up, reads and
 * counts the same way everywhere else in the app. Idempotent per variable: calling it again for the same
 * question is a no-op (or revives one taken out of use), so re-opening the NPS tool never doubles it up.
 */
export async function addNpsFindingAction(
  runId: string,
  documentId: string,
  result: NpsResult,
): Promise<{ ok: true; added: boolean } | Fail> {
  try {
    await withTenant(TENANT_ID, async (client) => {
      // Scoped by source_document_id too, not just the variable name: two documents in the
      // same run (two waves, say) can each have their own variable with the same name, and
      // without this a second document's reading would be mistaken for an existing finding
      // (or silently toggle the first document's instead of posting its own).
      const existing = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'level' and stated_stats->>'testType' = 'nps' and stated_stats->>'source' = 'nps_tool' and stated_stats->>'variable' = $2 and source_document_id = $3 and status <> 'rejected'",
        [runId, result.variable, documentId],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) return;
      const revived = await client.query<{ id: string }>(
        "update findings set status = 'accepted' where run_id = $1 and pattern_type = 'level' and stated_stats->>'testType' = 'nps' and stated_stats->>'source' = 'nps_tool' and stated_stats->>'variable' = $2 and source_document_id = $3 and status = 'rejected' returning id",
        [runId, result.variable, documentId],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const text = `Net Promoter Score on ${result.label} is ${result.nps} (promoters ${result.promoters}%, passives ${result.passives}%, detractors ${result.detractors}%; 95% interval ${result.lo} to ${result.hi}; ${result.weighted ? "weighted" : "unweighted"}, base ${result.n}).`;
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1, $2, 'generated', $3, $4, 'level', $5, 'quantitative', 'accepted', $6)
         returning id`,
        [
          TENANT_ID,
          runId,
          text,
          result.label,
          JSON.stringify({
            source: "nps_tool",
            variable: result.variable,
            question: result.label,
            testType: "nps",
            value: result.nps,
            lo: result.lo,
            hi: result.hi,
            promoters: result.promoters,
            passives: result.passives,
            detractors: result.detractors,
            // ANA-NPS-002: n/effectiveBase were both the rounded effective base, with the real raw
            // n and the weighted base nowhere in the stored record, and weightVar stored the
            // literal string "weighted" rather than which variable that was. All three bases and
            // the actual weight variable name are now kept distinct.
            n: result.n,
            rawN: result.rawN,
            weightedBase: result.weightedBase,
            effectiveBase: result.effectiveN,
            weightVar: result.weightVariable,
            // ANA-NPS-003: this reading's own interval qualification - whether a cluster design
            // was detected and applied for this file (see resolveSurveyDesign in ./surveyDesign),
            // and whether the correction used was the exact design-based contrast SE or the
            // average-design-effect approximation (computeNps, descriptiveFindings.ts) - used to
            // be computed for the on-screen result and then dropped the moment it was committed
            // to findings, leaving the committed record indistinguishable from a plain SRS
            // reading. designExact describes which variance calculation ran, not whether the
            // interval itself is exact for a finite sample - it is still a 1.96 normal-approximation
            // interval either way.
            designBased: result.designBased,
            designExact: result.designExact,
            // ANA-NPS-003: casesMissingDesign, designAmbiguous and intervalMethod used to be
            // computed for the on-screen reading and then dropped the moment it was committed -
            // a design that was requested but entirely missing for every case (or ambiguous, or
            // only partially present) reached findings/exports looking identical to a clean
            // design-based reading. All three are now carried through unconditionally, not just
            // when they happen to be non-null, so a later consumer can always tell apart "no
            // design was ever asked for" from "a design was asked for and couldn't be (fully)
            // applied".
            casesMissingDesign: result.casesMissingDesign,
            designAmbiguous: result.designAmbiguous,
            intervalMethod: result.intervalMethod,
            caveats: [
              "descriptive_reading",
              "weighted_effective_base",
              ...(result.designBased ? ["survey_design_modelled"] : ["survey_design_not_modelled", "sampling_assumed_random"]),
              // A design that WAS modelled but with some (or all) cases missing their design
              // variable(s) is still "survey_design_modelled" above (it is accurate as far as it
              // goes), but that alone reads as a clean, fully-applied design - this caveat makes
              // the partial/total gap explicit rather than letting the finding imply more
              // coverage than the data actually had.
              ...(result.designBased && result.casesMissingDesign ? ["survey_design_missing_for_some_cases"] : []),
              ...(result.designAmbiguous ? ["survey_design_candidates_ambiguous"] : []),
            ],
          }),
          documentId,
        ],
      );
      await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, added: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Takes an NPS finding out of use (rejected, not deleted, so adding it again restores it). */
export async function removeNpsFindingAction(runId: string, documentId: string, variable: string): Promise<{ ok: true; removed: number } | Fail> {
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        "update findings set status = 'rejected' where run_id = $1 and pattern_type = 'level' and stated_stats->>'testType' = 'nps' and stated_stats->>'source' = 'nps_tool' and stated_stats->>'variable' = $2 and source_document_id = $3 and status <> 'rejected' returning id",
        [runId, variable, documentId],
      );
      await recordHumanReview(client, r.rows.map((row) => row.id), "tool_remove");
      return r.rowCount ?? 0;
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Whether this NPS question is currently committed to findings (for the button state in the tool). */
export async function npsFindingStatusAction(runId: string, documentId: string, variable: string): Promise<{ ok: true; committed: boolean } | Fail> {
  try {
    const committed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'level' and stated_stats->>'testType' = 'nps' and stated_stats->>'source' = 'nps_tool' and stated_stats->>'variable' = $2 and source_document_id = $3 and status <> 'rejected'",
        [runId, variable, documentId],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
