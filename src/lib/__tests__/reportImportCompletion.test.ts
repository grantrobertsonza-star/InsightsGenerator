// IMP-006 / REP-IN-001 with REP-IN-002 (replacement preservation and researcher-action provenance)
// - permanent regression file.
//
// Exercises the REAL extractFindingsFromDocument / planReplacement / claimIdentityKey
// (extractFindings.ts), the REAL archiveAndReplaceFindings (findingArchive.ts), the REAL researcher
// actions (findingActions.ts), the REAL provenance writes (findingProvenance.ts), a real dashboard
// remove (drivers.removeDriverFindings) and the REAL withTenant transaction wrapper (db.ts).
// Controlled boundaries only: the `pg` driver (the in-memory fake in ./helpers/fakeFindingsDb.ts,
// which models per-connection rollback, schema cascades and whether migration 0094 is applied),
// object storage, the model call, cross-document grounding, API-usage logging, Next's
// revalidatePath, and the stats/crosstab modules drivers.ts imports but removal never calls.
// Nothing here runs against real PostgreSQL; see the handover for the integration checks.
//
// Every test starts from fresh modules (vi.resetModules), because findingProvenanceAvailable
// caches a positive answer per module and the pre-migration tests must not inherit it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeFindingsDb, type FakeFindingsDb, type Row } from "./helpers/fakeFindingsDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.setConfig({ testTimeout: 30000 });

const TENANT = vi.hoisted(() => {
  const id = "00000000-0000-4000-8000-000000000001";
  process.env.DEFAULT_TENANT_ID = id;
  return id;
});

