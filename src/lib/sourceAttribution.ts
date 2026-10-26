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
      `src_dt.label as source_table_label`,
  };
}

export type FindingSource = {
  source_filename: string | null;
  source_page: number | null;
  source_table_label?: string | null;
};

/** "survey.xlsx, Table 3" / "report.pdf, p. 4" / null when no source file is recorded. */
export function formatFindingSource(s: FindingSource): string | null {
  if (!s.source_filename) return null;
  const parts = [s.source_filename];
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
