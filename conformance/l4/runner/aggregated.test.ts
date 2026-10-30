// L4 path A: aggregated table files (Excel, CSV) read by the engine's one reader, then every
// deterministic consumer of a stored aggregated table: the claim-check view and checks (tableClaims),
// the Data quality panel (aggregatedQuality), the open pattern scan that writes generated findings
// (tableComputation), the digest charts, and the upload type suggestion. The model's part of a claim
// check (pointing at a cell) is replaced by the atom recorded in cases.json, written from the truth.
// Expected values come from cases.json (generate.py's declared truth or a hand reading), never from
// the app. Results: conformance/l4/out/aggregated.results.json.
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkAtom, fromGeneric, resolveCol, resolveRow, type Atom, type TableView } from "../../../src/lib/tableClaims";
import { computeAggregatedQuality } from "../../../src/lib/aggregatedQuality";
import { computeTablePatterns } from "../../../src/lib/tableComputation";
import { buildTableDigest } from "../../../src/lib/tableDigestCharts";
import { suggestPurposeFor } from "../../../src/lib/uploadPurposes";
import { engineCodebook, engineReadTable, FIXTURES, loadCases, ResultLog, type Case } from "./l4lib";

const log = new ResultLog("aggregated");
afterAll(() => log.write());

type Row = Record<string, string | number | boolean | null>;
type TruthCell = { row: string; col: string; value: number; unit: string; letters?: string; table?: number };
type TruthTable = { title?: string | null; columns?: { group: string; label: string }[]; base_unweighted?: Record<string, number> | null; base_weighted?: Record<string, number>; cells?: TruthCell[]; row_kinds?: Record<string, string>; dash_star?: Record<string, [number, number]> };

const BASE_OR_TOTAL = /^(unweighted |weighted |effective )?(base|total|n|sample size)\b|^net\b/i;
const near = (a: number, b: number, tol = 0.51) => Math.abs(a - b) <= tol;

function stanceOk(expected: string, actual: string) {
  if (expected === "supports_or_silent") return actual === "supports" || actual === "silent";
  return expected === actual;
}

const cases = loadCases().filter((c) => c.path === "A");

