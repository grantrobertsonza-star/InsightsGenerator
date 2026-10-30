// Counts behind the GT-010 delete confirmation (documentDeletionMessage.ts), per document, for one
// run: the findings removing the file (documentBin.removeDocumentToBin) archives, which are those with
// source_document_id = the document or source_table_id on one of its tables (plus legacy driver
// findings reached through their saved analysis, driverFindingSource.ts), and the researcher
// work and insights that go with them. One read. A failed read is reported as unavailable, so every
// confirmation falls back to the general wording rather than claiming zero; when the read worked,
// a document absent from the map has no findings.
import { withTenantRead } from "./db";
import type { DocumentDeletionImpact } from "./documentDeletionMessage";
import { driverAnalysesPresent, legacyDriverFindingOf } from "./driverFindingSource";
import {
  candidateSourceColumnAvailable,
  DECISION_REMOVED_WITH_FILE,
  KEPT_AND_MARKED,
  OBJECTIVE_REMOVED_WITH_FILE,
} from "./candidateSourceDocuments";

export type DeletionImpactResult = { available: boolean; byDocument: Map<string, DocumentDeletionImpact> };

const NONE: DocumentDeletionImpact = { findings: 0, reviewed: 0, notes: 0, insights: 0 };

/** The impact for one document: counts when the read worked (zeros when it has no findings), else null. */
export function impactFor(result: DeletionImpactResult, documentId: string): DocumentDeletionImpact | null {
  return result.available ? result.byDocument.get(documentId) ?? NONE : null;
}

export async function loadDocumentDeletionImpact(tenantId: string, runId: string): Promise<DeletionImpactResult> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      // GT1000-F01: the legacy driver findings deleteDocument also removes.
      const legacyDrivers = (await driverAnalysesPresent(client)) ? ` or ${legacyDriverFindingOf("f", "d.id")}` : "";
      const r = await client.query<{ document_id: string; findings: number; reviewed: number; notes: number; insights: number }>(
        `with doc_findings as (
           select d.id as document_id, f.id as finding_id, f.human_reviewed_at, f.researcher_note
             from documents d
             join findings f on f.run_id = d.run_id
                and (f.source_document_id = d.id
                     or f.source_table_id in (select dt.id from document_tables dt where dt.document_id = d.id)${legacyDrivers})
            where d.run_id = $1
         )
         select df.document_id,
                count(distinct df.finding_id)::int as findings,
                count(distinct df.finding_id) filter (where df.human_reviewed_at is not null)::int as reviewed,
                count(distinct df.finding_id) filter (where nullif(btrim(coalesce(df.researcher_note, '')), '') is not null)::int as notes,
                (count(distinct i.id) + count(distinct s.synthesized_insight_id))::int as insights
           from doc_findings df
           left join insights i on i.finding_id = df.finding_id
           left join synthesized_insight_sources s on s.pre_insight_id = i.id
          group by df.document_id`,
        [runId],
      );
      const byDocument = new Map<string, DocumentDeletionImpact>(
        r.rows.map((row) => [row.document_id, { findings: row.findings, reviewed: row.reviewed, notes: row.notes, insights: row.insights }]),
      );
      // The objectives and decisions side of a removal, by the rules documentBin applies
      // (candidateSourceDocuments.ts). Before migration 0115 no suggestion records its file, so none is
      // removed or marked and these counts are left out.
      for (const [table, removed] of [
        ["objective_candidates", OBJECTIVE_REMOVED_WITH_FILE],
        ["decision_candidates", DECISION_REMOVED_WITH_FILE],
      ] as const) {
        if (!(await candidateSourceColumnAvailable(client, table))) continue;
        const o = await client.query<{ document_id: string; suggestions: number; kept: number }>(
          `select d.id as document_id,
                  count(*) filter (where ${removed("c", "d.id")})::int as suggestions,
                  count(*) filter (where ${KEPT_AND_MARKED("c", "d.id", removed)})::int as kept
             from documents d join ${table} c on c.run_id = d.run_id and d.id = any(c.source_document_ids)
            where d.run_id = $1
            group by d.id`,
          [runId],
        );
        for (const row of o.rows) {
          const was = byDocument.get(row.document_id) ?? NONE;
          byDocument.set(row.document_id, {
            ...was,
            suggestions: (was.suggestions ?? 0) + row.suggestions,
            objectives: (was.objectives ?? 0) + row.kept,
          });
        }
      }
      return { available: true, byDocument };
    });
  } catch (error) {
    // Observable fallback: the server log says why the confirmation used general wording.
    console.error("documentDeletionImpact: counts unavailable", error instanceof Error ? error.message : String(error));
    return { available: false, byDocument: new Map() };
  }
}
