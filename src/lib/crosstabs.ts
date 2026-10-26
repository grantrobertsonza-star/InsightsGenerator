import { levelFindings, noDifferenceFindings } from "./descriptiveFindings";
import { withTenant, withTenantRead } from "./db";
import { hasRepeatedSetKeys } from "./variableSetKeys";
import { assertImportCaseCount } from "./importLimits";
import { loadDataSetup, loadDataSetupWithStatus } from "./dataSetup";
import type { DataSetup } from "./dataSetupShared";
import { resolveSurveyDesign, effectiveDesignChoice } from "./surveyDesign";
import { enrichDictionary } from "./labelOverlay";
import { loadVariableOverrides, applyQuestionTypeOverrides, type VariableOverrides } from "./variableOverrides";
import { archiveAndReplaceFindings } from "./findingArchive";
import {
  runStatsTool,
  type CategoryList,
  type CrosstabProvenance,
  type CrosstabRequest,
  type CrosstabResult,
  type CrosstabRow,
  type VariableDictionary,
} from "./parseStatsFile";
import { setCell } from "./rowCells";

const MAX_FINDINGS_PER_QUESTION = 3;
const MAX_FINDINGS_PER_TABLE = 40;
const FIRST_CROSSTAB_INDEX = 100;

// JSON.stringify's key order follows object-property insertion order, which a round trip
// through jsonb storage and back is not guaranteed to preserve. Comparing two overrides
// snapshots by their raw stringified form could therefore call two semantically identical
// objects "stale" just because their keys came back in a different order. Sorting keys at
// every level before stringifying makes the comparison depend only on the actual content.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

export type CrosstabListItem = {
  id: string;
  label: string;
  status: "draft" | "committed";
  findings: number;
  legacy: boolean;
  source: "workspace" | "ask" | "window" | "starter" | "assistant";
  /** Set on every table of a layered set: one subtable per category of a layer variable, SPSS-style.
   * Shared across the set so the UI can group them; layerCategory/layerLabel describe this one panel. */
  layerGroup?: string | null;
  layerCategory?: string | null;
  layerLabel?: string | null;
  /** True when the document's variable corrections (type/question-type overrides) have
   * changed since this table was built - a data-type override, for instance, can change
   * whether a row is tabulated as frequencies or a mean (see IMP-005), so a table built
   * before such a correction may no longer show what the corrected variable now would.
   * Always false for a table built before overrides_snapshot existed: there is nothing
   * to compare it against, so it is left alone rather than guessed at. */
  stale: boolean;
  /** ANA-NPS-003 (second counter-review; Brief 37 repair): "current" when the document's
   * persisted survey-design setting (or, with none persisted, what the heuristic would now
   * pick) matches the design actually applied when this table was built; "stale" when it
   * differs - changing the setting never retroactively edits an already-built table or a
   * finding made from it, it only marks it for the researcher's attention, the same "flag,
   * never silently recalculate" rule overrides_snapshot/`stale` already follows. "unknown" for
   * a table built before design_snapshot existed (nothing recorded to compare against) OR when
   * resolving the document's CURRENT design failed (a permission/connection error) - either way
   * this is a genuinely uncheckable state, not verified agreement, and must never collapse to
   * the same false/absent signal a confirmed match would show (Brief 37's re-review: "a
   * swallowed lookup failure can produce designStale: false... the actual findings loader also
   * returned false for a legacy null snapshot"). */
  designFreshness: DesignFreshness;
};

/** Brief 37 repair: distinct current/stale/unknown states for a table's or finding's design
 * freshness - see CrosstabListItem.designFreshness above for what each means and why a boolean
 * (or a boolean that silently defaults on failure) isn't enough. */
export type DesignFreshness = "current" | "stale" | "unknown";

type DocumentFile = { storage_path: string; source_filename: string; selected_sheet: string | null };

export async function loadDocumentFile(tenantId: string, runId: string, documentId: string): Promise<DocumentFile> {
  const doc = await withTenant(tenantId, async (client) => {
    const r = await client.query<DocumentFile>(
      "select storage_path, source_filename, selected_sheet from documents where id = $1 and run_id = $2",
      [documentId, runId],
    );
    return r.rows[0];
  });
  if (!doc) throw new Error("Document not found for this run");
  return doc;
}

/**
 * IMP-SHIP-001 (Codex round 2, "a losing publisher must adopt that choice and reparse
 * before returning, caching or saving data"): resolves which sheet is ACTUALLY
 * authoritative for this document after attempting to persist `resolved` as the choice.
 *
 * If `currentlySelected` was already set when the caller started, there is nothing to
 * race - it was already authoritative, and the caller parsed against it from the start.
 *
 * Otherwise this may be the first-ever read of this document's sheet, and another reader
 * (findings extraction, a dictionary load, a crosstab/driver build - any of them can be
 * first) could be resolving it at the same moment. `UPDATE ... WHERE selected_sheet IS
 * NULL ... RETURNING` tells us which of the two actually happened: a returned row means
 * our own `resolved` choice won and is now authoritative; an empty result means someone
 * else's write landed first, so the real, now-persisted value is read back and returned
 * instead - the CALLER MUST re-parse/recompute against that value before using its own
 * already-computed result for anything that gets saved, cached, or returned, since that
 * result no longer matches the sheet the rest of the system will treat as authoritative.
 *
 * Persistence failures here are NOT caught and swallowed (Codex round 2, "failures must
 * not silently permit divergent results"): a permission error or a missing migration must
 * stop this read from quietly proceeding on an unconfirmed guess, exactly like a stale
 * `selected_sheet` now does via `SheetSelectionLostError` - both are the same "don't
 * continue with an unconfirmed selection" rule, so both surface as an explicit failure
 * rather than one throwing and the other going on regardless.
 */
export async function resolveAuthoritativeSheet(
  tenantId: string,
  documentId: string,
  currentlySelected: string | null,
  resolved: string,
): Promise<string> {
  if (currentlySelected) return currentlySelected;
  return withTenant(tenantId, async (client) => {
    const won = await client.query<{ selected_sheet: string }>(
      "update documents set selected_sheet = $1 where id = $2 and selected_sheet is null returning selected_sheet",
      [resolved, documentId],
    );
    if (won.rows[0]) return won.rows[0].selected_sheet;
    // 0 rows affected: another reader's write already landed between our own read of
    // `currentlySelected` and this UPDATE. Read back what actually won.
    const existing = await client.query<{ selected_sheet: string | null }>(
      "select selected_sheet from documents where id = $1",
      [documentId],
    );
    return existing.rows[0]?.selected_sheet ?? resolved;
  });
}

/**
 * Confirmed questionnaire wording for a data file, or null when it has none (including a database
 * without the questionnaire tables, which getConfirmedItemsForData treats as no links). Loaded
 * lazily: instruments.ts imports this module.
 *
 * GT100-F01: a failed read is not caught here. It used to become null, the same as "no confirmed
 * links", so the dictionary, categories, cross tabs, scatter plots and driver analysis computed
 * with the file's own labels and missing codes. InstrumentMeaningUnavailableError now propagates
 * and each of those refuses before the engine is called.
 */
