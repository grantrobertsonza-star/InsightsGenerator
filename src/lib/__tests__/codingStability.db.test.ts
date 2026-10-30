// Batch 61, Codex STAB-F01 to STAB-F04: the stability check through its public functions
// (reapplyCodebook writes the original, runStabilityCheck, changeTurnCode, applyMajorityCoding,
// resolveStabilityTurn, getCodingAnalysis) on a real disposable PostgreSQL with every migration, connected
// as a NOSUPERUSER, NOBYPASSRLS role. Only the model is replaced: a fake that answers each yes/no call
// from a fixed answer key, and can omit decisions or fail a pass on request. The real applyCodebook,
// its completeness counts and the real persistence run.
//   F01  failed, partially omitted and entirely omitted passes are left out, never scored as "no code";
//        with none complete nothing is saved and the previous result stays; mixed passes are compared
//        with the complete ones only and the left-out pass is named; a retry recovers; an incomplete
//        original refuses the check
//   F02  the first run is the model's original coding: a researcher removal, its undo, an addition and
//        settling by majority do not change it, and are reported as changes since the original; human
//        decisions and settled turns survive a new check; a coding with no kept original is "unknown"
//   F03  a changed model, an older prompt, a theme added to the codebook and changed turns refuse the
//        check with what changed, leaving the previous result; the original cannot be edited; a new
//        original written while the check runs makes the save refuse
//   F04  the headline is unavailable when no theme reaches ten turns
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

type Mode = "ok" | "omit_one" | "omit_all" | "fail";
const fake = vi.hoisted(() => ({
  // code number -> unit ids ("turn.unit") that meet it
  key: new Map<number, Set<string>>(),
  plan: [] as Mode[],
  calls: 0,
  callsPerPass: 2,
  onCall: null as null | (() => Promise<void>),
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "claude-test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string }; messages: { content: unknown }[] }) => {
        const usage = { input_tokens: 1, output_tokens: 1 };
        if (req.tool_choice?.name !== "record_decisions")
          return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", name: "x", input: { summaries: [] } }] };
        const mode = fake.plan[Math.floor(fake.calls / fake.callsPerPass)] ?? "ok";
        fake.calls += 1;
        if (fake.onCall) {
          const f = fake.onCall;
          fake.onCall = null;
          await f();
        }
        const parts = req.messages[0].content as { text: string }[];
        const code = Number(/^Code (\d+):/.exec(parts[1].text)?.[1]);
        const units = [...parts[0].text.matchAll(/^\s+(\d+\.\d+) /gm)].map((m) => m[1]);
        if (mode === "fail") return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "no" }] };
        const shown = mode === "omit_all" ? [] : mode === "omit_one" ? units.slice(1) : units;
        const decisions = shown.map((id) => ({
          id,
          account_type: "personal",
          stance: "affirmed",
          why: "test",
          status: "clear",
          meets: fake.key.get(code)?.has(id) ?? false,
        }));
        return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", name: "record_decisions", input: { decisions } }] };
      }),
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.setConfig({ testTimeout: 60000 });

const ROLE = "ie_stability_b61_test";

