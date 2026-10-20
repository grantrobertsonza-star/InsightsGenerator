"use server";

import { revalidatePath } from "next/cache";
import { loadDocumentFile, loadVariableDictionaryWithStatus, overlayFor } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { withTenant } from "./db";
import { recordHumanReview } from "./findingProvenance";
import { runStatsTool } from "./parseStatsFile";
import { requireTenantId } from "./requestContext";
import { capByStride, pearsonCorrelation, scatterFinding } from "./scatter";
import { pearsonCorrelation as pearsonTest } from "./stats";

/** The most points sent to the browser for drawing; the correlation always uses every complete case. */
const MAX_POINTS = 5000;

type AxisInfo = { name: string; label: string; min: number; max: number; distinct: number; valueLabels?: Record<string, string> };

type Columns = {
  outcome: AxisInfo;
  predictors: AxisInfo[];
  y: (number | null)[];
  x: (number | null)[][];
  weights: (number | null)[] | null;
  n: number;
  skipped: { variable: string; reason: string }[];
};

export type ScatterResult = {
  x: AxisInfo;
  y: AxisInfo;
  /** Cases in the file. */
  casesInFile: number;
  /** Cases with both values (and a usable weight when weighted): what the correlation is computed on. */
  complete: number;
  weighted: boolean;
  /** Pearson r over every complete case (weighted when a weight is chosen); null when undefined. */
  correlation: { r: number; n: number } | null;
  /** The shared t test's two-sided p-value (stats.ts), unweighted only; null when weighted or undefined. */
  pValue: number | null;
  /** The points drawn, [x, y]; every complete case unless `capped`. */
  points: [number, number][];
  /** Set when there were more complete cases than are drawn: the drawn points are an even sample. */
  capped: { shown: number; of: number } | null;
};

type Fail = { ok: false; error: string };

/**
 * Reads two numeric variables case by case for the Analytics scatter plot (Grant, 2026-10-20), through
 * the same "columns" tool driver analysis uses (src/lib/drivers.ts), with the file's saved layout and
 * the researcher's label corrections, so answer codes that mean "no usable answer" (don't know,
 * refused) are missing here as they are there. Both names are checked against the file's own
 * dictionary first, so a request names real, distinct variables of this file. Returns complete cases
 * only: both values finite, and a finite positive weight when weighted.
 */
