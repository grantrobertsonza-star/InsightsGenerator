import { withTenant } from "./db";
import { performanceScales, predictorPerformance, type PerformanceMeasure } from "./driverPerformance";
import { recordHumanReview } from "./findingProvenance";
import { loadDataSetupWithStatus } from "./dataSetup";
import { runStatsTool } from "./parseStatsFile";
import { loadDocumentFile, overlayFor } from "./crosstabs";
import { driverAnalysis, type DriverResult } from "./driverAnalysis";
import { driverRequestVariables, parseDriverRequest } from "./driverRequest";
import { loadVariableOverrides } from "./variableOverrides";
import { driverDisplayNames } from "./driverPresentation";

export type DriverRequest = {
  outcome: string;
  outcomeType: "continuous" | "binary";
  /** Binary only: the lowest answer code that counts as the top box. Blank means the top two codes. */
  topBoxMin?: number | null;
  predictors: string[];
  weightVar?: string | null;
  bootstrap?: number;
  /** Optional: for a predictor, the survey question that asked how important it is. Draws the derived against stated importance chart. */
  statedImportance?: Record<string, string>;
  /** Optional: run the same analysis again within each category of this variable, such as gender. */
  groupVar?: string | null;
};

/** One category of the group variable: the same shares-and-performance analysis as the overall report, on just that slice. */
export type DriverSegment = {
  name: string;
  n: number;
  weighted: boolean;
  skipped: boolean;
  /** Why this segment has no result, when skipped is true. */
  reason?: string;
  result?: DriverResult;
  performance?: DriverPerformance[];
  /** Stated importance within this segment's own cases, same shape as DriverReport.stated. */
  stated?: DriverStated[];
};

/** `variable` is the predictor's code (absent on reports saved before 24 October 2026). */
export type DriverPerformance = {
  name: string;
  variable?: string;
  mean: number | null;
  topTwo: number | null;
  /** D2b (absent on reports saved before 29 October 2026): the figure the performance axis reads, and the scale top
   * the top two counted from (driverPerformance.ts). */
  measure?: PerformanceMeasure;
  scaleTop?: number | null;
  scaleStated?: boolean | null;
};

/**
 * What respondents said about how important a predictor is. `name` is the predictor's display name,
 * `predictor` its code (absent on reports saved before 24 October 2026), `variable` the importance
 * question's code.
 */
export type DriverStated = { name: string; predictor?: string; variable: string; mean: number | null; topTwo: number | null };

export type DriverReport = {
  request: DriverRequest;
  outcomeLabel: string;
  outcomeNote: string;
  casesInFile: number;
  weighted: boolean;
  skipped: { variable: string; reason: string }[];
  result: DriverResult;
  /** Where each predictor stands today, for the importance against performance view. Joined to rows by `variable`. */
  performance: DriverPerformance[];
  /** D2b: "mixed" when the predictors are not on one scale, so one performance axis needs a caution; absent on older reports. */
  performanceScales?: "same" | "mixed";
  /** Stated importance for the predictors that had an importance question paired with them. */
  stated?: DriverStated[];
  groupVariable?: string | null;
  groupLabel?: string | null;
  /** Same analysis run again within each category of groupVariable, when one was chosen. Stated importance is not re-split by segment. */
  segments?: DriverSegment[] | null;
  createdAt?: string;
  /**
   * GT1000-F01: the data file and the variable corrections (loadVariableOverrides) this result was
   * calculated with, and the variables it read. Absent on results calculated before 21 October
   * 2026, whose findings' corrections cannot be compared ("not checked", never current).
   */
  provenance?: DriverProvenance;
};

export type DriverProvenance = { documentId: string; overridesSnapshot: unknown; variables: string[] };

type Columns = {
  outcome: { name: string; label: string; min: number; max: number; distinct: number; valueLabels: Record<string, string> };
  predictors: { name: string; label: string; min: number; max: number; distinct: number; scaleTop?: number; scaleStated?: boolean }[];
  y: (number | null)[];
  x: (number | null)[][];
  weights: (number | null)[] | null;
  n: number;
  skipped: { variable: string; reason: string }[];
  group: { name: string; label: string; categories: string[] } | null;
  groupValues: (string | null)[] | null;
};

/** A segment needs enough complete cases of its own before a driver model on it means anything. */
const MIN_SEGMENT_CASES = 20;

function wMean(values: number[], w: number[]): number {
  let s = 0;
  let sw = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i] * w[i];
    sw += w[i];
  }
  return sw > 0 ? s / sw : NaN;
}

