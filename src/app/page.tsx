import { withTenant } from "@/lib/db";
import { revalidatePath } from "next/cache";

// There's no login system yet, so every run on this page belongs to one
// fixed tenant read from the environment. Once real auth exists, this will
// come from whoever is logged in instead.
const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type Run = {
  id: string;
  decision_statement: string | null;
  audience: string | null;
  status: string;
  created_at: string;
};

async function getRuns(): Promise<Run[]> {
  return withTenant(TENANT_ID, async (client) => {
    const result = await client.query<Run>(
      "select id, decision_statement, audience, status, created_at from runs order by created_at desc"
    );
    return result.rows;
  });
}

async function createRun(formData: FormData) {
  "use server";
  const decisionStatement = String(formData.get("decisionStatement") ?? "");
  const audience = String(formData.get("audience") ?? "");

  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      "insert into runs (tenant_id, decision_statement, audience) values ($1, $2, $3)",
      [TENANT_ID, decisionStatement, audience]
    );
  });

  revalidatePath("/");
}

export default async function Home() {
  const runs = await getRuns();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Insights Elevator</h1>
      <p style={{ color: "#555", marginBottom: 32 }}>
        A run is one engagement: a decision to inform, using a client&apos;s report and data.
      </p>

      <form action={createRun} style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 40 }}>
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

      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Runs</h2>
      {runs.length === 0 && <p style={{ color: "#777" }}>No runs yet.</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {runs.map((run) => (
          <li key={run.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 600 }}>{run.decision_statement}</div>
            <div style={{ color: "#666", fontSize: 14 }}>
              Audience: {run.audience} &middot; Status: {run.status} &middot;{" "}
              {new Date(run.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
