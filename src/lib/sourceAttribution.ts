import type { PoolClient } from "pg";

// Golden-thread repair (export attribution): one definition of "where did this claim come from",
// shared by every export that presents findings or insights, so a slide carries the same source
// reference the app and the spreadsheet show.
//
// A finding names its source in one of two ways: source_document_id (a report or transcript it was
// read from) or source_table_id, which points at document_tables (a table computed from a data
// file), whose document_id is the data file. The findings spreadsheet used to join documents on
// source_table_id directly, which never matches, so every computed finding exported a blank Source.
// An unrecorded source is said in words ("Source not recorded"), never left blank.

/** SQL join and columns for a findings alias, resolving the source file through either link. */
export function findingSourceSql(alias: string): { join: string; columns: string } {
  return {
    join:
      `left join document_tables src_dt on src_dt.id = ${alias}.source_table_id ` +
      `left join documents src_doc on src_doc.id = coalesce(${alias}.source_document_id, src_dt.document_id)`,
    columns:
      `src_doc.source_filename as source_filename, ${alias}.source_page as source_page, ` +
      `src_dt.label as source_table_label, nullif(btrim(src_doc.data_setup->>'wave'), '') as source_wave`,
  };
}

export type FindingSource = {
  source_filename: string | null;
  source_page: number | null;
  source_table_label?: string | null;
  /** The data file's wave label, when it is a wave of a tracking study (data set-up). */
  source_wave?: string | null;
};

/** "survey.xlsx, Table 3" / "wave2.sav (Wave 2), Table 3" / "report.pdf, p. 4" / null when no source file is recorded. */
export function formatFindingSource(s: FindingSource): string | null {
  if (!s.source_filename) return null;
  const parts = [s.source_wave ? `${s.source_filename} (${s.source_wave})` : s.source_filename];
  if (s.source_table_label && s.source_table_label.trim()) parts.push(s.source_table_label.trim());
  if (s.source_page !== null && s.source_page !== undefined) parts.push(`p. ${s.source_page}`);
  return parts.join(", ");
}

export const SOURCE_NOT_RECORDED = "Source not recorded";