export async function overlayFor(tenantId: string, runId: string, documentId: string) {
  const { getLabelOverlay } = await import("./instruments");
  return getLabelOverlay(tenantId, runId, documentId);
}

/** The variable list for a data file, read once and kept on the document. */
export async function loadVariableDictionary(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<VariableDictionary> {
  const setup = await loadDataSetup(tenantId, documentId);
  return buildVariableDictionaryForSetup(tenantId, runId, documentId, setup);
}

// ANA-NPS-003 (Brief 37 repair): "dictionary/build paths used by NPS, Objectives and charts
// still call loadDataSetup(), which substitutes defaults on failure - overriding design alone
// must not authorize defaulting unrelated inputs." The dictionary's cache-validity and build
// orientation both depend on the document's persisted `layout`, a required saved input
// entirely separate from `design` - a caller's own explicit design choice bypasses the design
// LOOKUP (see effectiveDesignChoice), but it was never meant to bypass this one too. The three
// repaired callers (runDistributionAction, runNpsAction, evaluateEvidenceQuestion) now call
// this strict variant instead, so a failed layout lookup fails their whole request visibly
// rather than silently building a dictionary off a defaulted ("rows_are_cases") layout while
// believing every required saved input was honestly retrieved. loadVariableDictionary itself
// is left tolerant, unchanged, for its many other existing callers (brandHealthActions,
// csmActions, crosstabActions, crosstabAsk, instruments, variableOverrides,
// waveTrackingActions, this run page) - this repair's scope is the dictionary/build paths
// NPS, Objectives and charts use, not every consumer of this function.
export async function loadVariableDictionaryWithStatus(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<{ ok: true; dictionary: VariableDictionary } | { ok: false; error: string }> {
  const status = await loadDataSetupWithStatus(tenantId, documentId);
  if (!status.ok) return { ok: false, error: status.error };
  const dictionary = await buildVariableDictionaryForSetup(tenantId, runId, documentId, status.setup);
  return { ok: true, dictionary };
}

// Import must know the underlying definition when a researcher clears a correction. Reading an
// already-corrected dictionary here would make the old correction look like the imported default.
export async function loadImportedVariableDictionary(tenantId: string, runId: string, documentId: string): Promise<VariableDictionary> {
  const status = await loadDataSetupWithStatus(tenantId, documentId);
  if (!status.ok) throw new Error(status.error);
  return buildVariableDictionaryForSetup(tenantId, runId, documentId, status.setup, false);
}

/**
 * The oldest cached dictionary version still valid for this layout and format. Version 8 changed
 * how a columns-as-cases file is typed after its flip: identifiers keep
 * their literal text, and whole numbers beyond the 64-bit range stay exact instead of wrapping
 * negative. A version-7 cache of such a file may list an identifier as numeric, so it is rebuilt
 * from the file on its next read; rows-as-cases typing did not change, so its version-7 caches stay
 * valid except for SAV/ZSAV: version 9 preserves their user-missing declarations in the audit.
 * Version10 rechecks flipped workbooks for unsupported separate-Codebook weight/MR definitions,
 * so an older dictionary cannot bypass the refusal by serving already-cached variable metadata.
 * Version 11 is the one reader for CSV, TSV and Excel (Codex TP500/IP1000): names and codes are read
 * as written, dates as ISO dates, and repeated names allocated by one rule, so every older cache of
 * such a file, in either layout, may name or type variables differently and is rebuilt.
 * Rebuilding only replaces documents.variable_dictionary: the
 * researcher's own corrections live in documents.variable_overrides and are applied on top, so a
 * rebuild cannot lose them.
 */
export function minimumDictionaryVersion(layout: DataSetup["layout"], sourceFilename = ""): number {
  if (/\.(?:csv|tsv|xlsx|xls)$/i.test(sourceFilename)) return 13;
  if (/\.(?:sav|zsav)$/i.test(sourceFilename)) return 9;
  return layout === "columns_are_cases" ? 10 : 7;
}

async function buildVariableDictionaryForSetup(
  tenantId: string,
  runId: string,
  documentId: string,
  setup: DataSetup,
  applyCorrections = true,
): Promise<VariableDictionary> {
  // Hoisted ahead of the cache check (previously loaded only on a cache miss): IMP-SHIP-001
  // (Codex round 2, "bind dictionary caches ... to selected-sheet identity") needs the
  // document's currently persisted selected_sheet to decide whether a cached dictionary was
  // built against the sheet that is now authoritative, not just whichever one happened to
  // be picked whenever that cache entry was written.
  const doc = await loadDocumentFile(tenantId, runId, documentId);
  let dictionary: VariableDictionary | null = null;
  try {
    const cached = await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ variable_dictionary: VariableDictionary | null }>(
        "select variable_dictionary from documents where id = $1 and run_id = $2",
        [documentId, runId],
      );
      return r.rows[0]?.variable_dictionary ?? null;
    });
    // Older copies lack sets, text flags or the label-based families and word-named flags (version 4), the weights and missing-code audit (version 5), and the uncapped duplicate-case count (version 6).
    // A dictionary cached under a different layout setting is stale (a raw file's chosen
    // orientation changes which column is which variable), so it's recomputed rather than
    // reused; a dictionary cached before layout was tracked (layout undefined) is treated
    // as matching only the default orientation, same as a file whose setup was never touched.
    const cachedLayout = cached?.layout ?? "rows_are_cases";
    // IMP-SHIP-001 (Codex round 2): a cache entry is only safe to reuse when it was built
    // against the sheet that is CURRENTLY authoritative. If something IS persisted, the
    // cache must name that exact sheet - including a cache entry from before sheet
    // tracking existed at all (cached.sheets undefined), which is treated as not matching
    // rather than assumed compatible, since there is no way to confirm it actually is.
    const cachedSheet = cached?.sheets?.data ?? null;
    // Codex round 3, "do not reuse an unconfirmed dictionary cache when selected_sheet is
    // null": the round-2 version of this check treated a null doc.selected_sheet as
    // vacuously satisfying sheetMatches whenever a cache existed, which let a multi-sheet
    // document's cache (built against WHATEVER sheet some earlier, never-persisted read
    // happened to pick) be reused without ever confirming that pick is the one every other
    // reader will also land on. A cache naming a specific sheet is only trustworthy once
    // that sheet is actually the published, authoritative choice - so when nothing is
    // persisted yet but the cache does name one, publish/adopt it through the same
    // single-writer race-resolution path extraction and a fresh dictionary read already
    // use, before ever reusing the cache. (A cache with no sheet at all - cachedSheet
    // null - has nothing to confirm: that's the single-sheet-file case, where sheet
    // selection isn't a concept, and the vacuous match still applies.)
    if (!doc.selected_sheet && cachedSheet) {
      const authoritative = await resolveAuthoritativeSheet(tenantId, documentId, null, cachedSheet);
      doc.selected_sheet = authoritative;
    }
    const sheetMatches = !doc.selected_sheet || cachedSheet === doc.selected_sheet;
    // IMP-015: version 7 shows conflicting label definitions as conflicts; an older cache may
    // carry a silently chosen label, so it is recomputed.
    // A cache that gives two question sets one key predates unique set keys: rebuilt (variableSetKeys.ts).
    if (cached && cached.sets && !hasRepeatedSetKeys(cached.sets) && (cached.version ?? 0) >= minimumDictionaryVersion(setup.layout, doc.source_filename) && cachedLayout === setup.layout && sheetMatches) {
      dictionary = cached;
    }
  } catch {
    // column missing until migration 0058 is applied; fall through and compute
  }
  if (dictionary) assertImportCaseCount(dictionary.nCases);
  if (!dictionary) {
    dictionary = await runStatsTool<VariableDictionary>("dictionary", doc.storage_path, doc.source_filename, {
      layout: setup.layout,
      selectedSheet: doc.selected_sheet,
    });
    dictionary.layout = setup.layout;
    // IMP-SHIP-001 (Codex round 2): this may be the first read to ever touch this document (a
    // Table document whose findings were never extracted, only used for Cross tabs) - if so,
    // find out which sheet actually became authoritative, which may not be the one this call
    // itself just computed against if another reader's write won the race. A losing read here
    // reruns the dictionary against the real winner before it is cached or returned, rather
    // than caching or returning a dictionary built from a sheet nothing else agrees with.
    const resolvedSheet = dictionary.sheets?.data;
    if (resolvedSheet) {
      const authoritative = await resolveAuthoritativeSheet(tenantId, documentId, doc.selected_sheet, resolvedSheet);
      if (authoritative !== resolvedSheet) {
        dictionary = await runStatsTool<VariableDictionary>("dictionary", doc.storage_path, doc.source_filename, {
          layout: setup.layout,
          selectedSheet: authoritative,
        });
        dictionary.layout = setup.layout;
      }
    }
    assertImportCaseCount(dictionary.nCases);
    try {
      await withTenant(tenantId, async (client) => {
        await client.query("update documents set variable_dictionary = $1 where id = $2", [
          JSON.stringify(dictionary),
          documentId,
        ]);
      });
    } catch {
      // caching is best effort - this is the computed-dictionary cache, a performance
      // convenience distinct from the selected_sheet provenance write above, which is not
      // allowed to fail silently (see resolveAuthoritativeSheet's own comment).
    }
  }
  const overlay = await overlayFor(tenantId, runId, documentId);
  const withOverlay = overlay ? enrichDictionary(dictionary, overlay) : dictionary;
  if (!applyCorrections) return withOverlay;
  // A researcher's saved question-type correction (Import screen) applies
  // here too, not only to the report shown on that screen: this is the one
  // place crosstab building, the categories list and the variable picker
  // all read the dictionary from, so folding it in here is enough to reach
  // all three. A crosstab table already built before the correction was
  // saved is not retroactively rebuilt; it keeps using the dictionary as it
  // read it at the time.
  // IMP-005: loadVariableOverrides itself already distinguishes the one expected failure
  // (migration 0077 not yet applied - the column does not exist) from everything else, and
  // rethrows anything unexpected rather than returning `{}` for it. Catching that rethrow
  // here and turning it back into `{}` undid that distinction at the one place a database
  // hiccup or a permissions error would otherwise be indistinguishable from "this document
  // genuinely has no corrections" - so a transient failure silently discarded every saved
  // correction instead of stopping the calculation that depends on them.
  const overrides = await loadVariableOverrides(tenantId, runId, documentId);
  return applyQuestionTypeOverrides(withOverlay, overrides);
}