async function readPairs(tenantId: string, runId: string, documentId: string, xVar: string, yVar: string, weightVar: string | null) {
  if (!xVar || !yVar) throw new Error("Choose a variable for each axis.");
  if (xVar === yVar) throw new Error("Choose two different variables for the two axes.");
  const dictStatus = await loadVariableDictionaryWithStatus(tenantId, runId, documentId);
  if (!dictStatus.ok) throw new Error(`This file's saved set-up could not be read: ${dictStatus.error}`);
  const names = new Set(dictStatus.dictionary.variables.map((v) => v.name));
  for (const [what, name] of [["X axis", xVar], ["Y axis", yVar], ["weight", weightVar]] as const) {
    if (name && !names.has(name)) throw new Error(`The ${what} variable "${name}" is not in this file.`);
  }
  const [doc, overlay, setupStatus] = await Promise.all([
    loadDocumentFile(tenantId, runId, documentId),
    overlayFor(tenantId, runId, documentId),
    loadDataSetupWithStatus(tenantId, documentId),
  ]);
  // The layout decides how the file is read, so a failed lookup must not fall back to a default.
  if (!setupStatus.ok) throw new Error(`This file's saved set-up could not be read: ${setupStatus.error}`);
  const cols = await runStatsTool<Columns>("columns", doc.storage_path, doc.source_filename, {
    outcome: yVar,
    predictors: [xVar],
    weightVar: weightVar || null,
    groupVar: null,
    overlay,
    layout: setupStatus.setup.layout,
    selectedSheet: doc.selected_sheet,
  });
  const xInfo = cols.predictors[0];
  if (!xInfo) {
    const why = cols.skipped.find((s) => s.variable === xVar)?.reason ?? "it has no usable numeric answers";
    throw new Error(`The X axis variable cannot be used: ${why}.`);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i < cols.y.length; i++) {
    const xv = cols.x[i]?.[0];
    const yv = cols.y[i];
    const wv = cols.weights ? cols.weights[i] : 1;
    if (xv === null || xv === undefined || yv === null || !Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    if (wv === null || !Number.isFinite(wv) || wv <= 0) continue;
    xs.push(xv);
    ys.push(yv);
    ws.push(wv);
  }
  return { xInfo, yInfo: cols.outcome, casesInFile: cols.n, weighted: !!cols.weights, xs, ys, ws: cols.weights ? ws : null };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The scatter plot's points and correlation. Read-only: nothing is stored. */
export async function runScatterAction(
  runId: string,
  documentId: string,
  xVar: string,
  yVar: string,
  weightVar: string | null,
): Promise<{ ok: true; result: ScatterResult } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const d = await readPairs(TENANT_ID, runId, documentId, xVar, yVar, weightVar);
    const pairs = d.xs.map((v, i) => [v, d.ys[i]] as [number, number]);
    const points = capByStride(pairs, MAX_POINTS);
    return {
      ok: true,
      result: {
        x: d.xInfo,
        y: d.yInfo,
        casesInFile: d.casesInFile,
        complete: pairs.length,
        weighted: d.weighted,
        correlation: pearsonCorrelation(d.xs, d.ys, d.ws),
        // The shared test (stats.ts), as on a posted finding; none for a weighted correlation.
        pValue: d.ws || d.xs.length < 3 ? null : (pearsonTest(d.xs, d.ys).pValue ?? null),
        points,
        capped: points.length < pairs.length ? { shown: points.length, of: pairs.length } : null,
      },
    };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

// One posted correlation per file, pair of variables and weight: the same pair weighted and unweighted
// are two findings, as their figures differ.
const SAME_FINDING = `run_id = $1 and pattern_type = 'relationship' and stated_stats->>'source' = 'scatter_tool'
  and stated_stats->>'variable1' = $2 and stated_stats->>'variable2' = $3
  and coalesce(stated_stats->>'weightVar', '') = coalesce($4, '') and source_document_id = $5`;

/**
 * Posts the scatter's correlation as a finding (Grant, 2026-10-20). The correlation is computed again
 * here from the file, never taken from the page. Posting again does nothing while one is in use; a
 * removed one is brought back rather than duplicated, as the chart tool does.
 */
export async function addScatterFindingAction(
  runId: string,
  documentId: string,
  xVar: string,
  yVar: string,
  weightVar: string | null,
): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const d = await readPairs(TENANT_ID, runId, documentId, xVar, yVar, weightVar);
    const finding = scatterFinding({ x: d.xInfo, y: d.yInfo, xs: d.xs, ys: d.ys, ws: d.ws, weightVar: d.ws ? weightVar : null, casesInFile: d.casesInFile });
    if (!finding) return { ok: false, error: "There is no correlation to post: fewer than three cases answered both, or one of them does not vary." };
    const weightKey = d.ws ? weightVar : null;
    let added = false;
    await withTenant(TENANT_ID, async (client) => {
      const existing = await client.query<{ n: number }>(`select count(*)::int as n from findings where ${SAME_FINDING} and status <> 'rejected'`, [runId, xVar, yVar, weightKey, documentId]);
      if ((existing.rows[0]?.n ?? 0) > 0) return;
      const revived = await client.query<{ id: string }>(
        `update findings set status = 'accepted' where ${SAME_FINDING} and status = 'rejected' returning id`,
        [runId, xVar, yVar, weightKey, documentId],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) {
        added = true;
        return;
      }
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1, $2, 'generated', $3, $4, 'relationship', $5, 'quantitative', 'accepted', $6)
         returning id`,
        [TENANT_ID, runId, finding.text, finding.theme, JSON.stringify(finding.statedStats), documentId],
      );
      await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
      added = true;
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, added };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Takes a posted scatter correlation out of use (rejected, so it can be brought back). */
export async function removeScatterFindingAction(
  runId: string,
  documentId: string,
  xVar: string,
  yVar: string,
  weightVar: string | null,
): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        `update findings set status = 'rejected' where ${SAME_FINDING} and status <> 'rejected' returning id`,
        [runId, xVar, yVar, weightVar || null, documentId],
      );
      await recordHumanReview(client, r.rows.map((row) => row.id), "tool_remove");
      return r.rowCount ?? 0;
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Whether this scatter's correlation (file, pair and weight) is currently posted. */
export async function scatterFindingStatusAction(
  runId: string,
  documentId: string,
  xVar: string,
  yVar: string,
  weightVar: string | null,
): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const committed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from findings where ${SAME_FINDING} and status <> 'rejected'`, [runId, xVar, yVar, weightVar || null, documentId]);
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}