/** One line for a slide: "Source: a" / "Sources: a; b; c; and 2 more" / "Source not recorded". */
export function sourceLine(sources: (string | null)[], max = 3): string {
  const distinct = Array.from(new Set(sources.filter((s): s is string => !!s)));
  if (distinct.length === 0) return SOURCE_NOT_RECORDED;
  const shown = distinct.slice(0, max);
  const more = distinct.length - shown.length;
  return `${distinct.length === 1 ? "Source" : "Sources"}: ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

/** Source references of each synthesized insight, through its linked pre-insights' findings. */
export async function loadSynthesizedInsightSources(
  client: Pick<PoolClient, "query">,
  synthesizedInsightIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (synthesizedInsightIds.length === 0) return out;
  const src = findingSourceSql("f");
  const result = await client.query<FindingSource & { synthesized_insight_id: string }>(
    `select s.synthesized_insight_id, ${src.columns}
     from synthesized_insight_sources s
     join insights pi on pi.id = s.pre_insight_id
     join findings f on f.id = pi.finding_id
     ${src.join}
     where s.synthesized_insight_id = any($1::uuid[])
     order by s.synthesized_insight_id, src_doc.source_filename nulls last, f.source_page nulls last`,
    [synthesizedInsightIds],
  );
  for (const row of result.rows) {
    const list = out.get(row.synthesized_insight_id) ?? [];
    const formatted = formatFindingSource(row);
    if (formatted && !list.includes(formatted)) list.push(formatted);
    out.set(row.synthesized_insight_id, list);
  }
  return out;
}

// EF-FND-F04 (batch 62): the exact place in its source a finding rests on, for exports that must let
// a reader find it again. Two tables from one file, two files with the same name, and two Cross tabs
// of one file that differ only by a filter all used to export the same "Source" text. The locator
// adds the stable ids (file, table), the table's number and label, the sheet, page and quote, the
// rows and variables the figure was computed from, and the table's filters, read through the same
// join as findingSourceSql. A field that applies to the finding but was never recorded says so
// ("Not recorded"); one that does not apply to its kind of source says "Not applicable".
export const LOCATOR_NOT_RECORDED = "Not recorded";
export const LOCATOR_NOT_APPLICABLE = "Not applicable";

/** Extra columns for the locator; use with findingSourceSql(alias).join. */
export function findingLocatorColumns(alias: string): string {
  return [
    `${alias}.source_document_id as locator_finding_document_id`,
    `${alias}.source_table_id as locator_table_id`,
    `src_doc.id as locator_document_id`,
    `src_doc.removed_at as locator_document_removed_at`,
    `coalesce(src_dt.crosstab->>'selectedSheet', src_doc.selected_sheet) as locator_sheet`,
    `src_dt.id is not null as locator_table_exists`,
    `src_dt.table_index as locator_table_index`,
    `src_dt.source_page as locator_table_page`,
    `src_dt.crosstab_status as locator_crosstab_status`,
    `src_dt.crosstab->'filters' as locator_filters`,
    `src_dt.crosstab->>'layerLabel' as locator_layer_label`,
    `src_dt.crosstab->>'layerCategory' as locator_layer_category`,
    `src_dt.crosstab->>'weightVar' as locator_weight`,
    `${alias}.source_quote as locator_quote`,
    `${alias}.source_cells as locator_cells`,
    `${alias}.stated_stats as locator_stats`,
  ].join(", ");
}

export type FindingLocatorRow = FindingSource & {
  locator_finding_document_id: string | null;
  locator_table_id: string | null;
  locator_document_id: string | null;
  locator_document_removed_at: string | Date | null;
  locator_sheet: string | null;
  locator_table_exists: boolean;
  locator_table_index: number | null;
  locator_table_page: number | null;
  locator_crosstab_status: string | null;
  locator_filters: unknown;
  locator_layer_label: string | null;
  locator_layer_category: string | null;
  locator_weight: string | null;
  locator_quote: string | null;
  locator_cells: unknown;
  locator_stats: Record<string, unknown> | null;
};

export type FindingLocator = {
  sourceState: string;
  file: string;
  fileId: string;
  table: string;
  tableId: string;
  sheet: string;
  page: string;
  quote: string;
  rows: string;
  variables: string;
  filters: string;
  weight: string;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The structured locator of one finding row read with findingLocatorColumns. */
export function describeFindingLocator(r: FindingLocatorRow): FindingLocator {
  const fromTable = r.locator_table_id !== null;
  const fromDocument = !fromTable && r.locator_finding_document_id !== null;
  const recorded = fromTable || fromDocument;
  const sourceState = !recorded
    ? "Source not recorded"
    : fromTable && !r.locator_table_exists
      ? "Source table no longer exists"
      : r.locator_document_id === null
        ? "Source file no longer exists"
        : r.locator_document_removed_at !== null
          ? "Source file removed from the project"
          : "Current";
  const s = r.locator_stats ?? {};
  const cells = r.locator_cells && typeof r.locator_cells === "object" ? (r.locator_cells as { rowIndices?: unknown }).rowIndices : null;
  const rowList = Array.isArray(cells) ? cells.filter((x): x is number => typeof x === "number") : [];
  const rows = !fromTable
    ? LOCATOR_NOT_APPLICABLE
    : rowList.length > 0
      ? `${rowList.length} row${rowList.length === 1 ? "" : "s"}: ${rowList.slice(0, 20).map((i) => i + 1).join(", ")}${rowList.length > 20 ? ", ..." : ""}`
      : "All rows of the table (no row selection recorded)";
  const variableParts = [
    text(s.variable1) && text(s.variable2) ? `${text(s.variable1)} with ${text(s.variable2)}` : null,
    text(s.bannerColumn) || text(s.stubColumn) ? `${text(s.stubColumn) ?? "?"} by ${text(s.bannerColumn) ?? "?"}` : null,
    text(s.question) ? `Question: ${text(s.question)}${text(s.answer) ? `, answer: ${text(s.answer)}` : ""}` : null,
    text(s.bannerVariable) || text(s.column) ? `Column: ${[text(s.bannerVariable), text(s.column)].filter(Boolean).join(" = ")}` : null,
    text(s.group1Label) && text(s.group2Label) ? `Groups: ${text(s.group1Label)} vs ${text(s.group2Label)}` : null,
  ].filter((x): x is string => !!x);
  const filterTexts = Array.isArray(r.locator_filters)
    ? r.locator_filters.map((f) => (f && typeof f === "object" ? text((f as { text?: unknown }).text) : null)).filter((x): x is string => !!x)
    : [];
  const layer = text(r.locator_layer_label) ?? text(r.locator_layer_category);
  const isCrosstab = r.locator_crosstab_status !== null;
  const filters = !fromTable
    ? LOCATOR_NOT_APPLICABLE
    : !isCrosstab
      ? LOCATOR_NOT_APPLICABLE
      : [...filterTexts, ...(layer ? [`layer: ${layer}`] : [])].join("; ") || "No filter (all cases)";
  const tableLabel = text(r.source_table_label);
  return {
    sourceState,
    file: r.source_filename ?? LOCATOR_NOT_RECORDED,
    fileId: r.locator_document_id ?? r.locator_finding_document_id ?? LOCATOR_NOT_RECORDED,
    table: !fromTable
      ? LOCATOR_NOT_APPLICABLE
      : !r.locator_table_exists
        ? LOCATOR_NOT_RECORDED
        : isCrosstab
          ? `Cross tab${tableLabel ? `: ${tableLabel}` : ""}`
          : `Table ${(r.locator_table_index ?? 0) + 1}${tableLabel ? `: ${tableLabel}` : ""}`,
    tableId: fromTable ? (r.locator_table_id as string) : LOCATOR_NOT_APPLICABLE,
    sheet: text(r.locator_sheet) ?? (fromTable ? LOCATOR_NOT_RECORDED : LOCATOR_NOT_APPLICABLE),
    page: r.source_page !== null && r.source_page !== undefined
      ? String(r.source_page)
      : r.locator_table_page !== null && r.locator_table_page !== undefined
        ? String(r.locator_table_page)
        : fromDocument ? LOCATOR_NOT_RECORDED : LOCATOR_NOT_APPLICABLE,
    quote: text(r.locator_quote) ?? (fromDocument ? LOCATOR_NOT_RECORDED : LOCATOR_NOT_APPLICABLE),
    rows,
    variables: variableParts.length > 0 ? variableParts.join("; ") : fromTable ? LOCATOR_NOT_RECORDED : LOCATOR_NOT_APPLICABLE,
    filters,
    weight: !isCrosstab ? (text(s.weightVar) ?? LOCATOR_NOT_APPLICABLE) : (text(r.locator_weight) ?? "Unweighted"),
  };
}