// ANA-NPS-003: the same PSU/strata name-pattern heuristic CrosstabWorkspace.tsx has used for
// its "Survey design" field since that UI was built, extracted so the one NPS-tool and
// Objectives-evidence request paths that never exposed a design picker of their own can still
// benefit from it, rather than always falling back to the plain SRS variance. As in that UI,
// detection is "both or neither" - a PSU variable with no corresponding strata variable is not
// enough to switch a design on by default there, so it is not enough here either; a document
// with only one of the two keeps getting the SRS fallback from both call sites, exactly as a
// researcher opening Cross tabs on the same file would see "Weights only" rather than a half
// applied design. This never invents a design the workspace itself would not have suggested,
// and a researcher's own explicit choice in the workspace (psuChoice/strataChoice there) has no
// counterpart here - these two paths have no design picker of their own to override with.
// ANA-NPS-003: the detection/resolution heuristic itself now lives in ./surveyDesign, a module
// with no server-only imports, so the manual Cross tabs workspace (a "use client" component)
// can import the exact same logic this file's own callers use, instead of keeping its own
// duplicate copy - the "a parallel path still uses the old behaviour" pattern Codex's repeat
// reviews kept finding. Re-exported here so npsActions.ts, objectiveEvidence.ts and any other
// existing server-side importer of `detectSurveyDesign` from "./crosstabs" keeps working
// unchanged.
export { detectSurveyDesign, resolveSurveyDesign, type DetectedDesign, type SurveyDesignChoice, type ResolvedSurveyDesign } from "./surveyDesign";

export async function loadCategories(
  tenantId: string,
  runId: string,
  documentId: string,
  variable: string,
): Promise<CategoryList> {
  const [doc, overlay, setup] = await Promise.all([
    loadDocumentFile(tenantId, runId, documentId),
    overlayFor(tenantId, runId, documentId),
    loadDataSetup(tenantId, documentId),
  ]);
  return runStatsTool<CategoryList>("categories", doc.storage_path, doc.source_filename, {
    variable,
    overlay,
    layout: setup.layout,
    selectedSheet: doc.selected_sheet,
  });
}

function fmtP(p: number | null): string {
  return p === null ? "n/a" : p < 0.001 ? "<0.001" : String(p);
}

type CrosstabFinding = { text: string; theme: string; stats: Record<string, unknown> };

/**
 * Benjamini-Hochberg adjusted p-values for every tested cell in a table, so a
 * wide starter set does not turn chance differences into findings. Keyed by
 * row, one entry per column (null where no test was run).
 */
function fdrQValues(result: CrosstabResult): Map<CrosstabRow, (number | null)[]> {
  const cells: { row: CrosstabRow; k: number; p: number }[] = [];
  for (const q of result.questions) {
    for (const row of q.rows) {
      if (row.isBase) continue;
      row.p.forEach((p, k) => {
        if (p !== null && p !== undefined) cells.push({ row, k, p });
      });
    }
  }
  cells.sort((a, b) => a.p - b.p);
  const m = cells.length;
  const q = new Array<number>(m);
  let running = 1;
  for (let i = m - 1; i >= 0; i--) {
    running = Math.min(running, (cells[i].p * m) / (i + 1));
    q[i] = running;
  }
  const out = new Map<CrosstabRow, (number | null)[]>();
  cells.forEach((c, i) => {
    const arr = out.get(c.row) ?? new Array<number | null>(c.row.p.length).fill(null);
    arr[c.k] = Math.round(q[i] * 10000) / 10000;
    out.set(c.row, arr);
  });
  return out;
}

