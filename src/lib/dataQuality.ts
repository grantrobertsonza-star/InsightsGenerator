// Import quality: plain counts and checks over a table as it landed in
// document_tables, with no model involved. Pure and client-safe so the same
// numbers can feed the run page, the report and the tests.

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

export function computeTableQuality(
  headers: string[],
  rows: Record<string, CellValue>[],
  kind: "raw" | "aggregated",
): TableQuality {
  const cases = rows.length;
  const variables = headers.length;
  const cells = cases * variables;

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

  const constantVariables = perVariable.filter((v) => v.constant).length;
  const unlabelledVariables = perVariable.filter((v) => v.unlabelled).length;
  const warnVariables = perVariable.filter(
    (v) => v.missingPct > MISSING_WARN_PCT,
  );
  const failVariables = perVariable.filter(
    (v) => v.missingPct > MISSING_FAIL_PCT,
  );

  const checks: QualityCheck[] = [];

  checks.push({
    id: "missing_overall",
    label: "Missing values overall",
    status:
      missingPct > OVERALL_MISSING_FAIL_PCT
        ? "fail"
        : missingPct > OVERALL_MISSING_WARN_PCT
          ? "warn"
          : "pass",
    detail: `${missingCells} of ${cells} cells empty (${missingPct}%).`,
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
      warnVariables.length === 0
        ? `No variable is more than ${MISSING_WARN_PCT}% empty.`
        : `${warnVariables.length} variable${warnVariables.length === 1 ? "" : "s"} more than ${MISSING_WARN_PCT}% empty` +
          (failVariables.length > 0
            ? `, ${failVariables.length} more than ${MISSING_FAIL_PCT}%.`
            : "."),
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
    .sort((a, b) => b.missingPct - a.missingPct)
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
    checks,
    status,
  };
}
