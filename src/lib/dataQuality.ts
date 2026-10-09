// Import quality: plain counts and checks over a table as it landed in
// document_tables, with no model involved. Pure and client-safe so the same
// numbers can feed the run page, the report and the tests.

import { isEligible } from "./routingParse";
import type { StatedRouting } from "./statedRouting";

export type QualityStatus = "pass" | "warn" | "fail";

export type CellValue = string | number | null | undefined;

// Inferred from the stored values alone: the file does not declare a
// measurement level, so this is a reading of the data, not a fact about how
// the question was asked.
//  categorical: text values, or numbers with at most two distinct values
//  discrete:    whole numbers with 3 to 10 distinct values (rating scales,
//               counts, coded answers): ordinal or interval, treated alike
//  continuous:  decimals, or whole numbers with more than 10 distinct values
export type VariableType = "categorical" | "discrete" | "continuous";

export type VariableQuality = {
  name: string;
  type: VariableType;
  missing: number;
  missingPct: number;
  distinct: number;
  constant: boolean;
  unlabelled: boolean;
  /**
   * Set when this variable's empty cells follow a routing pattern: it is
   * empty for (nearly) everyone who gave certain answers to this other
   * variable, and answered by (nearly) everyone else. That is how a survey
   * skips questions, so the gaps are by design, not bad data.
   */
  routedBy?: string | null;
  /** Where the routing came from: read off the questionnaire, or detected from the data. */
  routedSource?: "questionnaire" | "detected";
  /**
   * With stated routing: how many cases the questionnaire says were asked, and
   * how many of those are empty. Gaps among cases that were not asked are by
   * design; gaps among those asked are real missing data.
   */
  askedCount?: number;
  missingAsked?: number;
};

export type QualityCheck = {
  id: string;
  label: string;
  status: QualityStatus;
  detail: string;
};

export type TableQuality = {
  typeCounts: Record<VariableType, number>;
  variableDetails: VariableQuality[];
  kind: "raw" | "aggregated";
  cases: number;
  variables: number;
  cells: number;
  missingCells: number;
  missingPct: number;
  duplicateCases: number;
  constantVariables: number;
  unlabelledVariables: number;
  worstVariables: VariableQuality[];
  /** Variables over the missing threshold that are explained by a routing pattern. */
  routedVariables: number;
  /** Share of cells empty once routed variables are set aside. */
  unexplainedMissingPct: number;
  checks: QualityCheck[];
  status: QualityStatus;
};

// Thresholds are deliberately plain and visible, so a researcher can argue
// with them. A variable more than WARN is flagged, more than FAIL is
// treated as unusable for comparisons.
export const MISSING_WARN_PCT = 20;
export const MISSING_FAIL_PCT = 50;
export const OVERALL_MISSING_WARN_PCT = 5;
export const OVERALL_MISSING_FAIL_PCT = 20;
export const MIN_CASES_WARN = 100;
export const MIN_CASES_FAIL = 30;

const MISSING_TOKENS = new Set(["na", "n/a", "nan", "null", "#n/a", "."]);

export function isMissing(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  const text = value.trim().toLowerCase();
  return text === "" || MISSING_TOKENS.has(text);
}

// A header that is a bare code ("Q12", "VAR00007", "Column3", "V5") or
// empty tells a reader nothing about what was asked.
const GENERIC_HEADER = /^(var|v|q|col|column|field|x)[\s_]*\d+$/i;

export function isUnlabelledHeader(header: string): boolean {
  const text = header.trim();
  return text === "" || GENERIC_HEADER.test(text);
}

function asNumber(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/,/g, "");
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function inferVariableType(values: CellValue[]): VariableType {
  const present = values.filter((v) => !isMissing(v));
  if (present.length === 0) return "categorical";
  const numbers = present.map(asNumber);
  const numeric = numbers.filter((n): n is number => n !== null);
  if (numeric.length / present.length < 0.9) return "categorical";
  const distinct = new Set(numeric).size;
  if (distinct <= 2) return "categorical";
  const wholeNumbers = numeric.every((n) => Number.isInteger(n));
  if (wholeNumbers && distinct <= 10) return "discrete";
  return "continuous";
}