export function crosstabFindings(result: CrosstabResult): CrosstabFinding[] {
  const out: CrosstabFinding[] = [];
  // Starter sets test many cells at once, so only differences that survive a
  // false discovery rate correction (5%) become findings.
  const fdr = result.starter ? fdrQValues(result) : null;
  const weighted = result.weightVar ? "weighted" : "unweighted";
  // The test and its caveat follow the design the engine APPLIED (notes.designApplied), not the one
  // requested: designUsed is also filled when a design was asked for but every case lacked design data,
  // and then the standard errors are plain Kish ones tested against the normal (ANA-NPS-003 did the same
  // for NPS). stats.design below still records the request, with casesMissingDesign.
  const designApplied = result.notes?.designApplied === true;
  for (const q of result.questions) {
    const candidates: (CrosstabFinding & { gap: number })[] = [];
    for (const row of q.rows) {
      if (row.isBase) continue;
      row.sig.forEach((sig, k) => {
        const value = row.pct[k];
        const total = row.total.pct;
        if (!sig || value === null || value === undefined || total === null) return;
        const qv = fdr ? (fdr.get(row)?.[k] ?? null) : null;
        if (fdr && (qv === null || qv >= 0.05)) return;
        const col = result.columns[k];
        const base = row.base[k];
        const dir = sig > 0 ? "higher" : "lower";
        const isMean = q.kind === "numeric" || q.kind === "grid";
        const isScore = Boolean(row.isScore);
        const unit = isMean ? "" : "%";
        const subject =
          q.kind === "numeric"
            ? `${q.label} is ${dir} for ${col.blockLabel} "${col.name}" (average ${value}) than overall (${total})`
            : q.kind === "grid"
              ? `"${row.label}" on ${q.label} averages ${dir} for ${col.blockLabel} "${col.name}" (${value}) than overall (${total})`
              : isScore
                ? `"${row.label}" on ${q.label} is ${dir} for ${col.blockLabel} "${col.name}" (${value}${row.isMean ? "" : " points"}) than overall (${total}${row.isMean ? "" : " points"})`
                : `"${row.label}" on ${q.label} is ${dir} for ${col.blockLabel} "${col.name}" (${value}${unit}) than overall (${total}${unit})`;
        candidates.push({
          text: `${subject}, ${weighted}, based on ${base.n} cases (effective base ${Math.round(base.nEff)}); ${designApplied ? "t-test with design degrees of freedom, Taylor series variance" : "z-test"} of this group against all other cases in the same banner variable (not against the overall figure), ${row.pAdj?.[k] != null || qv !== null ? "unadjusted " : ""}p=${fmtP(row.p[k])}${row.pAdj?.[k] != null ? `, adjusted p=${fmtP(row.pAdj[k])} (corrected across the banner columns of this row)` : ""}${qv !== null ? `, false discovery rate q=${fmtP(qv)} (across every cell tested in this table; inclusion was decided on q, not on p)` : ""}.`,
          theme: `${q.label} by ${col.blockLabel}`,
          gap: Math.abs(value - total),
          stats: {
            testType: isMean || row.isMean ? "column_mean_vs_rest" : isScore ? "column_score_vs_rest" : "column_proportion_vs_rest",
            question: q.label,
            answer: row.label,
            bannerVariable: col.blockLabel,
            column: col.name,
            columnValue: value,
            totalValue: total,
            pValue: row.p[k],
            n: base.n,
            effectiveBase: base.nEff,
            weightVar: result.weightVar,
            design: result.notes?.designUsed ?? null,
            engineVersion: result.engine ?? null,
            ...(qv !== null ? { qValue: qv } : {}),
            correction: result.notes?.correction ?? "none",
            ...(row.pAdj?.[k] !== undefined && row.pAdj[k] !== null ? { pAdjusted: row.pAdj[k] } : {}),
            caveats: [
              // The table-wide control and the row-level correction are separate steps; both are recorded when both ran.
              ...(qv !== null ? ["fdr_controlled_within_table"] : []),
              ...(result.notes?.correction === "fdr"
                ? ["fdr_controlled_within_row"]
                : result.notes?.correction === "bonferroni"
                  ? ["bonferroni_controlled_within_row"]
                  : qv !== null
                    ? []
                    : ["uncorrected_multiple_comparisons"]),
              "weighted_effective_base",
              ...(designApplied ? ["survey_design_modelled"] : ["survey_design_not_modelled", "sampling_assumed_random"]),
            ],
          },
        });
      });
    }
    candidates.sort((a, b) => b.gap - a.gap);
    out.push(...candidates.slice(0, MAX_FINDINGS_PER_QUESTION));
  }
  if (out.length <= MAX_FINDINGS_PER_TABLE) return out;
  // Over the cap: keep the strongest evidence (smallest p, then largest gap), not
  // whichever questions happen to come first, and keep the table's question order.
  const strength = (f: CrosstabFinding & { gap?: number }) => {
    const st = f.stats as { qValue?: number | null; pAdjusted?: number | null; pValue?: number | null };
    return Number(st.qValue ?? st.pAdjusted ?? st.pValue ?? 1);
  };
  const gapOf = (f: CrosstabFinding & { gap?: number }) => f.gap ?? 0;
  return out
    .map((f, i) => ({ f, i }))
    .sort((x, y) => strength(x.f) - strength(y.f) || gapOf(y.f) - gapOf(x.f) || x.i - y.i)
    .slice(0, MAX_FINDINGS_PER_TABLE)
    .sort((x, y) => x.i - y.i)
    .map((x) => x.f);
}