let db: FakeFindingsDb;
vi.mock("pg", () => ({
  Pool: class {
    async connect() {
      return db.connect();
    }
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../tableComputation", () => ({ getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => undefined) }));
vi.mock("../anthropic", () => ({
  anthropic: { messages: { create: vi.fn() } },
  CLAUDE_MODEL: "claude-sonnet-5",
}));
vi.mock("../dataSetup", () => ({}));
vi.mock("../parseStatsFile", () => ({}));
vi.mock("../crosstabs", () => ({}));
vi.mock("../driverAnalysis", () => ({}));
let storageBuffer: Buffer;
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async () => ({ data: { arrayBuffer: async () => storageBuffer }, error: null })),
        upload: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));

const RUN = "run-1";
const DOC = "doc-1";
const DOCUMENT_ROW = { id: DOC, run_id: RUN, storage_path: "doc.txt", source_filename: "report.txt" };

function makeLongPlainText(totalChars: number): string {
  // No page markers, so buildChunks slices by CHUNK_CHARS (25000) alone: 30000 chars -> 2 chunks.
  const unit = "This report describes a finding about the surveyed population. ";
  return unit.repeat(Math.ceil(totalChars / unit.length)).slice(0, totalChars);
}

function toolUseResponse(findings: Record<string, unknown>[]) {
  return {
    content: [{ type: "tool_use", id: "tu_1", name: "record_findings", input: { findings } }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: "tool_use",
  };
}

const f = (text: string, quote: string, extra: Record<string, unknown> = {}) => ({
  finding_text: text,
  finding_kind: "fact",
  theme: "Satisfaction",
  data_type: "quantitative",
  source_quote: quote,
  ...extra,
});

// The model answers per chunk, keyed on the "part N of 2" wording in that chunk's own prompt, so
// concurrent chunk calls cannot be mis-assigned by call order.
async function modelAnswers(part1: Record<string, unknown>[] | Error, part2: Record<string, unknown>[] | Error) {
  const { anthropic } = await import("../anthropic");
  vi.mocked(anthropic.messages.create).mockImplementation((async (args: unknown) => {
    const answer = JSON.stringify(args).includes("part 2 of 2") ? part2 : part1;
    if (answer instanceof Error) throw answer;
    return toolUseResponse(answer);
  }) as never);
}

const NEW_1 = f("New reading of satisfaction.", "Quote one from the new reading.");
const NEW_2 = f("New reading of loyalty.", "Quote two from the new reading.");

type ProvenanceMode = "tracked" | "legacy" | "none";
let created = 0;
function finding(mode: ProvenanceMode, id: string, status: string, quote: string, extra: Row = {}): Row {
  const base: Row = {
    id,
    tenant_id: TENANT,
    run_id: RUN,
    origin: "stated",
    finding_text: `Prior wording ${id}`,
    finding_kind: "fact",
    theme: "Prior theme",
    status,
    source_document_id: DOC,
    source_page: null,
    source_quote: quote,
    researcher_note: null,
    cited_support_finding_ids: [],
    grounded_by_finding_id: null,
    created_seq: created++,
  };
  if (mode !== "none") {
    Object.assign(base, {
      human_reviewed_at: null,
      human_review_action: null,
      human_edited_at: null,
      human_edited_fields: [],
      provenance_tracked: mode === "tracked",
    });
  }
  return { ...base, ...extra };
}

// Prior state. A = untouched default-accepted, no dependents. B = accepted with a researcher note,
// sharing NEW_1's quote but making a different claim. C = rejected (a human exclusion). D =
// accepted with a verdict, an insight and a recommendation. E = a finding in another document
// grounded on D.
function priorState(mode: ProvenanceMode) {
  return {
    documents: [DOCUMENT_ROW],
    findings: [
      finding(mode, "prior-A", "accepted", "Old quote A."),
      finding(mode, "prior-B", "accepted", "Quote one from the new reading.", { researcher_note: "Check against Q2 tracking", finding_text: "Researcher-reviewed wording B" }),
      finding(mode, "prior-C", "rejected", "Old quote C."),
      finding(mode, "prior-D", "accepted", "Old quote D."),
      finding(mode, "prior-E", "accepted", "Other doc quote.", { source_document_id: "doc-2", grounded_by_finding_id: "prior-D" }),
    ],
    verdicts: [{ id: "verdict-D", finding_id: "prior-D", verdict_tier: "robust" }],
    insights: [{ id: "insight-D", finding_id: "prior-D", headline: "Insight on D" }],
    recommendations: [{ id: "rec-D", insight_id: "insight-D", action_text: "Act on D" }],
  };
}

const live = (id: string) => db.state.findings.find((r) => r.id === id);
const liveForDoc = () => db.state.findings.filter((r) => r.source_document_id === DOC);
const liveIds = () => liveForDoc().map((r) => r.id as string).sort();
const newRows = () => liveForDoc().filter((r) => String(r.id).startsWith("new-"));
const strip = (rows: Row[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "created_seq")));
const pick = (ids: string[]) => strip(structuredClone(db.state.findings.filter((r) => ids.includes(r.id as string))));
// Everything except the trace table: the prior authoritative state that must be untouched.
function authoritativeSnapshot() {
  return structuredClone(Object.fromEntries(Object.entries(db.state).filter(([k]) => k !== "trace")));
}
const withheld = (reason: string) =>
  db.state.trace.filter((e) => e.event === "extract_findings_replacement_withheld" && (e.detail as Row).reason === reason);

async function extract(options?: { onlyReplacePending?: boolean; confirmLegacyReplacement?: { findingIds: string[] } }) {
  const { extractFindingsFromDocument } = await import("../extractFindings");
  return extractFindingsFromDocument(TENANT, RUN, DOC, options);
}
async function actions() {
  return import("../findingActions");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storageBuffer = Buffer.from(makeLongPlainText(30000), "utf-8");
  db = createFakeFindingsDb({ documents: [DOCUMENT_ROW] });
});

