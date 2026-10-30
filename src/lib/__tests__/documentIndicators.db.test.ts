// Document size indicators on the Import screen (Grant 2026-10-19: pages and words for proposals and
// reports). The rules (documentIndicators.ts) directly, and the actual action against a real
// database, with storage (the external boundary) serving a real PDF built here, so the page count
// comes from pdf.js reading actual bytes rather than a stub.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { countWords, reviewCoverage, reviewCoverageText } from "../documentIndicators";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

/** A minimal valid PDF with `pages` empty pages and a correct cross-reference table. */
function pdfWithPages(pages: number): Uint8Array {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const storage = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), downloads: [] as string[], fail: false }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (path: string) => {
          storage.downloads.push(path);
          const bytes = storage.files.get(path);
          if (storage.fail || !bytes) return { data: null, error: { message: storage.fail ? "storage unavailable" : "Object not found" } };
          return { data: new Blob([bytes as BlobPart]), error: null };
        },
      }),
    },
  },
}));

describe("document indicator rules", () => {
  it("counts words on whitespace, and empty text as zero", () => {
    expect(countWords("  The research   brief\n\nfor Q3.\t")).toBe(5);
    expect(countWords("   ")).toBe(0);
  });
  it("a review reads a document of exactly the limit in full; one character more is partial, rounded down", () => {
    expect(reviewCoverage(150_000)).toEqual({ kind: "whole", chars: 150_000, limit: 150_000 });
    expect(reviewCoverage(150_001)).toEqual({ kind: "partial", chars: 150_001, limit: 150_000, assessedPct: 99 });
    expect(reviewCoverage(300_000).kind === "partial" && reviewCoverage(300_000)).toMatchObject({ assessedPct: 50 });
    expect(reviewCoverageText(reviewCoverage(300_000))).toBe(
      "Longer than a quality review reads: about the first 50% (150,000 of 300,000 characters) is assessed, and the rest is recorded as not assessed.",
    );
  });
});

describe.skipIf(!TEST_DATABASE_URL)("document indicators action (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string;
  const doc = async (r: string, kind: string, name: string, preview: string | null, text: string | null) =>
    (
      await db.pool.query(
        "insert into documents(tenant_id,run_id,kind,source_filename,storage_path,preview_storage_path,extracted_text) values($1,$2,$3,$4,$5,$6,$7) returning id",
        [tenant, r, kind, name, `${tenant}/${r}/${name}`, preview, text],
      )
    ).rows[0].id as string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic indicators')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    storage.files.clear();
    storage.downloads.length = 0;
    storage.fail = false;
  });
  const indicators = async (runId: string, documentId: string) => (await import("../documentIndicatorActions")).documentIndicatorsAction(runId, documentId);

  it("a Word proposal: pages from its PDF copy, words from its text, and how much a quality review reads", async () => {
    storage.files.set("copies/proposal.docx.preview.pdf", pdfWithPages(7));
    const id = await doc(run, "evidence", "proposal.docx", "copies/proposal.docx.preview.pdf", "We propose a mixed-method study of mobile money users.");
    expect(await indicators(run, id)).toEqual({
      ok: true,
      indicators: { words: 9, chars: 54, pages: { count: 7 }, coverage: { kind: "whole", chars: 54, limit: 150_000 } },
    });
    // Selected again: counted from memory, not downloaded twice.
    await indicators(run, id);
    expect(storage.downloads).toEqual(["copies/proposal.docx.preview.pdf"]);
  });

  it("a long brief is flagged as partly reviewed; a report has no review line", async () => {
    const long = await doc(run, "evidence", "long-brief.txt", null, "word ".repeat(60_000));
    expect(await indicators(run, long)).toMatchObject({ ok: true, indicators: { words: 60_000, coverage: { kind: "partial", assessedPct: 50 } } });
    storage.files.set(`${tenant}/${run}/report.pdf`, pdfWithPages(3));
    const report = await doc(run, "report", "report.pdf", null, "Findings.");
    expect(await indicators(run, report)).toEqual({ ok: true, indicators: { words: 1, chars: 9, pages: { count: 3 }, coverage: null } });
  });

  it("unknown is said as unknown: text not read, no PDF copy, and a failed download each give a reason, never zero", async () => {
    const unread = await doc(run, "report", "deck.pptx", null, null);
    expect(await indicators(run, unread)).toEqual({
      ok: true,
      indicators: { words: null, chars: null, pages: { count: null, reason: "not counted until the file has been read" }, coverage: null },
    });
    const plain = await doc(run, "evidence", "brief.txt", null, "Short brief.");
    expect((await indicators(run, plain)).ok && (await indicators(run, plain))).toMatchObject({ indicators: { pages: { count: null, reason: "no PDF copy of this file to count pages from" } } });
    storage.fail = true;
    const missing = await doc(run, "evidence", "gone.docx", "copies/gone.docx.preview.pdf", "Text.");
    expect(await indicators(run, missing)).toMatchObject({ ok: true, indicators: { words: 1, pages: { count: null, reason: "the PDF could not be downloaded (storage unavailable)" } } });
  });

  it("a file from another project reveals nothing", async () => {
    const elsewhere = await doc(other, "evidence", "other.docx", null, "Secret.");
    expect(await indicators(run, elsewhere)).toEqual({ ok: false, error: "That file is not in this project." });
    expect(storage.downloads).toEqual([]);
  });
});
