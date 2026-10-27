import { NextResponse } from "next/server";
import { withoutMeanTickRows } from "@/lib/crosstabMeanRows";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import { convertOfficeDocToPdf } from "@/lib/convertToPdf";
import { addCrosstabSlides, CrosstabLayoutError } from "@/lib/crosstabSlides";
import type { CrosstabResult, CrosstabRow } from "@/lib/parseStatsFile";
import { routeRequestContext } from "@/lib/requestContext";

type Cell = string | number | null;

function sheetName(label: string, used: Set<string>): string {
  const base = (label.replace(/[\\/?*[\]:']/g, " ").trim() || "Table").slice(0, 28);
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${i++}`;
  used.add(name.toLowerCase());
  return name;
}

type ExportOpts = { measures: ("col" | "row" | "n" | "count" | "letters" | "resp" | "residual")[]; net: boolean };
const MEASURE_NAME = { col: "% within column", row: "% within row", n: "n", count: "Weighted count", resp: "% of responses", letters: "Significantly higher than", residual: "Standardized residual" } as const;

/**
 * One worksheet per saved crosstab. It mirrors the screen: the measures that are
 * ticked (one line each per answer), a base row of unweighted n and, on weighted
 * tables, a second base row with the effective base, a NET column per banner
 * variable when switched on, and a footer that states the test, the correction,
 * the design caveat and the provenance, so the table can leave the app without
 * losing its caveats.
 */
function tableSheet(label: string, r: CrosstabResult, opts: ExportOpts): XLSX.WorkSheet {
  const aoa: Cell[][] = [];
  const pctCells: [number, number][] = [];
  const cols = r.columns;
  const weighted = !!r.weightVar;
  const hasNet = opts.net && !r.overall && Array.isArray(r.nets) && r.nets.length > 0;
  type Entry = { kind: "col"; j: number; block: number } | { kind: "net"; block: number };
  const layout: Entry[] = [];
  cols.forEach((c, j) => {
    layout.push({ kind: "col", j, block: c.block });
    const next = cols[j + 1];
    if (hasNet && (!next || next.block !== c.block)) layout.push({ kind: "net", block: c.block });
  });
  const FIRST = 2; // answer label, measure name, then the layout columns
  aoa.push([label]);
  if (r.caption) aoa.push([r.caption]);
  aoa.push([]);

  const bannerRow: Cell[] = ["", ""];
  let last = -1;
  for (const e of layout) {
    bannerRow.push(e.block !== last ? (cols.find((c) => c.block === e.block)?.blockLabel ?? "") : "");
    last = e.block;
  }
  bannerRow.push("");
  aoa.push(bannerRow);
  aoa.push([
    "Answer",
    "Measure",
    ...layout.map((e) => {
      if (e.kind === "net") return "NET";
      const c = cols[e.j];
      return c.letter ? `${c.letter}: ${c.name}` : c.name;
    }),
    "Total",
  ]);
  const netOf = (block: number) => r.nets?.find((x) => x.block === block);
  aoa.push(["Base (unweighted n)", "", ...layout.map((e) => (e.kind === "col" ? cols[e.j].n : (netOf(e.block)?.n ?? ""))), r.total.n]);
  aoa.push(["Base (weighted)", "", ...layout.map((e) => (e.kind === "col" ? Math.round(cols[e.j].w) : Math.round(netOf(e.block)?.w ?? 0))), Math.round(r.total.w)]);
  aoa.push(["Base (effective n)", "", ...layout.map((e) => (e.kind === "col" ? Math.round(cols[e.j].nEff * 10) / 10 : Math.round((netOf(e.block)?.nEff ?? 0) * 10) / 10)), Math.round(r.total.nEff * 10) / 10]);
  aoa.push([]);

  for (const q of r.questions) {
    const tt = (q.tableTests ?? [])
      .map((t) => {
        const m: [string, number | null | undefined][] = [
          [t.phi !== undefined ? "phi" : "Cramer's V", t.phi ?? t.cramersV],
          ["contingency C", t.contingencyC],
          ["lambda (answer from banner)", t.lambdaAnswer],
          ["gamma", t.gamma],
          ["tau-b", t.tauB],
          ["tau-c", t.tauC],
          ["Somers' d (answer depends on banner)", t.somersD],
        ];
        const bits = m.filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} ${(v as number).toFixed(3)}`);
        const fisher = t.fisherP !== undefined ? `; Fisher exact p=${t.fisherP < 0.001 ? "<0.001" : t.fisherP}` : "";
        const sparse = t.lowExpectedPct !== undefined ? `; ${t.lowExpectedPct}% of cells have an expected count under 5 (smallest ${t.minExpected})` : "";
        return `${t.label}: overall ${t.p < 0.001 ? "p<0.001" : `p=${t.p}`} (chi-square ${t.chi2}, df ${t.df})${bits.length ? `; ${bits.join(", ")}` : ""}${fisher}${sparse}`;
      })
      .join("; ");
    aoa.push([`${q.label}${q.key.startsWith("nets-") ? " (a respondent counts once if they chose any of the options)" : q.kind === "multi" ? " (multiple response, each option on its own base)" : q.kind === "grid" ? " (averages)" : ""}`]);
    if (tt) aoa.push([`Whole-table test: ${tt}`]);
    if (q.kind === "numeric") {
      const er = q.rows.find((x) => !x.isBase && x.eta && x.eta.length > 0);
      if (er?.eta) aoa.push([`Eta: ${er.eta.map((e) => `${e.label} ${e.eta.toFixed(3)}`).join("; ")}`]);
    }
    const asPct = q.kind === "single" || q.kind === "multi";
    const firstData = q.rows.find((x) => !x.isBase && !x.isEffBase);
    for (const row of q.rows) {
      if (row.isBase) {
        const eff = !!row.isEffBase;
        const baseNet = (block: number): Cell => {
          const bs = firstData?.net?.find((x) => x.block === block)?.base;
          return bs ? (eff ? Math.round(bs.nEff) : bs.n) : "";
        };
        aoa.push([
          row.label,
          "",
          ...layout.map((e) => (e.kind === "col" ? (row.count[e.j] ?? "") : baseNet(e.block))),
          row.total.count ?? "",
        ]);
        continue;
      }
      const rowAsPct = asPct && !row.isScore;
      const cellOf = (e: Entry) => {
        if (e.kind === "col") {
          return { pct: row.pct[e.j], rowPct: row.rowPct?.[e.j], count: row.count[e.j], nCell: row.nCell?.[e.j], resp: row.respPct?.[e.j], letters: row.letters?.[e.j], residual: row.residual?.[e.j] };
        }
        const nt = row.net?.find((x) => x.block === e.block);
        return nt ? { pct: nt.pct, rowPct: nt.rowPct, count: nt.count, nCell: nt.nCell, resp: nt.respPct, letters: undefined, residual: undefined } : null;
      };
      const wanted = opts.measures.filter((m) => {
        if (r.overall && (m === "row" || m === "letters" || m === "residual")) return false;
        if (!rowAsPct) return m === "col" || m === "letters";
        if (m === "resp") return row.respPct !== undefined;
        if (m === "n") return row.nCell !== undefined;
        if (m === "count") return weighted;
        if (m === "residual") return row.residual !== undefined;
        return true;
      });
      for (const m of wanted.length > 0 ? wanted : (["col"] as const)) {
        if (m === "letters") {
          if (row.letters?.some((l) => l)) {
            aoa.push(["", MEASURE_NAME.letters, ...layout.map((e) => (e.kind === "col" ? row.letters?.[e.j] || "" : "")), ""]);
          }
          continue;
        }
        const line: Cell[] = [row.label, !rowAsPct && m === "col" ? (row.isScore && !row.isMean ? "Net score (points)" : "Average") : MEASURE_NAME[m]];
        const put = (v: number | null | undefined, isTotal: boolean, colIdx: number) => {
          if (v === null || v === undefined) {
            line.push(m === "n" ? "" : "-");
            return;
          }
          const pctLike = rowAsPct && (m === "col" || m === "row" || m === "resp");
          line.push(pctLike ? v / 100 : v);
          if (pctLike) pctCells.push([aoa.length, colIdx]);
          void isTotal;
        };
        layout.forEach((e, k) => {
          const cd = cellOf(e);
          const v = !cd ? null : m === "col" ? cd.pct : m === "row" ? cd.rowPct : m === "n" ? cd.nCell : m === "resp" ? cd.resp : m === "residual" ? cd.residual : cd.count;
          put(v, false, FIRST + k);
        });
        const tot = m === "col" ? row.total.pct : m === "row" ? (rowAsPct ? 100 : null) : m === "n" ? (row.total.nCell ?? null) : m === "resp" ? (row.total.respPct ?? null) : m === "residual" ? null : row.total.count;
        put(tot, true, FIRST + layout.length);
        aoa.push(line);
      }
    }
    if (q.kind === "single") {
      const answers = q.rows.filter((x) => !x.isBase && !x.isNet);
      if (answers.length >= 2) {
        const sum = (vals: (number | null | undefined)[]): number | null => {
          const v = vals.filter((x): x is number => typeof x === "number");
          return v.length === 0 ? null : v.reduce((a, b) => a + b, 0);
        };
        for (const m of opts.measures.filter((x) => x === "col" || x === "n" || (x === "count" && weighted))) {
          if (m === "n" && answers[0].nCell === undefined) continue;
          const pick = (e: Entry | "total"): number | null =>
            sum(
              answers.map((x) => {
                if (e === "total") return m === "col" ? x.total.pct : m === "n" ? (x.total.nCell ?? null) : x.total.count;
                if (e.kind === "col") return m === "col" ? x.pct[e.j] : m === "n" ? (x.nCell?.[e.j] ?? null) : x.count[e.j];
                const nt = x.net?.find((y) => y.block === e.block);
                return !nt ? null : m === "col" ? nt.pct : m === "n" ? nt.nCell : nt.count;
              }),
            );
          const cell = (v: number | null): Cell => (v === null ? "" : m === "col" ? (Math.abs(v - 100) <= 0.5 ? 100 : v) / 100 : v);
          const line: Cell[] = ["Total", MEASURE_NAME[m], ...layout.map((e) => cell(pick(e))), cell(pick("total"))];
          if (m === "col") for (let c = FIRST; c <= FIRST + layout.length; c++) pctCells.push([aoa.length, c]);
          aoa.push(line);
        }
      }
    }
    if (r.overall) {
      const items: { label: string; d: NonNullable<CrosstabRow["desc"]> }[] = q.desc
        ? [{ label: "Codes of the answers", d: q.desc }]
        : q.rows.filter((x) => !x.isBase && x.desc).map((x) => ({ label: x.label, d: x.desc as NonNullable<CrosstabRow["desc"]> }));
      if (items.length > 0) {
        aoa.push(["Descriptive statistics", "", "n", "Mean", "Std. deviation", "Variance", "Std. error", "Minimum", "10th pct", "25th pct", "Median", "75th pct", "90th pct", "Maximum", "Range", "Mode", "Sum", "Skewness", "Kurtosis"]);
        for (const { label: l, d } of items) {
          aoa.push([l, "", d.n, d.mean, d.sd, d.variance, d.sem, d.min, d.p10 ?? null, d.p25, d.median, d.p75, d.p90 ?? null, d.max, d.range, d.mode ?? null, d.sum ?? null, d.skewness ?? null, d.kurtosis ?? null]);
        }
      }
    }
    aoa.push([]);
  }

  aoa.push(["Notes"]);
  const n = r.notes;
  if (n) {
    aoa.push([n.test]);
    if (n.design) aoa.push([n.design]);
    if (n.overlap) aoa.push([n.overlap]);
    if (n.tableTest) aoa.push([n.tableTest]);
    if (n.designUsed && n.designUsed.casesMissingDesign > 0) {
      aoa.push([`Warning: ${n.designUsed.casesMissingDesign} cases have no value for the survey design variables and were treated as unclustered, which can understate the standard errors.`]);
    }
    aoa.push([`Letters beside a figure name the columns it is significantly higher than within the same banner variable (column-pair test, 95%).`]);
    aoa.push([`Figures with fewer than ${n.minBase} cases are shown as a dash. Figures with ${n.minBase} to ${(n.minReliable ?? 30) - 1} cases are indicative only.`]);
    aoa.push([`n is the unweighted number of cases in the cell. The base row shows unweighted cases; on weighted tables a second base row shows the effective base (Kish). NET is everyone with a valid answer to the question and to that banner variable, and is not tested.`]);
    if (r.notes && (r.notes as { associationNote?: string }).associationNote) aoa.push([(r.notes as { associationNote?: string }).associationNote as string]);
    if (n.dkNote) aoa.push([n.dkNote]);
    if (n.filterNote) aoa.push([n.filterNote]);
    if (n.expectedNote) aoa.push([n.expectedNote]);
    if (n.respNote) aoa.push([n.respNote]);
    aoa.push([n.multiBase]);
    aoa.push([n.means]);
  }
  const p = r.provenance;
  if (p) {
    aoa.push([
      `Source: ${p.sourceFile}; weight: ${p.weightVar ?? "none"}; ${p.cases?.toLocaleString("en-US") ?? "?"} cases; built ${p.builtAt}; engine ${p.engine ?? r.engine ?? "unknown"}.`,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [rr, cc] of pctCells) {
    const ref = XLSX.utils.encode_cell({ r: rr, c: cc });
    if (ws[ref] && typeof ws[ref].v === "number") ws[ref].z = "0.0%";
  }
  ws["!cols"] = [{ wch: 44 }, { wch: 22 }, ...layout.map(() => ({ wch: 14 })), { wch: 12 }];
  return ws;
}

/** All saved crosstabs for a run (or one, with ?tableId=) as an Excel workbook. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  const sp = new URL(request.url).searchParams;
  const tableId = sp.get("tableId");
  const allowed = ["col", "row", "n", "count", "letters", "resp", "residual"] as const;
  const asked = (sp.get("measures") ?? "col,n,letters").split(",").filter((m): m is (typeof allowed)[number] => (allowed as readonly string[]).includes(m));
  const opts: ExportOpts = { measures: asked.length > 0 ? asked : ["col"], net: sp.get("net") !== "0" };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(runId) || (tableId && !uuid.test(tableId))) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const data = await withTenant(TENANT_ID, async (client) => {
    const run = await client.query<{ project_name: string | null }>("select project_name from runs where id = $1", [runId]);
    if (run.rows.length === 0) return null;
    const tables = await client.query<{ id: string; label: string | null; crosstab: (CrosstabResult & { version?: number }) | null }>(
      `select id, label, crosstab from document_tables
       where run_id = $1 and crosstab is not null and coalesce(crosstab_status, 'committed') <> 'evidence' ${tableId ? "and id = $2" : ""}
       order by document_id, table_index`,
      tableId ? [runId, tableId] : [runId],
    );
    return { name: run.rows[0].project_name, tables: tables.rows };
  });
  if (!data) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  // Batch 48: mean=0 when the researcher unticked Mean on the table; its Mean-tick rows are left out of
  // every format, as on screen. Defined mean groups are kept.
  const hideMeanTickRows = sp.get("mean") === "0";
  const usable = data.tables
    .filter((t) => t.crosstab?.version === 2)
    .map((t) => (hideMeanTickRows && t.crosstab ? { ...t, crosstab: { ...withoutMeanTickRows(t.crosstab), version: t.crosstab.version } } : t));
  if (usable.length === 0) return NextResponse.json({ error: "No saved crosstabs to export." }, { status: 404 });
  const stem = (data.name ?? "project").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const format = (sp.get("format") ?? "xlsx").toLowerCase();

  if (format === "pptx" || format === "pdf") {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    for (const t of usable) {
      // GT-005: the layout is planned to fit the slide (src/lib/crosstabSlides.ts). A table that
      // cannot be laid out without losing content is refused by name, never exported clipped.
      try {
        addCrosstabSlides(pptx, t.label ?? "Crosstab", t.crosstab as CrosstabResult);
      } catch (error) {
        if (!(error instanceof CrosstabLayoutError)) throw error;
        return NextResponse.json(
          { error: `"${t.label ?? "Crosstab"}" cannot be laid out on slides without losing content (${error.message}) Export it to Excel instead, or shorten its name or labels.` },
          { status: 422 },
        );
      }
    }
    const pptxBuffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    if (format === "pptx") {
      return new NextResponse(new Uint8Array(pptxBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${stem || "project"}-crosstabs.pptx"`,
        },
      });
    }
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await convertOfficeDocToPdf(pptxBuffer, "crosstabs.pptx");
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not convert the tables to PDF." },
        { status: 500 },
      );
    }
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${stem || "project"}-crosstabs.pdf"`,
      },
    });
  }

  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const t of usable) {
    XLSX.utils.book_append_sheet(wb, tableSheet(t.label ?? "Crosstab", t.crosstab as CrosstabResult, opts), sheetName(t.label ?? "Crosstab", used));
  }
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stem || "project"}-crosstabs.xlsx"`,
    },
  });
}