describe("IMP-006 completion status (retained closures, real archive and transaction path)", () => {
  it("[case 1] all chunks succeed: publishes every chunk's findings, failedParts 0", async () => {
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract();
    expect(result).toMatchObject({ failedParts: 0, totalParts: 2, published: true, notPublishedReason: null, legacyConfirmation: null });
    expect(result.rows).toHaveLength(2);
    expect(newRows()).toHaveLength(2);
    expect(db.state.trace.find((e) => e.event === "extract_findings_summary")?.detail).toMatchObject({ failedParts: 0, findings: 2 });
  });

  it("[case 2] some chunks fail on a FIRST read (nothing prior to protect): the partial set is published and failedParts reports it", async () => {
    await modelAnswers([NEW_1], new Error("simulated model failure on the second chunk"));
    const result = await extract();
    expect(result).toMatchObject({ failedParts: 1, totalParts: 2, published: true });
    expect(newRows().map((r) => r.finding_text)).toEqual([NEW_1.finding_text]);
  });

  it("[case 3] all chunks fail: throws with the multi-part message", async () => {
    await modelAnswers(new Error("simulated total model failure"), new Error("simulated total model failure"));
    await expect(extract()).rejects.toThrow(
      /Extraction failed on every part of "report\.txt" \(2 parts\)\. First error: simulated total model failure/,
    );
  });

  it("[baseline] a single-chunk document's lone failure still throws with that chunk's own message", async () => {
    storageBuffer = Buffer.from("A short report describing a single finding about the surveyed population and its context.", "utf-8");
    await modelAnswers(new Error("simulated single-chunk failure"), new Error("unused"));
    await expect(extract()).rejects.toThrow("simulated single-chunk failure");
  });

  it("[support links] a new stated insight's cited support resolves to the published id of a finding in the same chunk", async () => {
    await modelAnswers(
      [NEW_1, f("Satisfaction drives loyalty.", "A stated insight quote.", { finding_kind: "stated_insight", supporting_indices: [0] })],
      [NEW_2],
    );
    expect((await extract()).published).toBe(true);
    const fact = newRows().find((r) => r.finding_text === NEW_1.finding_text)!;
    const insight = newRows().find((r) => r.finding_kind === "stated_insight")!;
    expect(insight.cited_support_finding_ids).toEqual([fact.id]);
  });
});

