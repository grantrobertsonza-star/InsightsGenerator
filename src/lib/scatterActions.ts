"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { loadDocumentFile, loadVariableDictionaryWithStatus, overlayFor } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { withTenant, withTenantRead } from "./db";
import { findingProvenanceAvailable, recordHumanReview } from "./findingProvenance";
import type { LabelOverlay } from "./labelOverlay";
import { canonicalJson } from "./researchQualityRules";
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
  const [doc, overlay, setupStatus, content] = await Promise.all([
    loadDocumentFile(tenantId, runId, documentId),
    overlayFor(tenantId, runId, documentId),
    loadDataSetupWithStatus(tenantId, documentId),
    documentContentSha(tenantId, runId, documentId),
  ]);
  // The layout decides how the file is read, so a failed lookup must not fall back to a default.
  if (!setupStatus.ok) throw new Error(`This file's saved set-up could not be read: ${setupStatus.error}`);
  const basis = scatterBasis(
    { storagePath: doc.storage_path, selectedSheet: doc.selected_sheet, contentSha: content.sha, layout: setupStatus.setup.layout, overlay },
    [xVar, yVar, weightVar],
  );
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
  return { xInfo, yInfo: cols.outcome, casesInFile: cols.n, weighted: !!cols.weights, xs, ys, ws: cols.weights ? ws : null, basis, hashColumn: content.column };
}

/**
 * The file's recorded content hash (migration 0098). `sha` is null when the lookup succeeded and no
 * hash is recorded. `column` is false when the column does not exist (0098 not applied, SQLSTATE
 * 42703): the stored path and set-up then still identify the file read, as before. Any other failure
 * (a dropped connection, a permission refusal) is thrown, never read as "no hash", so a basis is
 * never built from a lookup that failed (Codex RR-02, 2026-10-21).
 */
type ContentIdentity = { sha: string | null; column: boolean };

async function documentContentSha(tenantId: string, runId: string, documentId: string): Promise<ContentIdentity> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ content_sha256: string | null }>("select content_sha256 from documents where id = $1 and run_id = $2", [documentId, runId]);
      return { sha: r.rows[0]?.content_sha256 ?? null, column: true };
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "42703") return { sha: null, column: false };
    throw error;
  }
}

type BasisInputs = {
  storagePath: string;
  selectedSheet: string | null;
  contentSha: string | null;
  layout: unknown;
  overlay: LabelOverlay | null;
};

/**
 * IR-01 (Codex, 2026-10-20): what a posted correlation was computed from, as one hash: the stored
 * file (its path, recorded content hash and chosen sheet), the saved layout, and the questionnaire
 * labels for the three variables used (the columns tool reads "no usable answer" codes from them).
 * Labels of other variables are left out, so correcting an unrelated question does not make this
 * finding look out of date. Variable names, never labels, identify the finding itself.
 */
