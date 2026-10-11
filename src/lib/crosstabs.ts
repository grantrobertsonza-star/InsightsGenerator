import { levelFindings, noDifferenceFindings } from "./descriptiveFindings";
import { withTenant } from "./db";
import { enrichDictionary } from "./labelOverlay";
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

const MAX_FINDINGS_PER_QUESTION = 3;
const MAX_FINDINGS_PER_TABLE = 40;
const FIRST_CROSSTAB_INDEX = 100;

export type CrosstabListItem = {
  id: string;
  label: string;
  status: "draft" | "committed";
  findings: number;
  legacy: boolean;
  source: "workspace" | "ask" | "window" | "starter";
};

type DocumentFile = { storage_path: string; source_filename: string };

export async function loadDocumentFile(tenantId: string, runId: string, documentId: string): Promise<DocumentFile> {
  const doc = await withTenant(tenantId, async (client) => {
    const r = await client.query<DocumentFile>(
      "select storage_path, source_filename from documents where id = $1 and run_id = $2",
      [documentId, runId],
    );
    return r.rows[0];
  });
  if (!doc) throw new Error("Document not found for this run");
  return doc;
}

/** Confirmed questionnaire wording for a data file. Loaded lazily: instruments.ts imports this module. */
export async function overlayFor(tenantId: string, runId: string, documentId: string) {
  try {
    const { getLabelOverlay } = await import("./instruments");
    return await getLabelOverlay(tenantId, runId, documentId);
  } catch {
    return null; // instrument tables not migrated yet: the file's own labels stand
  }
}

