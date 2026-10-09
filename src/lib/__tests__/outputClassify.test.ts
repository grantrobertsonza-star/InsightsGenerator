import { describe, expect, it } from "vitest";
import { assignFamilies, classifyOutput, parseDelimited, roleCounts } from "../outputClassify";

const prof = (csv: string) => parseDelimited(csv, ".csv");
const cls = (name: string, csv: string) => classifyOutput({ name, path: name, ext: ".csv", profile: prof(csv) });

describe("parseDelimited", () => {
  it("reads quotes, a BOM and counts rows", () => {
    const p = parseDelimited('﻿"a","b"\r\n1,"x, y"\r\n2,"he said ""hi"""\r\n', ".csv");
    expect(p.headers).toEqual(["a", "b"]);
    expect(p.rowCount).toBe(2);
    expect(p.sample[0][1]).toBe("x, y");
    expect(p.sample[1][1]).toBe('he said "hi"');
  });
});

describe("classifyOutput", () => {
  it("recognises model coefficients", () => {
    const c = cls("m1_coefficients.csv", '"Estimate","Std. Error","t value","Pr(>|t|)","term"\n1,0.2,5,0.01,"x"\n');
    expect(c.kind).toBe("model_coefficients");
    expect(c.role).toBe("evidence");
  });
  it("recognises odds ratios with intervals", () => {
    const c = cls("m1_ORs.csv", '"OR","2.5 %","97.5 %","term"\n2.2,1.3,3.7,"x"\n');
    expect(c.kind).toBe("odds_ratios");
  });
  it("treats diagnostics as assurance", () => {
    expect(cls("deff.csv", 'Outcome,Weighted_mean,SE,DEFF\na,0.6,0.01,2.2\n').role).toBe("assurance");
    expect(cls("v.csv", "Model,Mean_Adjusted_GVIF,Max_Adjusted_GVIF\nM1,1.1,1.3\n").role).toBe("assurance");
  });
  it("treats pass/fail files as validation", () => {
    const c = cls("checks.csv", "check,differences,status\nA,0,PASS\nB,0,PASS\n");
    expect(c.kind).toBe("validation_checks");
  });
  it("treats a replication file as assurance even with ratio columns", () => {
    const c = cls("01_exact_replication_check.csv", "model,OR,ci_low,ci_high,p\nM3,2.0,1.1,3.2,0.01\n");
    expect(c.role).toBe("assurance");
  });
  it("treats item/value files as context", () => {
    expect(cls("run_manifest.csv", "item,value\nR_version,4.5\n").role).toBe("provenance");
  });
  it("reads proportions with intervals as evidence", () => {
    expect(cls("by_seg.csv", "segment,level,prop_pct,se_pct,ci_l_pct,ci_u_pct\na,b,62,1.4,59,65\n").kind).toBe("proportions");
  });
  it("sends the unrecognised to be checked", () => {
    const c = cls("misc.csv", "foo,bar\nx,y\n");
    expect(c.role).toBe("unclassified");
  });
  it("keeps session info apart from a console log", () => {
    const c = classifyOutput({ name: "11_sessionInfo.txt", path: "11_sessionInfo.txt", ext: ".txt", profile: { headers: [], rowCount: 0, sample: [], numericColumns: 0 }, text: "R version 4.5.2" });
    expect(c.kind).toBe("session_info");
    const l = classifyOutput({ name: "console output.docx", path: "console output.docx", ext: ".docx", profile: { headers: [], rowCount: 0, sample: [], numericColumns: 0 }, text: "R version 4.5.2\n> library(survey)" });
    expect(l.kind).toBe("console_log");
  });
});

describe("assignFamilies", () => {
  it("uses folders and shared first words", () => {
    const f = assignFamilies(["DV1_a.csv", "DV1_b.csv", "solo.csv", "robust/00_x.csv", "robust/01_y.csv"]);
    expect(f.get("DV1_a.csv")).toBe("DV1");
    expect(f.get("solo.csv")).toBe("Other files");
    expect(f.get("robust/00_x.csv")).toBe("robust");
  });
  it("counts roles", () => {
    expect(roleCounts([{ role: "evidence" }, { role: "evidence" }, { role: "assurance" }]).evidence).toBe(2);
  });
});