function worst(a: QualityStatus, b: QualityStatus): QualityStatus {
  const rank = { pass: 0, warn: 1, fail: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

// Routing detection only runs on tables big enough for a split to mean
// something, and treats a split as clean at 95%.
const ROUTING_MIN_CASES = 50;
const ROUTING_CLEAN = 0.95;
const ROUTING_MAX_KEYS = 15;

/**
 * Looks for a variable that explains why `target` is empty: a gate question
 * whose answers split the cases into "target nearly always empty" and
 * "target nearly always answered". Empty answers to the gate count as one
 * more answer, so chained routing is found too. Among the gates that fit,
 * the one most people answered is named, since that is the real filter
 * question and not a sibling that was skipped alongside.
 */
function findRoutingVariable(
  targetIdx: number,
  columns: CellValue[][],
  headers: string[],
  missingByVar: number[],
): string | null {
  const target = columns[targetIdx];
  const targetMissing = target.map((v) => isMissing(v));
  const totalMissing = missingByVar[targetIdx];
  let best: { name: string; missing: number } | null = null;
  for (let w = 0; w < columns.length; w++) {
    if (w === targetIdx) continue;
    const keys = new Map<string, { n: number; miss: number }>();
    let tooMany = false;
    for (let i = 0; i < target.length; i++) {
      const v = columns[w][i];
      const key = isMissing(v) ? "\u2205" : String(v);
      let g = keys.get(key);
      if (!g) {
        if (keys.size >= ROUTING_MAX_KEYS) {
          tooMany = true;
          break;
        }
        g = { n: 0, miss: 0 };
        keys.set(key, g);
      }
      g.n += 1;
      if (targetMissing[i]) g.miss += 1;
    }
    if (tooMany || keys.size < 2) continue;
    let high = 0;
    let low = 0;
    let lowMissing = 0;
    let clean = true;
    for (const g of keys.values()) {
      const rate = g.miss / g.n;
      if (rate >= ROUTING_CLEAN) high += 1;
      else if (rate <= 1 - ROUTING_CLEAN) {
        low += 1;
        lowMissing += g.miss;
      } else {
        clean = false;
        break;
      }
    }
    if (!clean || high === 0 || low === 0) continue;
    if (lowMissing > (1 - ROUTING_CLEAN) * totalMissing) continue;
    if (!best || missingByVar[w] < best.missing) best = { name: headers[w], missing: missingByVar[w] };
  }
  return best ? best.name : null;
}

export function computeTableQuality(
  headers: string[],
  rows: Record<string, CellValue>[],
  kind: "raw" | "aggregated",
  stated: StatedRouting[] = [],
): TableQuality {
  const cases = rows.length;
  const variables = headers.length;
  const cells = cases * variables;

  const columns: CellValue[][] = [];
  const perVariable: VariableQuality[] = headers.map((name) => {
    let missing = 0;
    const seen = new Set<string>();
    const column: CellValue[] = [];
    for (const row of rows) {
      const value = row[name];
      column.push(value);
      if (isMissing(value)) {
        missing += 1;
      } else {
        seen.add(String(value));
      }
    }
    columns.push(column);
    return {
      name,
      type: inferVariableType(column),
      missing,
      missingPct: pct(missing, cases),
      distinct: seen.size,
      constant: cases > 1 && seen.size <= 1,
      unlabelled: isUnlabelledHeader(name),
    };
  });

  const typeCounts: Record<VariableType, number> = {
    categorical: 0,
    discrete: 0,
    continuous: 0,
  };
  for (const v of perVariable) typeCounts[v.type] += 1;

  const missingCells = perVariable.reduce((sum, v) => sum + v.missing, 0);
  const missingPct = pct(missingCells, cells);

  let duplicateCases = 0;
  if (kind === "raw") {
    const seenRows = new Set<string>();
    for (const row of rows) {
      const key = JSON.stringify(headers.map((h) => row[h] ?? null));
      if (seenRows.has(key)) duplicateCases += 1;
      else seenRows.add(key);
    }
  }

  // Survey routing: set aside variables whose gaps are explained by a gate question.
  if (kind === "raw" && cases >= ROUTING_MIN_CASES) {
    const missingByVar = perVariable.map((v) => v.missing);
    perVariable.forEach((v, idx) => {
      if (v.missingPct > MISSING_WARN_PCT && !v.constant) {
        v.routedBy = findRoutingVariable(idx, columns, headers, missingByVar);
      }
    });
  }
  for (const v of perVariable) if (v.routedBy && !v.routedSource) v.routedSource = "detected";

  // Skip instructions read off a confirmed questionnaire take priority over
  // detection, but only when the data fits them: nearly everyone the rule says
  // was not asked must indeed be empty. Otherwise the rule is left unused.
  if (kind === "raw" && stated.length > 0) {
    const idxByHeader = new Map(headers.map((h, i) => [h, i]));
    const statedByHeader = new Map(stated.map((s) => [s.header, s]));
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    perVariable.forEach((v, idx) => {
      const s = statedByHeader.get(v.name);
      if (!s) return;
      const gates = Object.entries(s.gates).map(([code, g]) => {
        const col = idxByHeader.get(g.header);
        const byLabel = new Map<string, string>();
        for (const o of g.options) {
          byLabel.set(norm(o.label), o.code);
          byLabel.set(`code${norm(o.code)}`, o.code);
        }
        return { code, col, byLabel };
      });
      if (gates.some((g) => g.col === undefined)) return;
      let asked = 0;
      let missAsked = 0;
      let notAsked = 0;
      let answeredNotAsked = 0;
      for (let i = 0; i < cases; i++) {
        const answers: Record<string, string | null> = {};
        for (const g of gates) {
          const raw = columns[g.col as number][i];
          answers[g.code] = isMissing(raw) ? null : (g.byLabel.get(norm(String(raw))) ?? String(raw));
        }
        const el = isEligible(s.routing, answers);
        const empty = isMissing(columns[idx][i]);
        if (el === false) {
          notAsked += 1;
          if (!empty) answeredNotAsked += 1;
        } else {
          asked += 1;
          if (empty) missAsked += 1;
        }
      }
      if (notAsked === 0 || answeredNotAsked / notAsked > 0.1) return;
      v.routedBy = s.gates[Object.keys(s.gates)[0]].header;
      v.routedSource = "questionnaire";
      v.askedCount = asked;
      v.missingAsked = missAsked;
    });
  }

  const routed = perVariable.filter((v) => v.routedBy);
  const askedPct = (v: VariableQuality) =>
    v.askedCount !== undefined ? pct(v.missingAsked ?? 0, v.askedCount) : v.missingPct;
  // A variable whose gaps are fully explained is set aside; one with stated
  // routing is judged on the cases that were actually asked.
  const explained = (v: VariableQuality) => !!v.routedBy && v.askedCount === undefined;
  const unroutedCells = perVariable.reduce(
    (sum, v) => sum + (v.askedCount !== undefined ? v.askedCount : v.routedBy ? 0 : cases),
    0,
  );
  const unroutedMissing = perVariable.reduce(
    (sum, v) => sum + (v.askedCount !== undefined ? (v.missingAsked ?? 0) : v.routedBy ? 0 : v.missing),
    0,
  );
  const unexplainedMissingPct = pct(unroutedMissing, unroutedCells);

  const constantVariables = perVariable.filter((v) => v.constant).length;
  const unlabelledVariables = perVariable.filter((v) => v.unlabelled).length;
  const warnVariables = perVariable.filter(
    (v) => !explained(v) && askedPct(v) > MISSING_WARN_PCT,
  );
  const failVariables = perVariable.filter(
    (v) => !explained(v) && askedPct(v) > MISSING_FAIL_PCT,
  );

  const checks: QualityCheck[] = [];

  checks.push({
    id: "missing_overall",
    label: "Missing values overall",
    status:
      unexplainedMissingPct > OVERALL_MISSING_FAIL_PCT
        ? "fail"
        : unexplainedMissingPct > OVERALL_MISSING_WARN_PCT
          ? "warn"
          : "pass",
    detail:
      `${missingCells} of ${cells} cells empty (${missingPct}%).` +
      (routed.length > 0
        ? ` Setting aside ${routed.length} routed question${routed.length === 1 ? "" : "s"} (see below), ${unexplainedMissingPct}% of the rest is empty.` +
          (routed.some((v) => v.routedSource === "questionnaire")
            ? ` ${routed.filter((v) => v.routedSource === "questionnaire").length} follow the questionnaire's skip instructions, and only respondents who were asked count toward their gaps.`
            : "")
        : ""),
  });

  checks.push({
    id: "missing_by_variable",
    label: "Missing values by variable",
    status:
      failVariables.length > 0
        ? "fail"
        : warnVariables.length > 0
          ? "warn"
          : "pass",
    detail:
      (warnVariables.length === 0
        ? `No variable is more than ${MISSING_WARN_PCT}% empty without an explanation.`
        : `${warnVariables.length} variable${warnVariables.length === 1 ? "" : "s"} more than ${MISSING_WARN_PCT}% empty` +
          (failVariables.length > 0
            ? `, ${failVariables.length} more than ${MISSING_FAIL_PCT}%.`
            : ".")) +
      (routed.length > 0
        ? ` ${routed.length} more ${routed.length === 1 ? "is" : "are"} empty by routing: asked only of respondents who gave certain answers to another question, so the gaps are by design.`
        : ""),
  });

  if (kind === "raw") {
    checks.push({
      id: "sample_size",
      label: "Number of cases",
      status:
        cases < MIN_CASES_FAIL
          ? "fail"
          : cases < MIN_CASES_WARN
            ? "warn"
            : "pass",
      detail:
        cases < MIN_CASES_WARN
          ? `${cases} cases. Subgroup comparisons will rest on small bases.`
          : `${cases} cases.`,
    });
    checks.push({
      id: "duplicates",
      label: "Duplicate cases",
      status: duplicateCases > 0 ? "warn" : "pass",
      detail:
        duplicateCases > 0
          ? `${duplicateCases} case${duplicateCases === 1 ? " is" : "s are"} an exact copy of an earlier one.`
          : "No exact duplicate cases.",
    });
    checks.push({
      id: "constant",
      label: "Variables with no variation",
      status: constantVariables > 0 ? "warn" : "pass",
      detail:
        constantVariables > 0
          ? `${constantVariables} variable${constantVariables === 1 ? "" : "s"} hold a single value for every case.`
          : "Every variable varies.",
    });
  }

  checks.push({
    id: "labels",
    label: "Variable labels",
    status: unlabelledVariables > 0 ? "warn" : "pass",
    detail:
      unlabelledVariables > 0
        ? `${unlabelledVariables} variable${unlabelledVariables === 1 ? " has" : "s have"} a code or blank name instead of a label.`
        : "Every variable has a descriptive name.",
  });

  const status = checks.reduce<QualityStatus>(
    (acc, c) => worst(acc, c.status),
    "pass",
  );

  const worstVariables = [...perVariable]
    .filter((v) => v.missing > 0 || v.constant || v.unlabelled)
    .sort((a, b) => (a.routedBy ? 1 : 0) - (b.routedBy ? 1 : 0) || b.missingPct - a.missingPct)
    .slice(0, 8);

  return {
    typeCounts,
    variableDetails: perVariable,
    kind,
    cases,
    variables,
    cells,
    missingCells,
    missingPct,
    duplicateCases,
    constantVariables,
    unlabelledVariables,
    worstVariables,
    routedVariables: routed.length,
    unexplainedMissingPct,
    checks,
    status,
  };
}