describe.skipIf(!TEST_DATABASE_URL)("batch 61 coding stability (real database, restricted role)", () => {
  let db: DisposableDb;
  const T = randomUUID();
  let run = "";
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p).then((r) => r.rows);
  const lib = async () => ({
    ...(await import("../codingAnalysis")),
    ...(await import("../extractThemes")),
    ...(await import("../codingOverrides")),
  });

  /** A transcript (three participant turns, one moderator question) coded by the model through
   * reapplyCodebook, which keeps the original. Returns the codebook in force. */
  async function coded(opts: { turns?: number; original?: Mode } = {}) {
    const turns = opts.turns ?? 3;
    const doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript','t.txt',$3) returning id", [T, run, `${T}/${randomUUID()}.txt`]))[0].id as string;
    const v1 = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'induced') returning id", [T, run, doc]))[0].id as string;
    for (const [i, name] of ["Waiting", "Payment"].entries())
      await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,$3,$4,$5)", [T, v1, i, name, `${name} definition`]);
    await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,speaker,role,text) values($1,$2,$3,0,'Mod','moderator','How was the service?')", [T, run, doc]);
    for (let i = 1; i <= turns; i++)
      await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,speaker,role,text) values($1,$2,$3,$4,'P','participant',$5)", [T, run, doc, i, `I waited ${i} hours and the payment ${i % 2 ? "failed" : "worked"}.`]);
    const codes = await q("select id, name, definition from coding_codes where codebook_id = $1 order by position", [v1]);
    fake.key = new Map([
      [1, new Set(Array.from({ length: turns }, (_, k) => `${k + 1}.1`))],
      [2, new Set(Array.from({ length: turns }, (_, k) => k + 1).filter((t) => t % 2 === 1).map((t) => `${t}.1`))],
    ]);
    fake.plan = [opts.original ?? "ok"];
    fake.calls = 0;
    const { reapplyCodebook } = await lib();
    await reapplyCodebook(T, run, doc, codes.map((c) => ({ id: c.id, name: c.name, definition: c.definition, inclusion: "", exclusion: "" })));
    const book = (await q("select id from coding_codebooks where document_id = $1 and version = 2", [doc]))[0].id as string;
    const code = Object.fromEntries((await q("select id, name from coding_codes where codebook_id = $1", [book])).map((c) => [c.name, c.id]));
    const seg = Object.fromEntries((await q("select id, segment_index from coding_segments where document_id = $1", [doc])).map((s) => [s.segment_index, s.id]));
    return { doc, book, code, seg };
  }
  async function check(f: { doc: string; book: string }, plan: Mode[], reruns = plan.length) {
    fake.plan = plan;
    fake.calls = 0;
    const { runStabilityCheck } = await lib();
    return runStabilityCheck(T, run, f.doc, f.book, reruns);
  }
  const stored = (book: string) =>
    q("select s.segment_index, t.runs, t.agree, t.orig_codes, t.run_codes, t.resolved_at is not null as resolved from coding_turn_stability t join coding_segments s on s.id = t.segment_id where t.codebook_id = $1 order by s.segment_index", [book]);
  const checkRow = (book: string) => q("select passes_requested, passes_complete, excluded from coding_stability_checks where codebook_id = $1", [book]).then((r) => r[0] ?? null);
  const view = async (doc: string) => (await (await lib()).getCodingAnalysis(T, run)).get(doc)!;

  beforeAll(async () => {
    db = await createDisposableDb();
    await q("insert into tenants(id,name) values($1,'Stability')", [T]);
    run = (await q("insert into runs(tenant_id,project_name) values($1,'S') returning id", [T]))[0].id;
    await q(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${ROLE}') then create role ${ROLE} login password 'ie_test_only' nobypassrls; end if; end $$`);
    await q(`grant usage on schema public to ${ROLE}`);
    await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
    await q(`grant usage, select on all sequences in schema public to ${ROLE}`);
    await q(`grant execute on all functions in schema public to ${ROLE}`);
    const u = new URL(db.url);
    u.username = ROLE;
    u.password = "ie_test_only";
    process.env.DATABASE_URL = u.toString();
    delete process.env.CODING_APPLY_MODEL;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("control: a complete original and a complete identical pass agree on every turn, and the check is recorded", async () => {
    const f = await coded();
    const base = await q("select model, failed_batches, incomplete_batches, decisions from coding_model_baselines where codebook_id = $1", [f.book]);
    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({ model: "claude-test-model", failed_batches: 0, incomplete_batches: 0 });
    expect(base[0].decisions[f.seg[1]].sort()).toEqual([f.code.Waiting, f.code.Payment].sort());
    expect(await check(f, ["ok"])).toContain("1 complete pass compared");
    expect((await stored(f.book)).map((r) => [r.runs, r.agree])).toEqual([[2, 2], [2, 2], [2, 2]]);
    expect(await checkRow(f.book)).toEqual({ passes_requested: 1, passes_complete: 1, excluded: [] });
    const v = await view(f.doc);
    expect(v.stabilityBaseline.state.state).toBe("ready");
    expect(v.stability!.check).toMatchObject({ recorded: true, requested: 1, complete: 1, againstCurrentOriginal: true });
  });

  it("F01: a failed pass, a pass with one decision omitted and a pass with every decision omitted are left out; nothing is saved and the previous result stays", async () => {
    const f = await coded();
    await check(f, ["ok"]);
    const before = await stored(f.book);
    for (const mode of ["fail", "omit_one", "omit_all"] as Mode[]) {
      await expect(check(f, [mode])).rejects.toThrow(/No pass came back complete.*previous result is unchanged.*pass 1 incomplete/);
      expect(await stored(f.book)).toEqual(before);
      expect(await checkRow(f.book)).toEqual({ passes_requested: 1, passes_complete: 1, excluded: [] });
    }
    // Retry and recovery: the next complete pass is compared and saved.
    expect(await check(f, ["ok"])).toContain("1 complete pass compared");
  });

  it("F01: mixed passes are compared on the complete ones only, the left-out pass is named, and its omissions never count as no code", async () => {
    const f = await coded();
    const msg = await check(f, ["ok", "omit_one", "fail"]);
    expect(msg).toMatch(/2 more times|3 more times/);
    expect(msg).toContain("pass 2 incomplete: 1 of 1 batches left some turns undecided");
    expect(msg).toContain("pass 3 incomplete: 1 of 1 batches failed");
    const rows = await stored(f.book);
    // Two runs (original and pass 1); without the fix pass 2's omitted first unit read as "no code" on turn 1.
    expect(rows.map((r) => [r.runs, r.agree])).toEqual([[2, 2], [2, 2], [2, 2]]);
    expect(rows[0].run_codes).toEqual([[1, 2]]);
    const k = await checkRow(f.book);
    expect(k.passes_requested).toBe(3);
    expect(k.passes_complete).toBe(1);
    expect(k.excluded.map((e: { pass: number }) => e.pass)).toEqual([2, 3]);
  });

  it("F01: an incomplete original refuses the check; a fresh complete application recovers", async () => {
    const f = await coded({ original: "omit_one" });
    expect((await view(f.doc)).stabilityBaseline.state.state).toBe("incomplete");
    await expect(check(f, ["ok"])).rejects.toThrow(/original coding is incomplete/);
    expect(fake.calls).toBe(0);
    expect(await stored(f.book)).toEqual([]);
  });

  it("F02: a researcher's removal, its undo and an addition leave the original as it was; they show as changes since the original and survive the check", async () => {
    const f = await coded();
    const { changeTurnCode } = await lib();
    await check(f, ["ok"]);
    await changeTurnCode(T, run, f.doc, f.seg[1], f.code.Waiting, "remove");
    await changeTurnCode(T, run, f.doc, f.seg[2], f.code.Payment, "add");
    let v = await view(f.doc);
    expect(v.stabilityBaseline.researcherChanges).toEqual({ added: 1, removed: 1, turns: 2 });
    // Without the fix, run 1 was rebuilt from the edited coding and turn 1 fell from 2 of 2 to 1 of 2.
    await check(f, ["ok"]);
    expect((await stored(f.book)).map((r) => r.agree)).toEqual([2, 2, 2]);
    expect((await stored(f.book))[0].orig_codes).toEqual([1, 2]);
    // The researcher's decisions are untouched by the check.
    expect(await q("select action from coding_assignment_overrides where segment_id = $1", [f.seg[1]])).toEqual([{ action: "remove" }]);
    expect(await q("select 1 from coding_assignments where segment_id = $1 and code_id = $2", [f.seg[1], f.code.Waiting])).toEqual([]);
    expect(await q("select source from coding_assignments where segment_id = $1 and code_id = $2", [f.seg[2], f.code.Payment])).toEqual([{ source: "researcher" }]);
    // Undo the removal: back to the model's coding, and the change count falls.
    await changeTurnCode(T, run, f.doc, f.seg[1], f.code.Waiting, "add");
    v = await view(f.doc);
    expect(v.stabilityBaseline.researcherChanges).toEqual({ added: 1, removed: 0, turns: 1 });
  });

  it("F02: settling by majority and a settled turn survive a new check, and the original is unchanged by them", async () => {
    const f = await coded();
    // Passes 1 and 2 drop "Waiting" on turn 3 (unit 3.1): the majority removes it from the coding in force.
    fake.key.get(1)!.delete("3.1");
    await check(f, ["ok", "ok"]);
    const { applyMajorityCoding, saveBlindStabilityTurn, resolveStabilityTurn } = await lib();
    expect(await applyMajorityCoding(T, run, f.doc, f.book)).toContain("1 removed");
    await saveBlindStabilityTurn(T, f.book, f.seg[3], [f.code.Payment]);
    await resolveStabilityTurn(T, run, f.doc, f.book, f.seg[3], []);
    const original = await q("select decisions from coding_model_baselines where codebook_id = $1", [f.book]);
    expect(original[0].decisions[f.seg[3]]).toContain(f.code.Waiting);
    expect((await view(f.doc)).stabilityBaseline.researcherChanges).toEqual({ added: 0, removed: 1, turns: 1 });
    await check(f, ["ok", "ok"]);
    const rows = await stored(f.book);
    expect(rows[2]).toMatchObject({ runs: 3, agree: 1, orig_codes: [1, 2], resolved: true });
    expect(await q("select 1 from coding_assignments where segment_id = $1 and code_id = $2", [f.seg[3], f.code.Waiting])).toEqual([]);
  });

  it("F02: a coding with no kept original (made before batch 61, or edited since) is unknown and is not checked against the current coding", async () => {
    const f = await coded();
    await q("delete from coding_model_baselines where codebook_id = $1", [f.book]);
    const v = await view(f.doc);
    expect(v.stabilityBaseline.state.state).toBe("unknown");
    expect(v.stabilityBaseline.refusal).toMatch(/not kept.*Apply the codebook again/);
    await expect(check(f, ["ok"])).rejects.toThrow(/original coding of this transcript was not kept/);
    expect(fake.calls).toBe(0);
  });

  it("F02: an older result without a recorded check is shown as such and cannot settle by majority", async () => {
    const f = await coded();
    await check(f, ["ok", "ok"]);
    await q("delete from coding_stability_checks where codebook_id = $1", [f.book]);
    const v = await view(f.doc);
    expect(v.stability!.check).toEqual({ recorded: false });
    expect(v.stability!.majority.available).toBe(false);
    const { applyMajorityCoding } = await lib();
    await expect(applyMajorityCoding(T, run, f.doc, f.book)).rejects.toThrow(/before the check recorded/);
  });

  it("F03: a changed model refuses before any pass and keeps the previous result; restoring the model recovers", async () => {
    const f = await coded();
    await check(f, ["ok"]);
    const before = await stored(f.book);
    process.env.CODING_APPLY_MODEL = "claude-other-model";
    try {
      expect((await view(f.doc)).stabilityBaseline.state).toMatchObject({ state: "changed" });
      await expect(check(f, ["ok"])).rejects.toThrow(/the model changed \(the original coding used claude-test-model; a new run would use claude-other-model\)/);
      expect(fake.calls).toBe(0);
      expect(await stored(f.book)).toEqual(before);
    } finally {
      delete process.env.CODING_APPLY_MODEL;
    }
    await check(f, ["ok"]);
  });

  it("F03: an original made with an older prompt refuses; the original cannot be edited in place", async () => {
    const f = await coded();
    await expect(q("update coding_model_baselines set prompt_hash = 'old-prompt' where codebook_id = $1", [f.book])).rejects.toThrow(/never changed/);
    await q(
      `insert into coding_model_baselines (tenant_id, run_id, document_id, codebook_id, model, prompt_hash, codebook_fingerprint,
         segmentation_fingerprint, total_batches, failed_batches, incomplete_batches, decisions)
       select tenant_id, run_id, document_id, codebook_id, model, 'old-prompt', codebook_fingerprint, segmentation_fingerprint,
              total_batches, failed_batches, incomplete_batches, decisions
         from coding_model_baselines where codebook_id = $1`,
      [f.book],
    );
    await expect(check(f, ["ok"])).rejects.toThrow(/coding instructions or the way turns are prepared/);
  });

  it("the original moves with its transcript to the bin and back, unchanged; nothing else on it can change", async () => {
    const f = await coded();
    const before = await q("select id, decisions from coding_model_baselines where codebook_id = $1", [f.book]);
    const bin = await import("../documentBin");
    const removed = await bin.removeDocumentToBin(T, run, f.doc, null);
    expect(await q("select count(*)::int as n from coding_model_baselines where codebook_id = $1 and run_id = $2", [f.book, run])).toEqual([{ n: 0 }]);
    await bin.restoreDocumentFromBin(T, run, removed.removalId);
    expect(await q("select id, decisions from coding_model_baselines where codebook_id = $1 and run_id = $2", [f.book, run])).toEqual(before);
    await expect(q("update coding_model_baselines set decisions = '{}'::jsonb where codebook_id = $1", [f.book])).rejects.toThrow(/never changed/);
  });

  it("F03: a theme added to the codebook and changed turns refuse the check, naming the change", async () => {
    const f = await coded();
    const { addResearcherCode } = await lib();
    await addResearcherCode(T, run, f.doc, f.book, "Staff", "Staff behaviour", null);
    await expect(check(f, ["ok"])).rejects.toThrow(/themes? added since: Staff/);
    const g = await coded();
    await q("update coding_segments set text = text || ' Later edit.' where id = $1", [g.seg[2]]);
    await expect(check(g, ["ok"])).rejects.toThrow(/transcript's turns changed/);
  });

  it("F03: a new original written while the check runs makes the save refuse and keeps the previous result", async () => {
    const f = await coded();
    await check(f, ["ok"]);
    const before = await stored(f.book);
    fake.onCall = async () => {
      await q(
        `insert into coding_model_baselines (tenant_id, run_id, document_id, codebook_id, model, prompt_hash, codebook_fingerprint,
           segmentation_fingerprint, total_batches, failed_batches, incomplete_batches, decisions)
         select tenant_id, run_id, document_id, codebook_id, model, prompt_hash, codebook_fingerprint, segmentation_fingerprint,
                total_batches, failed_batches, incomplete_batches, '{}'::jsonb
           from coding_model_baselines where codebook_id = $1`,
        [f.book],
      );
    };
    await expect(check(f, ["ok"])).rejects.toThrow(/changed while the check was running/);
    expect(await stored(f.book)).toEqual(before);
  });

  it("F04 and lead figures: with no theme in ten turns the averages and the stricter figure are unavailable, and the themes are marked too few", async () => {
    const f = await coded({ turns: 3 });
    await check(f, ["ok"]);
    const st = (await view(f.doc)).stability!;
    expect(st.codeAgreement).toBeNull();
    expect(st.pairwiseAverage).toBeNull();
    expect(st.kappaAverage).toBeNull();
    expect(st.eligibleCodes).toBe(0);
    expect(st.belowMinimumCodes).toBe(2);
    expect(st.perCode.every((c) => c.tooFew)).toBe(true);
    // Per-theme pairwise agreement is still shown with its denominator: 3 turns x 1 pair of runs.
    expect(st.perCode[0]).toMatchObject({ pairwise: 1, pairwiseComparisons: 3 });
  });

  it("F04 boundary: a theme in exactly ten turns is eligible, one in fewer is left out of the averages", async () => {
    const f = await coded({ turns: 10 });
    // Pass 1 drops "Waiting" on turn 10 only.
    fake.key.get(1)!.delete("10.1");
    await check(f, ["ok"]);
    const st = (await view(f.doc)).stability!;
    // Waiting: 10 turns, 9 consistent; Payment: 5 turns (odd ones), too few.
    expect(st.eligibleCodes).toBe(1);
    expect(st.belowMinimumCodes).toBe(1);
    expect(st.codeAgreement).toBeCloseTo(0.9, 12);
    // Hand-computed: 10 turns x 1 pair, 9 agree.
    expect(st.pairwiseAverage).toBeCloseTo(0.9, 12);
    expect(st.perCode.find((c) => c.name === "Payment")!.tooFew).toBe(true);
  });
});
