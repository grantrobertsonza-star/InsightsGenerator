// Codex GT100-F02 (21 October 2026): a re-read keeps a reviewed report finding (its id, wording and
// review decision), but when the report's newly stored text no longer contains that finding's quote,
// its insight must not stay "Support current". Grounding is judged against the report's CURRENT
// stored text with the same quote rule extraction uses (quoteMatch), and a missing quote is treated
// as a deleted source is: support no longer valid, left out of Accepted exports with the reason.
// Real disposable PostgreSQL through the app's own db.ts, the ACTUAL re-read
// (extractFindingsFromDocument) and the actual insight export routes. Controlled: the model
// (scripted record_findings answer, or an outage), storage (the report's text, or a failed
// download), Next's cache/after() and the verification chain, as in supportReplacementDuplicates.
//   control     the quote is still in the new text but the extractor omits the claim: kept, current
//   missing     the quote is gone from the new text: kept as reviewed, support no longer valid, left
//               out of the Accepted deck with the reason; the pre-insight agrees
//   changed     the sentence was altered so the exact quote no longer appears: no longer valid
//   recovery    a later re-read whose text has the quote again: current, no second copy
//   failed      a re-read whose text download fails stores nothing and changes nothing; one whose
//               model call fails after the text was read is judged against that stored text
//   unreadable  stored text too short to judge (an image-only PDF): not checked, never invalid
//   no text     a report with no stored text: not checked, never current
//   unaffected  an insight on another report stays current throughout
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const hooks = vi.hoisted(() => ({
  storageText: "",
  downloadFails: false,
  modelFails: false,
  extraction: [] as Record<string, unknown>[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../tableComputation", () => ({ getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async () =>
          hooks.downloadFails
            ? { data: null, error: { message: "Synthetic storage outage" } }
            : { data: { arrayBuffer: async () => Buffer.from(hooks.storageText) }, error: null },
        ),
        upload: vi.fn(async () => ({ error: null })),
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async () => {
        if (hooks.modelFails) throw new Error("Synthetic model outage");
        return {
          stop_reason: "tool_use",
          usage: {},
          content: [{ type: "tool_use", id: "tu", name: "record_findings", input: { findings: hooks.extraction } }],
        };
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });
const TENANT = "00000000-0000-4000-8000-0000000000f8";

describe.skipIf(!TEST_DATABASE_URL)("GT100-F02 a kept report finding's quote is checked against its report's current text (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const rows = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows;

  const SAT_Q = "Satisfaction stands at 72 percent among recent customers.";
  const SAT = "Satisfaction is 72% among recent customers.";
  const NEW_Q = "Net promoter score is 30 this year.";
  const OTHER_Q = "Awareness stands at 60 percent among all adults surveyed in the spring.";
  const FILLER = "This annual report summarises the customer programme for the year under review.";
  const ids: Record<string, string> = {};

  const params = () => ({ params: Promise.resolve({ id: run }) });
  async function csvSupport() {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export/route");
    const res = await GET(new Request("http://x/"), params());
    expect(res.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const list = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    return Object.fromEntries(list.map((r) => [String(r.Headline), String(r.Support)]));
  }
  async function deckText(scope: string) {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export-deck/route");
    const res = await GET(new Request(`http://x/?scope=${scope}`), params());
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("\n").replace(/<[^>]+>/g, " ");
  }
  async function reread(text: string, extraction: Record<string, unknown>[] = [{ finding_text: "NPS is 30 this year.", finding_kind: "fact", theme: "Advocacy", data_type: "quantitative", source_quote: NEW_Q }]) {
    hooks.storageText = text;
    hooks.extraction = extraction;
    const { extractFindingsFromDocument } = await import("../extractFindings");
    return extractFindingsFromDocument(TENANT, run, ids.main);
  }
  const satRows = () => rows("select id, finding_text, status, source_quote from findings where run_id = $1 and finding_text = $2", [run, SAT]);
  async function preInsightStatus() {
    const { loadPreInsightSupport } = await import("../supportStatus");
    return (await loadPreInsightSupport(TENANT, run, [ids.satPre])).statusOf(ids.satPre);
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name, entry_point) values ($1, 'Quote grounding', 'generate') returning id`, [TENANT]);
    // Each report as a first read leaves it: its text stored, its findings quoting that text.
    const report = (name: string, text: string) =>
      one(`insert into documents (tenant_id, run_id, kind, source_filename, storage_path, extracted_text) values ($1, $2, 'report', $3, $3, $4) returning id`, [TENANT, run, name, text]);
    const stated = (doc: string, text: string, quote: string) =>
      one(
        `insert into findings (tenant_id, run_id, origin, finding_text, finding_kind, status, theme, source_document_id, source_quote, quote_verified) values ($1, $2, 'stated', $3, 'fact', 'accepted', 'T', $4, $5, true) returning id`,
        [TENANT, run, text, doc, quote],
      );
    ids.main = await report("main-report.txt", `${FILLER} ${SAT_Q} Nothing else of note.`);
    ids.other = await report("other-report.txt", `${FILLER} ${OTHER_Q}`);
    ids.sat = await stated(ids.main, SAT, SAT_Q);
    // Reviewed by a researcher, so a re-read keeps it (REP-IN-002 protection).
    await db.pool.query("update findings set researcher_note = 'Checked by the researcher' where id = $1", [ids.sat]);
    ids.otherFinding = await stated(ids.other, "Awareness is 60%.", OTHER_Q);
    const insight = async (headline: string, finding: string) => {
      const si = await one(
        `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
         values ($1, $2, $3, 'Researcher wording kept', 't', 'i', 1, 1, 1, 'exploratory', 'accepted') returning id`,
        [TENANT, run, headline],
      );
      const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication, support_snapshot) values ($1, $2, $3, 'h', 'o', 't', 'i', finding_support_parts($3)) returning id`, [TENANT, run, finding]);
      await db.pool.query(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1, $2, $3, finding_support_parts($4))`, [TENANT, si, pi, finding]);
      return { si, pi };
    };
    const sat = await insight("Satisfaction insight", ids.sat);
    ids.satInsight = sat.si;
    ids.satPre = sat.pi;
    await insight("Unaffected insight", ids.otherFinding);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("before any re-read, both insights' support is current", async () => {
    expect(await csvSupport()).toEqual({ "Satisfaction insight": "Support current", "Unaffected insight": "Support current" });
    expect((await preInsightStatus()).status).toBe("current");
  });

  it("control: the quote is still in the new text but the extractor omits the claim, so the kept finding stays current", async () => {
    const result = await reread(`${FILLER} ${SAT_Q} ${NEW_Q} Nothing else of note.`);
    expect(result.published).toBe(true);
    expect((await satRows()).map((r) => r.id)).toEqual([ids.sat]);
    expect(await csvSupport()).toEqual({ "Satisfaction insight": "Support current", "Unaffected insight": "Support current" });
  });

  it("missing: the quote is gone from the new text; the finding is kept as reviewed, its support is no longer valid everywhere", async () => {
    await reread(`Annual report. ${NEW_Q} Nothing else of note in this year's programme summary.`);
    const kept = await satRows();
    expect(kept).toEqual([{ id: ids.sat, finding_text: SAT, status: "accepted", source_quote: SAT_Q }]);
    const support = await csvSupport();
    expect(support["Satisfaction insight"]).toMatch(/^Support no longer valid: the quote behind “Satisfaction is 72% among recent customers\.” no longer appears in its report/);
    expect(support["Unaffected insight"]).toBe("Support current");
    const accepted = await deckText("accepted");
    expect(accepted).toMatch(/Left out: support no longer valid/);
    expect(accepted).toMatch(/Unaffected insight/);
    // The pre-insight on the same finding agrees (one shared rule).
    expect(await preInsightStatus()).toMatchObject({ status: "invalid", reasons: [expect.objectContaining({ kind: "quote_missing", findingId: ids.sat })] });
    // The insight, its wording and its review decision are untouched.
    expect(await rows("select observation, review_status from synthesized_insights where id = $1", [ids.satInsight])).toEqual([{ observation: "Researcher wording kept", review_status: "accepted" }]);
  });

  it("recovery: a later re-read whose text has the quote again is current again, with no second copy of the finding", async () => {
    await reread(`${FILLER} ${SAT_Q} ${NEW_Q}`, [
      { finding_text: SAT, finding_kind: "fact", theme: "T", data_type: "quantitative", source_quote: SAT_Q },
      { finding_text: "NPS is 30 this year.", finding_kind: "fact", theme: "Advocacy", data_type: "quantitative", source_quote: NEW_Q },
    ]);
    expect((await satRows()).map((r) => r.id)).toEqual([ids.sat]);
    expect(await csvSupport()).toEqual({ "Satisfaction insight": "Support current", "Unaffected insight": "Support current" });
  });

  it("changed: the sentence was altered so the exact quote no longer appears: no longer valid", async () => {
    await reread(`${FILLER} Satisfaction stands at 64 percent among recent customers. ${NEW_Q}`);
    expect((await satRows()).map((r) => r.id)).toEqual([ids.sat]);
    expect((await csvSupport())["Satisfaction insight"]).toMatch(/^Support no longer valid/);
    // Back to the original text for the next cases.
    await reread(`${FILLER} ${SAT_Q} ${NEW_Q}`);
    expect((await csvSupport())["Satisfaction insight"]).toBe("Support current");
  });

  it("failed: a re-read whose text download fails stores nothing and changes nothing", async () => {
    hooks.downloadFails = true;
    try {
      await expect(reread(`Annual report. ${NEW_Q} Nothing else of note in this year's programme summary.`)).rejects.toThrow();
    } finally {
      hooks.downloadFails = false;
    }
    const [doc] = await rows("select extracted_text from documents where id = $1", [ids.main]);
    expect(doc.extracted_text).toContain(SAT_Q);
    expect((await csvSupport())["Satisfaction insight"]).toBe("Support current");
  });

  it("failed: a model outage after the text was read keeps every finding, and the support is judged against the text now stored", async () => {
    hooks.modelFails = true;
    try {
      // Same text as before: nothing changes.
      await expect(reread(`${FILLER} ${SAT_Q} ${NEW_Q}`)).rejects.toThrow(/Synthetic model outage/);
      expect((await csvSupport())["Satisfaction insight"]).toBe("Support current");
      // The file now reads differently: the read text is stored before the model is called, so the
      // quote is judged against what the report says now, even though no finding was replaced.
      await expect(reread(`Annual report. ${NEW_Q} Nothing else of note in this year's programme summary.`)).rejects.toThrow(/Synthetic model outage/);
    } finally {
      hooks.modelFails = false;
    }
    expect((await satRows()).map((r) => r.id)).toEqual([ids.sat]);
    expect((await csvSupport())["Satisfaction insight"]).toMatch(/^Support no longer valid/);
    await reread(`${FILLER} ${SAT_Q} ${NEW_Q}`);
    expect((await csvSupport())["Satisfaction insight"]).toBe("Support current");
  });

  it("unreadable: stored text too short to judge is 'not checked', never 'no longer valid'", async () => {
    // An image-only PDF reads as almost nothing; the re-read stores it, then refuses to call the model.
    await expect(reread("Page 1")).rejects.toThrow(/Almost no readable text/);
    expect((await satRows()).map((r) => r.id)).toEqual([ids.sat]);
    const support = await csvSupport();
    expect(support["Satisfaction insight"]).toMatch(/^Support not checked: its support could not be checked \(its report's stored text could not be read to check the quote\)/);
    expect(support["Unaffected insight"]).toBe("Support current");
    await reread(`${FILLER} ${SAT_Q} ${NEW_Q}`);
    expect((await csvSupport())["Satisfaction insight"]).toBe("Support current");
  });

  it("no text: a report with no stored text is 'not checked', never current", async () => {
    await db.pool.query("update documents set extracted_text = null where id = $1", [ids.main]);
    expect((await csvSupport())["Satisfaction insight"]).toMatch(/^Support not checked/);
    expect((await preInsightStatus()).status).toBe("unknown");
    await db.pool.query("update documents set extracted_text = $2 where id = $1", [ids.main, `${FILLER} ${SAT_Q} ${NEW_Q}`]);
    expect((await csvSupport())["Satisfaction insight"]).toBe("Support current");
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("GT100-F02 a kept report finding's quote is checked against its report's current text (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
