// Golden-thread follow-up (Grant, 2026-10-17): every reader that means "the finding's verdict now"
// uses its ONE latest verdict (latestVerdict.ts: created_at desc, then id desc, the order
// finding_support_parts records). Before, several readers joined `verdicts` directly, so a finding
// with an older robust verdict and a newer refusal still counted as verified, and a finding with
// several verdicts appeared once per verdict.
// Real disposable PostgreSQL; the ACTUAL functions and routes; only the model and chart rendering
// are mocked (the prompts the model would receive are captured and read).
// Fixture, all accepted generated findings:
//   A: robust, then not_supported              -> refused now
//   B: not_supported, then robust              -> robust now
//   C: robust, robust, then use_with_caution   -> one row, use_with_caution
//   D: robust and insufficient_information in the same instant; the refusal has the larger id
//   E: robust once                             -> control
// The fixture findings carry no finding_kind, as findings computed from data tables do (only report
// extraction sets it). The chain check used `finding_kind != 'stated_insight'`, which is null for
// them, so its evidence pool silently left out every computed finding; it now uses
// `is distinct from` and this test would see an empty prompt otherwise.
// Readers: both narrative exports (the findings they chart and list), the discovery section, the
// research assistant's evidence, stated-insight chain checking's evidence pool, and the run page's
// verification summary and failed-verdict sample.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/methodologyStatus", async () => await import("../methodologyStatus"));