function scatterBasis(inputs: BasisInputs, variables: (string | null)[]): string {
  const used = variables.filter((v): v is string => !!v);
  const pick = (map: Record<string, unknown> | undefined) => Object.fromEntries(used.filter((v) => map && v in map).map((v) => [v, map![v]]));
  const overlay = inputs.overlay
    ? { variableLabels: pick(inputs.overlay.variableLabels), valueLabels: pick(inputs.overlay.valueLabels) }
    : null;
  return createHash("sha256")
    .update(canonicalJson({ file: inputs.storagePath, sheet: inputs.selectedSheet, content: inputs.contentSha, layout: inputs.layout ?? null, overlay }))
    .digest("hex");
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
 * The figures of a posted correlation, compared to decide whether a repost changes anything. Display
 * fields (labels, wording) are compared through the finding text instead, and `basis` separately.
 */
function figuresOf(stats: Record<string, unknown>): string {
  const { r, n, casesInFile, weighted, weightVar, pValue, points } = stats;
  return canonicalJson({ r, n, casesInFile, weighted, weightVar: weightVar ?? null, pValue: pValue ?? null, points: points ?? null });
}

type PostedRow = {
  id: string;
  status: string;
  finding_text: string;
  stated_stats: Record<string, unknown> | null;
  /** Null when migration 0094 is not applied: wording is then treated as never edited by hand. */
  wording_edited: boolean | null;
};

/**
 * Recorded in `stated_stats.wording_review` when the figures of a finding whose wording the
 * researcher edited have changed since: the wording is kept, and this says it was written for
 * earlier figures and offers the sentence the tool would write now (Codex RR-01, 2026-10-21).
 */
export type ScatterWordingReview = { reason: "figures_changed"; suggested_text: string };

/**
 * Posts the scatter's correlation as a finding (Grant, 2026-10-20). The correlation is computed again
 * here from the file, never taken from the page.
 *
 * Repair of IR-01 and IR-02 (Codex, 2026-10-20):
 * - One finding per file, pair of variable NAMES and weight. A post, repost or revival always
 *   writes the figures computed now: when the file, its set-up or the labels used changed since the
 *   finding was posted (recorded as `stated_stats.basis`), the existing finding's text and figures
 *   are updated in place rather than left at the old correlation. As for the other analysis tools
 *   (brandHealthActions.ts), a theme the researcher changed by hand is kept, and so is wording the
 *   researcher edited (RR-01, see ScatterWordingReview below). Updating in place keeps
 *   the finding's id, so an insight built on it is shown as having changed figures (supportStatus).
 * - The file's document row is locked FOR UPDATE (and must exist in this project) before the
 *   existing finding is looked up, the pattern chooseInstrumentLink uses, so two posts of the same
 *   correlation run one after the other and the second finds the first: one finding, never two.
 * - The file is read before the transaction; if the read fails nothing is written and the previous
 *   finding stays as it was.
 *
 * `added` is true when a finding was created or brought back; `updated` when an existing one's
 * figures or wording were brought up to date.
 */
export async function addScatterFindingAction(
  runId: string,
  documentId: string,
  xVar: string,
  yVar: string,
  weightVar: string | null,
): Promise<{ ok: true; added: boolean; updated: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const d = await readPairs(TENANT_ID, runId, documentId, xVar, yVar, weightVar);
    const finding = scatterFinding({ x: d.xInfo, y: d.yInfo, xs: d.xs, ys: d.ys, ws: d.ws, weightVar: d.ws ? weightVar : null, casesInFile: d.casesInFile });
    if (!finding) return { ok: false, error: "There is no correlation to post: fewer than three cases answered both, or one of them does not vary." };
    const weightKey = d.ws ? weightVar : null;
    // Whether the hash column existed when the basis was computed: a basis computed without it
    // cannot be compared with one computed with it (see scatterFindingStatusAction).
    const stats = { ...finding.statedStats, basis: d.basis, ...(d.hashColumn ? {} : { basis_without_content_hash: true }) };
    const statsJson = JSON.stringify(stats);
    const result = await withTenant(TENANT_ID, async (client) => {
      const doc = await client.query("select id from documents where id = $1 and run_id = $2 for update", [documentId, runId]);
      if (doc.rowCount !== 1) throw new Error("That data file is not in this project.");
      // Oldest first, a finding in use before a removed one: the one kept if earlier duplicates exist.
      const provenance = await findingProvenanceAvailable(client);
      const rows = (
        await client.query<PostedRow>(
          `select id, status, finding_text, stated_stats,
                  ${provenance ? "human_edited_fields @> array['finding_text']" : "null::boolean"} as wording_edited
             from findings where ${SAME_FINDING}
           order by (status = 'rejected'), created_at, id`,
          [runId, xVar, yVar, weightKey, documentId],
        )
      ).rows;
      const target = rows[0];
      if (!target) {
        const inserted = await client.query<{ id: string }>(
          `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
           values ($1, $2, 'generated', $3, $4, 'relationship', $5, 'quantitative', 'accepted', $6)
           returning id`,
          [TENANT_ID, runId, finding.text, finding.theme, statsJson, documentId],
        );
        await recordHumanReview(client, inserted.rows.map((row) => row.id), "tool_add");
        return { added: true, updated: false };
      }
      const old = target.stated_stats ?? {};
      const figuresChanged = figuresOf(old) !== figuresOf(stats);
      // RR-01: wording the researcher edited is theirs. A repost or a revival never replaces it.
      // Unchanged figures leave it as it is (a label change included); changed figures update the
      // figures and record that the wording was written for earlier ones, with the sentence the
      // tool would write now, for the researcher to review. A qualification already recorded stays
      // until the researcher rewords the finding, since the wording still predates those figures.
      const keepWording = target.wording_edited === true;
      let next: Record<string, unknown> = stats;
      if (keepWording) {
        const review: ScatterWordingReview | undefined = figuresChanged
          ? { reason: "figures_changed", suggested_text: finding.text }
          : (old.wording_review as ScatterWordingReview | undefined);
        next = review ? { ...stats, wording_review: review } : stats;
      }
      const text = keepWording ? target.finding_text : finding.text;
      const changed = target.finding_text !== text || figuresChanged || canonicalJson(old.wording_review ?? null) !== canonicalJson(next.wording_review ?? null);
      const nextJson = JSON.stringify(next);
      const reviving = target.status === "rejected";
      if (changed) {
        await client.query(
          `update findings set finding_text = $2,
             theme = ${provenance ? "case when human_edited_fields @> array['theme'] then theme else $3 end" : "$3"},
             stated_stats = $4
           where id = $1`,
          [target.id, text, finding.theme, nextJson],
        );
      } else if (old.basis !== d.basis || !!old.basis_without_content_hash !== !d.hashColumn) {
        // Same figures and wording from a changed basis (for example a relabelled answer that is
        // not missing): only the record of what they were computed from moves on.
        await client.query("update findings set stated_stats = $2 where id = $1", [target.id, nextJson]);
      }
      if (reviving) await client.query("update findings set status = 'accepted' where id = $1", [target.id]);
      if (reviving || changed) await recordHumanReview(client, [target.id], "tool_add");
      return { added: reviving, updated: changed };
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...result };
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

/**
 * Whether this scatter's correlation (file, pair and weight) is currently posted, and whether the
 * posted figures were computed from the file and set-up as they are now (`current`): false when
 * the file, its layout or the labels used have changed since (post again to update it), null when
 * that cannot be told (a finding posted before this was recorded, or a lookup that failed, the
 * file's content hash included: RR-02). `wordingReview` is set when the researcher's wording was
 * kept over changed figures and is waiting for their review (RR-01). The file itself is not read
 * here.
 */
export async function scatterFindingStatusAction(
  runId: string,
  documentId: string,
  xVar: string,
  yVar: string,
  weightVar: string | null,
): Promise<{ ok: true; committed: boolean; current: boolean | null; wordingReview: ScatterWordingReview | null } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const posted = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ basis: string | null; without_hash: boolean; wording_review: ScatterWordingReview | null }>(
        `select stated_stats->>'basis' as basis, coalesce((stated_stats->>'basis_without_content_hash')::boolean, false) as without_hash,
                stated_stats->'wording_review' as wording_review from findings where ${SAME_FINDING} and status <> 'rejected' order by created_at, id limit 1`,
        [runId, xVar, yVar, weightVar || null, documentId],
      );
      return r.rows[0] ?? null;
    });
    if (!posted) return { ok: true, committed: false, current: null, wordingReview: null };
    const wordingReview = posted.wording_review ?? null;
    if (!posted.basis) return { ok: true, committed: true, current: null, wordingReview };
    let current: boolean | null = null;
    try {
      const [doc, overlay, setupStatus, content] = await Promise.all([
        loadDocumentFile(TENANT_ID, runId, documentId),
        overlayFor(TENANT_ID, runId, documentId),
        loadDataSetupWithStatus(TENANT_ID, documentId),
        documentContentSha(TENANT_ID, runId, documentId),
      ]);
      // Computed with the hash column and checked without it, or the other way round: the two
      // cannot be compared, so this is unknown rather than current or changed.
      if (setupStatus.ok && content.column === !posted.without_hash) {
        const now = scatterBasis(
          { storagePath: doc.storage_path, selectedSheet: doc.selected_sheet, contentSha: content.sha, layout: setupStatus.setup.layout, overlay },
          [xVar, yVar, weightVar],
        );
        current = now === posted.basis;
      }
    } catch {
      current = null; // could not be checked: never reported as current
    }
    return { ok: true, committed: true, current, wordingReview };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}
