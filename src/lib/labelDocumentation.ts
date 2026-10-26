// The "Labels and documentation" tab of a raw data file (Grant, 26 October 2026, import plan step 2):
// the file's own labels, its codebook and its questionnaire side by side, which of them each applied
// label comes from (LBL-01, resolveLabels in labelOverlay.ts), where a codebook and a questionnaire
// disagree, and how much of the file is documented. Read on demand; nothing is stored or changed here.
//
// "Documented" means the variable has a label of its own in the file or a confirmed link to a
// codebook entry or questionnaire question. Suggested links do not count: they are not applied.
import { withTenantRead } from "./db";
import { loadFileOwnVariableDictionary } from "./crosstabs";
import { getConfirmedItemsForData } from "./instruments";
import { resolveLabels, labelSourceRank, type LabelSource } from "./labelOverlay";

export type LabelOrigin = "data_file" | "codebook" | "questionnaire" | "other";

export type DocumentedVariable = {
  name: string;
  /** The file's own variable label; null when it has none or the label only repeats the name. */
  fileLabel: string | null;
  fileHasAnswerLabels: boolean;
  codebook: { code: string | null; text: string; answers: number } | null;
  questionnaire: { code: string | null; text: string; answers: number } | null;
  /** Where the label and the answer labels in tables come from; null when there are none. */
  labelFrom: LabelOrigin | null;
  answerLabelsFrom: LabelOrigin | null;
  conflict: boolean;
};

export type LabelDocumentation = {
  documents: { id: string; filename: string; type: string | null; entries: number; confirmed: number }[];
  variables: DocumentedVariable[];
  coverage: { variables: number; documented: number; byCodebook: number; byQuestionnaire: number; undocumented: number };
  conflicts: { variable: string; applied: { filename: string; labels: Record<string, string> }; other: { filename: string; labels: Record<string, string> } }[];
  /** Codebook entries with no confirmed variable in this file: a suggestion waiting, or no match found. */
  entriesWithoutColumn: { documentId: string; code: string | null; text: string; state: "suggested" | "no_match" }[];
  entriesWithoutColumnTotal: number;
};

export const MAX_ENTRIES_LISTED = 200;

const originOf = (s: LabelSource | null | undefined): LabelOrigin =>
  s?.instrumentType === "codebook" ? "codebook" : s?.instrumentType === "questionnaire" ? "questionnaire" : "other";

