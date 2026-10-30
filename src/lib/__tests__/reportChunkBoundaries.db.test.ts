// EF-SEC-F01 (batch 62): a claim near a cut between two parts of a long report. Through the real
// extractFindingsFromDocument, buildChunks and publication, against a real disposable PostgreSQL.
// The model is the mocked boundary, standing in for a reader that finds a claim only when its whole
// sentence is in the text it was sent (page markers and line breaks read through, as a reader would),
// and that cites support only when the cited sentences are in the same request. Storage and the PDF
// reader are mocked: a "PDF" here is a list of page texts.
//
// Covered: a fact, a qualification (hypothesis), a recommendation and a stated insight with its cited
// support crossing a cut; claims at the very beginning and end; a claim read twice in the repeated
// overlap, published once; an explicit empty answer (published, nothing found) against a malformed one
// (withheld, previous findings kept); and a sentence crossing a page break at a paginated cut, verified
// against the pages read together. Not established: whether a real model extracts every claim it is
// shown (extraction recall needs its own evaluation set; nothing here claims a reading is complete).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

type Candidate = { finding_text: string; source_quote: string; finding_kind: string; supports?: string[]; page?: number };
const model = vi.hoisted(() => ({
  candidates: [] as Candidate[],
  mode: "normal" as "normal" | "empty" | "malformed_second",
  requests: [] as string[],
}));
const flat = (t: string) => t.replace(/\[\[PAGE \d+\]\]/g, " ").replace(/\s+/g, " ");
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        const text = req.messages[0].content;
        model.requests.push(text);
        const seen = flat(text);
        const index = model.requests.length - 1;
        let input: unknown;
        if (model.mode === "empty") input = { findings: [] };
        else if (model.mode === "malformed_second" && index === 1) input = {};
        else {
          const found = model.candidates.filter((c) => seen.includes(c.source_quote));
          input = {
            findings: found.map((c) => ({
              finding_text: c.finding_text,
              source_quote: c.source_quote,
              finding_kind: c.finding_kind,
              theme: "Service",
              data_type: "quantitative",
              ...(c.page ? { page_number: c.page } : {}),
              ...(c.supports
                ? { supporting_indices: c.supports.map((q) => found.findIndex((f) => f.source_quote === q)).filter((i) => i >= 0) }
                : {}),
            })),
          };
        }
        return { content: [{ type: "tool_use", name: "record_findings", input }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "tool_use" };
      }),
    },
  },
}));
const source = vi.hoisted(() => ({ text: "", pages: null as string[] | null }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: source.pages })),
}));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ download: async () => ({ data: new Blob([source.text]), error: null }) }) } },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../tableComputation", async (orig) => ({ ...(await orig<object>()), getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const FILLER = "The study describes access to services and the context for these results. ";
const CUT = 25000;

