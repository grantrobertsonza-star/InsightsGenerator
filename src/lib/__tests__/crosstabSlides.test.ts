import { PYTHON } from "./helpers/pythonEngine";
// Golden-thread GT-005 (Codex, 2026-10-17): the crosstab export's pptx (and the pdf made from it)
// first laid the table out wider than the slide, clipping Total. The first repair (ffa7adc) fitted
// the width but estimated height from an average character width, so long or wide-glyph answers
// and long banner headings still ran past the bottom and over the footer, and the PDF lost answers
// (Codex review: 7 of 30 answers missing; a 2,821-character answer and 382-character banner
// headings also lost text). Checks, on the deck built by the export's own addCrosstabSlides:
//   1. the golden two-column table (actual Python engine): inside the slide, Total on every slide,
//      the independent reference figures (Purchase: 200 base, 50% / 50% total) in the table;
//   2. a 25-column banner: column groups that fit, each column once, answer/Total/base each slide;
//   3. complete content in the plan for every shape: each line's parts, joined, are its label
//      exactly, in order, figures on the first part only; every page's estimated height fits;
//   4. rendered with LibreOffice (when installed), for the golden table and the reviewer's shapes
//      built by the actual engine (30 answers of 228 characters of capital W; one 2,821-character
//      answer; 12 banner headings of 382 characters): every word inside the page, no table word
//      below the table area or over the footer, every answer part and every banner heading in the
//      PDF text, and every END_nn sentinel present.
// Skipped parts say why (no python engine, no LibreOffice/pdftotext).
import { describe, expect, it } from "vitest";
import { SOFFICE, officeConvert } from "./helpers/officeRender";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import {
  addCrosstabSlides, planCrosstabSlides, planTitle, crosstabLines, rowHeight, lineHeightOf, shownLabel,
  SLIDE_W, SLIDE_H, TABLE_BOTTOM, TABLE_W, MARGIN_X, LABEL_COL, FOOTER_Y, type SlidePlan,
} from "../crosstabSlides";
import type { CrosstabResult } from "../parseStatsFile";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const GOLDEN = path.join(process.cwd(), "fixtures", "golden-thread-1", "golden-survey-documented.xlsx");
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;
const PDFTOTEXT = spawnSync("which", ["pdftotext"]).status === 0;
const EMU = 914400;

