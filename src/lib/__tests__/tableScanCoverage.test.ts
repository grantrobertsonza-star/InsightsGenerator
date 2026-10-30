// EF-FND-F01 (batch 62): imported-table discovery examines every column, says which it examined and
// which it left out and why, applies a false discovery rate across the tests it actually ran, and
// reports its per-table cap separately from "nothing found". Through the real computeTablePatterns.
// The q-values are checked against Benjamini-Hochberg worked by hand on the scan's own p-values.
import { describe, expect, it } from "vitest";
import { computeTablePatterns } from "../tableComputation";
import { pearsonCorrelation } from "../stats";

const N = 60;
// X and Y: a strong (not exact) relationship. Fillers: constant, so they correlate with nothing.
const base = Array.from({ length: N }, (_, i) => ({ X: i, Y: i * 3 + 7 + ((i % 3) - 1) / 10 }));
const filler = Array.from({ length: 15 }, (_, i) => `F${i}`);
const withFillers = base.map((r) => ({ ...r, ...Object.fromEntries(filler.map((f) => [f, 0])) }));
const relationship = (headers: string[], rows: Record<string, number | string | null>[], options?: { excludedColumns?: string[] }) =>
  computeTablePatterns(headers, rows, options).patterns.find(
    (p) => p.patternType === "relationship" && [p.statedStats.variable1, p.statedStats.variable2].sort().join() === "X,Y",
  );

describe("every column is examined", () => {
  it("the same pair gives the same finding before and after the old 15-column cutoff", () => {
    const early = relationship(["X", "Y", ...filler], withFillers);
    const late = relationship([...filler, "X", "Y"], withFillers);
    expect(early).toBeDefined();
    expect(late).toBeDefined();
    expect(late!.statedStats.r).toBe(early!.statedStats.r);
    expect(late!.statedStats.pValue).toBe(early!.statedStats.pValue);
  });

  it("reordered headers give the same set of findings", () => {
    const a = computeTablePatterns(["X", ...filler, "Y"], withFillers).patterns.map((p) => p.description).sort();
    const b = computeTablePatterns([...filler.slice().reverse(), "Y", "X"], withFillers).patterns.map((p) =>
      p.description.replace(/^Y and X/, "X and Y"),
    ).sort();
    expect(b).toEqual(a);
  });

  it("a 40-column table reports all 40 as examined or omitted with a reason", () => {
    const rows = base.map((r, i) => ({
      ...r,
      ...Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`N${k}`, (i * (k + 1)) % 7])),
      ID: `case-${i}`,
      Region: ["North", "South", "East"][i % 3],
      Sparse: i < 3 ? 1 : null,
      Same: "x",
      ...Object.fromEntries(Array.from({ length: 4 }, (_, k) => [`T${k}`, `t${(i + k) % 4}`])),
    }));
    const headers = Object.keys(rows[0]);
    expect(headers).toHaveLength(40);
    const { scan } = computeTablePatterns(headers, rows);
    expect(scan.columnsInTable).toBe(40);
    expect(scan.examined.length + scan.omitted.length).toBe(40);
    expect(scan.omitted).toEqual(
      expect.arrayContaining([
        { name: "ID", reason: "too_many_categories" },
        { name: "Sparse", reason: "too_few_values" },
        { name: "Same", reason: "single_value" },
      ]),
    );
    expect(scan.examined.find((e) => e.name === "Region")?.role).toBe("categorical");
    expect(scan.examined.find((e) => e.name === "N29")?.role).toBe("numeric");
    expect(scan.testsRun.relationship).toBeGreaterThan(15 * 14 / 2);
  });

  it("an intentional exclusion is honoured and reported", () => {
    const { patterns, scan } = computeTablePatterns(["X", "Y"], base, { excludedColumns: ["Y"] });
    expect(patterns.some((p) => p.patternType === "relationship")).toBe(false);
    expect(scan.omitted).toEqual([{ name: "Y", reason: "excluded" }]);
  });
});

describe("multiple comparisons scaled to the tests run", () => {
  it("each kept relationship carries its BH q across the whole family, worked by hand", () => {
    // Three numeric columns, three tests: X-Y strong, X-Z and Y-Z weaker.
    const rows = base.map((r, i) => ({ ...r, Z: (i % 5) + i / 20 }));
    const { patterns, scan } = computeTablePatterns(["X", "Y", "Z"], rows);
    expect(scan.testsRun).toEqual({ segmentDifference: 0, relationship: 3 });
    const rels = patterns.filter((p) => p.patternType === "relationship");
    expect(rels.length).toBeGreaterThan(0);
    // Hand BH on all three tests' p-values (the shared test, kept or not): sort ascending,
    // q_k = min over j >= k of p_j * m / j.
    const col = (h: "X" | "Y" | "Z") => rows.map((r) => r[h]);
    const all = [["X", "Y"], ["X", "Z"], ["Y", "Z"]]
      .map(([a, b]) => pearsonCorrelation(col(a as "X"), col(b as "X")).pValue as number)
      .sort((a, b) => a - b);
    const q = all.map((_, k) => Math.min(...all.slice(k).map((p, j) => (p * 3) / (k + j + 1))));
    for (const rel of rels) {
      const k = all.indexOf(rel.statedStats.pValue as number);
      expect(rel.statedStats.qValue).toBeCloseTo(Math.min(1, q[k]), 4);
      expect(rel.statedStats.testsInFamily).toBe(3);
      expect(rel.statedStats.caveats).toEqual(["fdr_controlled_within_table"]);
      expect(rel.description).toMatch(/false discovery rate q=.* across the 3 tests run on this table/);
    }
  });

  it("a p below 0.05 that does not survive the family's false discovery rate is not kept", () => {
    // One weak relationship among many null tests: p < 0.05 alone, q above it.
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = Array.from({ length: 40 }, (_, i) => ({
      A: i,
      B: i * 0.05 + rnd() * 6,
      ...Object.fromEntries(Array.from({ length: 12 }, (_, k) => [`R${k}`, rnd()])),
    }));
    const headers = Object.keys(rows[0]);
    const scan = computeTablePatterns(headers, rows);
    for (const p of scan.patterns.filter((x) => x.patternType !== "outlier")) {
      expect(p.statedStats.qValue as number).toBeLessThan(0.05);
    }
  });
});

describe("a cap is not 'nothing found'", () => {
  it("nothing found: every column examined, tests run, no pattern", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ A: i % 2, B: (i * 7) % 3 === 0 ? 1 : 2 }));
    const { patterns, scan } = computeTablePatterns(["A", "B"], rows);
    expect(patterns).toHaveLength(0);
    expect(scan).toMatchObject({ patternsFound: 0, patternsKept: 0, capped: false });
    expect(scan.examined).toHaveLength(2);
  });
  it("capped: more patterns found than the per-table bound keeps, reported as such", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      Object.fromEntries(Array.from({ length: 12 }, (_, k) => [`V${k}`, i * (k + 1) + ((i * k) % 3)])),
    );
    const { patterns, scan } = computeTablePatterns(Object.keys(rows[0]), rows);
    expect(scan.patternsFound).toBeGreaterThan(scan.selectionCap);
    expect(patterns).toHaveLength(scan.selectionCap);
    expect(scan.capped).toBe(true);
  });
});
