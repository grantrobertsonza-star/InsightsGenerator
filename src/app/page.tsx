import Link from "next/link";
import { withTenant } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { deleteRun } from "@/lib/runActions";
import DeleteRunButton from "./DeleteRunButton";

// There's no login system yet, so every run on this page belongs to one
// fixed tenant read from the environment. Once real auth exists, this will
// come from whoever is logged in instead.
const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type Run = {
  id: string;
  decision_statement: string | null;
  audience: string | null;
  status: string;
  entry_point: "generate" | "validate" | null;
  created_at: string;
};

async function getRuns(): Promise<Run[]> {
  return withTenant(TENANT_ID, async (client) => {
    const result = await client.query<Run>(
      "select id, decision_statement, audience, status, entry_point, created_at from runs order by created_at desc"
    );
    return result.rows;
  });
}

async function createRun(formData: FormData) {
  "use server";
  const decisionStatement = String(formData.get("decisionStatement") ?? "");
  const audience = String(formData.get("audience") ?? "");
  const entryPoint = String(formData.get("entryPoint") ?? "");

  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      "insert into runs (tenant_id, decision_statement, audience, entry_point) values ($1, $2, $3, $4)",
      [TENANT_ID, decisionStatement, audience, entryPoint]
    );
  });

  revalidatePath("/");
}

const entryPointLabel: Record<string, string> = {
  generate: "Generate from data",
  validate: "Validate existing insights",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string }>;
}) {
  const { entry } = await searchParams;
  const runs = await getRuns();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Insights Elevator</h1>
      <p style={{ color: "#555", marginBottom: 32 }}>
        A run is one engagement: a decision to inform, using a client&apos;s report and data.
      </p>

      {entry !== "generate" && entry !== "validate" ? (
        <div style={{ display: "flex", gap: 16, marginBottom: 40 }}>
          <Link
            href="/?entry=generate"
            style={{
              flex: 1,
              display: "block",
              padding: 24,
              border: "2px solid #14213D",
              borderRadius: 12,
              textDecoration: "none",
              color: "#14213D",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Generate from data</div>
            <div style={{ fontSize: 14, color: "#555" }}>
              Start from raw tables or a dataset. The app mines it directly for undeclared patterns:
              segment differences, trends, outliers, relationships.
            </div>
          </Link>
          <Link
            href="/?entry=validate"
            style={{
              flex: 1,
              display: "block",
              padding: 24,
              border: "2px solid #14213D",
              borderRadius: 12,
              textDecoration: "none",
              color: "#14213D",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Validate existing insights</div>
            <div style={{ fontSize: 14, color: "#555" }}>
              Start from a report that already makes claims. The app checks each one and elevates
              what survives into a clear narrative.
            </div>
          </Link>
        </div>
      ) : (
        <div style={{ marginBottom: 40 }}>
          <Link href="/" style={{ fontSize: 14, color: "#2A6FDB" }}>
            &larr; Choose a different starting point
          </Link>
          <p style={{ fontWeight: 600, marginTop: 8, marginBottom: 16 }}>
            Starting point: {entryPointLabel[entry]}
          </p>
          <form action={createRun} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="hidden" name="entryPoint" value={entry} />
            <label>
              Decision this run should inform
              <textarea
                name="decisionStatement"
                required
                rows={2}
                style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              />
            </label>
            <label>
              Audience
              <input
                name="audience"
                required
                style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              />
            </label>
            <button
              type="submit"
              style={{ padding: "10px 16px", background: "#14213D", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
            >
              Create run
            </button>
          </form>
        </div>
      )}

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Runs</h2>
      {runs.length === 0 && <p style={{ color: "#777" }}>No runs yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {runs.map((run) => {
          const deleteThisRun = deleteRun.bind(null, run.id);
          return (
            <li
              key={run.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <Link href={`/runs/${run.id}`} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{run.decision_statement}</div>
                <div style={{ color: "#666", fontSize: 14 }}>
                  {run.entry_point ? entryPointLabel[run.entry_point] : "No starting point recorded"} &middot;{" "}
                  Audience: {run.audience} &middot; Status: {run.status} &middot;{" "}
                  {new Date(run.created_at).toLocaleString()}
                </div>
              </Link>
              <form action={deleteThisRun}>
                <DeleteRunButton />
              </form>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
