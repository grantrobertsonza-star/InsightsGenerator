// Import-stage data quality for files that arrive as already-aggregated
// tables (a report's tables, a cross tab export). Pure counting and
// arithmetic, no model calls. It cannot say whether a table is right, only
// whether it carries what is needed to be used safely: a base, a stated
// weighting, figures that add up, and no obvious extraction damage.

import type { CellValue, QualityStatus } from "./dataQuality";

export type AggregatedTableInput = {
  label: string | null;
  headers: string[];
  rows: Record<string, CellValue>[];
};

export type AggregatedCheck = {
  id: string;
  label: string;
  status: QualityStatus;
  detail: string;
};

export type AggregatedQuality = {
  tables: number;
  usableTables: number;
  rowsTotal: number;
  columnsMedian: number | null;
  withBase: number;
  withoutBase: string[]; // table names, capped
  bases: { count: number; min: number | null; median: number | null; max: number | null; under30: number; under10: number };
  weightingStated: { mentioned: number; weighted: boolean; unweighted: boolean };
  percentColumns: { checked: number; addTo100: number; nearMiss: number; over: number; under: number };
  totals: { checkable: number; mismatched: number };
  duplicateTables: number;
  artefacts: { tooSmall: number; emptyHeaders: number; emptyColumns: number; headerRepeatedInBody: number };
  bannerSignatures: { distinct: number; sharedByMost: number };
  checks: AggregatedCheck[];
  status: QualityStatus;
};

export const BASE_RELIABLE = 30;
export const BASE_SUPPRESS = 10;
export const PCT_TOLERANCE = 3; // rounding on a column of percentages
export const NEAR_MISS_MAX = 10;
export const TOTAL_TOLERANCE = 0.01; // relative