describe("REP-IN-002 replacement preservation (migration applied, tracked rows)", () => {
  beforeEach(() => {
    db = createFakeFindingsDb(priorState("tracked"));
  });

  it("partial reread with prior findings: nothing is retired or inserted; ids, wording, review states, notes and dependents are unchanged", async () => {
    const before = authoritativeSnapshot();
    await modelAnswers([NEW_1], new Error("simulated model failure on the second chunk"));
    const result = await extract();
    expect(result).toMatchObject({ failedParts: 1, totalParts: 2, published: false, rows: [], legacyConfirmation: null });
    expect(result.notPublishedReason).toMatch(/1 of 2 parts of "report\.txt" could not be read/);
    expect(result.notPublishedReason).toMatch(/previous 4 findings are unchanged\. Retry extraction for this document/);
    expect(authoritativeSnapshot()).toEqual(before);
    expect(withheld("partial_read")[0]?.detail).toMatchObject({ retainedFindings: 4 });
  });

  it("total failure with prior findings: throws, and the prior state is untouched", async () => {
    const before = authoritativeSnapshot();
    await modelAnswers(new Error("down"), new Error("down"));
    await expect(extract()).rejects.toThrow(/Extraction failed on every part/);
    expect(authoritativeSnapshot()).toEqual(before);
  });

  it("complete replacement: retires only the untouched tracked finding; noted, rejected and dependent findings keep ids, content and links", async () => {
    const keptBefore = pick(["prior-B", "prior-C", "prior-D", "prior-E"]);
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract();
    expect(result).toMatchObject({ failedParts: 0, published: true, notPublishedReason: null });
    expect(live("prior-A")).toBeUndefined();
    expect(db.state.finding_history.map((h) => h.original_finding_id)).toEqual(["prior-A"]);
    expect(db.state.finding_history[0]).toMatchObject({ archived_reason: "manual_reextract", provenance_tracked: true, human_reviewed_at: null });
    expect(pick(["prior-B", "prior-C", "prior-D", "prior-E"])).toEqual(keptBefore);
    expect(db.state.verdicts).toEqual([{ id: "verdict-D", finding_id: "prior-D", verdict_tier: "robust" }]);
    expect(db.state.insights).toEqual([{ id: "insight-D", finding_id: "prior-D", headline: "Insight on D" }]);
    expect(db.state.recommendations).toEqual([{ id: "rec-D", insight_id: "insight-D", action_text: "Act on D" }]);
    expect(live("prior-E")!.grounded_by_finding_id).toBe("prior-D");
    // NEW_1 shares B's quote but is a different claim, so it is inserted beside B.
    expect(newRows().map((r) => r.finding_text)).toEqual([NEW_1.finding_text, NEW_2.finding_text]);
  });

  it("publication fails at retirement: rolls back to the prior state with a retry message; the retry publishes once with no duplicates", async () => {
    const before = authoritativeSnapshot();
    db.failOn(/^insert into finding_history/);
    await modelAnswers([NEW_1], [NEW_2]);
    const failed = await extract();
    expect(failed).toMatchObject({ published: false, rows: [], legacyConfirmation: null });
    expect(failed.notPublishedReason).toMatch(/could not be saved \(injected failure.*\), so nothing was replaced and its previous findings are unchanged\. Retry extraction/);
    expect(authoritativeSnapshot()).toEqual(before);
    db.clearFaults();
    expect((await extract()).published).toBe(true);
    expect(liveIds()).toEqual(["new-1", "new-2", "prior-B", "prior-C", "prior-D"]);
    expect(db.state.finding_history.map((h) => h.original_finding_id)).toEqual(["prior-A"]);
  });

  it("publication fails after a new row was inserted in the same transaction: the insert and the retirement both roll back", async () => {
    const before = authoritativeSnapshot();
    db.failOn(/^insert into findings/, 2);
    await modelAnswers([NEW_1], [NEW_2]);
    expect((await extract()).published).toBe(false);
    expect(db.executed.some((sql) => sql.startsWith("delete from findings"))).toBe(true);
    expect(authoritativeSnapshot()).toEqual(before);
  });

  it("partial reread, then complete retries: each publishes exactly one replacement set and never duplicates", async () => {
    await modelAnswers([NEW_1], new Error("simulated model failure on the second chunk"));
    expect((await extract()).published).toBe(false);
    await modelAnswers([NEW_1], [NEW_2]);
    expect((await extract()).published).toBe(true);
    expect(liveIds()).toEqual(["new-1", "new-2", "prior-B", "prior-C", "prior-D"]);
    // The previous replacement's rows are automatic, tracked and unreviewed, so a further complete
    // re-read replaces them rather than adding a second copy.
    await modelAnswers([NEW_1], [NEW_2]);
    expect((await extract()).published).toBe(true);
    expect(liveIds()).toEqual(["new-3", "new-4", "prior-B", "prior-C", "prior-D"]);
    expect(liveForDoc().filter((r) => r.finding_text === NEW_2.finding_text)).toHaveLength(1);
  });

  it("regenerate-rejected (onlyReplacePending): retires only the rejected finding and keeps every accepted one", async () => {
    await modelAnswers([NEW_1], [NEW_2]);
    expect((await extract({ onlyReplacePending: true })).published).toBe(true);
    expect(db.state.finding_history.map((h) => h.original_finding_id)).toEqual(["prior-C"]);
    expect(liveIds()).toEqual(["new-1", "new-2", "prior-A", "prior-B", "prior-D"]);
  });

  it("regenerate-rejected with a partial read while a rejected finding exists: withheld, nothing changes", async () => {
    const before = authoritativeSnapshot();
    await modelAnswers([NEW_1], new Error("simulated model failure on the second chunk"));
    expect((await extract({ onlyReplacePending: true })).published).toBe(false);
    expect(authoritativeSnapshot()).toEqual(before);
  });

  it("a document removed from the run before publication: not published, nothing written", async () => {
    await modelAnswers([NEW_1], [NEW_2]);
    const original = db.connect;
    db.connect = () => {
      const c = original();
      return {
        ...c,
        query: async (sql: string, params?: unknown[]) =>
          /^select id from documents where id = \$1 and run_id = \$2 for update/i.test(sql.trim()) ? { rows: [] } : c.query(sql, params),
      };
    };
    const before = authoritativeSnapshot();
    const result = await extract();
    expect(result.published).toBe(false);
    expect(result.notPublishedReason).toMatch(/document no longer exists in this run/);
    expect(authoritativeSnapshot()).toEqual(before);
  });
});