describe.skipIf(!TEST_DATABASE_URL)("report parts: claims at the cuts (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T')", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function readReport(text: string, candidates: Candidate[], opts: { filename?: string; pages?: string[]; mode?: typeof model.mode; run?: string; doc?: string } = {}) {
    const run = opts.run ?? (await q("insert into runs (tenant_id) values ($1) returning id", [tenant]))[0].id;
    const doc =
      opts.doc ??
      (await q(
        "insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'report', $3, 'synthetic') returning id",
        [tenant, run, opts.filename ?? "report.txt"],
      ))[0].id;
    source.text = text;
    source.pages = opts.pages ?? null;
    model.candidates = candidates;
    model.mode = opts.mode ?? "normal";
    model.requests = [];
    const { extractFindingsFromDocument } = await import("../extractFindings");
    let error = "";
    let reply: Awaited<ReturnType<typeof extractFindingsFromDocument>> | null = null;
    try {
      reply = await extractFindingsFromDocument(tenant, run, doc);
    } catch (e) {
      error = String(e);
    }
    const rows = await q(
      "select id, finding_text, finding_kind, source_quote, quote_verified, source_page, cited_support_finding_ids from findings where run_id = $1 order by created_at, id",
      [run],
    );
    return { run, doc, reply, error, rows };
  }

  /** Filler up to `at` characters (cut mid-sentence), then `tail`. */
  const around = (at: number, tail: string) => FILLER.repeat(Math.ceil(at / FILLER.length)).slice(0, at) + " " + tail;

  const fact = "Satisfaction was 61% among branch customers in this study.";
  const qualification = "This may reflect access barriers in rural areas rather than service quality.";
  const recommendation = "The report recommends extending service hours at rural branches.";
  const insight = "Taken together, the satisfaction and delay results show service availability is the priority.";
  const delay = "Customers who waited longer than an hour were less satisfied in the survey.";

  it("a fact, a qualification and a recommendation straddling the cut are each read whole once", async () => {
    for (const [kind, sentence] of [["fact", fact], ["hypothesis", qualification], ["recommendation", recommendation]] as const) {
      const text = around(CUT - 20, sentence + " " + FILLER.repeat(3));
      const r = await readReport(text, [{ finding_text: sentence, source_quote: sentence, finding_kind: kind }]);
      expect(model.requests.length).toBe(2);
      expect(model.requests.filter((x) => flat(x).includes(sentence))).toHaveLength(1);
      expect(r.reply?.published).toBe(true);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ finding_kind: kind, source_quote: sentence, quote_verified: true });
    }
  });

  it("a stated insight just after the cut keeps the support it cites from just before the cut", async () => {
    const text = around(CUT - 400, `${fact} ${delay} ${insight} ` + FILLER.repeat(5));
    const r = await readReport(text, [
      { finding_text: fact, source_quote: fact, finding_kind: "fact" },
      { finding_text: delay, source_quote: delay, finding_kind: "own_finding" },
      { finding_text: insight, source_quote: insight, finding_kind: "stated_insight", supports: [fact, delay] },
    ]);
    expect(r.reply?.published).toBe(true);
    // Both supporting sentences are in the first part and repeated in the second; each is published once.
    expect(r.rows.map((x) => x.source_quote).sort()).toEqual([delay, fact, insight].sort());
    const ins = r.rows.find((x) => x.finding_kind === "stated_insight")!;
    const ids = r.rows.filter((x) => x.finding_kind !== "stated_insight").map((x) => x.id).sort();
    expect([...(ins.cited_support_finding_ids as string[])].sort()).toEqual(ids);
  });

  it("claims at the very beginning and the very end of a long report are read", async () => {
    const first = "Overall, 72% of respondents used the mobile channel at least monthly.";
    const last = "Finally, 15% of respondents reported closing an account in the year.";
    const text = first + "\n" + FILLER.repeat(900) + "\n" + last;
    const r = await readReport(text, [
      { finding_text: first, source_quote: first, finding_kind: "fact" },
      { finding_text: last, source_quote: last, finding_kind: "fact" },
    ]);
    expect(model.requests.length).toBeGreaterThan(2);
    expect(r.rows.map((x) => x.source_quote).sort()).toEqual([first, last].sort());
  });

  it("a claim in the repeated overlap, returned by both parts, is published once and a repeat read adds nothing", async () => {
    const text = around(CUT - 300, fact + " " + FILLER.repeat(400));
    const r = await readReport(text, [{ finding_text: fact, source_quote: fact, finding_kind: "fact" }]);
    expect(model.requests.filter((x) => flat(x).includes(fact)).length).toBe(2);
    expect(r.rows).toHaveLength(1);
    const again = await readReport(text, [{ finding_text: fact, source_quote: fact, finding_kind: "fact" }], { run: r.run, doc: r.doc });
    expect(again.reply?.published).toBe(true);
    expect(again.rows).toHaveLength(1);
  });

  it("the same sentence written twice far apart is two readings, not an overlap duplicate", async () => {
    const text = fact + " " + FILLER.repeat(400) + " " + fact + " " + FILLER.repeat(10);
    const r = await readReport(text, [{ finding_text: fact, source_quote: fact, finding_kind: "fact" }]);
    // Two places in the report, each read by its own part: the overlap rule removes nothing outside
    // the repeated text, so both readings are published.
    expect(r.reply?.published).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(model.requests.filter((x) => flat(x).includes(fact)).length).toBe(2);
  });

  it("an explicit empty answer from every part is published as nothing found; a malformed part withholds and keeps the previous findings", async () => {
    const text = FILLER.repeat(500);
    const empty = await readReport(text, [], { mode: "empty" });
    expect(empty.reply?.published).toBe(true);
    expect(empty.rows).toHaveLength(0);

    const prior = around(CUT - 20, fact + " " + FILLER.repeat(3));
    const first = await readReport(prior, [{ finding_text: fact, source_quote: fact, finding_kind: "fact" }]);
    expect(first.rows).toHaveLength(1);
    const broken = await readReport(prior, [{ finding_text: fact, source_quote: fact, finding_kind: "fact" }], {
      mode: "malformed_second",
      run: first.run,
      doc: first.doc,
    });
    // Withheld either as an unpublished partial reading or as a failed read; never as a reading.
    expect(broken.error !== "" || broken.reply?.published === false).toBe(true);
    expect(broken.rows.map((x) => x.id)).toEqual(first.rows.map((x) => x.id));
  });

  it("paginated: a sentence crossing the page break at a cut is sent whole once and verified against both pages", async () => {
    const opening = "Respondents in the northern region reported that waiting times";
    const closing = "fell by 12% after the new appointment system was introduced.";
    const crossing = `${opening} ${closing}`;
    const page = (n: number) => `Page ${n} narrative. ` + FILLER.repeat(130);
    // Pages 1 and 2 fill most of the first part; page 3 does not fit, so the cut falls at the break
    // between page 2 (which ends mid-sentence) and page 3 (which finishes it).
    const pages = [page(1), page(2) + " " + opening, closing + " " + FILLER.repeat(80), page(4)];
    const r = await readReport("pdf bytes", [{ finding_text: crossing, source_quote: crossing, finding_kind: "fact", page: 3 }], {
      filename: "report.pdf",
      pages,
    });
    expect(model.requests.length).toBeGreaterThan(1);
    expect(model.requests.filter((x) => flat(x).includes(crossing))).toHaveLength(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].quote_verified).toBe(true);
  });
});
