// Codex GTR-02 (21 October 2026): quote grounding read the support rows and the report text they are
// checked against in two separate READ COMMITTED statements, so a change committed between them gave
// a state belonging to neither version: a document deleted in between read as "not checked" (and the
// Accepted deck kept the insight, qualified), and a quote replaced together with its text read as
// "quote missing". Both loaders now read inside one REPEATABLE READ snapshot.
// Real disposable PostgreSQL through the app's own db.ts, the ACTUAL deleteDocument action and the
// actual insight export routes. The interleaving is injected at the query boundary: the app's pool
// hands out clients whose query() runs a concurrent change from another connection straight after
// the loader's main support query returns, i.e. exactly between the two reads the old code made.
//   deletion     the actual deleteDocument commits in between: one coherent state (the version
//                before the deletion), never "not checked"; a fresh read is no longer valid, and
//                the Accepted deck leaves the insight out with the reason; the pre-insight loader too
//   atomic       a quote and its report text replaced in one writer transaction (both versions
//                valid) in between: never "quote missing", in either loader; current on retry
//   unchanged    no concurrent change: current
//   missing      the text replaced without the quote, before the read: no longer valid
//   failed read  the report-text read fails: not checked, with the error, never current; retry current
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { PoolClient } from "pg";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })), download: vi.fn(), upload: vi.fn() }) } },
}));

vi.setConfig({ testTimeout: 60000 });
const TENANT = "00000000-0000-4000-8000-0000000000f9";

// The injection point: after a query whose text matches `after`, run `interleave` once (from another
// connection) before handing the result back; `failText` makes the report-text read fail.
const hook: { after: RegExp | null; interleave: (() => Promise<void>) | null; failText: boolean; fired: number } = {
  after: null,
  interleave: null,
  failText: false,
  fired: 0,
};
const SYNTH_MAIN = /from synthesized_insights si/;
const PRE_MAIN = /from insights i\s+join findings f/;