describe("REP-IN-002 researcher actions are recorded and protect findings (real findingActions)", () => {
  // Five tracked, untouched, accepted findings with no note and no insight: exactly the case the
  // previous rule retired.
  beforeEach(() => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: ["theme", "kind", "accept", "bulk", "noteCleared", "control"].map((k) =>
        finding("tracked", `f-${k}`, "accepted", `Quote for ${k}.`, { finding_text: `Claim ${k}` }),
      ),
    });
  });

  it("theme edit, kind edit, explicit acceptance, bulk acceptance and a cleared note each survive a complete reread with id and human change intact", async () => {
    const a = await actions();
    await a.setFindingTheme(RUN, "f-theme", "Researcher theme");
    await a.setFindingKind(RUN, "f-kind", "own_finding");
    await a.setFindingStatus(RUN, "f-accept", "accepted");
    await a.setManyFindingStatuses(RUN, ["f-bulk"], "accepted");
    await a.setFindingNote(RUN, "f-noteCleared", "temporary");
    await a.setFindingNote(RUN, "f-noteCleared", "   ");

    // Review and edit stay separate: acceptance records no edit, an edit records no review.
    expect(live("f-accept")).toMatchObject({ human_review_action: "accept", human_edited_fields: [] });
    expect(live("f-bulk")).toMatchObject({ human_review_action: "bulk_accept", human_edited_fields: [] });
    expect(live("f-theme")).toMatchObject({ theme: "Researcher theme", human_reviewed_at: null, human_edited_fields: ["theme"] });
    expect(live("f-kind")).toMatchObject({ finding_kind: "own_finding", human_reviewed_at: null, human_edited_fields: ["finding_kind"] });
    expect(live("f-noteCleared")).toMatchObject({ researcher_note: null, human_edited_fields: ["researcher_note"] });
    const humanBefore = pick(["f-theme", "f-kind", "f-accept", "f-bulk", "f-noteCleared"]);

    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract();

    expect(result.published).toBe(true);
    expect(pick(["f-theme", "f-kind", "f-accept", "f-bulk", "f-noteCleared"])).toEqual(humanBefore);
    expect(live("f-control")).toBeUndefined();
    expect(db.state.finding_history).toEqual([
      expect.objectContaining({ original_finding_id: "f-control", provenance_tracked: true, human_reviewed_at: null, human_edited_fields: [] }),
    ]);
  });

  it("a finding cited as support by a protected finding is kept too, so the protected link never points at a retired row", async () => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: [
        finding("tracked", "f-support", "accepted", "Support quote.", { finding_text: "Supporting fact" }),
        finding("tracked", "f-insight", "accepted", "Insight quote.", { finding_kind: "stated_insight", cited_support_finding_ids: ["f-support"] }),
      ],
    });
    await (await actions()).setFindingStatus(RUN, "f-insight", "accepted");
    await modelAnswers([NEW_1], [NEW_2]);
    expect((await extract()).published).toBe(true);
    expect(live("f-insight")!.cited_support_finding_ids).toEqual(["f-support"]);
    expect(live("f-support")).toBeDefined();
    expect(db.state.finding_history).toHaveLength(0);
  });

  it("automatic inserts are tracked but never marked as reviewed, so a later complete reread may replace them", async () => {
    db = createFakeFindingsDb({ documents: [DOCUMENT_ROW] });
    await modelAnswers([NEW_1], [NEW_2]);
    await extract();
    expect(newRows().map((r) => [r.provenance_tracked, r.human_reviewed_at, r.human_edited_fields])).toEqual([
      [true, null, []],
      [true, null, []],
    ]);
    expect(db.executed.filter((sql) => sql.startsWith("insert into findings")).every((sql) => !sql.includes("human_review"))).toBe(true);
    await modelAnswers([NEW_1], [NEW_2]);
    await extract();
    expect(liveIds()).toEqual(["new-3", "new-4"]);
  });

  it("a dashboard remove records an explicit tool_remove review", async () => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: [finding("tracked", "f-driver", "accepted", "", { pattern_type: "driver", stated_stats: { analysisId: "an-1" } })],
    });
    const { removeDriverFindings } = await import("../drivers");
    expect(await removeDriverFindings(TENANT, RUN, "an-1")).toBe(1);
    expect(live("f-driver")).toMatchObject({ status: "rejected", human_review_action: "tool_remove" });
  });
});

