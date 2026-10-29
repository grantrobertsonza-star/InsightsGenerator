// L4 real reports: the actual extractDocumentText (LibreOffice + unpdf; storage replaced by the local
// file) on the FinScope 2025 databook (three-slide subset, see real_prep.py), the QMDA Tesla deck and
// the BRC/Ask Africa webinar PDF, against readings made without the app (real_expected.json: python-pptx
// reads of the native tables and chart series, and hand readings of rendered pages).
// Results: conformance/l4/out/real.results.json.
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { L4, ResultLog } from "./l4lib";

vi.hoisted(() => {
  process.env.LIBREOFFICE_PATH = process.env.LIBREOFFICE_PATH || "/usr/bin/soffice";
});
vi.mock("../../../src/lib/anthropic", () => ({ CLAUDE_MODEL: "none", anthropic: { messages: { create: vi.fn(async () => { throw new Error("no model call expected"); }) } } }));
vi.mock("../../../src/lib/db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn(), pool: {} }));
const files = vi.hoisted(() => ({ map: new Map<string, string>() }));
vi.mock("../../../src/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => {
          const { readFileSync: rf } = await import("node:fs");
          return files.map.has(key) ? { data: new Blob([new Uint8Array(rf(files.map.get(key)!))]), error: null } : { data: null, error: { message: "not found" } };
        },
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 600_000 });
const log = new ResultLog("real");
afterAll(() => log.write());
const EXP = JSON.parse(readFileSync(path.join(L4, "real_expected.json"), "utf8")).files;
const add = (caseId: string, check: string, expected: unknown, actual: unknown, pass: boolean, severity?: "S1" | "S2" | "S3", note?: string) => {
  log.add({ case: caseId, check, basis: "research", expected, actual, pass, severity, note });
  expect.soft(pass, `${caseId} ${check}`).toBe(true);
};

async function pages(file: string) {
  const { extractDocumentText } = await import("../../../src/lib/extractFindings");
  const key = `real/${path.basename(file)}`;
  files.map.set(key, file);
  const t0 = Date.now();
  const out = await extractDocumentText(key, path.basename(file), "doc");
  return { pages: out.pages, ms: Date.now() - t0 };
}
const fmtNumber = (v: number) => [String(v), Math.round(v).toLocaleString("en-US"), `${Math.round(v * 100)}%`];

/** Rows of a native table checked against a page: every cell present, and the row as one quote. */
async function tableRows(caseId: string, table: string[][], text: string) {
  const { quoteAppearsIn } = await import("../../../src/lib/quoteMatch");
  const body = table.filter((r) => r.slice(1).some((c) => /\d/.test(c)));
  const cellsMissing = body.flatMap((r) => r.filter((c) => c && !text.replace(/\s+/g, " ").includes(c.replace(/\s+/g, " "))));
  const quotes = body.map((r) => r.filter(Boolean).join(" "));
  const verified = quotes.filter((q) => quoteAppearsIn(q, text));
  add(caseId, "cells_present", `${body.length} data rows, every cell in the page text`, { missing: cellsMissing.slice(0, 8), missingCount: cellsMissing.length }, cellsMissing.length === 0, "S2");
  add(caseId, "row_quotes_verifiable", quotes.length, { verified: verified.length, firstUnverified: quotes.filter((q) => !verified.includes(q)).slice(0, 3) }, verified.length === quotes.length, "S3",
    "A report claim quoting a table row as it reads (label and values) is checked with quoteAppearsIn.");
}