/** Adds one table to the draft set. No findings are made until the set is committed. */
export async function buildCrosstab(
  tenantId: string,
  runId: string,
  documentId: string,
  request: CrosstabRequest,
  /** "evidence": built only to answer an objective evidence question, kept out of the draft set so it cannot be committed into findings. */
  options: {
    status?: "draft" | "evidence";
    /** The Research assistant question this table was built for and the exact request's key, so a retry of that question reuses it. */
    assistantRequest?: { id: string; key: string };
  } = {},
): Promise<{ tableId: string; questions: number; skipped: { variable: string; reason: string }[] }> {
  // No column variable is allowed: the table then describes all respondents (frequencies, means, spread).
  if (request.rowItems.length === 0) throw new Error("Choose at least one row variable.");
  // ANA-NPS-003 (Brief 38 repair): this was the exact remaining gap Codex found after Brief 37
  // fixed every CALLER's own lookups - buildCrosstab itself still independently called the
  // tolerant loadDataSetup() to read `layout` for the engine request, so a lookup failure here
  // (a transient permission/connection blip between a caller's own strict check and this
  // function's separate internal read of the same record) could still silently substitute
  // `rows_are_cases` and reach the engine, even after every caller upstream had checked
  // strictly. Fixed at the one place every caller - NPS, Objectives, charts, starter tables,
  // crosstabAsk, and the Cross tabs workspace's own direct calls alike - ultimately goes
  // through, rather than threading a pre-validated setup object through each call site's own
  // signature: a required-setting failure now fails this build before any engine request is
  // constructed, for every caller, by construction.
  const [doc, overlay, setupStatus, overrides] = await Promise.all([
    loadDocumentFile(tenantId, runId, documentId),
    overlayFor(tenantId, runId, documentId),
    loadDataSetupWithStatus(tenantId, documentId),
    // IMP-005: no `.catch(() => ({}))` here either - see loadVariableDictionary above. A
    // correction-retrieval failure must fail this build, not quietly reach the engine as
    // `typeOverrides: {}`, which would tabulate every overridden variable by its original,
    // uncorrected type.
    loadVariableOverrides(tenantId, runId, documentId),
  ]);
  if (!setupStatus.ok) {
    throw new Error(`This file's saved set-up could not be read, so this table was not built: ${setupStatus.error}`);
  }
  const setup = setupStatus.setup;
  // A researcher's data-type correction (categorical/discrete/continuous) changes how the
  // engine tabulates that one variable - a frequency table instead of a mean, or the reverse
  // (see the `type_overrides` handling in crosstab(), api/parse-stats-file.py). Only the `type`
  // field is relevant here; `questionType` corrections are already folded into the dictionary
  // itself (applyQuestionTypeOverrides) before a request is ever built from it.
  const typeOverrides = Object.fromEntries(
    Object.entries(overrides)
      .filter(([, o]) => o.type !== undefined)
      .map(([name, o]) => [name, o.type]),
  );
  let result = await runStatsTool<CrosstabResult>("crosstab", doc.storage_path, doc.source_filename, {
    ...request,
    correction: request.correction ?? "fdr",
    overlay,
    layout: setup.layout,
    typeOverrides,
    selectedSheet: doc.selected_sheet,
  });
  // Engineering brief round 4 (criterion 4, "persist the authoritative sheet explicitly in
  // calculation provenance"): unlike loadVariableDictionary and the extraction path
  // (documentTables.ts), this function previously never called resolveAuthoritativeSheet at
  // all - it just computed against whatever doc.selected_sheet happened to be, including
  // null/unconfirmed, and saved the result with no sheet identity in its provenance. A file
  // with no sheet concept (CSV, a stats file) returns no selectedSheet and nothing here
  // applies. For a multi-sheet workbook, this confirms/publishes this read's own sheet choice
  // the same way the other callers do; if another reader's independently-resolved pick has
  // already landed with a different sheet, this result was computed against a sheet nothing
  // else agrees is authoritative, so it is re-fetched against the real winner before anything
  // is saved - mirroring documentTables.ts's "a losing publisher must adopt that choice and
  // reparse" handling, not a change to the crosstab calculation logic itself.
  let authoritativeSheet: string | null = doc.selected_sheet ?? null;
  if (result.selectedSheet) {
    authoritativeSheet = await resolveAuthoritativeSheet(tenantId, documentId, doc.selected_sheet, result.selectedSheet);
    if (authoritativeSheet !== result.selectedSheet) {
      result = await runStatsTool<CrosstabResult>("crosstab", doc.storage_path, doc.source_filename, {
        ...request,
        correction: request.correction ?? "fdr",
        overlay,
        layout: setup.layout,
        typeOverrides,
        selectedSheet: authoritativeSheet,
      });
    }
  }
  if (result.questions.length === 0) {
    throw new Error(
      "None of the chosen rows could be tabulated. " + result.skipped.map((s) => `${s.variable}: ${s.reason}`).join(" "),
    );
  }

  // IMP-003 / ANA-BRAND-002: this flat `headers`/`rows` projection (the saved table's plain
  // SQL-friendly columns, used for CSV/export and simple table rendering - separate from the
  // full `result` object, which is saved verbatim too and correctly keeps every banner column
  // distinct no matter what it's called) keys each row object by the column's display name.
  // Two banner columns that happen to render the same name - two raw codes sharing one value
  // label, after the engine's own raw-code-identity fix stopped merging them into one column -
  // are real, distinct columns with real, distinct values, but writing `row[c] = ...` for both
  // under the identical string `c` let the second overwrite the first here, even though the
  // full `result` object a few lines below never lost either one. Same de-duplication technique
  // already used for transposeTable()'s column names (dataSetup.ts, IMP-003): a repeated name
  // gets a " (2)", " (3)", ... suffix so every column still gets its own object key.
  const colNamesBase = result.columns.map((c) => `${c.blockLabel}: ${c.name}`);
  const usedColNames = new Set<string>();
  const colNames = colNamesBase.map((base) => {
    let candidate = base;
    let suffix = 2;
    while (usedColNames.has(candidate)) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    usedColNames.add(candidate);
    return candidate;
  });
  const headers = ["Question", "Answer", ...colNames, "Total"];
  const rows = result.questions.flatMap((q) =>
    q.rows.filter((r) => !r.isEffBase && (!r.isBase || q.kind === "multi")).map((r) => {
      const row: Record<string, string | number | null> = { Question: q.label, Answer: r.label };
      colNames.forEach((c, k) => {
        setCell(row, c, r.isBase ? (r.count[k] ?? null) : (r.pct[k] ?? null));
      });
      row.Total = r.isBase ? (r.total.count ?? null) : (r.total.pct ?? null);
      return row;
    }),
  );
  const rowNames = request.rowItems.map((i) => (i.kind === "nets" && i.nets?.length ? i.nets.map((n) => `NET: ${n.label}`).join(", ") : i.label));
  const rowText = rowNames.length > 2 ? `${rowNames.slice(0, 2).join(", ")} +${rowNames.length - 2}` : rowNames.join(", ");
  const bannerText = result.blocks.map((b) => b.label).join(" + ");
  const filterText = result.filters && result.filters.length ? `, ${result.filters.map((f) => f.text).join(" and ")}` : "";
  const layerText = request.layerCategory ? ` — ${request.layerLabel ?? request.layerVariable}: ${request.layerCategory}` : "";
  const label = (result.overall
    ? `${request.starter ? "Starter: " : ""}${rowText}, all respondents${filterText} (${result.weightVar ? "weighted" : "unweighted"})`
    : `${request.starter ? "Starter: " : ""}${rowText} by ${bannerText}${filterText} (${result.weightVar ? "weighted" : "unweighted"})`) + layerText;

  const provenance: CrosstabProvenance = {
    builtAt: new Date().toISOString(),
    engine: result.engine ?? null,
    sourceFile: doc.source_filename,
    sourceDocumentId: documentId,
    cases: result.total?.n ?? null,
    weightVar: result.weightVar,
    correction: request.correction ?? "fdr",
    design: request.design ?? null,
    columnVars: request.columnVars,
    rowKeys: request.rowItems.map((i) => i.key),
    rowItems: request.rowItems.map((i) => ({ key: i.key, label: i.label ?? null, kind: i.kind, vars: i.vars })),
    excludeDk: request.excludeDk !== false,
    filters: request.filters ?? [],
    columnGroups: Object.fromEntries(Object.entries(request.columnGroups ?? {}).map(([k, g]) => [k, g.map((x) => x.label)])),
    questionnaireLabels: Boolean(overlay),
    starter: Boolean(request.starter),
    // Engineering brief round 4 (criterion 4): the sheet this table was actually computed
    // against, confirmed/published above - null for a CSV/stats file, which has no sheet
    // concept.
    selectedSheet: authoritativeSheet,
  };
  const source = request.starter ? "starter" : (request.source ?? "workspace");
  const stored = {
    ...result,
    provenance,
    source,
    ...(request.starter ? { starter: true } : {}),
    ...(request.layerGroup
      ? { layerGroup: request.layerGroup, layerVariable: request.layerVariable, layerLabel: request.layerLabel, layerCategory: request.layerCategory }
      : {}),
    // The exact request that built this table, kept verbatim (not just the summarised provenance
    // above) so the same definition can be replayed on another wave's file later.
    savedRequest: request,
    ...(options.assistantRequest ? { assistantRequest: options.assistantRequest } : {}),
  };

  const tableId = await withTenant(tenantId, async (client) => {
    // Table numbers are per file, taken as the highest so far plus one. Two tables saved at once
    // for one file (the CSM dashboard builds a variable's overall and segmented distributions
    // together, so this happens whenever Segment by is set; Codex CT500-F02) used to read the same
    // highest number and both insert it, and the second failed on document_tables' unique
    // (document_id, table_index) with the database's own message. Locking the file's row first
    // makes saves for one file take turns for the length of this transaction; the lock query also
    // confirms the file still exists in this run before anything is written.
    const owner = await client.query("select id from documents where id = $1 and run_id = $2 and tenant_id = $3 for update", [documentId, runId, tenantId]);
    if (owner.rows.length === 0) throw new Error("That data file was not found in this project, so the table was not saved.");
    const next = await client.query<{ next: number }>(
      "select coalesce(max(table_index) + 1, $2)::int as next from document_tables where document_id = $1 and table_index >= $2",
      [documentId, FIRST_CROSSTAB_INDEX],
    );
    // overrides_snapshot: the variable corrections in effect right now, saved alongside the
    // table so a later correction can be told apart from one this table already reflects (see
    // IMP-005, listCrosstabs() below). Needs migration 0078; mapped to a clear message here
    // (not retried without the column) because a transaction already failed on this insert
    // cannot simply run another statement without it - Postgres aborts the whole transaction
    // on the first error within it, so the only options are "do it right the first time" or
    // "fail with a clear reason", not "try again without the new column".
    try {
      const inserted = await client.query<{ id: string }>(
        `insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type, crosstab, crosstab_status, overrides_snapshot, design_snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, 'aggregated', $8, $9, $10, $11) returning id`,
        [
          tenantId,
          runId,
          documentId,
          next.rows[0].next,
          label,
          JSON.stringify(headers),
          JSON.stringify(rows),
          JSON.stringify(stored),
          options.status ?? "draft",
          JSON.stringify(overrides),
          // ANA-NPS-003 (second counter-review): the design actually sent to the engine for THIS
          // build - every current caller (Cross tabs' own workspace, the NPS tool, Objectives,
          // the distribution chart) resolves its own final design (its own explicit choice, the
          // document's persisted setting, or the heuristic - see effectiveDesignChoice in
          // ./surveyDesign) before calling buildCrosstab, so request.design here already IS that
          // final decision. Wrapped in an object (never a bare JSON `null`) so "weights only was
          // genuinely applied" (`{design: null}`) stays distinguishable, after a read back, from
          // "this table predates the column" (a real SQL NULL, read back as JS null) - a bare
          // JSON null and a SQL NULL are otherwise indistinguishable once node-postgres parses
          // the jsonb column, exactly the ambiguity DataDesignChoice's own three states exist to
          // avoid at the setting level.
          JSON.stringify({ design: request.design ?? null }),
        ],
      );
      return inserted.rows[0].id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/overrides_snapshot/.test(message)) {
        throw new Error("Building crosstabs needs migration 0078 applied first (npx.cmd supabase migration up).");
      }
      if (/design_snapshot/.test(message)) {
        throw new Error("Building crosstabs needs migration 0091 applied first (npx.cmd supabase migration up).");
      }
      // The lock above should make this impossible; if it still happens, say what it means
      // instead of showing the constraint's name. Nothing was saved, so trying again is safe.
      if ((error as { code?: string }).code === "23505" && /document_tables_document_id_table_index_key/.test(message)) {
        throw new Error(
          "Another table for this file was being saved at the same moment, so this one was not saved. Nothing was lost: try again.",
        );
      }
      throw error;
    }
  });
  return { tableId, questions: result.questions.length, skipped: result.skipped };
}