describe("REP-IN-002 claim-aware duplicate handling", () => {
  const SHARED = "Satisfaction is 80% and loyalty is 40%.";

  it('"Satisfaction is 80%" and "Loyalty is 40%" from one quote are both retained; the genuine duplicate adds no copy', async () => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: [finding("tracked", "f-sat", "accepted", SHARED, { finding_text: "Satisfaction is 80%." })],
    });
    await (await actions()).setFindingStatus(RUN, "f-sat", "accepted");
    await modelAnswers([f("  satisfaction IS 80%  ", SHARED), f("Loyalty is 40%.", SHARED)], []);
    const result = await extract();
    expect(result.published).toBe(true);
    expect(liveForDoc().map((r) => [r.id, r.finding_text])).toEqual([
      ["f-sat", "Satisfaction is 80%."],
      ["new-1", "Loyalty is 40%."],
    ]);
    expect(db.state.trace.find((e) => e.event === "extract_findings_replacement_published")?.detail).toMatchObject({ inserted: 1, duplicatesResolved: 1 });
  });

  it("the same claim from a different page is not treated as a duplicate (conservative: retained)", async () => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: [finding("tracked", "f-sat", "accepted", SHARED, { finding_text: "Satisfaction is 80%.", source_page: 3, human_reviewed_at: "t0", human_review_action: "accept" })],
    });
    await modelAnswers([f("Satisfaction is 80%.", SHARED)], []);
    await extract();
    expect(liveForDoc()).toHaveLength(2);
  });

  it("support links to a genuine duplicate resolve to the retained id, and a duplicate stated insight's own links are added to the retained one", async () => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: [
        finding("tracked", "f-sat", "accepted", SHARED, { finding_text: "Satisfaction is 80%." }),
        finding("tracked", "f-old-insight", "accepted", "Insight passage.", {
          finding_text: "Satisfied customers stay.",
          finding_kind: "stated_insight",
          cited_support_finding_ids: ["f-sat"],
        }),
      ],
    });
    const a = await actions();
    await a.setFindingStatus(RUN, "f-sat", "accepted");
    await a.setFindingStatus(RUN, "f-old-insight", "accepted");
    await modelAnswers(
      [
        f("Satisfaction is 80%", SHARED), // 0: duplicate of f-sat
        f("Loyalty is 40%", SHARED), // 1: new
        f("Satisfied customers stay", "Insight passage.", { finding_kind: "stated_insight", supporting_indices: [0, 1] }), // 2: duplicate of f-old-insight
        f("Loyal customers are satisfied.", "New insight passage.", { finding_kind: "stated_insight", supporting_indices: [0] }), // 3: new
      ],
      [],
    );
    expect((await extract()).published).toBe(true);
    const loyalty = liveForDoc().find((r) => r.finding_text === "Loyalty is 40%")!;
    const newInsight = liveForDoc().find((r) => r.finding_text === "Loyal customers are satisfied.")!;
    expect(newInsight.cited_support_finding_ids).toEqual(["f-sat"]);
    expect(live("f-old-insight")!.cited_support_finding_ids).toEqual(["f-sat", loyalty.id]);
    expect(newRows()).toHaveLength(2);
  });

  it("repeated duplicates of one retained insight accumulate one support union (Old + A + B), within and across chunks, stable on republication", async () => {
    db = createFakeFindingsDb({
      documents: [DOCUMENT_ROW],
      findings: [
        finding("tracked", "f-old", "accepted", "Old passage.", { finding_text: "Old support" }),
        finding("tracked", "f-I", "accepted", "Insight passage.", {
          finding_text: "Satisfied customers stay.",
          finding_kind: "stated_insight",
          cited_support_finding_ids: ["f-old"],
        }),
      ],
    });
    await (await actions()).setFindingStatus(RUN, "f-I", "accepted");
    const insightDup = (supporting_indices: number[]) =>
      f("Satisfied customers stay", "Insight passage.", { finding_kind: "stated_insight", supporting_indices });
    const answers = async () =>
      modelAnswers(
        // Chunk 1: A, then two duplicates of I. The first adds A; the second repeats A, cites the
        // other duplicate of I (a self-link once resolved) and must not drop A.
        [f("Support A", "Passage A."), insightDup([0]), insightDup([0, 1])],
        // Chunk 2: B, then another duplicate of I that adds B.
        [f("Support B", "Passage B."), insightDup([0])],
      );

    await answers();
    expect((await extract()).published).toBe(true);
    const a = liveForDoc().find((r) => r.finding_text === "Support A")!;
    const b = liveForDoc().find((r) => r.finding_text === "Support B")!;
    expect(liveForDoc().filter((r) => r.finding_kind === "stated_insight").map((r) => r.id)).toEqual(["f-I"]);
    expect(live("f-I")!.cited_support_finding_ids).toEqual(["f-old", a.id, b.id]);
    expect(liveIds()).toEqual(["f-I", "f-old", a.id as string, b.id as string].sort());

    // Republishing the same reading: I, Old, A and B are all kept (I is reviewed; Old, A and B are
    // its cited support), the duplicates resolve to them, and the union is unchanged.
    const before = authoritativeSnapshot();
    await answers();
    expect((await extract()).published).toBe(true);
    expect(live("f-I")!.cited_support_finding_ids).toEqual(["f-old", a.id, b.id]);
    expect(authoritativeSnapshot()).toEqual(before);
  });

  it("claimIdentityKey folds case, whitespace and trailing punctuation only", async () => {
    const { claimIdentityKey } = await import("../extractFindings");
    expect(claimIdentityKey("Satisfaction is 80%.", SHARED, null)).toBe(claimIdentityKey(" satisfaction  IS 80% ", ` ${SHARED.toUpperCase()} `, null));
    expect(claimIdentityKey("Satisfaction is 80%", SHARED, null)).not.toBe(claimIdentityKey("Loyalty is 40%", SHARED, null));
    expect(claimIdentityKey("Satisfaction is 80%", SHARED, null)).not.toBe(claimIdentityKey("Satisfaction is 81%", SHARED, null));
    expect(claimIdentityKey("Satisfaction is 80%", SHARED, 1)).not.toBe(claimIdentityKey("Satisfaction is 80%", SHARED, null));
  });
});