describe("L4 path A: aggregated table files", () => {
  for (const c of cases) {
    it(`${c.id} ${c.desc}`, () => {
      const file = path.join(FIXTURES, c.file);
      if (c.truth.codebook) {
        const tr = c.truth as unknown as { variables: string[]; labels: Record<string, string>; suggestion: string };
        const sug = suggestPurposeFor("indicators_datadict.csv", readFileSync(file, "utf8").slice(0, 8000)).id;
        const cb = engineCodebook(file);
        const items = cb.ok ? cb.result.items : [];
        const names = items.map((i) => i.variable);
        const add2 = (check: string, basis: "contract" | "research", expected: unknown, actual: unknown, pass: boolean, severity: "S1" | "S2" | "S3", note?: string) => {
          log.add({ case: c.id, check, basis, expected, actual, pass, severity, note });
          expect.soft(pass, `${c.id} ${check}`).toBe(true);
        };
        add2("suggested_type", "research", tr.suggestion, sug, sug === tr.suggestion, "S3", "File named DATADICT; name rule matches 'data dictionary' and 'datadictionary' only.");
        add2("codebook_variables", "research", { count: tr.variables.length, headerRowNotAVariable: true }, cb.ok ? { count: names.length, includesHeader: names.includes("VARIABLE_ID") } : cb.error,
          cb.ok && names.length === tr.variables.length && !names.includes("VARIABLE_ID"), "S2");
        const wrongLabels = cb.ok ? items.filter((i) => tr.labels[i.variable] !== undefined && (i.label ?? "") !== tr.labels[i.variable]).slice(0, 4).map((i) => ({ variable: i.variable, got: i.label, want: tr.labels[i.variable] })) : [];
        add2("codebook_labels_from_label_column", "research", "labels from VARIABLE_LABEL", wrongLabels.length ? wrongLabels : "all match", cb.ok && wrongLabels.length === 0, "S2");
        log.extra[c.id] = cb.ok ? { items: items.slice(0, 5) } : cb;
        return;
      }
      const ans = engineReadTable(file);
      const add = (check: string, basis: "contract" | "research", expected: unknown, actual: unknown, pass: boolean, severity?: "S1" | "S2" | "S3", note?: string) => {
        log.add({ case: c.id, check, basis, expected, actual, pass, severity, note });
        expect.soft(pass, `${c.id} ${check}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`).toBe(true);
      };
      add("engine_reads", "contract", "a table", ans.ok ? "a table" : `refused: ${(ans as { error: string }).error}`, ans.ok, "S1");
      if (!ans.ok) return;
      const headers = ans.headers;
      const rows = ans.rows as Row[];
      log.extra[c.id] = { sheet: ans.sheetName, headers, firstRows: rows.slice(0, 4) };

      // --- Case-level files uploaded as Tables: the engine read must equal the hand reading.
      if (c.truth.case_level) {
        const hand = c.truth.hand_reading as { headers: string[]; rows: Row[] };
        const same = JSON.stringify(headers) === JSON.stringify(hand.headers) && rows.length === hand.rows.length &&
          hand.rows.every((h, i) => hand.headers.every((k) => (h[k] ?? null) === (rows[i][k] ?? null)));
        add("engine_equals_hand_reading", "contract", { headers: hand.headers, rows: hand.rows.length }, { headers, rows: rows.length }, same, "S1");
        const pats = computeTablePatterns(headers, rows as Record<string, string | number | null>[]).patterns;
        log.extra[`${c.id}.patterns`] = pats.map((p) => p.description);
        add("case_level_file_recognised", "research", "refused or flagged as case-level data when uploaded as Tables",
          `stored as an aggregated table; the open scan would store ${pats.length} accepted generated findings`, false, "S3",
          "No contract: ingestion_type comes from the upload slot only.");
        return;
      }

      // --- Data360 DHS indicator files (SDMX long and wide).
      if (c.truth.dhs) {
        const tr = c.truth as unknown as { rows: number; columns: number; identity_columns: string[]; distinct_identities: number; value_column?: string; unit: string; constant_columns: string[];
          first_observations?: { dims: Record<string, string>; value: number }[]; first_filled?: { row: number; year: string; value: number }[]; suggestion: string };
        add("engine_shape", "contract", { rows: tr.rows, columns: tr.columns }, { rows: rows.length, columns: headers.length }, rows.length === tr.rows && headers.length === tr.columns, "S1");
        const valuesOk = tr.first_observations
          ? tr.first_observations.every((o, i) => rows[i][tr.value_column!] === o.value && tr.identity_columns.every((d) => String(rows[i][d] ?? "") === o.dims[d]))
          : (tr.first_filled ?? []).every((f) => rows[f.row][f.year] === f.value);
        add("engine_values", "contract", tr.first_observations ?? tr.first_filled, "first observations compared by identity", valuesOk, "S1");
        const sample = readFileSync(file, "utf8").slice(0, 8000);
        const sug = suggestPurposeFor("indicators.csv", sample).id;
        add("suggested_type", "research", tr.suggestion, sug, sug === tr.suggestion, "S3", "Aggregated indicators with no Total/Base row and percentages as plain numbers.");
        const view = fromGeneric("t", "d", "label", headers, rows);
        add("row_identity_kept", "research", `${tr.distinct_identities} distinct rows identified by ${tr.identity_columns.join(", ")}`, `${view.rows.length} row(s): ${view.rows.slice(0, 3).join(" | ")}`,
          view.rows.length === tr.distinct_identities, "S2", "fromGeneric takes the first column as the row label and keeps the first row per label.");
        const constUsed = tr.constant_columns.filter((k) => view.cols.includes(k));
        add("constant_columns_ignored", "research", "constant metadata columns (STRUCTURE, DATABASE_ID, DECIMALS ...) not offered as data columns", { offered: constUsed.length, of: tr.constant_columns.length },
          constUsed.length === 0, "S3");
        for (const cl of c.claims ?? []) {
          const res = checkAtom(view, cl.atom as unknown as Atom);
          const main = res.find((r) => r.check !== "locate") ?? res[0];
          add(`claim:${cl.id}`, "contract", cl.expected, { stance: main.stance, summary: main.summary }, stanceOk(cl.expected, main.stance), main.stance === "against" ? "S1" : "S2", cl.why);
        }
        const q = computeAggregatedQuality([{ label: null, headers, rows: rows as Record<string, string | number | null>[] }]);
        log.extra[`${c.id}.quality`] = q.checks;
        const pats = computeTablePatterns(headers, rows as Record<string, string | number | null>[]).patterns;
        log.extra[`${c.id}.patterns`] = pats.map((p) => p.description);
        const meta = /^(TIME_PERIOD|REF_AREA|DECIMALS|UNIT_MULT|TIME_FORMAT|OBS_STATUS|OBS_CONF|ACTION|STRUCTURE|STRUCTURE_ID|DATABASE_ID|FREQ)$/;
        const bad = pats.filter((p) => [p.statedStats.variable1, p.statedStats.variable2, p.statedStats.column, p.statedStats.bannerColumn, p.statedStats.stubColumn].some((v) => typeof v === "string" && meta.test(v)));
        add("generated_findings_sound", "research", "no generated finding treats a dimension (year, country) or a metadata column as a measure", { generated: pats.length, onMetadata: bad.slice(0, 3).map((p) => p.description) }, bad.length === 0, "S2");
        return;
      }
      const truthTables = (c.truth.tables ?? []) as TruthTable[];
      const view: TableView = fromGeneric("t", "d", "label", headers, rows);

      // --- Upload type suggestion (CSV only reads content).
      if (c.truth.suggestion && c.file.endsWith(".csv")) {
        const sample = readFileSync(file, "utf8").slice(0, 8000);
        const s = suggestPurposeFor("wave3_results.csv", sample).id;
        add("suggested_type", "research", c.truth.suggestion, s, s === c.truth.suggestion, "S3", "csvLooksLikeTables rule (upload-type-suggestions.md); file renamed to a neutral name");
      }

      // --- Table count.
      add("tables_found", "research", truthTables.length, 1, truthTables.length === 1, "S2", "The engine path always stores one table per file.");

      // --- Column identity and groups (first truth table).
      const t0 = truthTables[0] ?? {};
      if (t0.columns) {
        const want = t0.columns.map((x) => x.label);
        const own = (l: string) => headers.find((h) => h === l || (c.truth.headers_carry_n && h.startsWith(`${l} (n=`))) ?? null;
        const found = want.filter((l) => own(l) !== null);
        add("column_headers", "research", want, headers, found.length === want.length, "S2");
        // A claim names a column by its label; it must resolve to that column or to nothing, never to another.
        const wrong = want.map((l) => ({ label: l, resolved: resolveCol(view, l) })).filter((x) => x.resolved !== null && x.resolved !== own(x.label));
        add("column_resolution_never_wrong", "contract", "each label resolves to its own column or to none", wrong.length ? wrong : "none resolved to another column",
          wrong.length === 0, "S2", "tableClaims.ts: where the table does not settle it the result is silent, never a guess (matchLabel loose matching)");
        const groups = [...new Set(t0.columns.map((x) => x.group).filter((g) => g && !want.includes(g)))];
        if (groups.length > 0) {
          const kept = groups.filter((g) => headers.some((h) => h.includes(g)));
          add("column_groups", "research", groups, kept, kept.length === groups.length, "S2", "Group (banner variable) identity of each column");
        }
      }
      if (t0.title) {
        const titleAsHeader = headers.some((h) => h.includes(String(t0.title)));
        add("title_not_a_column", "research", "title kept as the table label, not a column name", titleAsHeader ? "title is a column name" : "not a column name", !titleAsHeader, "S2");
      }

      // --- Cells by row and column identity.
      const allCells = truthTables.flatMap((t, ti) => (t.cells ?? []).map((x) => ({ ...x, table: x.table ?? ti })));
      if (allCells.length > 0) {
        const misses: unknown[] = [];
        let ok = 0;
        for (const tc of allCells) {
          const r = resolveRow(view, tc.row);
          const col = resolveCol(view, tc.col);
          const cell = r && col ? view.cell(r, col) : null;
          const good = !!cell && cell.value !== null && near(cell.value, tc.value, tc.unit === "percent" ? 0.051 : 0.51) &&
            (tc.unit === "percent" ? cell.measure === "percent" : cell.measure !== "percent");
          if (good) ok++;
          else if (misses.length < 6) misses.push({ row: tc.row, col: tc.col, table: tc.table, want: `${tc.value} ${tc.unit}`, got: cell ? `${cell.value} ${cell.measure}` : `row ${r ?? "not found"}, col ${col ?? "not found"}` });
        }
        add("cells_by_identity", "research", `${allCells.length} of ${allCells.length}`, { matched: ok, firstMisses: misses }, ok === allCells.length, "S2",
          "Looked up the way a claim check looks them up (tableClaims.fromGeneric/resolveRow/resolveCol).");
        const lettered = allCells.filter((x) => x.letters);
        if (lettered.length > 0 && c.truth.letters_in_file) {
          const kept = lettered.filter((x) => {
            const r = resolveRow(view, x.row);
            const col = resolveCol(view, x.col);
            const raw = r && col ? rows.find((rw) => String(rw[headers[0]] ?? "").trim() === r)?.[col] : undefined;
            return typeof raw === "string" && raw.endsWith(x.letters!);
          });
          add("significance_letters", "research", `${lettered.length} lettered cells keep their letters as a separate significance mark`,
            `${kept.length} keep the letters inside the cell text; none is parsed as significance`, false, "S3",
            "Letters survive only as text inside the value; nothing reads them as a significance result.");
        }
      }
      if (t0.dash_star) {
        const bad: unknown[] = [];
        for (const [k, [lo, hi]] of Object.entries(t0.dash_star)) {
          const [rl, cl] = k.split("|");
          const r = resolveRow(view, rl); const col = resolveCol(view, cl);
          const cell = r && col ? view.cell(r, col) : null;
          const v = cell?.value ?? null;
          if (!(v !== null && v >= lo - 1e-9 && v <= hi + 1e-9)) bad.push({ cell: k, want: lo === hi ? lo : `${lo} < x < ${hi}`, got: v });
        }
        add("dash_star_values", "research", "'-' read as 0, '*' as between 0 and 0.5", bad.length ? bad : "all as expected", bad.length === 0, "S3");
      }

      // --- Base used for each column (the unweighted base, as a researcher tests on).
      if (t0.base_unweighted && t0.cells?.length) {
        const answerRow = t0.cells[0].row;
        const r = resolveRow(view, answerRow);
        const got: Record<string, number | null> = {};
        let good = true;
        for (const [colLabel, n] of Object.entries(t0.base_unweighted)) {
          const col = resolveCol(view, colLabel);
          const b = r && col ? view.cell(r, col)?.base ?? null : null;
          got[colLabel] = b;
          if (b !== n) good = false;
        }
        add("base_per_column", "research", t0.base_unweighted, got, good, "S2", "The base tableClaims uses for the interval and the low-base rule.");
      }

      // --- Claim checks with recorded cell-pointing (tier a and b are deterministic).
      for (const cl of c.claims ?? []) {
        const results = checkAtom(view, cl.atom as unknown as Atom);
        const stances = results.map((r) => r.stance);
        const main = results.find((r) => r.check !== "locate") ?? results[0];
        const pass = stanceOk(cl.expected, main.stance);
        const wrongWay = (cl.expected.startsWith("supports") && main.stance === "against") || (cl.expected === "against" && main.stance === "supports");
        add(`claim:${cl.id}`, cl.expected === "supports_or_silent" ? "contract" : "research", cl.expected,
          { stances, summary: main.summary }, pass, wrongWay ? "S1" : "S2",
          cl.expected === "supports_or_silent" ? "tableClaims.ts: where the measure is unclear the result is silent, never a guess" : cl.why);
      }

      // --- Data quality panel.
      const q = computeAggregatedQuality([{ label: null, headers, rows: rows as Record<string, string | number | null>[] }]);
      log.extra[`${c.id}.quality`] = q.checks;
      if (truthTables.length > 0) add("quality_table_count", "research", truthTables.length, q.tables, q.tables === truthTables.length, "S3");
      const truthBases = truthTables.flatMap((t) => Object.values(t.base_unweighted ?? {}));
      if (truthBases.length > 0) {
        const want = Math.min(...truthBases);
        add("quality_base_found", "research", { withBase: 1, smallest: want }, { withBase: q.withBase, smallest: q.bases.min }, q.withBase >= 1 && q.bases.min === want, "S3",
          "Smallest stated base (unweighted). A weighted base also counted as a base inflates the count but not this check.");
      } else if (truthTables.length > 0 && truthTables.every((t) => t.base_unweighted === null)) {
        const baseCheck = q.checks.find((x) => x.id === "base");
        add("quality_no_base_reported", "research", "no base n stated; base described in each label", baseCheck?.detail ?? null, baseCheck?.status === "fail" || baseCheck?.status === "warn", "S3");
      }
      const pctCheck = q.checks.find((x) => x.id === "percent_sums");
      const hasPct = allCells.some((x) => x.unit === "percent");
      if (hasPct && truthTables.some((t) => t.row_kinds)) {
        add("quality_percent_columns_checked", "research", "percentage columns recognised and checked (nets excluded from the sum)", pctCheck?.detail ?? "no percentage check ran",
          !!pctCheck && pctCheck.status === "pass" && !/further off/.test(pctCheck.detail), "S3");
      }

      // --- Generated findings (open scan): no finding may treat a base, total or net row as a data point,
      // and no finding may be built on a title or blank allocated name.
      const pats = computeTablePatterns(headers, rows as Record<string, string | number | null>[]).patterns;
      log.extra[`${c.id}.patterns`] = pats.map((p) => ({ type: p.patternType, text: p.description }));
      const labelCol = headers[0];
      const isStructural = (i: number) => BASE_OR_TOTAL.test(String(rows[i]?.[labelCol] ?? "").trim());
      const badNames = (s: string) => /^\s*\(\d+\)$|^$/.test(s) || (t0.title ? s.includes(String(t0.title)) : false);
      const offending = pats.filter((p) => {
        if (p.rowIndices.some(isStructural)) return true;
        if (p.patternType === "relationship") {
          const a = String(p.statedStats.variable1), b = String(p.statedStats.variable2);
          if (badNames(a) || badNames(b)) return true;
          return rows.some((r, i) => isStructural(i) && typeof r[a] === "number" && typeof r[b] === "number");
        }
        if (p.patternType === "outlier" && badNames(String(p.statedStats.column))) return true;
        return false;
      });
      add("generated_findings_sound", "research", "no generated finding uses a base/total/net row as a data point or a title/blank name as a variable",
        { generated: pats.length, unsound: offending.slice(0, 4).map((p) => p.description) }, offending.length === 0, "S2",
        "These are stored as accepted findings (generateFindingsFromTable).");

      // --- Digest charts: a column of answer labels and percentages must not be digested as a numeric distribution
      // of mixed base and percentage values (recorded only).
      log.extra[`${c.id}.digest`] = buildTableDigest(headers, rows).map((d) => ({ column: d.column, kind: d.kind }));
    });
  }
});