const BASE_LABEL =
  /^(?:(?:unweighted|weighted|effective|total)\s+)?(?:base|bases|n|sample size|sample|number of (?:respondents|cases)|respondents|cases)\b\s*(?:[:(=].*)?$/i;
const BASE_HEADER = /^(?:(?:unweighted|weighted)\s+)?(?:base|n|sample size|cases)$/i;
const HEADER_N = /\b(?:n|base)\s*=\s*([\d][\d,\s]*)/i;
const TOTAL_LABEL = /^(?:total|all|overall|all respondents|grand total)\b/i;

export function toNumber(v: CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (s === "" || /^(?:-|–|—|na|n\/a|\*|\.)$/i.test(s)) return null;
  s = s.replace(/%$/, "").replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const isPercentCell = (v: CellValue) => typeof v === "string" && /%\s*$/.test(v.trim());
const text = (v: CellValue) => (v === null || v === undefined ? "" : String(v).trim());

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type TableRead = {
  name: string;
  stub: string; // first column header
  baseRows: Set<number>;
  totalRows: Set<number>;
  bases: number[];
};

function readTable(t: AggregatedTableInput, index: number): TableRead {
  const stub = t.headers[0] ?? "";
  const baseRows = new Set<number>();
  const totalRows = new Set<number>();
  const bases: number[] = [];

  t.rows.forEach((row, i) => {
    const label = text(row[stub]);
    if (BASE_LABEL.test(label)) {
      baseRows.add(i);
      for (const h of t.headers.slice(1)) {
        const n = toNumber(row[h]);
        if (n !== null && n >= 0) bases.push(n);
      }
    } else if (TOTAL_LABEL.test(label)) {
      totalRows.add(i);
    }
  });
  for (const h of t.headers) {
    const m = HEADER_N.exec(h);
    if (m) {
      const n = Number(m[1].replace(/[,\s]/g, ""));
      if (Number.isFinite(n)) bases.push(n);
    }
  }
  // A base column, such as "Base" or "n" beside the categories.
  for (const h of t.headers.slice(1)) {
    if (BASE_HEADER.test(h.trim())) {
      for (const row of t.rows) {
        const n = toNumber(row[h]);
        if (n !== null && n >= 0) bases.push(n);
      }
    }
  }
  return { name: t.label?.trim() || `Table ${index + 1}`, stub, baseRows, totalRows, bases };
}

export function computeAggregatedQuality(tables: AggregatedTableInput[]): AggregatedQuality {
  const reads = tables.map(readTable);
  const usable = tables.filter((t) => t.headers.length >= 2 && t.rows.length >= 2);

  const allBases = reads.flatMap((r) => r.bases);
  const withBase = reads.filter((r) => r.bases.length > 0).length;
  const withoutBase = reads.filter((r) => r.bases.length === 0).map((r) => r.name);

  // Weighting wording anywhere: labels, headers, row labels.
  let weighted = false;
  let unweighted = false;
  let mentioned = 0;
  tables.forEach((t) => {
    const blob = [t.label ?? "", ...t.headers, ...t.rows.slice(0, 40).map((r) => text(r[t.headers[0]]))].join(" | ");
    const u = /\bunweighted\b/i.test(blob);
    const w = /\bweighted\b|\bweight(?:s|ing)?\b/i.test(blob.replace(/unweighted/gi, ""));
    if (u) unweighted = true;
    if (w) weighted = true;
    if (u || w) mentioned += 1;
  });

  // Percent columns: do they add up?
  let pChecked = 0, pAdd = 0, pNear = 0, pOver = 0, pUnder = 0;
  // Totals: do counts add up?
  let tCheckable = 0, tMismatched = 0;

  tables.forEach((t, ti) => {
    const r = reads[ti];
    const body = t.rows.map((row, i) => ({ row, i })).filter((x) => !r.baseRows.has(x.i) && !r.totalRows.has(x.i));
    for (const h of t.headers.slice(1)) {
      if (BASE_HEADER.test(h.trim())) continue;
      const cells = body.map((x) => x.row[h]);
      const nums = cells.map(toNumber).filter((n): n is number => n !== null);
      if (nums.length < 2) continue;
      const percentLike = cells.filter((c) => c !== null && c !== undefined && text(c) !== "").every((c) => isPercentCell(c) || (toNumber(c) !== null && (toNumber(c) as number) <= 100 && (toNumber(c) as number) >= 0)) &&
        cells.some(isPercentCell);
      if (percentLike) {
        pChecked += 1;
        const sum = nums.reduce((a, b) => a + b, 0);
        const diff = sum - 100;
        if (Math.abs(diff) <= PCT_TOLERANCE) pAdd += 1;
        else if (Math.abs(diff) <= NEAR_MISS_MAX) pNear += 1;
        else if (diff > 0) pOver += 1;
        else pUnder += 1;
      } else if (r.totalRows.size > 0 && !cells.some(isPercentCell)) {
        // Counts with a total row.
        for (const ti2 of r.totalRows) {
          const total = toNumber(t.rows[ti2][h]);
          if (total === null || total <= 0) continue;
          const parts = nums;
          if (parts.length < 2) continue;
          tCheckable += 1;
          const sum = parts.reduce((a, b) => a + b, 0);
          if (Math.abs(sum - total) > Math.max(1, total * TOTAL_TOLERANCE)) tMismatched += 1;
          break;
        }
      }
    }
  });

  // Duplicates.
  const sigs = tables.map((t) => JSON.stringify([t.headers, t.rows.slice(0, 30)]));
  const seen = new Set<string>();
  let duplicates = 0;
  sigs.forEach((s) => {
    if (seen.has(s)) duplicates += 1;
    seen.add(s);
  });

  // Extraction damage.
  let tooSmall = 0, emptyHeaders = 0, emptyColumns = 0, headerRepeated = 0;
  tables.forEach((t) => {
    if (t.headers.length < 2 || t.rows.length < 2) tooSmall += 1;
    if (t.headers.some((h) => h.trim() === "" || /^(?:unnamed|column|col)[\s_:-]*\d*$/i.test(h.trim()))) emptyHeaders += 1;
    if (t.headers.slice(1).some((h) => t.rows.length > 0 && t.rows.every((row) => text(row[h]) === ""))) emptyColumns += 1;
    const headerLine = t.headers.map((h) => h.trim().toLowerCase()).join("|");
    if (t.rows.some((row) => t.headers.map((h) => text(row[h]).toLowerCase()).join("|") === headerLine)) headerRepeated += 1;
  });

  // Banner (column header) signatures: how many tables share a layout.
  const bannerKey = (t: AggregatedTableInput) => t.headers.slice(1).map((h) => h.replace(HEADER_N, "").replace(/\s+/g, " ").trim().toLowerCase()).join("|");
  const bannerCounts = new Map<string, number>();
  usable.forEach((t) => bannerCounts.set(bannerKey(t), (bannerCounts.get(bannerKey(t)) ?? 0) + 1));
  const sharedByMost = bannerCounts.size > 0 ? Math.max(...bannerCounts.values()) : 0;

  const bases = {
    count: allBases.length,
    min: allBases.length ? Math.min(...allBases) : null,
    median: median(allBases),
    max: allBases.length ? Math.max(...allBases) : null,
    under30: allBases.filter((b) => b < BASE_RELIABLE).length,
    under10: allBases.filter((b) => b < BASE_SUPPRESS).length,
  };

  const checks: AggregatedCheck[] = [];
  const add = (id: string, label: string, status: QualityStatus, detail: string) => checks.push({ id, label, status, detail });
  const list = (xs: string[]) => `${xs.slice(0, 3).join(", ")}${xs.length > 3 ? `, and ${xs.length - 3} more` : ""}`;

  add("tables", "Tables read", tables.length === 0 ? "fail" : usable.length === 0 ? "fail" : "pass",
    tables.length === 0 ? "No tables were read from this file." : `${tables.length} table${tables.length === 1 ? "" : "s"} read, ${usable.length} with at least two columns and two rows.`);

  if (tables.length > 0) {
    add("base", "Base stated",
      withBase === 0 ? "fail" : withBase < tables.length ? "warn" : "pass",
      withBase === 0
        ? "No table shows a base (a Base or n row or column, or n= in a heading). Without one, differences cannot be tested and small groups cannot be spotted."
        : withBase === tables.length ? `All ${tables.length} tables state a base.` : `${withBase} of ${tables.length} tables state a base. Missing in: ${list(withoutBase)}.`);

    if (bases.count > 0) {
      add("base_sizes", "Base sizes",
        bases.under10 > 0 ? "warn" : bases.under30 > 0 ? "warn" : "pass",
        `Smallest ${bases.min?.toLocaleString()}, median ${bases.median?.toLocaleString()}, largest ${bases.max?.toLocaleString()} across ${bases.count} stated bases. ${bases.under30} under ${BASE_RELIABLE} and ${bases.under10} under ${BASE_SUPPRESS}. Figures on bases under ${BASE_RELIABLE} are shown as indicative only in the cross tab tool, and under ${BASE_SUPPRESS} are not reported.`);
    }

    add("weighting", "Weighting stated",
      mentioned > 0 ? "pass" : bases.count > 0 ? "warn" : "pass",
      mentioned === 0
        ? bases.count > 0 ? "Nothing says whether the figures or bases are weighted. If they are weighted, an unweighted base is needed to judge precision." : "No weighting language found, and no bases to qualify."
        : `${weighted && unweighted ? "Weighted and unweighted bases are both mentioned" : unweighted ? "Unweighted bases are mentioned" : "Weighting is mentioned"} in ${mentioned} table${mentioned === 1 ? "" : "s"}.`);

    if (pChecked > 0) {
      const off = pNear + pOver + pUnder;
      add("percent_sums", "Percentages add up",
        pNear > 0 ? "warn" : "pass",
        `${pAdd} of ${pChecked} percentage columns add to 100% (within ${PCT_TOLERANCE} points for rounding).${pNear > 0 ? ` ${pNear} miss by ${PCT_TOLERANCE + 1} to ${NEAR_MISS_MAX} points, which usually means a dropped row rather than a real pattern.` : ""}${pOver + pUnder > 0 ? ` ${pOver + pUnder} are further off, which is normal for multiple-response or partial tables.` : ""}${off === 0 ? "" : ""}`);
    }
    if (tCheckable > 0) {
      add("totals", "Totals add up", tMismatched > 0 ? "warn" : "pass",
        tMismatched === 0 ? `${tCheckable} count columns checked against their total row, all within 1%.` : `${tMismatched} of ${tCheckable} count columns do not add to their total row within 1%. A row may be missing or merged.`);
    }

    add("duplicates", "Duplicate tables", duplicates > 0 ? "warn" : "pass",
      duplicates === 0 ? "No repeated tables." : `${duplicates} table${duplicates === 1 ? " repeats" : "s repeat"} an earlier one. A report and its appendix often carry the same table.`);

    const damage = tooSmall + emptyHeaders + emptyColumns + headerRepeated;
    add("extraction", "Extraction damage", damage > 0 ? "warn" : "pass",
      damage === 0 ? "No tiny tables, blank headings, empty columns or repeated heading rows." :
        [tooSmall && `${tooSmall} too small to use`, emptyHeaders && `${emptyHeaders} with blank or generic headings`, emptyColumns && `${emptyColumns} with an empty column`, headerRepeated && `${headerRepeated} repeating the heading row in the body`].filter(Boolean).join(", ") + ". Check the preview.");

    if (usable.length > 1) {
      add("banners", "Column layouts", "pass",
        `${bannerCounts.size} distinct column layout${bannerCounts.size === 1 ? "" : "s"}; the most common is shared by ${sharedByMost} of ${usable.length} tables.${bannerCounts.size > 1 && sharedByMost < usable.length / 2 ? " Tables are split across many layouts, so comparing them side by side may need care." : ""}`);
    }
  }

  const status: QualityStatus = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";

  return {
    tables: tables.length,
    usableTables: usable.length,
    rowsTotal: tables.reduce((n, t) => n + t.rows.length, 0),
    columnsMedian: median(tables.map((t) => t.headers.length)),
    withBase,
    withoutBase: withoutBase.slice(0, 20),
    bases,
    weightingStated: { mentioned, weighted, unweighted },
    percentColumns: { checked: pChecked, addTo100: pAdd, nearMiss: pNear, over: pOver, under: pUnder },
    totals: { checkable: tCheckable, mismatched: tMismatched },
    duplicateTables: duplicates,
    artefacts: { tooSmall, emptyHeaders, emptyColumns, headerRepeatedInBody: headerRepeated },
    bannerSignatures: { distinct: bannerCounts.size, sharedByMost },
    checks,
    status,
  };
}