describe("L4 real reports (deterministic page text)", () => {
  it("R-DB FinScope 2025 databook, slides 10, 15, 60", async () => {
    const db = EXP.databook;
    const file = path.join(L4, db.file);
    if (!existsSync(file)) throw new Error("run conformance/l4/real_prep.py first");
    const { pages: p, ms } = await pages(file);
    log.extra["R-DB.ms"] = ms;
    log.extra["R-DB.pages"] = p.map((x) => x.text.replace(/\s+/g, " ").slice(0, 600));
    add("R-DB", "page_count", 3, p.length, p.length === 3, "S2");
    for (const [n, pg] of Object.entries(db.pages) as [string, { native_tables: string[][][]; charts: { categories: string[]; series: { name: string; values: number[] }[] }[] }][]) {
      const text = p[Number(n) - 1]?.text ?? "";
      for (const [ti, t] of pg.native_tables.entries()) await tableRows(`R-DB-p${n}-t${ti + 1}`, t, text);
      for (const [ci, ch] of pg.charts.entries()) {
        const vals = ch.series.flatMap((s) => s.values.filter((v) => v !== null).map((v) => ({ s: s.name, v })));
        const present = vals.filter(({ v }) => fmtNumber(v).some((f) => text.includes(f)));
        add(`R-DB-p${n}-c${ci + 1}`, "chart_values_in_text", `${vals.length} values in ${ch.series.length} series`, { present: present.length, series: ch.series.map((s) => s.name) },
          present.length === vals.length, "S2", "Chart series are in the file; only drawn data labels reach the text, and nothing links a label to its series.");
      }
    }
    // The 2025 column header of slide 60 reads "2024 (n=5600)" in the source (two columns named 2024).
    const t60 = db.pages["3"].native_tables[0][0] as string[];
    log.extra["R-DB.slide60.headers"] = t60;
  });

  it("R-TES QMDA Tesla deck, slides 13, 16, 18", async () => {
    const t = EXP.tesla;
    const { pages: p, ms } = await pages(t.file);
    log.extra["R-TES.ms"] = ms;
    add("R-TES", "page_count", 34, p.length, p.length === 34, "S2");
    for (const [n, pg] of Object.entries(t.pages) as [string, { native_tables: string[][][]; charts: { categories: string[]; series: { name: string; values: number[] }[] }[] }][]) {
      const text = p[Number(n) - 1]?.text ?? "";
      for (const [ti, tb] of pg.native_tables.entries()) {
        const cells = tb.flat().filter(Boolean);
        const missing = cells.filter((c) => !text.replace(/\s+/g, " ").includes(c.replace(/\s+/g, " ")));
        add(`R-TES-s${n}-t${ti + 1}`, "cells_present", cells.length, { missing: missing.slice(0, 5), missingCount: missing.length }, missing.length === 0, "S2");
      }
      if (pg.charts.length) {
        const vals = pg.charts.flatMap((ch) => ch.series.flatMap((s) => s.values.filter((v) => v !== null && v > 0)));
        const present = vals.filter((v) => fmtNumber(v).some((f) => text.includes(f)));
        add(`R-TES-s${n}`, "chart_values_in_text", `${vals.length} non-zero values in ${pg.charts.length} charts`, { present: present.length }, present.length === vals.length, "S2");
      }
    }
    const s13 = p[12]?.text ?? "";
    const hand = t.hand["13"].values as Record<string, string>;
    const found = Object.entries(hand).filter(([, v]) => s13.includes(v));
    add("R-TES-s13", "hand_chart_values_in_text", hand, Object.fromEntries(found), found.length === Object.keys(hand).length, "S2");
    add("R-TES-s13", "claim_derivation_checkable", "'33% would buy' traceable to Likely 23% + Very likely 10%", "no table holds the chart's data, so the claim cannot be checked against it", false, "S2",
      "Gap: a claim drawn from a chart on the same slide has no table to be checked against (path C stores no tables).");
  });

  it("R-BRC Ask Africa webinar PDF, page 17 (two side-by-side tables)", async () => {
    const { quoteAppearsIn } = await import("../../../src/lib/quoteMatch");
    const b = EXP.brc;
    const { pages: p, ms } = await pages(b.file);
    log.extra["R-BRC.ms"] = ms;
    add("R-BRC", "page_count", 38, p.length, p.length === 38, "S2");
    const text = p[16]?.text ?? "";
    log.extra["R-BRC.p17"] = text.replace(/\s+/g, " ").slice(0, 1500);
    for (const [ti, tb] of (b.hand["17"].tables as { title: string; rows: string[][] }[]).entries()) {
      const present = tb.rows.filter(([l, v]) => text.includes(l) && text.includes(v));
      add(`R-BRC-p17-t${ti + 1}`, "cells_present", tb.rows.length, present.length, present.length === tb.rows.length, "S2");
      const verified = tb.rows.filter(([l, v]) => quoteAppearsIn(`${l} ${v}`, text));
      add(`R-BRC-p17-t${ti + 1}`, "row_quotes_verifiable", tb.rows.length, { verified: verified.length, unverified: tb.rows.filter((r) => !verified.includes(r)).map((r) => r.join(" ")) },
        verified.length === tb.rows.length, "S3");
    }
  });
});