describe.skipIf(!TEST_DATABASE_URL)("GTR-02 quote grounding reads one coherent snapshot (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const FILLER = "This annual report summarises the customer programme for the year under review in some detail.";
  const Q1 = "Satisfaction stands at 72 percent among recent customers.";
  const Q2 = "Satisfaction stands at 74 percent among recent customers.";

  /** A report, its quoted accepted finding, a pre-insight and an accepted synthesized insight on it. */
  async function fixture(headline: string, quote = Q1) {
    const doc = await one(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, extracted_text) values ($1, $2, 'report', $3, $3, $4) returning id`,
      [TENANT, run, `${headline}.txt`, `${FILLER} ${quote} Nothing else of note.`],
    );
    const finding = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, finding_kind, status, theme, source_document_id, source_quote, quote_verified) values ($1, $2, 'stated', $3, 'fact', 'accepted', 'T', $4, $5, true) returning id`,
      [TENANT, run, `${headline} finding`, doc, quote],
    );
    const pre = await one(
      `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication, support_snapshot) values ($1, $2, $3, 'h', 'o', 't', 'i', finding_support_parts($3)) returning id`,
      [TENANT, run, finding],
    );
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
       values ($1, $2, $3, 'o', 't', 'i', 1, 1, 1, 'exploratory', 'accepted') returning id`,
      [TENANT, run, headline],
    );
    await db.pool.query(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1, $2, $3, finding_support_parts($4))`, [TENANT, si, pre, finding]);
    return { doc, finding, pre, si };
  }

  async function synth(si: string) {
    const { loadInsightSupportOrUnchecked } = await import("../supportStatus");
    return (await loadInsightSupportOrUnchecked(TENANT, run, [si])).statusOf(si);
  }
  async function preStatus(pre: string) {
    const { loadPreInsightSupportOrUnchecked } = await import("../supportStatus");
    return (await loadPreInsightSupportOrUnchecked(TENANT, run, [pre])).statusOf(pre);
  }
  async function deckText(scope: string) {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export-deck/route");
    const res = await GET(new Request(`http://x/?scope=${scope}`), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("\n").replace(/<[^>]+>/g, " ");
  }
  const armed = (after: RegExp, interleave: () => Promise<void>) => {
    hook.after = after;
    hook.interleave = interleave;
    hook.fired = 0;
  };

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name, entry_point) values ($1, 'Snapshot', 'generate') returning id`, [TENANT]);
    // Every client the app's pool hands out runs the injection hook around its queries.
    const { pool } = await import("../db");
    const realConnect = pool.connect.bind(pool) as () => Promise<PoolClient>;
    const wrapped = new WeakSet<PoolClient>();
    vi.spyOn(pool, "connect").mockImplementation((async () => {
      const client = await realConnect();
      if (!wrapped.has(client)) {
        wrapped.add(client);
        const realQuery = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
        (client as unknown as { query: (...a: unknown[]) => Promise<unknown> }).query = async (...args: unknown[]) => {
          const sql = typeof args[0] === "string" ? args[0] : "";
          if (hook.failText && /select id, extracted_text from documents/.test(sql)) throw new Error("Synthetic text read failure");
          const result = await realQuery(...args);
          if (hook.after && hook.interleave && hook.after.test(sql)) {
            const run = hook.interleave;
            hook.after = null;
            hook.interleave = null;
            hook.fired += 1;
            await run();
          }
          return result;
        };
      }
      return client;
    }) as unknown as typeof pool.connect);
  }, 120000);
  beforeEach(() => {
    hook.after = null;
    hook.interleave = null;
    hook.failText = false;
    hook.fired = 0;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("unchanged: with no concurrent change both loaders read current", async () => {
    const f = await fixture("Unchanged insight");
    expect((await synth(f.si)).status).toBe("current");
    expect((await preStatus(f.pre)).status).toBe("current");
  });

  it("deletion: the actual deleteDocument committed between the reads gives one coherent state, then no longer valid and left out", async () => {
    const f = await fixture("Deletion probe");
    const { deleteDocument } = await import("../documentActions");
    armed(SYNTH_MAIN, () => deleteDocument(run, f.doc));
    const during = await synth(f.si);
    expect(hook.fired).toBe(1);
    // The version before the deletion, read whole: the old code mixed it with the deleted text and
    // reported "not checked".
    expect(during.status).toBe("current");
    expect((await db.pool.query("select count(*)::int as n from documents where id = $1", [f.doc])).rows[0].n).toBe(0);
    // A fresh read sees the deletion: no longer valid, and the Accepted deck leaves it out with the reason.
    const after = await synth(f.si);
    expect(after.status).toBe("invalid");
    const accepted = await deckText("accepted");
    expect(accepted).toMatch(/Left out: support no longer valid/);
    expect(accepted).not.toMatch(/SUPPORT NOT CHECKED[^]*Deletion probe/i);
  });

  it("deletion: the pre-insight loader also reads one coherent state", async () => {
    const f = await fixture("Pre-insight deletion probe");
    const { deleteDocument } = await import("../documentActions");
    armed(PRE_MAIN, () => deleteDocument(run, f.doc));
    const during = await preStatus(f.pre);
    expect(hook.fired).toBe(1);
    expect(during.status).toBe("current");
  });

  it("atomic: a quote and its text replaced together between the reads is never read as quote missing, in either loader", async () => {
    const f = await fixture("Atomic probe");
    const replace = async (quote: string) => {
      const writer = await db.pool.connect();
      try {
        await writer.query("begin");
        await writer.query("update findings set source_quote = $2 where id = $1", [f.finding, quote]);
        await writer.query("update documents set extracted_text = $2 where id = $1", [f.doc, `${FILLER} ${quote} Nothing else of note.`]);
        await writer.query("commit");
      } finally {
        writer.release();
      }
    };
    armed(SYNTH_MAIN, () => replace(Q2));
    const during = await synth(f.si);
    expect(hook.fired).toBe(1);
    expect(during.reasons.map((r) => r.kind)).not.toContain("quote_missing");
    expect(during.status).not.toBe("invalid");
    armed(PRE_MAIN, () => replace(Q1));
    const preDuring = await preStatus(f.pre);
    expect(hook.fired).toBe(1);
    expect(preDuring.reasons.map((r) => r.kind)).not.toContain("quote_missing");
    expect(preDuring.status).not.toBe("invalid");
    // Retry: a coherent read of the final state.
    expect((await synth(f.si)).reasons.map((r) => r.kind)).not.toContain("quote_missing");
    expect((await preStatus(f.pre)).reasons.map((r) => r.kind)).not.toContain("quote_missing");
  });

  it("missing: text replaced without the quote before the read is no longer valid", async () => {
    const f = await fixture("Missing probe");
    await db.pool.query("update documents set extracted_text = $2 where id = $1", [f.doc, `${FILLER} Net promoter score is 30 this year.`]);
    const status = await synth(f.si);
    expect(status.status).toBe("invalid");
    expect(status.reasons.map((r) => r.kind)).toContain("quote_missing");
  });

  it("failed read: the report-text read fails, so support is not checked with the error, then current on retry", async () => {
    const f = await fixture("Failed read probe");
    hook.failText = true;
    const failed = await synth(f.si);
    expect(failed.status).toBe("unknown");
    expect(JSON.stringify(failed)).toMatch(/Synthetic text read failure/);
    const preFailed = await preStatus(f.pre);
    expect(preFailed.status).toBe("unknown");
    hook.failText = false;
    expect((await synth(f.si)).status).toBe("current");
    expect((await preStatus(f.pre)).status).toBe("current");
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("GTR-02 quote grounding reads one coherent snapshot (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