/**
 * Rebuilds every saved table of one document (a wave's file) against another document in the
 * same run (a later wave), replaying each table's own saved request verbatim: same banner, rows,
 * filters, weight, design and correction, just pointed at the new file. Closes the "a saved
 * crosstab definition does not auto-refresh on a new wave" gap: distributions, NPS and driver
 * analysis already recompute live across every wave file, but a crosstab is a stored table tied
 * to one document, so a new wave needs its own copy built from the same definition. Skips a table
 * with no saved request (built before this existed) or whose variables are not all present in the
 * new file, and reports why.
 */
export async function replicateCrosstabsToWave(
  tenantId: string,
  runId: string,
  sourceDocumentId: string,
  targetDocumentId: string,
): Promise<{ built: number; skipped: { label: string; reason: string }[] }> {
  const rows = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; label: string | null; saved_request: CrosstabRequest | null }>(
      `select id, label, crosstab->'savedRequest' as saved_request
       from document_tables
       where run_id = $1 and document_id = $2 and crosstab is not null
         and (crosstab->>'version')::int = 2
         and coalesce(crosstab_status, 'committed') <> 'evidence'
       order by table_index`,
      [runId, sourceDocumentId],
    );
    return r.rows;
  });
  let built = 0;
  const skipped: { label: string; reason: string }[] = [];
  for (const row of rows) {
    const label = row.label ?? "Crosstab";
    if (!row.saved_request) {
      skipped.push({ label, reason: "Built before tables could be replayed on another wave; rebuild it here first." });
      continue;
    }
    try {
      await buildCrosstab(
        tenantId,
        runId,
        targetDocumentId,
        { ...row.saved_request, source: row.saved_request.source ?? "workspace" },
        { status: "draft" },
      );
      built += 1;
    } catch (error) {
      skipped.push({ label, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { built, skipped };
}

/** Sets the title (stored as the table label) and the caption (stored in the table JSON) the researcher wrote. */
export async function setCrosstabText(tenantId: string, runId: string, tableId: string, title: string, caption: string): Promise<void> {
  const t = title.trim().slice(0, 300);
  const c = caption.trim().slice(0, 2000);
  await withTenant(tenantId, async (client) => {
    await client.query(
      `update document_tables
          set label = case when $3 = '' then label else $3 end,
              crosstab = jsonb_set(crosstab, '{caption}', to_jsonb($4::text))
        where id = $1 and run_id = $2 and crosstab is not null`,
      [tableId, runId, t, c],
    );
  });
}

type CrosstabListRow = {
  id: string;
  label: string | null;
  crosstab_status: "draft" | "committed" | null;
  findings: string;
  version: number | null;
  source: string | null;
  layer_group: string | null;
  layer_category: string | null;
  layer_label: string | null;
  overrides_snapshot?: VariableOverrides | null;
  design_snapshot?: { design: { psu: string | null; strata: string | null } | null } | null;
};

async function queryCrosstabList(
  tenantId: string,
  runId: string,
  documentId: string,
  includeSnapshot: boolean,
): Promise<CrosstabListRow[]> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<CrosstabListRow>(
      `select dt.id, dt.label, dt.crosstab_status,
              (select count(*) from findings f where f.source_table_id = dt.id) as findings,
              (dt.crosstab->>'version')::int as version,
              dt.crosstab->>'source' as source,
              dt.crosstab->>'layerGroup' as layer_group,
              dt.crosstab->>'layerCategory' as layer_category,
              dt.crosstab->>'layerLabel' as layer_label
              ${includeSnapshot ? ", dt.overrides_snapshot, dt.design_snapshot" : ""}
       from document_tables dt
       where dt.run_id = $1 and dt.document_id = $2 and dt.table_index >= $3 and dt.crosstab is not null
         and coalesce(dt.crosstab_status, 'committed') <> 'evidence'
       order by dt.table_index`,
      [runId, documentId, FIRST_CROSSTAB_INDEX],
    );
    return r.rows;
  });
}