export async function loadLabelDocumentation(tenantId: string, runId: string, dataDocumentId: string): Promise<LabelDocumentation> {
  const own = await withTenantRead(tenantId, (client) =>
    client.query("select 1 from documents where id = $1 and run_id = $2 and kind = 'table' and ingestion_type = 'raw'", [dataDocumentId, runId]),
  );
  if (own.rowCount !== 1) throw new Error("That data file is not in this project.");
  // Each read refuses on failure (a failed confirmed-link read is InstrumentMeaningUnavailableError):
  // an unreadable source is never shown as "not documented".
  const [dictionary, items, linked] = await Promise.all([
    loadFileOwnVariableDictionary(tenantId, runId, dataDocumentId),
    getConfirmedItemsForData(tenantId, runId, dataDocumentId),
    withTenantRead(tenantId, async (client) => {
      const docs = await client.query<{ id: string; source_filename: string; instrument_type: string | null; entries: string; confirmed: string }>(
        `select d.id, d.source_filename, d.instrument_type,
                (select count(*) from instrument_items i where i.document_id = d.id) as entries,
                (select count(distinct l.variable) from instrument_links l join instrument_items i on i.id = l.item_id
                  where i.document_id = d.id and l.data_document_id = $2 and l.status = 'confirmed') as confirmed
         from documents d
         where d.run_id = $1 and d.kind = 'instrument' and d.instrument_type in ('codebook', 'questionnaire')
           and (d.instrument_for = $2 or exists (select 1 from instrument_links l join instrument_items i on i.id = l.item_id
                                                  where i.document_id = d.id and l.data_document_id = $2))
         order by d.uploaded_at, d.id`,
        [runId, dataDocumentId],
      );
      const codebookIds = docs.rows.filter((d) => d.instrument_type === "codebook").map((d) => d.id);
      const unlinked = await client.query<{ document_id: string; code: string | null; item_text: string; suggested: boolean }>(
        `select i.document_id, i.code, i.item_text,
                exists (select 1 from instrument_links l where l.item_id = i.id and l.data_document_id = $2 and l.status = 'suggested') as suggested
         from instrument_items i
         where i.document_id = any($1::uuid[])
           and not exists (select 1 from instrument_links l where l.item_id = i.id and l.data_document_id = $2 and l.status = 'confirmed')
         order by i.document_id, i.item_order`,
        [codebookIds, dataDocumentId],
      );
      return { docs: docs.rows, unlinked: unlinked.rows };
    }),
  ]);

  const confirmed = items.filter((i) => i.confirmed);
  const { overlay, sources } = resolveLabels(
    confirmed.map((i) => ({ itemId: i.itemId, variable: i.variable, code: i.code, text: i.text, options: i.options, source: { documentId: i.documentId, instrumentType: i.instrumentType } })),
  );
  const filename = new Map(linked.docs.map((d) => [d.id, d.source_filename]));
  // The first confirmed entry per variable and type, in LBL-01 order (getConfirmedItemsForData sorts).
  const entryOf = (variable: string, type: "codebook" | "questionnaire") => {
    const it = confirmed.find((i) => i.variable === variable && i.instrumentType === type);
    return it ? { code: it.code, text: it.text, answers: it.options.filter((o) => o.code !== "" && o.label).length } : null;
  };
  const conflicted = new Set((overlay.conflicts ?? []).map((c) => c.variable));

  const variables = dictionary.variables.map((v): DocumentedVariable => {
    const own = v.label && v.label.trim() !== "" && v.label !== v.name ? v.label : null;
    const src = sources[v.name];
    return {
      name: v.name,
      fileLabel: own,
      fileHasAnswerLabels: v.labelled,
      codebook: entryOf(v.name, "codebook"),
      questionnaire: entryOf(v.name, "questionnaire"),
      // The engine's rule (_apply_overlay, enrichDictionary): the file's own label is never replaced.
      labelFrom: own ? "data_file" : src?.variableLabel !== undefined ? originOf(src.variableLabel) : null,
      answerLabelsFrom: v.labelled ? "data_file" : src?.valueLabels !== undefined ? originOf(src.valueLabels) : null,
      conflict: conflicted.has(v.name),
    };
  });
  const documented = variables.filter((v) => v.fileLabel || v.codebook || v.questionnaire).length;
  const sortedDocs = [...linked.docs].sort((a, b) => labelSourceRank(a.instrument_type) - labelSourceRank(b.instrument_type));
  return {
    documents: sortedDocs.map((d) => ({ id: d.id, filename: d.source_filename, type: d.instrument_type, entries: Number(d.entries), confirmed: Number(d.confirmed) })),
    variables,
    coverage: {
      variables: variables.length,
      documented,
      byCodebook: variables.filter((v) => v.codebook).length,
      byQuestionnaire: variables.filter((v) => v.questionnaire).length,
      undocumented: variables.length - documented,
    },
    conflicts: (overlay.conflicts ?? []).map((c) => ({
      variable: c.variable,
      applied: { filename: filename.get(c.applied.documentId) ?? "A linked document", labels: c.applied.labels },
      other: { filename: filename.get(c.other.documentId) ?? "A linked document", labels: c.other.labels },
    })),
    entriesWithoutColumn: linked.unlinked.slice(0, MAX_ENTRIES_LISTED).map((u) => ({ documentId: u.document_id, code: u.code, text: u.item_text, state: u.suggested ? "suggested" : "no_match" })),
    entriesWithoutColumnTotal: linked.unlinked.length,
  };
}