/** The variable list for a data file, read once and kept on the document. */
export async function loadVariableDictionary(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<VariableDictionary> {
  try {
    const cached = await withTenant(tenantId, async (client) => {
      const r = await client.query<{ variable_dictionary: VariableDictionary | null }>(
        "select variable_dictionary from documents where id = $1 and run_id = $2",
        [documentId, runId],
      );
      return r.rows[0]?.variable_dictionary ?? null;
    });
    // Older copies lack sets, text flags or the label-based families and word-named flags (version 4), and the weights and missing-code audit (version 5).
    if (cached && cached.sets && (cached.version ?? 0) >= 5) {
      const overlay = await overlayFor(tenantId, runId, documentId);
      return overlay ? enrichDictionary(cached, overlay) : cached;
    }
  } catch {
    // column missing until migration 0058 is applied; fall through and compute
  }
  const doc = await loadDocumentFile(tenantId, runId, documentId);
  const dictionary = await runStatsTool<VariableDictionary>("dictionary", doc.storage_path, doc.source_filename);
  try {
    await withTenant(tenantId, async (client) => {
      await client.query("update documents set variable_dictionary = $1 where id = $2", [
        JSON.stringify(dictionary),
        documentId,
      ]);
    });
  } catch {
    // caching is best effort
  }
  const overlay = await overlayFor(tenantId, runId, documentId);
  return overlay ? enrichDictionary(dictionary, overlay) : dictionary;
}

export async function loadCategories(
  tenantId: string,
  runId: string,
  documentId: string,
  variable: string,
): Promise<CategoryList> {
  const doc = await loadDocumentFile(tenantId, runId, documentId);
  const overlay = await overlayFor(tenantId, runId, documentId);
  return runStatsTool<CategoryList>("categories", doc.storage_path, doc.source_filename, { variable, overlay });
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
          text: `${subject}, ${weighted}, based on ${base.n} cases (effective base ${Math.round(base.nEff)}); z-test${result.notes?.designUsed ? " with Taylor series variance" : ""} of this group against all other cases in the same banner variable (not against the overall figure), ${row.pAdj?.[k] != null || qv !== null ? "unadjusted " : ""}p=${fmtP(row.p[k])}${row.pAdj?.[k] != null ? `, adjusted p=${fmtP(row.pAdj[k])} (corrected across the banner columns of this row)` : ""}${qv !== null ? `, false discovery rate q=${fmtP(qv)} (across every cell tested in this table; inclusion was decided on q, not on p)` : ""}.`,
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
              ...(result.notes?.designUsed ? ["survey_design_modelled"] : ["survey_design_not_modelled", "sampling_assumed_random"]),
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
  options: { status?: "draft" | "evidence" } = {},
): Promise<{ tableId: string; questions: number; skipped: { variable: string; reason: string }[] }> {
  // No column variable is allowed: the table then describes all respondents (frequencies, means, spread).
  if (request.rowItems.length === 0) throw new Error("Choose at least one row variable.");
  const doc = await loadDocumentFile(tenantId, runId, documentId);
  const overlay = await overlayFor(tenantId, runId, documentId);
  const result = await runStatsTool<CrosstabResult>("crosstab", doc.storage_path, doc.source_filename, { ...request, correction: request.correction ?? "fdr", overlay });
  if (result.questions.length === 0) {
    throw new Error(
      "None of the chosen rows could be tabulated. " + result.skipped.map((s) => `${s.variable}: ${s.reason}`).join(" "),
    );
  }

  const colNames = result.columns.map((c) => `${c.blockLabel}: ${c.name}`);
  const headers = ["Question", "Answer", ...colNames, "Total"];
  const rows = result.questions.flatMap((q) =>
    q.rows.filter((r) => !r.isEffBase && (!r.isBase || q.kind === "multi")).map((r) => {
      const row: Record<string, string | number | null> = { Question: q.label, Answer: r.label };
      colNames.forEach((c, k) => {
        row[c] = r.isBase ? (r.count[k] ?? null) : (r.pct[k] ?? null);
      });
      row.Total = r.isBase ? (r.total.count ?? null) : (r.total.pct ?? null);
      return row;
    }),
  );
  const rowNames = request.rowItems.map((i) => (i.kind === "nets" && i.nets?.length ? i.nets.map((n) => `NET: ${n.label}`).join(", ") : i.label));
  const rowText = rowNames.length > 2 ? `${rowNames.slice(0, 2).join(", ")} +${rowNames.length - 2}` : rowNames.join(", ");
  const bannerText = result.blocks.map((b) => b.label).join(" + ");
  const filterText = result.filters && result.filters.length ? `, ${result.filters.map((f) => f.text).join(" and ")}` : "";
  const label = result.overall
    ? `${request.starter ? "Starter: " : ""}${rowText}, all respondents${filterText} (${result.weightVar ? "weighted" : "unweighted"})`
    : `${request.starter ? "Starter: " : ""}${rowText} by ${bannerText}${filterText} (${result.weightVar ? "weighted" : "unweighted"})`;

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
  };
  const source = request.starter ? "starter" : (request.source ?? "workspace");
  const stored = { ...result, provenance, source, ...(request.starter ? { starter: true } : {}) };

  const tableId = await withTenant(tenantId, async (client) => {
    const next = await client.query<{ next: number }>(
      "select coalesce(max(table_index) + 1, $2)::int as next from document_tables where document_id = $1 and table_index >= $2",
      [documentId, FIRST_CROSSTAB_INDEX],
    );
    const inserted = await client.query<{ id: string }>(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type, crosstab, crosstab_status)
       values ($1, $2, $3, $4, $5, $6, $7, 'aggregated', $8, $9) returning id`,
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
      ],
    );
    return inserted.rows[0].id;
  });
  return { tableId, questions: result.questions.length, skipped: result.skipped };
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

export async function listCrosstabs(tenantId: string, runId: string, documentId: string): Promise<CrosstabListItem[]> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{
      id: string;
      label: string | null;
      crosstab_status: "draft" | "committed" | null;
      findings: string;
      version: number | null;
      source: string | null;
    }>(
      `select dt.id, dt.label, dt.crosstab_status,
              (select count(*) from findings f where f.source_table_id = dt.id) as findings,
              (dt.crosstab->>'version')::int as version,
              dt.crosstab->>'source' as source
       from document_tables dt
       where dt.run_id = $1 and dt.document_id = $2 and dt.table_index >= $3 and dt.crosstab is not null
         and coalesce(dt.crosstab_status, 'committed') <> 'evidence'
       order by dt.table_index`,
      [runId, documentId, FIRST_CROSSTAB_INDEX],
    );
    return r.rows.map((row) => ({
      id: row.id,
      label: row.label ?? "Crosstab",
      status: row.crosstab_status ?? "committed",
      findings: Number(row.findings),
      legacy: row.version !== 2,
      source: (["workspace", "ask", "window", "starter"] as const).find((x) => x === row.source) ?? (String(row.label ?? "").startsWith("Starter:") ? "starter" : "workspace"),
    }));
  });
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
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: tableId,
      onlyRejected: false,
      archiveReason: "manual_reextract",
    });
    await client.query("delete from document_tables where id = $1 and run_id = $2 and crosstab is not null", [tableId, runId]);
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