function golden(): CrosstabResult {
  const driver = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
b = open(sys.argv[2], "rb").read()
out = eng.crosstab(b, "golden.xlsx", {"selectedSheet": "Data", "columnVars": ["Gender"], "typeOverrides": {}, "rowItems": [{"key": "Purchase", "label": "Purchase", "vars": ["Purchase"]}, {"key": "Recommend", "label": "Likelihood to recommend", "vars": ["Recommend"]}]})
out["provenance"] = {"sourceFile": "golden-survey-documented.xlsx"}
print(json.dumps(out, default=str))`;
  const r = spawnSync(PYTHON, ["-c", driver, ENGINE, GOLDEN], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as CrosstabResult;
}

/**
 * The reviewer's shapes, built from a CSV by the ACTUAL engine (so the labels are what the engine
 * keeps, not what a test assumes): "dense" 30 answers "Answer n: " + 210 W + " END_nn" by three
 * regions; "oversized" one 2,821-character answer by two regions; "header" 12 regions whose names
 * are 382 characters.
 */
function engineShape(shape: "dense" | "oversized" | "header"): CrosstabResult {
  const driver = String.raw`
import csv, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
shape = sys.argv[2]
f = io.StringIO(); w = csv.writer(f); w.writerow(["Answer", "Region"])
if shape == "dense":
    for g in ["Region 1", "Region 2", "Region 3"]:
        for i in range(30):
            for _ in range(4): w.writerow([f"Answer {i+1}: " + "W" * 210 + f" END_{i+1:02d}", g])
else:
    answer = ("A long substantive answer with details. " * 70) + "END_OVERSIZE_SENTINEL" if shape == "oversized" else "Ordinary answer"
    groups = ["Region 1", "Region 2"] if shape == "oversized" else [("Very wide letter W " * 20) + str(i + 1) for i in range(12)]
    for g in groups:
        for i in range(40): w.writerow([answer if i < 20 else "Short alternative", g])
raw = f.getvalue().encode()
out = eng.crosstab(raw, shape + ".csv", {"columnVars": ["Region"], "rowItems": [{"key": "Answer", "label": "Which answer describes your experience?", "vars": ["Answer"]}], "typeOverrides": {}})
out["provenance"] = {"sourceFile": shape + ".csv"}
print(json.dumps(out, default=str))`;
  const r = spawnSync(PYTHON, ["-c", driver, ENGINE, shape], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as CrosstabResult;
}

/** A synthetic wide or long table in the engine's result shape (only what the slides read). */
function synthetic(columns: number, answers: number, labelLength: number): CrosstabResult {
  const cols = Array.from({ length: columns }, (_, j) => ({ block: 0, blockLabel: "Region", name: `Region ${j + 1}`, var: "Region", rawCode: String(j + 1), letter: String.fromCharCode(65 + (j % 26)), n: 40, w: 40, nEff: 40 }));
  const row = (label: string, pct: number, extra: Record<string, unknown> = {}) => ({ label, count: cols.map(() => 40), pct: cols.map((_c, j) => pct + j / 10), total: { count: 40 * columns, pct, base: { n: 40 * columns, w: 40 * columns, nEff: 40 * columns } }, ...extra });
  return {
    version: 2,
    columns: cols,
    questions: [{
      key: "Q", label: "Which of these did you use", kind: "single",
      rows: [row("Base: answered this question", 0, { isBase: true }), ...Array.from({ length: answers }, (_, i) => row(`Answer ${i + 1} ${"x".repeat(Math.max(0, labelLength - 10))}`, 10 + i))],
    }],
    provenance: { sourceFile: "synthetic.csv" },
  } as unknown as CrosstabResult;
}

async function deckOf(r: CrosstabResult, label = "Table"): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  addCrosstabSlides(pptx, label, r);
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

function plansOf(r: CrosstabResult, label = "Table"): SlidePlan[] {
  const { header, lines, columnKeys } = crosstabLines(r);
  return planCrosstabSlides(header, lines, { top: planTitle(label).top, columnKeys });
}

/** Per slide: the table frames' right edges (inches) and the slide text. */
async function slides(buffer: Buffer): Promise<{ slideW: number; slides: { right: number[]; text: string }[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const pres = await zip.files["ppt/presentation.xml"].async("string");
  const slideW = Number(/<p:sldSz cx="(\d+)"/.exec(pres)![1]) / EMU;
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  const out = [];
  for (const n of names) {
    const xml = await zip.files[n].async("string");
    const right: number[] = [];
    for (const frame of xml.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g) ?? []) {
      const x = Number(/<a:off x="(\d+)"/.exec(frame)![1]) / EMU;
      const grid = [...frame.matchAll(/<a:gridCol w="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0) / EMU;
      right.push(x + grid);
    }
    out.push({ right, text: xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") });
  }
  return { slideW, slides: out };
}

/** Every line's content is on the slides exactly once, in order: parts joined give the label. */
function expectCompletePlan(r: CrosstabResult, plans: SlidePlan[]) {
  const { lines } = crosstabLines(r);
  const groups = new Set(plans.filter((p) => p.kind === "table").map((p) => p.groupIndex));
  for (const g of groups) {
    const rows = plans.filter((p) => p.kind === "table" && p.groupIndex === g).flatMap((p) => p.rows.filter((x) => !x.repeat));
    const joined: string[] = [];
    for (const row of rows) {
      if (row.part) {
        joined[joined.length - 1] += row.label;
        expect(row.cells.every((c) => c === ""), "figures only on the first part").toBe(true);
      } else joined.push(row.label);
    }
    expect(joined).toEqual(lines.map((l) => l.label));
  }
  for (const p of plans) {
    const rowWidths = p.kind === "key" ? [p.widths[1], p.widths[0]] : p.widths;
    const height = rowHeight(p.header, p.widths, "bold") + p.rows.reduce((s, ln) => s + lineHeightOf(ln, rowWidths), 0);
    expect(height, "estimated table height").toBeLessThanOrEqual(TABLE_BOTTOM - p.top + 1e-9);
    expect(p.widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TABLE_W + 1e-9);
  }
}

describe("crosstab slides fit the page (GT-005)", () => {
  it.skipIf(!PYTHON_OK)("golden two-column table: inside the slide, Total on every slide, reference figures present", async () => {
    const deck = await slides(await deckOf(golden()));
    expect(deck.slideW).toBeCloseTo(SLIDE_W, 2);
    for (const s of deck.slides) {
      for (const right of s.right) expect(right, "table right edge").toBeLessThanOrEqual(deck.slideW - MARGIN_X + 0.01);
      expect(s.text).toContain("Total");
    }
    const all = deck.slides.map((s) => s.text).join(" ");
    expect(all).toMatch(/Base: answered this question 100 100 200/);
    expect(all).toMatch(/Yes 40% 60% 50%/);
  });

  it("a 25-column banner is split into groups that fit, each column once, with answer, Total and base on every slide", async () => {
    const r = synthetic(25, 4, 20);
    const plans = plansOf(r);
    const seen = plans.flatMap((p) => (p.continued ? [] : p.columns));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, j) => j));
    for (const p of plans) {
      expect(p.header[0]).toBe("Answer");
      expect(p.header[p.header.length - 1]).toBe("Total");
      expect(p.rows.some((x) => x.kind === "base")).toBe(true);
    }
    expectCompletePlan(r, plans);
    const deck = await slides(await deckOf(r));
    for (const s of deck.slides) for (const right of s.right) expect(right).toBeLessThanOrEqual(deck.slideW - MARGIN_X + 0.01);
    expect(deck.slides.length).toBeGreaterThan(1);
  });

  it("long labels continue onto further slides, repeating heading and base, with every answer once", () => {
    const r = synthetic(3, 30, 220);
    const plans = plansOf(r);
    expect(plans.length).toBeGreaterThan(1);
    for (const p of plans.filter((x) => x.continued)) {
      expect(p.rows[0].label).toMatch(/\(continued\)$/);
      expect(p.rows[0].repeat).toBe(true);
      expect(p.rows[1].kind).toBe("base");
    }
    expectCompletePlan(r, plans);
  });

  it.skipIf(!PYTHON_OK)("the reviewer's engine shapes: complete in the plan, split rows and a column key where needed", () => {
    const dense = engineShape("dense");
    expectCompletePlan(dense, plansOf(dense));
    const oversized = engineShape("oversized");
    const op = plansOf(oversized);
    expectCompletePlan(oversized, op);
    expect(op.flatMap((p) => p.rows).some((x) => (x.part ?? 0) > 0), "the 2,821-character answer is split").toBe(true);
    const header = engineShape("header");
    const hp = plansOf(header);
    expectCompletePlan(header, hp);
    const keyed = hp.filter((p) => p.kind === "key").flatMap((p) => p.rows);
    const headings = new Map<string, string>();
    for (const k of keyed) {
      if (!k.part) headings.set(k.cells[0], k.label);
      else headings.set([...headings.keys()].pop()!, headings.get([...headings.keys()].pop()!)! + k.label);
    }
    // Each banner heading is given in full: in a column key, or in a table header that fits.
    const fullHeaders = new Set(hp.filter((p) => p.kind === "table").flatMap((p) => p.header));
    expect(keyed.length, "the 382-character headings needed a key").toBeGreaterThan(0);
    for (const c of header.columns) {
      const full = c.letter ? `${c.letter}: ${c.name}` : c.name;
      expect(headings.get(c.letter ?? "") === full || fullHeaders.has(full), full.slice(0, 30)).toBe(true);
    }
  });

  it("a table name too long for any title area is refused visibly, not clipped", () => {
    expect(() => planTitle("Name ".repeat(2000))).toThrow(/too long/);
    expect(planTitle("Table").pt).toBe(18);
  });

  it.skipIf(!SOFFICE || !PDFTOTEXT || !PYTHON_OK)("rendered PDF: inside the page and above the footer, every answer part and heading present", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ct-pdf-"));
    const cases: [string, CrosstabResult][] = [
      ["golden", golden()], ["wide", synthetic(25, 4, 20)], ["long", synthetic(3, 30, 220)],
      ["dense", engineShape("dense")], ["oversized", engineShape("oversized")], ["header", engineShape("header")],
    ];
    const norm = (s: string) => s.replace(/\s+/g, "");
    for (const [name, r] of cases) {
      writeFileSync(path.join(dir, `${name}.pptx`), await deckOf(r));
      const conv = officeConvert(path.join(dir, `${name}.pptx`), "pdf", dir);
      expect(conv.status, conv.detail).toBe(0);
      const bbox = spawnSync("pdftotext", ["-bbox", path.join(dir, `${name}.pdf`), "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
      const pages = bbox.split(/<page /).slice(1);
      const plans = plansOf(r);
      expect(pages.length, `${name}: one page per planned slide`).toBe(plans.length);
      pages.forEach((page, i) => {
        const width = Number(/width="([\d.]+)"/.exec(page)![1]);
        const height = Number(/height="([\d.]+)"/.exec(page)![1]);
        expect(height).toBeCloseTo(SLIDE_H * 72, 0);
        const words = [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] }));
        expect(words.filter((w) => w.x1 > width + 0.5 || w.y1 > height + 0.5).map((w) => w.t), `${name} p${i + 1}: words beyond the page`).toEqual([]);
        // Table words end above the footer; footer words start at the footer. Nothing straddles.
        const straddle = words.filter((w) => w.y1 > TABLE_BOTTOM * 72 + 3 && w.y0 < FOOTER_Y * 72 - 1);
        expect(straddle.map((w) => w.t), `${name} p${i + 1}: words over the footer line`).toEqual([]);
        const plan = plans[i];
        if (plan.kind === "table") expect(page, `${name} p${i + 1}: Total`).toContain(">Total<");
        // Every row's label part on this slide is in the PDF text of its column, in full.
        const colLeft = plan.kind === "key" ? (MARGIN_X + plan.widths[0]) * 72 - 2 : MARGIN_X * 72 - 2;
        const colRight = plan.kind === "key" ? SLIDE_W * 72 : (MARGIN_X + LABEL_COL) * 72 + 2;
        const column = norm(words.filter((w) => w.x0 >= colLeft && w.x1 <= colRight && w.y0 < FOOTER_Y * 72 - 1).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((w) => w.t).join(""));
        for (const row of plan.rows) {
          const text = row.repeat ? "" : norm(shownLabel(row)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          expect(column.includes(text), `${name} p${i + 1}: "${shownLabel(row).slice(0, 40)}..." rendered in full`).toBe(true);
        }
      });
      const text = spawnSync("pdftotext", ["-layout", path.join(dir, `${name}.pdf`), "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
      if (name === "dense") for (let n = 1; n <= 30; n++) expect(text, `END_${String(n).padStart(2, "0")}`).toContain(`END_${String(n).padStart(2, "0")}`);
      if (name === "oversized") expect(text).toContain("END_OVERSIZE_SENTINEL");
      if (name === "golden") {
        expect(text).toMatch(/Yes\s+40%\s+60%\s+50%/);
        expect(text).toMatch(/Base: answered this question\s+100\s+100\s+200/);
      }
    }
  }, 600_000);
});
