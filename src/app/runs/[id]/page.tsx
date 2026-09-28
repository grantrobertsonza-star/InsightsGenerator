import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractClaimsFromDocument } from "@/lib/extractClaims";
import { generateInsightsFromTable } from "@/lib/generateInsights";
import ClaimsTable from "./ClaimsTable";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;
const BUCKET = "documents";

type Run = {
  id: string;
  decision_statement: string | null;
  audience: string | null;
  status: string;
  entry_point: "generate" | "validate" | null;
};

type Document = {
  id: string;
  kind: "report" | "table" | "evidence";
  source_filename: string;
  uploaded_at: string;
};

type Claim = {
  id: string;
  origin: "stated" | "generated";
  claim_text: string;
  claim_kind: "own_finding" | "external_citation" | "insight" | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  source_filename: string | null;
};

async function getRun(runId: string): Promise<Run | null> {
  return withTenant(TENANT_ID, async (client) => {
    const result = await client.query<Run>(
      "select id, decision_statement, audience, status, entry_point from runs where id = $1",
      [runId]
    );
    return result.rows[0] ?? null;
  });
}

async function getDocuments(runId: string): Promise<Document[]> {
  return withTenant(TENANT_ID, async (client) => {
    const result = await client.query<Document>(
      "select id, kind, source_filename, uploaded_at from documents where run_id = $1 order by uploaded_at desc",
      [runId]
    );
    return result.rows;
  });
}

async function getClaims(runId: string): Promise<Claim[]> {
  return withTenant(TENANT_ID, async (client) => {
    const result = await client.query<Claim>(
      `select c.id, c.origin, c.claim_text, c.claim_kind, c.theme, c.status,
              coalesce(d1.source_filename, d2.source_filename) as source_filename
       from claims c
       left join documents d1 on d1.id = c.source_document_id
       left join documents d2 on d2.id = c.source_table_id
       where c.run_id = $1
       order by c.created_at`,
      [runId]
    );
    return result.rows;
  });
}

async function extractClaimsAction(runId: string, documentId: string) {
  "use server";
  await extractClaimsFromDocument(TENANT_ID, runId, documentId);
  revalidatePath(`/runs/${runId}`);
}

async function generateInsightsAction(runId: string, documentId: string) {
  "use server";
  await generateInsightsFromTable(TENANT_ID, runId, documentId);
  revalidatePath(`/runs/${runId}`);
}

async function uploadDocument(runId: string, formData: FormData) {
  "use server";
  const files = formData.getAll("file") as File[];
  const kind = String(formData.get("kind") ?? "report");
  const realFiles = files.filter((file) => file.size > 0);

  if (realFiles.length === 0) {
    return;
  }

  for (const file of realFiles) {
    // Tenant-scoped path: even though this bucket is only ever touched by
    // server code using the secret key, every object still lives under the
    // tenant's own folder, so nothing has to change here when client-facing
    // storage policies are added later.
    const storagePath = `${TENANT_ID}/${runId}/${Date.now()}-${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: file.type || undefined });

    if (uploadError) {
      throw new Error(`Upload of ${file.name} failed: ${uploadError.message}`);
    }

    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into documents (tenant_id, run_id, kind, source_filename, storage_path)
         values ($1, $2, $3, $4, $5)`,
        [TENANT_ID, runId, kind, file.name, storagePath]
      );
    });
  }

  revalidatePath(`/runs/${runId}`);
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) {
    notFound();
  }

  const documents = await getDocuments(id);
  const claims = await getClaims(id);
  const uploadWithRunId = uploadDocument.bind(null, id);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif" }}>
      <Link href="/" style={{ fontSize: 14, color: "#2A6FDB" }}>
        &larr; All runs
      </Link>

      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "8px 0" }}>{run.decision_statement}</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>
        Audience: {run.audience} &middot; Status: {run.status} &middot; Starting point:{" "}
        {run.entry_point === "generate" ? "Generate from data" : "Validate existing insights"}
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Upload a document</h2>
      <form
        action={uploadWithRunId}
        style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 40, maxWidth: 420 }}
      >
        <label>
          What kind of file is this?
          <select name="kind" style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}>
            <option value="report">Report (a document with written findings)</option>
            <option value="table">Table / raw data (a spreadsheet or cross-tab)</option>
            <option value="evidence">Evidence (prior research, for comparison)</option>
          </select>
        </label>
        <label>
          File(s)
          <input type="file" name="file" required multiple style={{ display: "block", marginTop: 4 }} />
        </label>
        <button
          type="submit"
          style={{ padding: "10px 16px", background: "#14213D", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          Upload
        </button>
      </form>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Documents</h2>
      {documents.length === 0 && <p style={{ color: "#777" }}>Nothing uploaded yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8, marginBottom: 40 }}>
        {documents.map((doc) => {
          const extractAction = extractClaimsAction.bind(null, id, doc.id);
          const generateAction = generateInsightsAction.bind(null, id, doc.id);
          return (
            <li key={doc.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <strong>{doc.source_filename}</strong> &middot; {doc.kind} &middot;{" "}
                {new Date(doc.uploaded_at).toLocaleString()}
              </div>
              {doc.kind === "report" && (
                <form action={extractAction}>
                  <button
                    type="submit"
                    style={{ padding: "6px 12px", background: "#2A6FDB", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
                  >
                    Extract claims
                  </button>
                </form>
              )}
              {doc.kind === "table" && (
                <form action={generateAction}>
                  <button
                    type="submit"
                    style={{ padding: "6px 12px", background: "#1E7A34", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" }}
                  >
                    Generate insights from data
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Claims</h2>
      {claims.length === 0 ? (
        <p style={{ color: "#777" }}>None extracted yet.</p>
      ) : (
        <ClaimsTable runId={id} claims={claims} />
      )}
    </main>
  );
}
