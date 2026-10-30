// The brief or proposal passage behind an objective or the business problem (CE-4, evidence chain,
// 26 October 2026; migration 0122). Written when an objective is filled from a document
// (runContextActions.ts), with whether the passage was found in that document's text; read for the
// objective's detail and the evidence trail. A passage that was not found is shown as such, never as a
// quote from the document.
import type { PoolClient } from "pg";
import type { BriefPassage } from "./briefIntake";

export async function briefPassagesAvailable(client: Pick<PoolClient, "query">): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>("select to_regclass('public.brief_passages') is not null as ok");
  return r.rows[0]?.ok === true;
}

/** Stores one passage in the caller's transaction; a no-op before migration 0122. */
export async function storeBriefPassage(
  client: PoolClient,
  tenantId: string,
  runId: string,
  p: {
    field: "objective" | "business_problem";
    candidateId: string | null;
    passage: BriefPassage;
    brief: { id: string } | null;
    proposal: { id: string } | null;
  },
): Promise<void> {
  if (!(await briefPassagesAvailable(client))) return;
  const documentId = p.passage.document === "brief" ? (p.brief?.id ?? null) : (p.proposal?.id ?? null);
  await client.query(
    `insert into brief_passages (tenant_id, run_id, field, objective_candidate_id, document_id, document_role, quote, verified)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, runId, p.field, p.candidateId, documentId, p.passage.document, p.passage.quote, p.passage.verified],
  );
}

export type StoredBriefPassage = {
  role: "brief" | "proposal";
  /** The document's name, or null when it has since been removed. */
  filename: string | null;
  quote: string;
  verified: boolean;
};

/** The passages behind each objective (by candidate id) and the business problem; undefined before 0122. */
export async function loadBriefPassages(
  client: Pick<PoolClient, "query">,
  runId: string,
): Promise<{ objectives: Map<string, StoredBriefPassage[]>; businessProblem: StoredBriefPassage[] } | undefined> {
  if (!(await briefPassagesAvailable(client))) return undefined;
  const r = await client.query<{ field: string; objective_candidate_id: string | null; document_role: "brief" | "proposal"; source_filename: string | null; quote: string; verified: boolean }>(
    `select p.field, p.objective_candidate_id, p.document_role, d.source_filename, p.quote, p.verified
     from brief_passages p left join documents d on d.id = p.document_id
     where p.run_id = $1 order by p.created_at, p.id`,
    [runId],
  );
  const objectives = new Map<string, StoredBriefPassage[]>();
  const businessProblem: StoredBriefPassage[] = [];
  for (const row of r.rows) {
    const passage = { role: row.document_role, filename: row.source_filename, quote: row.quote, verified: row.verified };
    if (row.field === "objective" && row.objective_candidate_id) objectives.set(row.objective_candidate_id, [...(objectives.get(row.objective_candidate_id) ?? []), passage]);
    else if (row.field === "business_problem") businessProblem.push(passage);
  }
  return { objectives, businessProblem };
}

/** "From the brief (brief.docx)", with "not found in its text" when the passage was not found. */
export function passageSourceText(p: StoredBriefPassage): string {
  const where = `From the ${p.role}${p.filename ? ` (${p.filename})` : " (since removed)"}`;
  return p.verified ? where : `${where}; this passage was not found in its text, so it may be reworded`;
}