describe("REP-IN-002 legacy rows with unknown provenance (migration applied)", () => {
  beforeEach(() => {
    db = createFakeFindingsDb({
      ...priorState("legacy"),
      findings: [
        ...priorState("legacy").findings,
        finding("legacy", "prior-F", "accepted", "Old quote F."),
        finding("tracked", "prior-G", "accepted", "Old quote G."),
      ],
    });
  });

  it("are kept by default: the replacement is withheld and the confirmation names exactly the unprotected unknown rows on this document", async () => {
    const before = authoritativeSnapshot();
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract();
    expect(result.published).toBe(false);
    expect(result.legacyConfirmation).toEqual({ documentId: DOC, findingIds: ["prior-A", "prior-F"] });
    expect(result.notPublishedReason).toMatch(/2 findings on "report\.txt" predate review tracking/);
    expect(authoritativeSnapshot()).toEqual(before);
    expect(withheld("legacy_unconfirmed")[0]?.detail).toMatchObject({ legacyFindingIds: ["prior-A", "prior-F"] });
  });

  it("a partial confirmation is not enough: the rest stay protected and the replacement is withheld again", async () => {
    const before = authoritativeSnapshot();
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract({ confirmLegacyReplacement: { findingIds: ["prior-A"] } });
    expect(result.published).toBe(false);
    expect(result.legacyConfirmation?.findingIds).toEqual(["prior-F"]);
    expect(authoritativeSnapshot()).toEqual(before);
  });

  it("a full confirmation retires exactly the confirmed rows; it cannot retire protected work or another document's findings", async () => {
    const protectedBefore = pick(["prior-B", "prior-C", "prior-D", "prior-E"]);
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract({
      confirmLegacyReplacement: { findingIds: ["prior-A", "prior-F", "prior-B", "prior-C", "prior-D", "prior-E"] },
    });
    expect(result.published).toBe(true);
    expect(db.state.finding_history.map((h) => h.original_finding_id).sort()).toEqual(["prior-A", "prior-F", "prior-G"]);
    expect(db.state.finding_history.find((h) => h.original_finding_id === "prior-A")).toMatchObject({ provenance_tracked: false });
    expect(pick(["prior-B", "prior-C", "prior-D", "prior-E"])).toEqual(protectedBefore);
    expect(db.state.insights).toHaveLength(1);
  });

  it("a researcher action taken after the migration removes a row from the unknown set", async () => {
    await (await actions()).setFindingTheme(RUN, "prior-F", "Reviewed now");
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract();
    expect(result.legacyConfirmation?.findingIds).toEqual(["prior-A"]);
  });
});

