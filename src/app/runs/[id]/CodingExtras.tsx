import { codebooksByTranscript, loadMemos } from "@/lib/codingMemos";
import CodingExtrasClient from "./CodingExtrasClient";
import { requireTenantId } from "@/lib/requestContext";

/** Memos and codebook reuse for one coded transcript. Loads its own data. */
export default async function CodingExtras({
  runId,
  documentId,
  filename,
}: {
  runId: string;
  documentId: string;
  filename: string;
}) {
  const TENANT_ID = await requireTenantId();
  const [memos, books] = await Promise.all([loadMemos(TENANT_ID, runId), codebooksByTranscript(TENANT_ID, runId)]);
  const mine = books.find((b) => b.documentId === documentId);
  return (
    <CodingExtrasClient
      runId={runId}
      documentId={documentId}
      filename={filename}
      codeNames={mine?.codes.map((c) => c.name) ?? []}
      memos={memos.filter((m) => m.documentId === documentId || m.documentId === null)}
      others={books.filter((b) => b.documentId !== documentId).map((b) => ({ documentId: b.documentId, filename: b.filename, codes: b.codes.length }))}
    />
  );
}
