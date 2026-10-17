import { PYTHON } from "./helpers/pythonEngine";
// Golden-thread GT-005 (Codex, 2026-10-17): the crosstab export's pptx (and the pdf made from it)
// laid the table out 13.8 inches wide on a 13.33-inch slide, so the Total column was clipped.
// Checks, on the deck built by the export's own addCrosstabSlides:
//   1. the golden two-column table (Purchase and Likelihood to recommend by Gender, from the ACTUAL
//      Python engine): every table lies inside the slide, Total is a header on every slide, and the
//      independent reference figures (Purchase: 200 base, 50% / 50% total) are in the table;
//   2. a 25-column banner: split into column groups that each fit, every banner column appears
//      exactly once, and each slide repeats the answer column, Total and the base row;
//   3. long answer labels: rows continue onto further slides within the height budget, and each
//      continuation repeats its question heading and base row;
//   4. rendered with LibreOffice (when installed): every word on every PDF page lies inside the
//      page, and the golden Total figures are on the page.
// Skipped parts say why (no python engine, no LibreOffice).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { addCrosstabSlides, planCrosstabSlides, crosstabLines, rowHeight, SLIDE_W, TABLE_BOTTOM, TABLE_TOP, TABLE_W, MARGIN_X } from "../crosstabSlides";
import type { CrosstabResult } from "../parseStatsFile";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const GOLDEN = path.join(process.cwd(), "fixtures", "golden-thread-1", "golden-survey-documented.xlsx");
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;
const SOFFICE = ["soffice", "libreoffice"].find((b) => spawnSync("which", [b]).status === 0);
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

async function deckOf(r: CrosstabResult): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  addCrosstabSlides(pptx, "Table", r);
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
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
    const { header, lines } = crosstabLines(r);
    const plans = planCrosstabSlides(header, lines);
    const seen = plans.flatMap((p) => (p.continued ? [] : p.columns));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, j) => j));
    for (const p of plans) {
      expect(p.widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(TABLE_W + 1e-9);
      expect(p.header[0]).toBe("Answer");
      expect(p.header[p.header.length - 1]).toBe("Total");
      expect(p.rows.some((x) => x.kind === "base")).toBe(true);
    }
    const deck = await slides(await deckOf(r));
    for (const s of deck.slides) for (const right of s.right) expect(right).toBeLessThanOrEqual(deck.slideW - MARGIN_X + 0.01);
    expect(deck.slides.length).toBeGreaterThan(1);
  });

  it("long labels continue onto further slides within the height budget, repeating heading and base", () => {
    const r = synthetic(3, 30, 220);
    const { header, lines } = crosstabLines(r);
    const plans = planCrosstabSlides(header, lines);
    expect(plans.length).toBeGreaterThan(1);
    for (const p of plans) {
      const height = rowHeight(p.header, p.widths) + p.rows.reduce((s, ln) => s + rowHeight([ln.label, ...ln.cells], p.widths), 0);
      expect(height, "estimated table height").toBeLessThanOrEqual(TABLE_BOTTOM - TABLE_TOP + 1e-9);
    }
    for (const p of plans.filter((x) => x.continued)) {
      expect(p.rows[0].label).toMatch(/\(continued\)$/);
      expect(p.rows[1].kind).toBe("base");
    }
    // Every answer appears exactly once.
    const answers = plans.flatMap((p) => p.rows.filter((x) => x.kind === "answer").map((x) => x.label));
    expect(answers.length).toBe(30);
    expect(new Set(answers).size).toBe(30);
  });

  it.skipIf(!SOFFICE || !PDFTOTEXT || !PYTHON_OK)("rendered PDF: every word inside its page, golden Total figures on the page", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ct-pdf-"));
    for (const [name, r] of [["golden", golden()], ["wide", synthetic(25, 4, 20)], ["long", synthetic(3, 30, 220)]] as const) {
      writeFileSync(path.join(dir, `${name}.pptx`), await deckOf(r));
      const conv = spawnSync(SOFFICE!, ["--headless", "--convert-to", "pdf", "--outdir", dir, path.join(dir, `${name}.pptx`)], { encoding: "utf8", timeout: 120_000 });
      expect(conv.status, conv.stderr).toBe(0);
      const bbox = spawnSync("pdftotext", ["-bbox", path.join(dir, `${name}.pdf`), "-"], { encoding: "utf8" }).stdout;
      const pages = bbox.split(/<page /).slice(1);
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) {
        const width = Number(/width="([\d.]+)"/.exec(page)![1]);
        const words = [...page.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>([^<]*)</g)];
        const outside = words.filter((w) => Number(w[2]) > width + 0.5).map((w) => w[3]);
        expect(outside, `${name}: words beyond the page width`).toEqual([]);
        expect(page, `${name}: Total on every page`).toContain(">Total<");
      }
      if (name === "golden") {
        const text = spawnSync("pdftotext", ["-layout", path.join(dir, "golden.pdf"), "-"], { encoding: "utf8" }).stdout;
        expect(text).toMatch(/Yes\s+40%\s+60%\s+50%/);
        expect(text).toMatch(/Base: answered this question\s+100\s+100\s+200/);
      }
    }
  }, 300_000);
});