/** Reads the chosen columns from the data file and runs the driver analysis on them. */
export async function runDriverAnalysisFor(
  tenantId: string,
  runId: string,
  documentId: string,
  untrustedRequest: DriverRequest,
): Promise<DriverReport> {
  // GT1000-F02: refused here, before any read or calculation, whoever the caller is.
  const checked = parseDriverRequest(untrustedRequest);
  if (!checked.ok) throw new Error(checked.error);
  const request = checked.request;
  const [doc, overlay, setupStatus, overrides] = await Promise.all([
    loadDocumentFile(tenantId, runId, documentId),
    overlayFor(tenantId, runId, documentId),
    loadDataSetupWithStatus(tenantId, documentId),
    loadVariableOverrides(tenantId, runId, documentId),
  ]);
  if (!setupStatus.ok) throw new Error(`Could not read the saved data layout for driver analysis: ${setupStatus.error}`);
  const setup = setupStatus.setup;
  const cols = await runStatsTool<Columns>("columns", doc.storage_path, doc.source_filename, {
    outcome: request.outcome,
    predictors: request.predictors,
    weightVar: request.weightVar ?? null,
    groupVar: request.groupVar ?? null,
    overlay,
    layout: setup.layout,
    headerRowsSkipped: setup.headerRowsSkipped,
    selectedSheet: doc.selected_sheet,
  });

  const nan = (v: number | null) => (v === null ? NaN : v);
  let y = cols.y.map(nan);
  const x = cols.x.map((row) => row.map(nan));
  const weights = cols.weights ? cols.weights.map(nan) : undefined;
  // A case with no usable weight cannot be counted.
  if (weights) weights.forEach((w, i) => { if (!Number.isFinite(w)) y[i] = NaN; });

  let outcomeNote = `Score on ${cols.outcome.label}, treated as a number.`;
  if (request.outcomeType === "binary") {
    const o = cols.outcome;
    const min = request.topBoxMin ?? (o.distinct === 2 ? o.max : o.max - 1);
    if (!(min > o.min)) throw new Error("The top box must start above the lowest answer code.");
    y = y.map((v) => (Number.isFinite(v) ? (v >= min ? 1 : 0) : NaN));
    outcomeNote = `Top box on ${o.label}: answers from ${min} up to ${o.max}, against everyone else who answered.`;
  }

  // Display names, unique within the report (driverPresentation.driverDisplayNames, Codex AN500-F01).
  // Every row, performance and stated record also carries the predictor's code (`variable`), and
  // consumers join on that, never on the display name.
  const names = driverDisplayNames(cols.predictors);
  const codeOf = new Map(names.map((n, j) => [n, cols.predictors[j].name]));
  const withCodes = (r: DriverResult): DriverResult => ({ ...r, rows: r.rows.map((row) => ({ ...row, variable: codeOf.get(row.name) })) });

  const result = driverAnalysis({
    y,
    x,
    names,
    outcome: request.outcomeType,
    weights,
    bootstrap: request.bootstrap,
  });
  if ("error" in result) throw new Error(result.error);
  const resultWithCodes = withCodes(result);

  // One rule for the file and for each segment (driverPerformance.ts).
  const performanceOf = (inRow: (i: number) => boolean): DriverPerformance[] =>
    cols.predictors.map((p, j) => {
      const vals: number[] = [];
      const ws: number[] = [];
      cols.x.forEach((row, i) => {
        if (!inRow(i)) return;
        const v = row[j];
        if (v === null || !Number.isFinite(y[i])) return;
        vals.push(v);
        ws.push(weights ? (Number.isFinite(weights[i]) ? weights[i] : 0) : 1);
      });
      return { name: names[j], variable: p.name, ...predictorPerformance(p, vals, ws) };
    });
  const performance = performanceOf(() => true);

  // Same performance calc as above, restricted to one segment's rows.
  const performanceFor = (idx: Set<number>): DriverPerformance[] => performanceOf((i) => idx.has(i));

  // Stated importance needs a second read (the importance questions themselves aren't in cols), fetched once
  // and then sliced per segment the same way y/x/weights are, so each segment compares derived against stated
  // importance using only its own cases rather than the whole file's.
  const pairs = Object.entries(request.statedImportance ?? {}).filter(
    ([pred, imp]) => imp && imp !== request.outcome && request.predictors.includes(pred),
  );
  let statedForIdx: ((idx: Set<number> | null) => DriverStated[]) | null = null;
  if (pairs.length > 0) {
    const impVars = [...new Set(pairs.map(([, imp]) => imp))];
    const c2 = await runStatsTool<Columns>("columns", doc.storage_path, doc.source_filename, {
      outcome: request.outcome,
      predictors: impVars,
      weightVar: request.weightVar ?? null,
      groupVar: request.groupVar ?? null,
      overlay,
      layout: setup.layout,
      headerRowsSkipped: setup.headerRowsSkipped,
      selectedSheet: doc.selected_sheet,
    });
    const w2 = c2.weights ? c2.weights.map(nan) : null;
    statedForIdx = (idx) => {
      const out: DriverStated[] = [];
      for (const [pred, imp] of pairs) {
        const j = c2.predictors.findIndex((p) => p.name === imp);
        const k = cols.predictors.findIndex((p) => p.name === pred);
        if (j < 0 || k < 0) continue;
        const meta = c2.predictors[j];
        const vals: number[] = [];
        const ws: number[] = [];
        c2.x.forEach((row, i) => {
          if (idx && !idx.has(i)) return;
          const v = row[j];
          const wi = w2 ? w2[i] : 1;
          if (v === null || !Number.isFinite(v) || !Number.isFinite(wi)) return;
          vals.push(v);
          ws.push(wi);
        });
        if (vals.length === 0) continue;
        const sw = ws.reduce((a, b) => a + b, 0);
        const smallScale = meta.distinct >= 3 && meta.distinct <= 11;
        const cut = meta.max - 1;
        const topTwo = smallScale && sw > 0 ? vals.reduce((a, v, i) => a + (v >= cut ? ws[i] : 0), 0) / sw : null;
        const mean = wMean(vals, ws);
        out.push({ name: names[k], predictor: pred, variable: imp, mean: Number.isFinite(mean) ? mean : null, topTwo });
      }
      return out;
    };
  }
  const stated = statedForIdx ? statedForIdx(null) : undefined;

  let segments: DriverSegment[] | null = null;
  if (cols.group && cols.groupValues) {
    const gv = cols.groupValues;
    segments = cols.group.categories.map((cat) => {
      const idx = new Set<number>();
      for (let i = 0; i < gv.length; i++) if (gv[i] === cat) idx.add(i);
      const n = idx.size;
      if (n < MIN_SEGMENT_CASES) {
        return { name: cat, n, weighted: Boolean(weights), skipped: true, reason: `Fewer than ${MIN_SEGMENT_CASES} cases in this group.` };
      }
      const ySeg = [...idx].map((i) => y[i]);
      const xSeg = [...idx].map((i) => x[i]);
      const wSeg = weights ? [...idx].map((i) => weights[i]) : undefined;
      const segResult = driverAnalysis({ y: ySeg, x: xSeg, names, outcome: request.outcomeType, weights: wSeg, bootstrap: request.bootstrap });
      if ("error" in segResult) {
        return { name: cat, n, weighted: Boolean(weights), skipped: true, reason: segResult.error };
      }
      return {
        name: cat,
        n,
        weighted: Boolean(weights),
        skipped: false,
        result: withCodes(segResult),
        performance: performanceFor(idx),
        stated: statedForIdx ? statedForIdx(idx) : undefined,
      };
    });
  }

  return {
    request,
    // GT1000-F01: what this result was calculated from, recorded server-side with the result so a
    // finding posted from it can later be checked against the file's current corrections.
    provenance: { documentId, overridesSnapshot: overrides, variables: driverRequestVariables(request) },
    stated,
    outcomeLabel: cols.outcome.label,
    outcomeNote,
    casesInFile: cols.n,
    weighted: Boolean(weights),
    skipped: cols.skipped,
    result: resultWithCodes,
    performance,
    performanceScales: performanceScales(performance.map((x) => ({ mean: x.mean, topTwo: x.topTwo, measure: x.measure ?? "mean", scaleTop: x.scaleTop ?? null, scaleStated: x.scaleStated ?? null })), cols.predictors),
    groupVariable: cols.group?.name ?? null,
    groupLabel: cols.group?.label ?? null,
    segments,
  };
}

