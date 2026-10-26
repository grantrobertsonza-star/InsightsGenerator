import { describe, expect, it } from "vitest";
import { compareWaves, suggestRelated, twoSidedP, waveStem } from "../outputWaves";
import { parseDelimitedAll, type OutputKind } from "../outputClassify";
import type { SetFileData } from "../outputAnalysis";

let n = 0;
const file = (path: string, kind: OutputKind, csv: string): SetFileData => ({
  id: `w${n++}`,
  name: path.split("/").pop() as string,
  path,
  family: "Model",
  role: "evidence",
  kind,
  table: parseDelimitedAll(csv, ".csv"),
  text: null,
});
const coef = (rows: [string, number, number][]) =>
  "Estimate,Std. Error,t value,Pr(>|t|),term\n" + rows.map(([t, e, s]) => `${e},${s},${e / s},${Math.abs(e / s) > 1.96 ? 0.01 : 0.5},"${t}"`).join("\n");

describe("waveStem and suggestRelated", () => {
  it("ignores wave, year and version tokens", () => {
    expect(waveStem("Wave1_DV1_Model1_coefficients_2023.csv")).toBe(waveStem("Wave2_DV1_Model1_coefficients_2024.csv"));
  });
  it("suggests the same output again when most names match", () => {
    const a = { id: "a", name: "Output 2023", waveLabel: null, files: [{ name: "w1_m1_coef.csv" }, { name: "w1_m2_coef.csv" }, { name: "w1_clusters.csv" }] };
    const b = { id: "b", name: "Output 2024", waveLabel: null, files: [{ name: "w2_m1_coef.csv" }, { name: "w2_m2_coef.csv" }, { name: "w2_clusters.csv" }] };
    const r = suggestRelated([a, b]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("same_output_again");
  });
  it("suggests parts of one output when the label is shared and no files are", () => {
    const a = { id: "a", name: "Models", waveLabel: "Wave 3", files: [{ name: "m1.csv" }] };
    const b = { id: "b", name: "Clusters", waveLabel: "Wave 3", files: [{ name: "k4.csv" }] };
    expect(suggestRelated([a, b])[0].kind).toBe("parts_of_one_output");
  });
  it("suggests nothing for unrelated sets", () => {
    const a = { id: "a", name: "Alpha", waveLabel: null, files: [{ name: "m1.csv" }] };
    const b = { id: "b", name: "Beta", waveLabel: null, files: [{ name: "k4.csv" }] };
    expect(suggestRelated([a, b])).toHaveLength(0);
  });
});

describe("compareWaves", () => {
  it("separates a change larger than sampling error from one within chance", () => {
    const e = [file("w1/Model1_coefficients.csv", "model_coefficients", coef([["(Intercept)", 0, 0.5], ["Region: north", 1.0, 0.1], ["Age: young", 0.5, 0.2]]))];
    const l = [file("w2/Model1_coefficients.csv", "model_coefficients", coef([["(Intercept)", 0, 0.5], ["Region: north", 0.4, 0.1], ["Age: young", 0.55, 0.2]]))];
    const r = compareWaves({ id: "1", label: "Wave 1", files: e }, { id: "2", label: "Wave 2", files: l });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].text).toMatch(/1 of 2 shared terms changed/);
    expect(r.findings[0].text).toMatch(/Region: north \(OR 2.72 then 1.49/);
    expect(r.findings[0].text).toMatch(/Age: young .*within chance/);
    expect(r.findings[0].caveats.some((c) => /independent samples/.test(c.text))).toBe(true);
  });
  it("compares proportions by segment", () => {
    const hdr = "segment_var,segment_level,outcome,prop_pct,se_pct,ci_l_pct,ci_u_pct\n";
    const e = [file("w1/by_segment.csv", "proportions", hdr + "age,18-29,use,70,1.5,67,73\nage,60+,use,30,2,26,34")];
    const l = [file("w2/by_segment.csv", "proportions", hdr + "age,18-29,use,80,1.5,77,83\nage,60+,use,31,2,27,35")];
    const r = compareWaves({ id: "1", label: "Wave 1", files: e }, { id: "2", label: "Wave 2", files: l });
    expect(r.findings[0].text).toMatch(/1 of 2 segments moved/);
    expect(r.findings[0].text).toMatch(/18-29 rose from 70.0% to 80.0%/);
  });
  it("says so when nothing matches", () => {
    const e = [file("w1/a_coef.csv", "model_coefficients", coef([["x", 1, 0.1]]))];
    const l = [file("w2/b_coef.csv", "model_coefficients", coef([["x", 1, 0.1]]))];
    const r = compareWaves({ id: "1", label: "A", files: e }, { id: "2", label: "B", files: l });
    expect(r.findings).toHaveLength(0);
    expect(r.notes.join(" ")).toMatch(/nothing to compare/);
  });
  it("gets the normal tail roughly right", () => {
    expect(Math.abs(twoSidedP(1.96) - 0.05) < 0.002).toBe(true);
  });
});