describe("REP-IN-002 before migration 0094 (provenance cannot be recorded)", () => {
  beforeEach(() => {
    db = createFakeFindingsDb(priorState("none"), { provenance: false });
  });

  it("researcher actions still save without touching the missing columns", async () => {
    const a = await actions();
    await a.setFindingStatus(RUN, "prior-A", "accepted");
    await a.setFindingTheme(RUN, "prior-A", "Researcher theme");
    expect(live("prior-A")).toMatchObject({ status: "accepted", theme: "Researcher theme" });
    expect(live("prior-A")).not.toHaveProperty("human_reviewed_at");
  });

  it("a reviewed finding is not made eligible for retirement: replacement is blocked visibly and offers no confirmation", async () => {
    await (await actions()).setFindingStatus(RUN, "prior-A", "accepted");
    const before = authoritativeSnapshot();
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract();
    expect(result).toMatchObject({ published: false, legacyConfirmation: null });
    expect(result.notPublishedReason).toMatch(/blocked until database migration 0094_finding_review_provenance is applied/);
    expect(authoritativeSnapshot()).toEqual(before);
    expect(withheld("provenance_unavailable")[0]?.detail).toMatchObject({ blockedFindings: 1 });
  });

  it("a confirmation is not honoured before the migration", async () => {
    const before = authoritativeSnapshot();
    await modelAnswers([NEW_1], [NEW_2]);
    const result = await extract({ confirmLegacyReplacement: { findingIds: ["prior-A"] } });
    expect(result.published).toBe(false);
    expect(authoritativeSnapshot()).toEqual(before);
  });

  it("a first read and a partial-read withhold behave as before", async () => {
    db = createFakeFindingsDb({ documents: [DOCUMENT_ROW] }, { provenance: false });
    await modelAnswers([NEW_1], [NEW_2]);
    expect((await extract()).published).toBe(true);
    await modelAnswers([NEW_1], new Error("part 2 failed"));
    const partial = await extract();
    expect(partial).toMatchObject({ published: false, failedParts: 1 });
    expect(newRows()).toHaveLength(2);
  });
});

describe("planReplacement (the protection rule, pure)", () => {
  it("protects review, edit, non-default status, a non-blank note, an insight and cited support; withholds unknown rows unless confirmed", async () => {
    const { planReplacement } = await import("../extractFindings");
    const row = (id: string, extra: Partial<Record<string, unknown>> = {}) => ({
      id,
      status: "accepted",
      researcher_note: null,
      source_quote: id,
      source_page: null,
      finding_text: id,
      cited_support_finding_ids: [],
      human_reviewed_at: null,
      human_edited_fields: [] as string[],
      provenance_tracked: true,
      ...extra,
    });
    const plan = planReplacement(
      [
        row("plain"),
        row("blank", { researcher_note: "   " }),
        row("reviewed", { human_reviewed_at: "t", cited_support_finding_ids: ["cited"] }),
        row("cited"),
        row("edited", { human_edited_fields: ["theme"] }),
        row("rej", { status: "rejected" }),
        row("dep"),
        row("legacy", { provenance_tracked: false }),
        row("legacyOk", { provenance_tracked: false }),
      ],
      new Set(["dep"]),
      false,
      new Set(["legacyOk", "reviewed"]),
    );
    expect(plan.retireIds).toEqual(["plain", "blank", "legacyOk"]);
    expect(plan.legacyUnconfirmedIds).toEqual(["legacy"]);
    expect(plan.keep.map((k) => k.id)).toEqual(["reviewed", "cited", "edited", "rej", "dep", "legacy"]);
  });
});

// Case 4's caller-level half (page.tsx persisting status / surfacing the message, and the legacy
// confirmation prompt) remains source-inspected, not executed here.
it.skip("[PLANNED INTEGRATION, case 4] processing_status write failure and the legacy prompt through page.tsx", () => {});