export type SavedDriverAnalysis = { id: string; title: string; createdAt: string; report: DriverReport };

/** Postgres "undefined_table": the one failure that means "not migrated yet" rather than a real error. */
const UNDEFINED_TABLE = "42P01";

/**
 * Locks this organisation's project row (FOR UPDATE) for the rest of the transaction, so saves and
 * posts for one project go one at a time and a duplicate check made after the lock sees the other
 * request's write. Throws when the project is not this organisation's: the lock query confirms the
 * row exists, it does not assume it.
 */
async function lockOwnedRun(client: import("pg").PoolClient, tenantId: string, runId: string): Promise<void> {
  const owned = await client.query("select id from runs where id = $1 and tenant_id = $2 for update", [runId, tenantId]);
  if (owned.rowCount === 0) throw new Error("That project was not found.");
}

/**
 * Saves a driver analysis once (IR-03, 2026-10-20). Saving the same result again (the same data
 * file, the same request and the same report, compared as JSON values) returns the analysis already
 * saved instead of inserting a second copy, so posting a reopened or re-run analysis cannot create a
 * parallel artifact with its own set of findings. A different report for the same request (the data
 * or its setup changed) is a different result and is saved as such. Ownership of the project and the
 * data file is checked on this write, under the project lock.
 */
export async function saveDriverAnalysis(
  tenantId: string,
  runId: string,
  documentId: string,
  title: string,
  report: DriverReport,
): Promise<string> {
  // GT1000-F02: a result whose request this contract refuses is not saved, so it can never be
  // posted. The result itself is the one the screen received from runDriverAnalysisFor (not
  // recalculated here); its recorded provenance must name this data file.
  if (!report || typeof report !== "object" || !report.result || typeof report.result !== "object") throw new Error("There is no driver analysis result to save.");
  const checked = parseDriverRequest(report.request);
  if (!checked.ok) throw new Error(checked.error);
  if (report.provenance && report.provenance.documentId !== documentId) throw new Error("This result was calculated from a different data file.");
  // R1000-01: the variables an analysis depends on are its checked request's (driverRequestVariables);
  // a list returned with the result is replaced by them, never trusted, so an empty or shortened list
  // cannot hide a later correction. Replaced rather than refused: the list is derived from the
  // request, so there is no researcher choice in it to lose. A corrections snapshot that is not a
  // plain object is recorded as not known (null), which support reports as not checked.
  if (report.provenance) {
    const snapshot = report.provenance.overridesSnapshot;
    report = {
      ...report,
      provenance: {
        documentId,
        overridesSnapshot: snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null,
        variables: driverRequestVariables(checked.request),
      },
    };
  }
  return withTenant(tenantId, async (client) => {
    await lockOwnedRun(client, tenantId, runId);
    const doc = await client.query("select id from documents where id = $1 and run_id = $2 and tenant_id = $3", [documentId, runId, tenantId]);
    if (doc.rowCount === 0) throw new Error("That data file is not in this project.");
    const request = JSON.stringify(report.request);
    const body = JSON.stringify(report);
    const same = await client.query<{ id: string }>(
      `select id from driver_analyses
        where run_id = $1 and document_id = $2 and request = $3::jsonb and report = $4::jsonb
        order by created_at limit 1`,
      [runId, documentId, request, body],
    );
    if (same.rows[0]) return same.rows[0].id;
    const r = await client.query<{ id: string }>(
      `insert into driver_analyses (tenant_id, run_id, document_id, title, request, report)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [tenantId, runId, documentId, title.trim() || "Driver analysis", request, body],
    );
    return r.rows[0].id;
  });
}

/**
 * The saved analyses for one data file. Only a table that does not exist yet (migration 0072 not
 * applied) reads as "none saved"; any other failure is thrown, so a failed read is never shown as an
 * empty list.
 */
export async function listDriverAnalyses(tenantId: string, runId: string, documentId: string): Promise<SavedDriverAnalysis[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const r = await client.query<{ id: string; title: string; created_at: Date; report: DriverReport }>(
        `select id, title, created_at, report from driver_analyses
          where run_id = $1 and document_id = $2 and tenant_id = $3 order by created_at desc`,
        [runId, documentId, tenantId],
      );
      return r.rows.map((row) => ({ id: row.id, title: row.title, createdAt: new Date(row.created_at).toISOString(), report: row.report }));
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNDEFINED_TABLE) return [];
    throw error;
  }
}

export async function deleteDriverAnalysis(tenantId: string, runId: string, id: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("delete from driver_analyses where id = $1 and run_id = $2 and tenant_id = $3", [id, runId, tenantId]);
  });
}

/**
 * The provenance a posted driver finding records (GT1000-F01): the saved analysis's data file, and
 * the corrections and variables its result was calculated with when the result recorded them. A
 * result from before provenance was recorded gives null corrections, which support reports as not
 * checked. A recorded data file that is not the saved analysis's own is not trusted: null too.
 */
function savedProvenance(report: DriverReport, documentId: string): DriverProvenance {
  const p = report.provenance;
  // R1000-01: the dependency list is always the checked request's, whatever the saved report says.
  // A request that no longer parses gives no list and no snapshot: support then reads not checked.
  const checked = parseDriverRequest(report.request);
  if (!checked.ok) return { documentId, overridesSnapshot: null, variables: [] };
  const variables = driverRequestVariables(checked.request);
  const snapshot = p?.overridesSnapshot;
  if (!p || p.documentId !== documentId || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { documentId, overridesSnapshot: null, variables };
  }
  return { documentId, overridesSnapshot: snapshot, variables };
}

/**
 * Adds a saved analysis to the project's findings, once (IR-03). The analysis row is locked FOR
 * UPDATE first (which also confirms it is this organisation's and this project's), so two posts of
 * the same analysis go one at a time and the second sees the first one's findings. Findings already
 * in use are left as they are, wording included; findings taken out of use are put back as they
 * were, never rewritten from the report. `added` counts findings inserted or put back;
 * `alreadyPosted` counts those that were already in use.
 */
export async function addDriverFindings(
  tenantId: string,
  runId: string,
  analysisId: string,
): Promise<{ added: number; alreadyPosted: number }> {
  const { driverFindings } = await import("./driverFindings");
  return withTenant(tenantId, async (client) => {
    const saved = await client.query<{ report: DriverReport; document_id: string }>(
      "select report, document_id from driver_analyses where id = $1 and run_id = $2 and tenant_id = $3 for update",
      [analysisId, runId, tenantId],
    );
    if (!saved.rows[0]) throw new Error("That analysis was not found.");
    // GT1000-F01: the findings name the data file they were calculated from (source_document_id,
    // as every other calculated finding does), so deleting the file removes them with the file's
    // other findings and support sees the deletion; and they carry the corrections the result was
    // calculated with, so a later correction shows up as changed support.
    const documentId = saved.rows[0].document_id;
    const provenance = savedProvenance(saved.rows[0].report, documentId);
    const existing = await client.query<{ n: number }>(
      "select count(*)::int as n from findings where run_id = $1 and pattern_type = 'driver' and stated_stats->>'analysisId' = $2 and status <> 'rejected'",
      [runId, analysisId],
    );
    const alreadyPosted = existing.rows[0]?.n ?? 0;
    if (alreadyPosted > 0) return { added: 0, alreadyPosted };
    const revived = await client.query<{ id: string }>(
      // Findings posted before GT1000-F01 have no source_document_id; restoring one names it then.
      "update findings set status = 'accepted', source_document_id = coalesce(source_document_id, $3) where run_id = $1 and pattern_type = 'driver' and stated_stats->>'analysisId' = $2 and status = 'rejected' returning id",
      [runId, analysisId, documentId],
    );
    await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
    if ((revived.rowCount ?? 0) > 0) return { added: revived.rowCount ?? 0, alreadyPosted: 0 };
    const drafts = driverFindings(saved.rows[0].report, analysisId);
    for (const f of drafts) {
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1, $2, 'generated', $3, $4, 'driver', $5, 'quantitative', 'accepted', $6)
         returning id`,
        [tenantId, runId, f.text, f.theme, JSON.stringify({ ...f.stats, provenance }), documentId],
      );
      await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
    }
    return { added: drafts.length, alreadyPosted: 0 };
  });
}

/** Takes the findings a driver analysis added out of use (rejected, not deleted, so adding them again restores them). */
export async function removeDriverFindings(tenantId: string, runId: string, analysisId: string): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string }>(
      "update findings set status = 'rejected' where run_id = $1 and pattern_type = 'driver' and stated_stats->>'analysisId' = $2 and status <> 'rejected' returning id",
      [runId, analysisId],
    );
    await recordHumanReview(client, r.rows.map((row) => row.id), "tool_remove");
    return r.rowCount ?? 0;
  });
}

/**
 * How many findings in use each saved analysis has. A failed read is thrown, not returned as an
 * empty map: "could not check" must not read as "nothing posted" (the screen would then offer to
 * post again).
 */
export async function driverFindingCounts(tenantId: string, runId: string): Promise<Map<string, number>> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; n: number }>(
      "select stated_stats->>'analysisId' as id, count(*)::int as n from findings where run_id = $1 and tenant_id = $2 and pattern_type = 'driver' and status <> 'rejected' group by 1",
      [runId, tenantId],
    );
    return new Map(r.rows.map((row) => [row.id, row.n] as const));
  });
}
