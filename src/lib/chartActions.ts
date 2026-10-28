"use server";

import { revalidatePath } from "next/cache";

import { buildCrosstab, loadCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { resolveSurveyDesign, effectiveDesignChoice } from "./surveyDesign";
import { loadDataSetupWithStatus } from "./dataSetup";
import { withTenant } from "./db";
import { recordHumanReview } from "./findingProvenance";
import { defaultWeight } from "./starterTables";
import { baseOf } from "./descriptiveFindings";
import { exactPct, exactTotalPct } from "./crosstabExact";
import { requireTenantId } from "./requestContext";

const round1 = (x: number) => Math.round(x * 10) / 10;

export type ChartSeries = {
  name: string;
  n: number;
  /** rawCode: the bar's underlying answer code when the source row carried one (CrosstabRow.rawCode) -
   * see ANA-BRAND-002: wave tracking aligns bars across waves on this, not on `label`, since a wording-only
   * value-label change between waves must not look like a different category.
   * share: the bar's percentage unrounded (the engine's pctExact; CT5K-F01), null where the table
   * suppressed it, for figures derived from several bars (csmMetrics.summarizeSeries). `pct` is the
   * one-decimal display value (0 for a suppressed cell, as drawn). Absent on series built elsewhere
   * (wave tracking), which summarizeSeries reads from pct. */
  bars: { label: string; pct: number; share?: number | null; rawCode?: string }[];
};

export type ChartResult = {
  variable: string;
  label: string;
  n: number;
  weighted: boolean;
  /** Set when a group variable split the chart into more than one series. */
  grouped: boolean;
  groupLabel: string | null;
  series: ChartSeries[];
  /**
   * How the bars were made, as this action actually built them (IR-10, 2026-10-20): "bins" when the
   * engine returned no answer categories and its histogram ranges were used, "values" when each bar
   * is one answer category (which includes a numeric question tabulated as categories, for example
   * after a researcher's categorical correction). Charts describe their encoding from this, never
   * from a guess about the variable. Absent on results built elsewhere (wave tracking).
   */
  method?: ChartMethod;
};

/** See ChartResult.method. */
export type ChartMethod = "bins" | "values";

type Fail = { ok: false; error: string };

/**
 * One variable's answer distribution, read straight off the file the same way the NPS tool does: an
 * evidence crosstab (status "evidence", kept out of the Cross tabs list) read back for its Total column,
 * or, with a group variable, its columns, one per group category (the same banner mechanism Cross tabs
 * uses, so "split by gender" reads exactly as it would in a committed table). A purely continuous
 * question with no answer categories falls back to its histogram bins.
 */
export async function runDistributionAction(
  runId: string,
  documentId: string,
  variable: string,
  // undefined means "not specified, pick the inferred default weight for me";
  // null means the researcher explicitly chose no weight. The two must stay
  // distinct here, or an explicit "None" silently gets the default back.
  weightVar: string | null | undefined,
  groupVar: string | null,
): Promise<{ ok: true; result: ChartResult } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    // ANA-NPS-003 (Brief 37 repair): the dictionary's build/cache path depends on the
    // document's persisted layout - a required saved input distinct from design, and not
    // superseded by any design override this caller might have - so a failed lookup here must
    // fail this request too, not silently build off a defaulted layout.
    const dictStatus = await loadVariableDictionaryWithStatus(TENANT_ID, runId, documentId);
    if (!dictStatus.ok) {
      return { ok: false, error: `This file's saved set-up could not be read: ${dictStatus.error}` };
    }
    const dict = dictStatus.dictionary;
    const v = dict.variables.find((x) => x.name === variable);
    if (!v) return { ok: false, error: "That variable was not found in this file." };
    const g = groupVar ? dict.variables.find((x) => x.name === groupVar) : null;
    if (groupVar && !g) return { ok: false, error: "That grouping variable was not found in this file." };

    // ANA-NPS-003 (second counter-review): this chart previously applied no survey design at all,
    // not even the name-pattern heuristic Cross tabs and the NPS tool already use - a distribution
    // chart's percentages and standard errors were always plain SRS, even on a document with an
    // unambiguous PSU variable or a researcher's own persisted design choice. Deferring to the
    // document's setting (falling back to the heuristic when none is set) closes that gap and
    // brings this tool in line with "apply it consistently... across analytical tools."
    // Codex re-review, package 4 (cross-tab handover repair): this chart has no design input of
    // its own either, so a lookup failure for the document's persisted setting must not silently
    // fall back to the bare heuristic while the caller believes a persisted choice was honestly
    // checked. Fails actionably here instead of computing (and the caller then possibly saving)
    // a result built on a guess rather than the researcher's actual saved choice.
    const setupStatus = await loadDataSetupWithStatus(TENANT_ID, documentId);
    if (!setupStatus.ok) {
      return { ok: false, error: `This file's saved survey-design set-up could not be read: ${setupStatus.error}` };
    }
    const setup = setupStatus.setup;
    const resolvedDesign = resolveSurveyDesign(dict, effectiveDesignChoice(setup.design, undefined));

    const built = await buildCrosstab(
      TENANT_ID,
      runId,
      documentId,
      {
        columnVars: g ? [g.name] : [],
        rowItems: [{ key: variable, label: v.label || variable, vars: [variable] }],
        weightVar: weightVar === undefined ? defaultWeight(dict) : weightVar,
        source: "ask",
        design: resolvedDesign.design ?? undefined,
      },
      { status: "evidence" },
    );
    const { result } = await loadCrosstab(TENANT_ID, runId, built.tableId);
    if (!result || result.questions.length === 0) return { ok: false, error: "This question could not be tabulated." };

    const q = result.questions[0];
    const dataRows = q.rows.filter((r) => !r.isBase && !r.isEffBase && !r.isNet && !r.isScore && !r.isMean);
    const answers = dataRows.filter((r) => r.total.pct !== null && r.total.pct !== undefined);

    if (answers.length === 0) {
      // No discrete answer categories (a continuous question such as age or income): fall back to its
      // histogram, when one was computed, so it can still be charted. Not available split by group yet.
      const hist = q.desc?.hist;
      if (hist && hist.length > 0 && !g) {
        const n = q.desc?.n ?? 0;
        return {
          ok: true,
          result: {
            variable,
            label: v.label || variable,
            n: Math.round(n),
            weighted: !!result.weightVar,
            grouped: false,
            groupLabel: null,
            method: "bins",
            series: [
              {
                name: "All respondents",
                n: Math.round(n),
                bars: hist.map((b) => ({ label: b.lo === b.hi ? `${b.lo}` : `${b.lo} to ${b.hi}`, pct: round1(b.pct), share: b.pctExact ?? b.pct })),
              },
            ],
          },
        };
      }
      return {
        ok: false,
        error: g
          ? "This question has no answer categories to chart grouped. Pick one with discrete answers."
          : "This question has no answer categories to chart, and no histogram could be computed either. Pick one with discrete answers.",
      };
    }

    const n0 = baseOf(answers[0]) ?? 0;

    if (!g) {
      return {
        ok: true,
        result: {
          variable,
          label: v.label || variable,
          n: Math.round(n0),
          weighted: !!result.weightVar,
          grouped: false,
          groupLabel: null,
          method: "values",
          series: [{ name: "All respondents", n: Math.round(n0), bars: answers.map((r) => ({ label: r.label, pct: round1(r.total.pct as number), share: exactTotalPct(r), rawCode: r.rawCode })) }],
        },
      };
    }

    // ANA-BRAND-001: a series' `n` is how many respondents ANSWERED this question within that
    // column, not how large the banner column/segment is overall - `answers[0].base[i]` (every
    // answer row of one question shares the same per-column base) is the question's own
    // answered base for column i, read off the same CellBase the table itself uses for that
    // column's base row. `result.columns[i].n/nEff` is the banner column's raw membership size
    // (eg "how many respondents are Brand X"), which can be much larger than how many of them
    // actually answered this particular question (a skip pattern, a screening question, or
    // simple non-response) - using it as this series' base understated how much eligibility
    // differed between two things being compared on the same banner (brandHealthActions.ts's
    // funnel-stage ratio reads this same `n`, so a banner of 200 respondents per brand looked
    // "the same base" for a stage only 100 of them were actually asked).
    const series: ChartSeries[] = result.columns.map((c, i) => {
      const answeredBase = answers[0]?.base?.[i];
      const n = answeredBase ? (answeredBase.nEff || answeredBase.n) : (c.nEff || c.n);
      return {
        name: c.name,
        n: Math.round(n),
        bars: answers.map((r) => ({ label: r.label, pct: r.pct[i] !== null && r.pct[i] !== undefined ? round1(r.pct[i] as number) : 0, share: exactPct(r, i), rawCode: r.rawCode })),
      };
    });

    return {
      ok: true,
      result: {
        variable,
        label: v.label || variable,
        n: Math.round(n0),
        weighted: !!result.weightVar,
        grouped: true,
        method: "values",
        groupLabel: g.label || g.name,
        series,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One line summarising a chart's distribution, for the finding text. */
function describeChart(result: ChartResult): string {
  const base = result.weighted ? "weighted" : "unweighted";
  if (!result.grouped) {
    const bars = result.series[0]?.bars ?? [];
    const top = [...bars].sort((a, b) => b.pct - a.pct)[0];
    const topText = top ? `, led by "${top.label}" at ${top.pct}%` : "";
    return `Answers to "${result.label}" (n=${result.n}, ${base})${topText}.`;
  }
  const parts = result.series
    .map((s) => {
      const top = [...s.bars].sort((a, b) => b.pct - a.pct)[0];
      return top ? `${s.name} ${top.pct}% "${top.label}" (n=${s.n})` : `${s.name} (n=${s.n})`;
    })
    .join("; ");
  return `Answers to "${result.label}" split by ${result.groupLabel} (${base}): ${parts}.`;
}

/**
 * Posts (or re-posts) a chart's distribution as a finding. Keyed on the variable plus its optional
 * group variable, so charting the same question two different ways (overall, then split by gender)
 * produces two findings rather than one overwriting the other, the same dedupe shape the NPS tool uses.
 */
export async function addChartFindingAction(
  runId: string,
  documentId: string,
  result: ChartResult,
  groupVar: string | null,
): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    await withTenant(TENANT_ID, async (client) => {
      // Scoped by source_document_id too: two documents in the same run (two waves, say) can
      // each have their own variable of the same name, and without this a second document's
      // chart would be mistaken for an existing finding from the first.
      const existing = await client.query<{ n: number }>(
        `select count(*)::int as n from findings
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'chart_tool'
           and stated_stats->>'variable' = $2 and coalesce(stated_stats->>'groupVar', '') = coalesce($3, '')
           and source_document_id = $4 and status <> 'rejected'`,
        [runId, result.variable, groupVar, documentId],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) return;
      const revived = await client.query<{ id: string }>(
        `update findings set status = 'accepted'
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'chart_tool'
           and stated_stats->>'variable' = $2 and coalesce(stated_stats->>'groupVar', '') = coalesce($3, '')
           and source_document_id = $4 and status = 'rejected'
         returning id`,
        [runId, result.variable, groupVar, documentId],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const text = describeChart(result);
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
            source: "chart_tool",
            variable: result.variable,
            question: result.label,
            testType: "distribution",
            groupVar: groupVar ?? null,
            groupLabel: result.groupLabel,
            n: result.n,
            effectiveBase: result.n,
            weightVar: result.weighted ? "weighted" : null,
            series: result.series,
            caveats: ["descriptive_reading"],
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

export async function removeChartFindingAction(
  runId: string,
  documentId: string,
  variable: string,
  groupVar: string | null,
): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        `update findings set status = 'rejected'
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'chart_tool'
           and stated_stats->>'variable' = $2 and coalesce(stated_stats->>'groupVar', '') = coalesce($3, '')
           and source_document_id = $4 and status <> 'rejected'
         returning id`,
        [runId, variable, groupVar, documentId],
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

/** Whether this chart (variable + optional group) is currently committed to findings. */
export async function chartFindingStatusAction(
  runId: string,
  documentId: string,
  variable: string,
  groupVar: string | null,
): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const committed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        `select count(*)::int as n from findings
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'chart_tool'
           and stated_stats->>'variable' = $2 and coalesce(stated_stats->>'groupVar', '') = coalesce($3, '')
           and source_document_id = $4 and status <> 'rejected'`,
        [runId, variable, groupVar, documentId],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

