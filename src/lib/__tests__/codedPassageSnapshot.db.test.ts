// Batch 60, Codex COD5K-F01: the treatment of coded-passage snapshots (coding_unit_assignments.unit_text,
// migration 0090) after the shared sentence rule changed. A passage is never rewritten as if the new
// split were what the model saw: a snapshot is shown as taken, recognised as coded under the old or
// new rule, and reported stale only when neither rule reproduces it from the stored turns; a row with
// no snapshot is shown as the old rule split it. Real disposable PostgreSQL (owner connection; the
// reader is a plain tenant-scoped read).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "no-provider",
  anthropic: { messages: { create: vi.fn(async () => { throw new Error("Provider forbidden in this test"); }) } },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("COD5K-F01 coded-passage snapshots after the sentence rule changed (real database)", () => {
  let db: DisposableDb;
  const T = randomUUID();
  const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
  const FOOTER = "Synthetic interview. All dialogue is fictional.";
  const TEXTS = [
    `I waited for help and received no response. ${FOOTER}`,
    `My account was blocked while the payment was processed. ${FOOTER}`,
    `I made a payment of 12. ${FOOTER}`,
  ];

  beforeAll(async () => {
    db = await createDisposableDb();
    await q("insert into tenants(id,name) values($1,'T')", [T]);
    process.env.DATABASE_URL = db.url;
  }, 180000);
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db.drop();
  });

  async function codedTranscript(snapshots: (string | null)[]) {
    const run = (await q("insert into runs(tenant_id) values($1) returning id", [T])).rows[0].id;
    const doc = (await q("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript','t.txt',$3) returning id", [T, run, `${T}/${randomUUID()}.txt`])).rows[0].id;
    const book = (await q("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'induced') returning id", [T, run, doc])).rows[0].id;
    const code = (await q("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,1,'Payment','d') returning id", [T, book])).rows[0].id;
    for (const [i, text] of TEXTS.entries()) {
      const seg = (await q("insert into coding_segments(tenant_id,run_id,document_id,segment_index,role,text) values($1,$2,$3,$4,'participant',$5) returning id", [T, run, doc, i, text])).rows[0].id;
      if (i !== 2) continue;
      await q("insert into coding_assignments(tenant_id,segment_id,code_id) values($1,$2,$3)", [T, seg, code]);
      for (const [k, snap] of snapshots.entries())
        await q("insert into coding_unit_assignments(tenant_id,segment_id,code_id,unit,unit_text) values($1,$2,$3,$4,$5)", [T, seg, code, k + 1, snap]);
    }
    return doc as string;
  }

  it("a snapshot taken under the old rule is the passage shown, recognised as legacy, not stale; the turn text is never rewritten", async () => {
    // What the model was shown before the fix: only half the footer was recognised.
    const doc = await codedTranscript(["I made a payment of 12. Synthetic interview."]);
    const { getCodedUnitPassages } = await import("../extractThemes");
    const [p] = await getCodedUnitPassages(T, doc);
    expect(p).toMatchObject({
      textAsCoded: "I made a payment of 12. Synthetic interview.",
      text: "I made a payment of 12. Synthetic interview.",
      currentText: "I made a payment of 12.",
      legacyRuleText: "I made a payment of 12. Synthetic interview.",
      codedUnderRule: "legacy-number-full-stop",
      stale: false,
      passageUncertain: false,
    });
    expect((await q("select text from coding_segments where document_id = $1 and segment_index = 2", [doc])).rows[0].text).toBe(TEXTS[2]);
  });

  it("a snapshot taken under the new rule is recognised as current; one matching neither is stale and still shown as taken", async () => {
    const doc = await codedTranscript(["I made a payment of 12.", "A passage the transcript no longer holds."]);
    const { getCodedUnitPassages } = await import("../extractThemes");
    const [current, gone] = await getCodedUnitPassages(T, doc);
    expect(current).toMatchObject({ text: "I made a payment of 12.", codedUnderRule: "numeric-endings-v2", stale: false });
    expect(gone).toMatchObject({ text: "A passage the transcript no longer holds.", codedUnderRule: null, stale: true, currentText: null });
  });

  it("a row without a snapshot (written before 0090) is shown as the legacy rule split it, the units the model saw", async () => {
    const doc = await codedTranscript([null]);
    const { getCodedUnitPassages } = await import("../extractThemes");
    const [p] = await getCodedUnitPassages(T, doc);
    expect(p).toMatchObject({ textAsCoded: null, text: "I made a payment of 12. Synthetic interview.", codedUnderRule: "legacy-number-full-stop", stale: false });
  });
});