const charted: { id: string }[][] = [];
const prompts: string[] = [];
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
for (const m of ["db", "deckSlides", "docxReport", "caveatLabels", "supportStatus", "supportStatusShared", "sourceAttribution", "narrativeSupportSummary", "figureChecks", "numberTrace", "storyNarrative", "latestVerdict", "discoveryReport", "decisionContext", "recommendationQualification"]) {
  vi.doMock(`@/lib/${m}`, async () => await import(`../${m}`));
}
vi.mock("@/lib/discoverySlides", () => ({ addDiscoverySlides: vi.fn() }));
vi.mock("@/lib/exportChartImages", () => ({
  buildChartImagesByTheme: vi.fn(async (findings: { id: string }[]) => {
    charted.push(findings.map((f) => ({ id: f.id })));
    return [];
  }),
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system?: unknown; messages: { content: string }[] }) => {
        prompts.push(`${typeof req.system === "string" ? req.system : JSON.stringify(req.system ?? "")}\n${req.messages.map((m) => m.content).join("\n")}`);
        // Text answer for the assistant; an unusable tool answer for the chain check (the claim is
        // then left unverified, which is all this test needs: the prompt was built).
        return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "Noted." }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("readers use each finding's latest verdict (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  const f: Record<string, string> = {};
  const text = (k: string) => `Finding ${k} about purchase intent`;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Latest verdict readers')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name,entry_point,decision_statement) values($1,'Latest verdicts','generate','Decision A') returning id", [tenant])).rows[0].id;
    const verdicts: Record<string, [string, string, string?][]> = {
      A: [["robust", "2026-01-01"], ["not_supported", "2026-01-02"]],
      B: [["not_supported", "2026-01-01"], ["robust", "2026-01-02"]],
      C: [["robust", "2026-01-01"], ["robust", "2026-01-02"], ["use_with_caution", "2026-01-03"]],
      D: [["robust", "2026-01-01", "00000000-0000-4000-8000-0000000000d1"], ["insufficient_information", "2026-01-01", "ffffffff-ffff-4fff-bfff-ffffffffffd1"]],
      E: [["robust", "2026-01-01"]],
    };
    for (const [k, list] of Object.entries(verdicts)) {
      f[k] = (await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'generated',$3,'accepted','Theme') returning id", [tenant, run, text(k)])).rows[0].id;
      for (const [tier, at, id] of list) {
        await db.pool.query(
          "insert into verdicts(id,tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level,created_at) values(coalesce($1::uuid,gen_random_uuid()),$2,$3,$4,$5,'single_pass','single_source',$6)",
          [id ?? null, tenant, f[k], tier, `${tier} rationale for ${k} at ${at}`, at],
        );
      }
    }
    await db.pool.query(
      "insert into deck_narratives(tenant_id,run_id,executive_summary,situation,complication,question,governing_thought,pillars,recommendations_intro,caveats) values($1,$2,'Summary','S','C','Q','G','[]','','[]')",
      [tenant, run],
    );
  }, 120000);
  afterAll(async () => {
    // The assistant now takes a capacity slot from the claim pool (RR-F08): both pools are closed
    // before the database is dropped (Codex RR-M03).
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool?.end?.();
    await db.drop();
  });

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
  const expected = () => [f.B, f.C, f.E].sort();

  it("the narrative deck and report chart and list each verified finding once, by its latest verdict", async () => {
    charted.length = 0;
    for (const route of ["story/export", "story/export-docx"]) {
      const { GET } = await import(`../../app/api/runs/[id]/${route}/route`);
      const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: run }) });
      expect(res.status, route).toBe(200);
    }
    expect(charted.length).toBe(2);
    for (const rows of charted) expect(ids(rows)).toEqual(expected());
  });

  it("the discovery section lists each net-new finding once, with its latest tier", async () => {
    const { loadDiscoveryReportData } = await import("../discoveryReport");
    const client = await db.pool.connect();
    try {
      const d = await loadDiscoveryReportData(client, run);
      const listed = d.netNewFindings.map((x) => [x.text, x.verdictTier]);
      expect(listed.sort()).toEqual([[text("B"), "robust"], [text("C"), "use_with_caution"], [text("E"), "robust"]].sort());
    } finally {
      client.release();
    }
  });

  it("the research assistant is handed each verified finding once and never a refused one", async () => {
    prompts.length = 0;
    const { askResearchAssistant } = await import("../researchAssistant");
    await askResearchAssistant(tenant, run, "What do the findings say?");
    const prompt = prompts.join("\n");
    for (const k of ["B", "C", "E"]) expect(prompt.split(text(k)).length - 1, `finding ${k} once`).toBe(1);
    for (const k of ["A", "D"]) expect(prompt, `refused finding ${k}`).not.toContain(text(k));
  });

  it("stated-insight chain checking sees each finding once, labelled with its latest verdict", async () => {
    prompts.length = 0;
    await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,status,theme,finding_kind) values($1,$2,'stated','Report says purchase intent is high','accepted','Theme','stated_insight')", [tenant, run]);
    const { validateStatedInsights } = await import("../validateStatedInsights");
    await validateStatedInsights(tenant, run);
    const prompt = prompts.join("\n");
    expect(prompt.length).toBeGreaterThan(0);
    const label = (k: string) => prompt.split("\n").filter((l) => l.includes(text(k)));
    const tiers: Record<string, string> = { A: "not_supported", B: "robust", C: "use_with_caution", D: "insufficient_information", E: "robust" };
    for (const [k, tier] of Object.entries(tiers)) {
      expect(label(k).length, `finding ${k} once`).toBe(1);
      expect(label(k)[0], `finding ${k} latest verdict`).toContain(`verdict: ${tier}`);
    }
  });

  it("the run page's verification summary counts findings, not verdict rows, by their latest verdict", async () => {
    const { getVerdictSummary, getSampleFailedVerdicts } = await import("../verdictSummary");
    expect(await getVerdictSummary(tenant, run)).toEqual({ verdictedCount: 5, passedCount: 3 });
    const failed = await getSampleFailedVerdicts(tenant, run);
    expect(failed.map((x) => [x.finding_text, x.verdict_tier]).sort()).toEqual([[text("A"), "not_supported"], [text("D"), "insufficient_information"]].sort());
    // B's older refusal was overturned: not a current failure.
    expect(failed.some((x) => x.finding_text === text("B"))).toBe(false);
  });

  it("the shared rule matches finding_support_parts on every fixture finding", async () => {
    const { latestVerdictLateral } = await import("../latestVerdict");
    const r = await db.pool.query(
      `select f.finding_text, v.verdict_tier = finding_support_parts(f.id)->>'verdict' as same
         from findings f join ${latestVerdictLateral("f.id", ["verdict_tier"])} v on true where f.run_id = $1`,
      [run],
    );
    expect(r.rows.length).toBe(5);
    expect(r.rows.every((x) => x.same)).toBe(true);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("readers use each finding's latest verdict (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