/**
 * Codex re-review, package 4 (cross-tab handover repair): "demonstrate downstream staleness
 * after design changes" needs the SAME current-design resolution `listCrosstabs` below already
 * computes, available to other callers (the Findings table's own design-staleness check in
 * page.tsx is the first one) without a second, independently-maintained copy of this exact
 * three-step resolution - the "a parallel path still uses the old behaviour" pattern this
 * codebase has hit more than once. Returns the canonical JSON of the design that WOULD be
 * applied to a fresh build of this document right now: the document's persisted setting
 * (DataSetup.design), or, with none persisted, exactly what the name-pattern heuristic would
 * pick (effectiveDesignChoice, ./surveyDesign) - the same resolution every deferring caller (the
 * NPS tool, Objectives, the distribution chart) already goes through.
 */
export type CurrentDesignSnapshotStatus = { ok: true; snapshot: string } | { ok: false; error: string };

/** Brief 37 repair (ANA-NPS-003 / findings-freshness): previously called tolerant
 * loadDataSetup/loadVariableDictionary, so a permission or connection failure silently resolved
 * to the DEFAULTED design (or threw past this function's callers in an uncontrolled way) -
 * either way a genuine "couldn't check" was indistinguishable from "checked, and it matches."
 * Now uses the status-returning loaders and reports failure explicitly, so designFreshnessStatus
 * below can tell a confirmed match apart from an uncheckable one. */
export async function resolveCurrentDesignSnapshotStatus(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<CurrentDesignSnapshotStatus> {
  const [setupStatus, dictStatus] = await Promise.all([
    loadDataSetupWithStatus(tenantId, documentId),
    loadVariableDictionaryWithStatus(tenantId, runId, documentId),
  ]);
  if (!setupStatus.ok) return { ok: false, error: setupStatus.error };
  if (!dictStatus.ok) return { ok: false, error: dictStatus.error };
  const currentDesign = resolveSurveyDesign(dictStatus.dictionary, effectiveDesignChoice(setupStatus.setup.design, undefined)).design;
  return { ok: true, snapshot: canonicalJson(currentDesign) };
}

/**
 * Codex re-review, package 4; Brief 37 repair: the one place `listCrosstabs` and the Findings
 * table both decide a table's/finding's design freshness, so the two can't drift. Brief 37's
 * re-review: a legacy row with no `design_snapshot` recorded at all, and a failed
 * `currentDesignSnapshot` lookup, were both previously treated as "not stale" - a confirmed
 * false, indistinguishable from an actual match. Both are now "unknown": there is nothing (or
 * nothing reliable) to compare against, which is a different thing from having compared and
 * found agreement.
 */
export function designFreshnessStatus(
  designSnapshot: { design: { psu: string | null; strata: string | null } | null } | null | undefined,
  currentDesignSnapshot: CurrentDesignSnapshotStatus,
): DesignFreshness {
  if (designSnapshot === undefined || designSnapshot === null) return "unknown";
  if (!currentDesignSnapshot.ok) return "unknown";
  return canonicalJson(designSnapshot.design) === currentDesignSnapshot.snapshot ? "current" : "stale";
}

/** A table built from this file, with the exact request that built it (`crosstab.savedRequest`). */
export type RecentTableDefinition = { id: string; label: string; status: string; request: CrosstabRequest };

/**
 * The newest tables built from this data file, newest first, with their saved requests, so a
 * plain-English request can refer to one ("the table just produced", Grant 2026-10-22). Evidence
 * tables (built by Objectives) and tables saved before requests were kept are left out. A failed
 * read throws: the caller says the earlier tables could not be read rather than treating it as none.
 */
export async function loadRecentTableDefinitions(
  tenantId: string,
  runId: string,
  documentId: string,
  limit = 5,
): Promise<RecentTableDefinition[]> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ id: string; label: string | null; status: string | null; request: CrosstabRequest }>(
      `select id, label, crosstab_status as status, crosstab->'savedRequest' as request
       from document_tables
       where run_id = $1 and document_id = $2 and table_index >= $3 and crosstab is not null
         and (crosstab->>'version')::int = 2
         and coalesce(crosstab_status, 'committed') <> 'evidence'
         and crosstab ? 'savedRequest'
       order by table_index desc
       limit $4`,
      [runId, documentId, FIRST_CROSSTAB_INDEX, limit],
    );
    return r.rows.map((row) => ({ id: row.id, label: row.label ?? "Crosstab", status: row.status ?? "committed", request: row.request }));
  });
}

