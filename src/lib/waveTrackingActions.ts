"use server";

import { revalidatePath } from "next/cache";

import { withTenant, withTenantRead } from "./db";
import { recordHumanReview } from "./findingProvenance";
import { loadVariableDictionary } from "./crosstabs";
import { normaliseDataSetup } from "./dataSetupShared";
import { projectWaves, waveOrderText, type OrderedWave } from "./waves";
import { runDistributionAction, type ChartResult } from "./chartActions";
import { runNpsAction, type NpsResult, type NpsSegment } from "./npsActions";
import { runDriverAnalysisFor, type DriverReport } from "./drivers";
import { recordForRow } from "./driverPresentation";
import { requireTenantId } from "./requestContext";

type Fail = { ok: false; error: string };

export type WaveFile = OrderedWave;

/**
 * The waves in this run's analysis (`projectWaves`): raw case-level data files labelled with a wave
 * (set on the file itself, under Import data), those the researcher took out left out, in fieldwork
 * order when every wave has a date and in upload order otherwise, with the basis said in words. A
 * one-off project with no file labelled this way returns an empty list, so nothing about Wave tracking
 * shows up unless the researcher has actually marked at least one file as a wave.
 */
export async function listWaveFilesAction(runId: string): Promise<{ ok: true; files: WaveFile[]; excluded: WaveFile[]; order: string } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const files = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string; source_filename: string; data_setup: unknown; uploaded_at: Date | string }>(
        `select id, source_filename, data_setup, uploaded_at from documents
         where run_id = $1 and kind = 'table' and ingestion_type = 'raw' and data_setup is not null
         order by uploaded_at asc`,
        [runId],
      );
      return projectWaves(r.rows.map((row) => ({ documentId: row.id, filename: row.source_filename, uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at), setup: normaliseDataSetup(row.data_setup) })));
    });
    return { ok: true, files: files.included, excluded: files.excluded, order: waveOrderText(files.basis) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Questions present in every labelled wave file (matched by variable name, the same questionnaire
 * repeated over time), so the picker only ever offers something that can actually be compared across all
 * of them rather than failing part way through a build.
 */
export async function sharedWaveVariablesAction(
  runId: string,
  documentIds: string[],
): Promise<{ ok: true; variables: { name: string; label: string }[]; weights: { name: string; label: string }[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    if (documentIds.length === 0) return { ok: true, variables: [], weights: [] };
    const dicts = await Promise.all(documentIds.map((id) => loadVariableDictionary(TENANT_ID, runId, id)));
    const [first, ...rest] = dicts;
    const shared = first.variables.filter((v) => rest.every((d) => d.variables.some((x) => x.name === v.name)));
    const variables = shared.map((v) => ({ name: v.name, label: v.label || v.name }));
    const weights = shared.filter((v) => v.weightLike).map((v) => ({ name: v.name, label: v.label || v.name }));
    return { ok: true, variables, weights };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * One question's answer distribution, read once per wave and lined up on a shared set of answer labels so
 * the bars stay comparable even if an answer nobody picked that round dropped out of one wave's own crosstab
 * (it reads as 0% there instead of vanishing and throwing off the alignment). Reuses runDistributionAction
 * file by file rather than inventing a second reading of the data, so a wave chart always matches what the
 * single-file chart tool would say about that same file and question.
 */
export async function runWaveChartAction(
  runId: string,
  files: WaveFile[],
  variable: string,
  weightVar: string | null,
): Promise<{ ok: true; result: ChartResult } | Fail> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  try {
    if (files.length < 2) return { ok: false, error: "Label at least two files as waves to compare them." };
    const perWave: { f: WaveFile; result: ChartResult }[] = [];
    for (const f of files) {
      const r = await runDistributionAction(runId, f.documentId, variable, weightVar, null);
      if (!r.ok) return { ok: false, error: `${f.wave}: ${r.error}` };
      perWave.push({ f, result: r.result });
    }
    // ANA-BRAND-002: align on each bar's underlying answer code (rawCode), not its display label -
    // a codebook can relabel the same code between waves (eg "Good" -> "Excellent") without the
    // category itself changing, and matching on label text alone would read that as one category
    // vanishing and a new one appearing, splitting what is really one trend line into two and
    // misreporting it as 100%/0% swings. A bar with no rawCode (an older saved table, or a
    // variable with no value labels at all, where the label text is the only identity it has)
    // falls back to using its own label as the key - unchanged behaviour for that case. The label
    // shown for each aligned key is the latest wave's own wording, so a genuine relabel is
    // reflected in the chart rather than hidden by always showing the first wave's wording.
    const keyOf = (b: { label: string; rawCode?: string }) => b.rawCode ?? b.label;
    const keys: string[] = [];
    const displayLabel = new Map<string, string>();
    for (const { result } of perWave) {
      for (const b of result.series[0]?.bars ?? []) {
        const k = keyOf(b);
        if (!keys.includes(k)) keys.push(k);
        displayLabel.set(k, b.label);
      }
    }
    const series = perWave.map(({ f, result }) => {
      const byKey = new Map((result.series[0]?.bars ?? []).map((b) => [keyOf(b), b.pct] as const));
      return { name: f.wave, n: result.n, bars: keys.map((k) => ({ label: displayLabel.get(k) ?? k, pct: byKey.get(k) ?? 0 })) };
    });
    const sample = perWave[0].result;
    return {
      ok: true,
      result: {
        variable,
        label: sample.label,
        n: perWave.reduce((a, { result }) => a + result.n, 0),
        weighted: sample.weighted,
        grouped: true,
        groupLabel: "Wave",
        series,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * NPS read once per wave on an 11-point question, assembled as one NpsResult: the most recent wave stands
 * as the headline ring and breakdown, and every wave (that one included) is listed under `segments`, the
 * same shape a group-variable split already produces, so the existing by-segment comparison bars in
 * NpsVisual double as the wave-over-wave trend with no new chart to build or maintain.
 */
export async function runWaveNpsAction(
  runId: string,
  files: WaveFile[],
  variable: string,
  weightVar: string | null,
): Promise<{ ok: true; result: NpsResult } | Fail> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  try {
    if (files.length < 2) return { ok: false, error: "Label at least two files as waves to compare them." };
    const perWave: { f: WaveFile; result: NpsResult }[] = [];
    for (const f of files) {
      const r = await runNpsAction(runId, f.documentId, variable, weightVar, null);
      if (!r.ok) return { ok: false, error: `${f.wave}: ${r.error}` };
      perWave.push({ f, result: r.result });
    }
    const latest = perWave[perWave.length - 1].result;
    const segments: NpsSegment[] = perWave.map(({ f, result }) => ({
      name: f.wave,
      n: result.n,
      rawN: result.rawN,
      weightedBase: result.weightedBase,
      effectiveN: result.effectiveN,
      nps: result.nps,
      lo: result.lo,
      hi: result.hi,
      promoters: result.promoters,
      passives: result.passives,
      detractors: result.detractors,
      designBased: result.designBased,
      designExact: result.designExact,
      scale: result.scale,
      // Overnight queue, package 4: these three used to be computed per wave (inside the
      // runNpsAction call just above) and then dropped the moment this segment literal was
      // built, since NpsSegment didn't carry them. Each wave is its own file, so its own
      // missing-design count, design-candidate ambiguity and interval method can genuinely
      // differ from the next wave's - this is now preserved per wave, not just at the
      // single (latest-wave) `result` used for the headline numbers above.
      casesMissingDesign: result.casesMissingDesign,
      designAmbiguous: result.designAmbiguous,
      intervalMethod: result.intervalMethod,
    }));
    return {
      ok: true,
      result: { ...latest, groupVariable: "wave", groupLabel: "Wave", segments },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --- Findings --------------------------------------------------------------------------
//
// Posted under pattern_type 'trend' with their own source tags (wave_nps_tool / wave_chart_tool),
// separate from the plain nps_tool/chart_tool findings the per-file Analytics panels post: the same
// variable name is shared by every wave file on purpose (same questionnaire, repeated), so reusing those
// tools' dedupe keys here would collide with, or get shadowed by, an unrelated single-file reading of the
// same question.

function describeWaveNps(segments: NpsSegment[], label: string, weighted: boolean): string {
  const parts = segments.map((s) => `${s.name} ${s.nps} (n=${s.n.toLocaleString()})`).join(", ");
  const first = segments[0];
  const last = segments[segments.length - 1];
  const change = last.nps - first.nps;
  const trend = change > 0 ? `up ${change} point${change === 1 ? "" : "s"}` : change < 0 ? `down ${Math.abs(change)} point${change === -1 ? "" : "s"}` : "flat";
  return `Net Promoter Score on "${label}" by wave: ${parts}. ${trend} from ${first.name} to ${last.name} (${weighted ? "weighted" : "unweighted"}).`;
}

/** Posts (or re-posts) a wave-over-wave NPS reading as a finding. Keyed on the variable alone: one
 * wave-trend finding per question, so building the comparison again just refreshes it. */
export async function addWaveNpsFindingAction(runId: string, result: NpsResult): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const segments = result.segments;
    if (!segments || segments.length === 0) return { ok: false, error: "No wave segments to post." };
    await withTenant(TENANT_ID, async (client) => {
      const existing = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_nps_tool' and stated_stats->>'variable' = $2 and status <> 'rejected'",
        [runId, result.variable],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) {
        const touched = await client.query<{ id: string }>(
          "update findings set finding_text = $3, stated_stats = $4 where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_nps_tool' and stated_stats->>'variable' = $2 and status <> 'rejected' returning id",
          [
            runId,
            result.variable,
            describeWaveNps(segments, result.label, result.weighted),
            JSON.stringify({ source: "wave_nps_tool", variable: result.variable, question: result.label, testType: "nps_trend", segments }),
          ],
        );
        await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
        return;
      }
      const revived = await client.query<{ id: string }>(
        "update findings set status = 'accepted' where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_nps_tool' and stated_stats->>'variable' = $2 and status = 'rejected' returning id",
        [runId, result.variable],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status)
         values ($1, $2, 'generated', $3, $4, 'trend', $5, 'quantitative', 'accepted')
         returning id`,
        [
          TENANT_ID,
          runId,
          describeWaveNps(segments, result.label, result.weighted),
          result.label,
          JSON.stringify({
            source: "wave_nps_tool",
            variable: result.variable,
            question: result.label,
            testType: "nps_trend",
            segments,
            caveats: ["descriptive_reading", "wave_files_treated_as_independent_samples"],
          }),
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

export async function removeWaveNpsFindingAction(runId: string, variable: string): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        "update findings set status = 'rejected' where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_nps_tool' and stated_stats->>'variable' = $2 and status <> 'rejected' returning id",
        [runId, variable],
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

export async function waveNpsFindingStatusAction(runId: string, variable: string): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const committed = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_nps_tool' and stated_stats->>'variable' = $2 and status <> 'rejected'",
        [runId, variable],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function describeWaveChart(result: ChartResult): string {
  const base = result.weighted ? "weighted" : "unweighted";
  const parts = result.series
    .map((s) => {
      const top = [...s.bars].sort((a, b) => b.pct - a.pct)[0];
      return top ? `${s.name} ${top.pct}% "${top.label}" (n=${s.n.toLocaleString()})` : `${s.name} (n=${s.n.toLocaleString()})`;
    })
    .join("; ");
  return `Answers to "${result.label}" by wave (${base}): ${parts}.`;
}

/** Posts (or re-posts) a wave-over-wave distribution as a finding. Keyed on the variable alone, same
 * reasoning as the NPS trend above. */
export async function addWaveChartFindingAction(runId: string, result: ChartResult): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    await withTenant(TENANT_ID, async (client) => {
      const existing = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_chart_tool' and stated_stats->>'variable' = $2 and status <> 'rejected'",
        [runId, result.variable],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) {
        const touched = await client.query<{ id: string }>(
          "update findings set finding_text = $3, stated_stats = $4 where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_chart_tool' and stated_stats->>'variable' = $2 and status <> 'rejected' returning id",
          [
            runId,
            result.variable,
            describeWaveChart(result),
            JSON.stringify({ source: "wave_chart_tool", variable: result.variable, question: result.label, testType: "distribution_trend", series: result.series }),
          ],
        );
        await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
        return;
      }
      const revived = await client.query<{ id: string }>(
        "update findings set status = 'accepted' where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_chart_tool' and stated_stats->>'variable' = $2 and status = 'rejected' returning id",
        [runId, result.variable],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status)
         values ($1, $2, 'generated', $3, $4, 'trend', $5, 'quantitative', 'accepted')
         returning id`,
        [
          TENANT_ID,
          runId,
          describeWaveChart(result),
          result.label,
          JSON.stringify({
            source: "wave_chart_tool",
            variable: result.variable,
            question: result.label,
            testType: "distribution_trend",
            series: result.series,
            caveats: ["descriptive_reading", "wave_files_treated_as_independent_samples"],
          }),
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

export async function removeWaveChartFindingAction(runId: string, variable: string): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        "update findings set status = 'rejected' where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_chart_tool' and stated_stats->>'variable' = $2 and status <> 'rejected' returning id",
        [runId, variable],
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

export async function waveChartFindingStatusAction(runId: string, variable: string): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const committed = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_chart_tool' and stated_stats->>'variable' = $2 and status <> 'rejected'",
        [runId, variable],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type WaveDriverRequest = {
  outcome: string;
  outcomeType: "continuous" | "binary";
  topBoxMin?: number | null;
  predictors: string[];
  weightVar?: string | null;
  /** Optional: run each wave's analysis again within each category of this variable, same as the single-file tool. */
  groupVar?: string | null;
};

export type WaveDriverTableRow = { name: string; shares: (number | null)[] };

/** One row per predictor, one column per wave: the same share-of-explained-outcome figure the bar chart
 * used to plot, read as a table instead so every wave's weight for a predictor lines up in one glance
 * rather than needing bars compared across a crowded chart. */
export type WaveDriverTable = {
  outcome: string;
  outcomeLabel: string;
  waves: { name: string; n: number; weighted: boolean }[];
  /** Ordered by the first wave's own ranking, highest share first, same reasoning as the old chart: reads
   * as "most to least important when this started" rather than reshuffling per wave. */
  rows: WaveDriverTableRow[];
};

/**
 * Driver analysis run once per wave on the same outcome and predictors, read off as a grouped bar chart:
 * one bar series per wave, one bar per predictor, height is that predictor's share of the explained
 * outcome in that wave. Reuses the ChartResult shape the distribution tool already produces, so it drops
 * straight into the same chart grid, gets the same title/colour/legend controls and the same
 * Copy image/Download PNG/Post to findings, with no separate rendering path to maintain.
 */
export async function runWaveDriverAction(
  runId: string,
  files: WaveFile[],
  request: WaveDriverRequest,
): Promise<{ ok: true; table: WaveDriverTable; perWave: { wave: string; report: DriverReport }[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    if (files.length < 2) return { ok: false, error: "Label at least two files as waves to compare them." };
    const perWave: { f: WaveFile; report: Awaited<ReturnType<typeof runDriverAnalysisFor>> }[] = [];
    for (const f of files) {
      const report = await runDriverAnalysisFor(TENANT_ID, runId, f.documentId, {
        outcome: request.outcome,
        outcomeType: request.outcomeType,
        topBoxMin: request.topBoxMin ?? null,
        predictors: request.predictors,
        weightVar: request.weightVar ?? null,
        groupVar: request.groupVar ?? null,
      });
      perWave.push({ f, report });
    }
    // The first wave's own ranking sets the predictor order every wave's row lines up against, so the
    // table reads top to bottom as "most to least important when this started" rather than reshuffling
    // per wave.
    // Rows line up across waves by the predictor's code (Codex AN500-F01), not its display name, which
    // can differ between waves or carry a generated suffix.
    const firstRows = perWave[0].report.result.rows;
    const rows: WaveDriverTableRow[] = firstRows.map((first) => ({
      name: first.name,
      shares: perWave.map(({ report }) => {
        const row = recordForRow(first, report.result.rows, firstRows);
        return row ? Math.round(row.share * 1000) / 10 : null;
      }),
    }));
    const first = perWave[0].report;
    return {
      ok: true,
      table: {
        outcome: request.outcome,
        outcomeLabel: first.outcomeLabel,
        waves: perWave.map(({ f, report }) => ({ name: f.wave, n: report.result.n, weighted: report.weighted })),
        rows,
      },
      perWave: perWave.map(({ f, report }) => ({ wave: f.wave, report })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function describeWaveDriverTable(table: WaveDriverTable): string {
  const topPerWave = table.waves
    .map((w, i) => {
      const best = [...table.rows].sort((a, b) => (b.shares[i] ?? -1) - (a.shares[i] ?? -1))[0];
      return best ? `${w.name} led by "${best.name}" (${best.shares[i] ?? 0}%)` : `${w.name} (n=${w.n.toLocaleString()})`;
    })
    .join("; ");
  return `Driver weights for "${table.outcomeLabel}" by wave: ${topPerWave}.`;
}

/** Posts (or re-posts) a wave-over-wave driver-weight comparison as a finding. Keyed on the outcome
 * variable alone, same reasoning as the chart and NPS trend findings above. */
export async function addWaveDriverFindingAction(runId: string, table: WaveDriverTable): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    await withTenant(TENANT_ID, async (client) => {
      const existing = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_driver_tool' and stated_stats->>'variable' = $2 and status <> 'rejected'",
        [runId, table.outcome],
      );
      if ((existing.rows[0]?.n ?? 0) > 0) {
        const touched = await client.query<{ id: string }>(
          "update findings set finding_text = $3, stated_stats = $4 where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_driver_tool' and stated_stats->>'variable' = $2 and status <> 'rejected' returning id",
          [
            runId,
            table.outcome,
            describeWaveDriverTable(table),
            JSON.stringify({ source: "wave_driver_tool", variable: table.outcome, question: table.outcomeLabel, testType: "driver_trend", table }),
          ],
        );
        await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
        return;
      }
      const revived = await client.query<{ id: string }>(
        "update findings set status = 'accepted' where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_driver_tool' and stated_stats->>'variable' = $2 and status = 'rejected' returning id",
        [runId, table.outcome],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status)
         values ($1, $2, 'generated', $3, $4, 'trend', $5, 'quantitative', 'accepted')
         returning id`,
        [
          TENANT_ID,
          runId,
          describeWaveDriverTable(table),
          table.outcomeLabel,
          JSON.stringify({
            source: "wave_driver_tool",
            variable: table.outcome,
            question: table.outcomeLabel,
            testType: "driver_trend",
            table,
            caveats: ["descriptive_reading", "wave_files_treated_as_independent_samples"],
          }),
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

export async function removeWaveDriverFindingAction(runId: string, outcome: string): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        "update findings set status = 'rejected' where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_driver_tool' and stated_stats->>'variable' = $2 and status <> 'rejected' returning id",
        [runId, outcome],
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

export async function waveDriverFindingStatusAction(runId: string, outcome: string): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const committed = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'trend' and stated_stats->>'source' = 'wave_driver_tool' and stated_stats->>'variable' = $2 and status <> 'rejected'",
        [runId, outcome],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