export async function listCrosstabs(tenantId: string, runId: string, documentId: string): Promise<CrosstabListItem[]> {
  // IMP-005: not `.catch(() => ({}))` - see loadVariableDictionary above. `currentOverrides`
  // feeds the `stale` flag below by comparison against each table's saved snapshot; silently
  // treating a retrieval failure as "no overrides currently saved" could mark a table that
  // genuinely has outstanding corrections as not stale, which is the direction that misleads
  // a researcher into trusting figures that were never recalculated against them.
  const currentOverrides = await loadVariableOverrides(tenantId, runId, documentId);
  const currentSnapshot = canonicalJson(currentOverrides);
  const currentDesignSnapshotStatus = await resolveCurrentDesignSnapshotStatus(tenantId, runId, documentId);

  let rows: CrosstabListRow[];
  try {
    rows = await queryCrosstabList(tenantId, runId, documentId, true);
  } catch (error) {
    // Each attempt is its own transaction (a fresh withTenant call, not a retry inside the one
    // that just failed) - a transaction Postgres has already aborted on error cannot run
    // another statement without first rolling back, so this never tries to recover within the
    // same one. Migration 0078 or 0091 not applied yet: list without the staleness column(s)
    // rather than failing the whole crosstab workspace over it.
    const message = error instanceof Error ? error.message : String(error);
    if (!/overrides_snapshot|design_snapshot/.test(message)) throw error;
    rows = await queryCrosstabList(tenantId, runId, documentId, false);
  }

  return rows.map((row) => ({
    id: row.id,
    label: row.label ?? "Crosstab",
    status: row.crosstab_status ?? "committed",
    findings: Number(row.findings),
    legacy: row.version !== 2,
    source: (["workspace", "ask", "window", "starter", "assistant"] as const).find((x) => x === row.source) ?? (String(row.label ?? "").startsWith("Starter:") ? "starter" : "workspace"),
    layerGroup: row.layer_group,
    layerCategory: row.layer_category,
    layerLabel: row.layer_label,
    stale:
      row.overrides_snapshot !== undefined && row.overrides_snapshot !== null
        ? canonicalJson(row.overrides_snapshot) !== currentSnapshot
        : false,
    designFreshness: designFreshnessStatus(row.design_snapshot, currentDesignSnapshotStatus),
  }));
}

/** Turns every draft table in the set into findings and marks the set committed. */
export async function commitCrosstabs(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<{ tables: number; findings: number }> {
  return withTenant(tenantId, async (client) => {
    const drafts = await client.query<{ id: string; crosstab: CrosstabResult }>(
      `select id, crosstab from document_tables
       where run_id = $1 and document_id = $2 and crosstab_status = 'draft' and crosstab is not null
       order by table_index`,
      [runId, documentId],
    );
    let findings = 0;
    for (const draft of drafts.rows) {
      for (const f of crosstabFindings(draft.crosstab)) {
        await client.query(
          `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_table_id, data_type, status)
           values ($1, $2, 'generated', $3, $4, 'segment_difference', $5, $6, 'quantitative', 'accepted')`,
          [tenantId, runId, f.text, f.theme, JSON.stringify(f.stats), draft.id],
        );
        findings++;
      }
      // Wide funnel: every committed table also gives direct readings (shares, top-two box, NPS,
      // averages) and "no difference" results, whether or not anything in it is significant.
      // Nothing is dropped here for lack of significance; the insight step grades them.
      const wide = [...levelFindings(draft.crosstab), ...noDifferenceFindings(draft.crosstab)];
      for (const f of wide) {
        await client.query(
          `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_table_id, data_type, status)
           values ($1, $2, 'generated', $3, $4, $5, $6, $7, 'quantitative', 'accepted')`,
          [tenantId, runId, f.text, f.theme, f.patternType, JSON.stringify(f.stats), draft.id],
        );
        findings++;
      }
      await client.query("update document_tables set crosstab_status = 'committed' where id = $1", [draft.id]);
    }
    return { tables: drafts.rows.length, findings };
  });
}

/**
 * Tables committed before wide findings existed have only their significant cells as findings.
 * Adds the direct readings and no-difference results to any committed table that has none yet.
 * Safe to repeat: a table that already has either kind is left alone.
 */
export async function addWideFindingsToCommitted(tenantId: string, runId: string): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const tables = await client.query<{ id: string; crosstab: CrosstabResult }>(
      `select dt.id, dt.crosstab from document_tables dt
        where dt.run_id = $1 and dt.crosstab is not null and (dt.crosstab->>'version')::int = 2
          and coalesce(dt.crosstab_status, 'committed') = 'committed'
          and not exists (select 1 from findings f where f.source_table_id = dt.id and f.pattern_type in ('level', 'no_difference'))`,
      [runId],
    );
    let added = 0;
    for (const t of tables.rows) {
      for (const f of [...levelFindings(t.crosstab), ...noDifferenceFindings(t.crosstab)]) {
        await client.query(
          `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_table_id, data_type, status)
           values ($1, $2, 'generated', $3, $4, $5, $6, $7, 'quantitative', 'accepted')`,
          [tenantId, runId, f.text, f.theme, f.patternType, JSON.stringify(f.stats), t.id],
        );
        added++;
      }
    }
    return added;
  });
}

/** Removes every draft table of a data file. Drafts have no findings, so nothing else is affected. */
export async function deleteDraftCrosstabs(tenantId: string, runId: string, documentId: string): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query(
      "delete from document_tables where run_id = $1 and document_id = $2 and crosstab is not null and crosstab_status = 'draft'",
      [runId, documentId],
    );
    return r.rowCount ?? 0;
  });
}

/** Removes a crosstab (draft or committed) and any findings built from it. */
export async function deleteCrosstab(tenantId: string, runId: string, tableId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    // Codex CT500-F01: the table is found and locked by its own id AND this project's before any of
    // its findings are archived. The archive below selects findings by table id only, so a table of
    // another project of the same organisation used to lose its findings while the delete (scoped by
    // run) matched nothing and the action reported success. A missing or mismatched table now stops
    // here with nothing changed; archive and delete stay in one transaction.
    const owned = await client.query(
      "select id from document_tables where id = $1 and run_id = $2 and tenant_id = $3 and crosstab is not null for update",
      [tableId, runId, tenantId],
    );
    if (owned.rowCount !== 1) throw new Error("That table is not in this project (it may have been deleted already), so nothing was deleted.");
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: tableId,
      onlyRejected: false,
      archiveReason: "manual_reextract",
    });
    const deleted = await client.query("delete from document_tables where id = $1 and run_id = $2 and crosstab is not null", [tableId, runId]);
    // Held by the lock above, so this always deletes the one row; checked so the archive above can
    // never commit without its table being deleted with it.
    if (deleted.rowCount !== 1) throw new Error("The table could not be deleted, so nothing was changed. Try again.");
  });
}

/** The saved result of one crosstab, for the workspace viewer. */
export async function loadCrosstab(
  tenantId: string,
  runId: string,
  tableId: string,
): Promise<{ label: string; result: CrosstabResult | null }> {
  const row = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ label: string | null; crosstab: (CrosstabResult & { version?: number }) | null }>(
      "select label, crosstab from document_tables where id = $1 and run_id = $2",
      [tableId, runId],
    );
    return r.rows[0];
  });
  if (!row?.crosstab) throw new Error("This crosstab has no saved result.");
  return { label: row.label ?? "Crosstab", result: row.crosstab.version === 2 ? row.crosstab : null };
}
