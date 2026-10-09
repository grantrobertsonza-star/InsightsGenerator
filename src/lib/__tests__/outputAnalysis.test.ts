import { describe, expect, it } from "vitest";
import { analyseSet, readReferences, type SetFileData } from "../outputAnalysis";
import { parseDelimitedAll, type OutputKind, type OutputRole } from "../outputClassify";

let n = 0;
function file(path: string, kind: OutputKind, role: OutputRole, csv: string | null, text: string | null = null): SetFileData {
  const name = path.split("/").pop() as string;
  const family = path.includes("/") ? (path.split("/").slice(-2, -1)[0] as string) : "Model";
  return { id: `f${n++}`, name, path, family, role, kind, table: csv ? parseDelimitedAll(csv, ".csv") : null, text };
}

const coefCsv = (rows: [number, number, number, number, string][]) =>
  `"Estimate","Std. Error","t value","Pr(>|t|)","term"\n` + rows.map((r) => `${r[0]},${r[1]},${r[2]},${r[3]},"${r[4]}"`).join("\n");
const orCsv = (rows: [number, number, number, string][]) => `"OR","2.5 %","97.5 %","term"\n` + rows.map((r) => `${r[0]},${r[1]},${r[2]},"${r[3]}"`).join("\n");

const est = 0.8;
const se = 0.25;
const good: [number, number, number, number, string][] = [
  [-0.2, 0.5, -0.4, 0.69, "(Intercept)"],
  [est, se, est / se, 0.0014, "Structural (DV6): high"],
  [-1.3, 0.2, -6.5, 0.00001, "Employment: Unemployed"],
  [0.1, 0.2, 0.5, 0.62, "Gender: male"],
];
const goodOr = (shift = 1): [number, number, number, string][] =>
  good.map(([e, s, , , t]) => [Math.exp(e) * shift, Math.exp(e - 1.96 * s), Math.exp(e + 1.96 * s), t]);

const consoleText = `> finscope$dv6_struct_3cat <- relevel(finscope$dv6_struct_3cat, ref = "low")
> x <- relevel(
+   finscope$other_cat,
+   ref = "NLI: low"
+ )
> d <- d %>% mutate(
+   nli = clean_levels(nli, "NLI"),
+ )`;

describe("readReferences", () => {
  it("reads single-line and wrapped relevel calls and strips a label prefix", () => {
    const refs = readReferences(consoleText);
    expect(refs.find((r) => r.variable === "dv6_struct_3cat")?.level).toBe("low");
    expect(refs.find((r) => r.variable === "other_cat")?.level).toBe("low");
  });
});

describe("analyseSet: models", () => {
  it("passes when odds ratios equal exp(estimate) and writes one finding per model with reference category", () => {
    const files = [
      file("Output/Model1_coefficients.csv", "model_coefficients", "evidence", coefCsv(good)),
      file("Output/Model1_ORs.csv", "odds_ratios", "evidence", orCsv(goodOr())),
      file("Output/console output.docx", "console_log", "provenance", null, consoleText),
      file("Output/gvif.csv", "diagnostics", "assurance", "Model,Mean_Adjusted_GVIF,Max_Adjusted_GVIF\nModel 1 (demographics),1.1,2.5\n"),
    ];
    const a = analyseSet(files);
    expect(a.checks.find((c) => c.id === "or-vs-coef")?.status).toBe("pass");
    expect(a.findings).toHaveLength(1);
    const f = a.findings[0];
    expect(f.text).toMatch(/2 of 3 terms/);
    expect(f.text).toMatch(/Structural \(DV6\): high \(higher odds than low/);
    expect(f.text).toMatch(/Employment: Unemployed \(lower odds/);
    expect(f.text).not.toMatch(/Gender/);
    expect(f.text).not.toMatch(/—/);
    expect(f.caveats.some((c) => c.severity === "caution" && /Collinearity may matter/.test(c.text))).toBe(true);
    expect(f.caveats.some((c) => /not adjusted/.test(c.text))).toBe(true);
  });

  it("flags odds ratios that do not match the coefficients", () => {
    const files = [
      file("Output/Model1_coefficients.csv", "model_coefficients", "evidence", coefCsv(good)),
      file("Output/Model1_ORs.csv", "odds_ratios", "evidence", orCsv(goodOr(1.2))),
    ];
    const a = analyseSet(files);
    const c = a.checks.find((x) => x.id === "or-vs-coef");
    expect(c?.status).toBe("flag");
    expect(c?.detail).toMatch(/another model run/);
  });

  it("gives no finding when no term reaches p < .05, and says so", () => {
    const flat: [number, number, number, number, string][] = [
      [0.1, 0.2, 0.5, 0.62, "(Intercept)"],
      [0.1, 0.2, 0.5, 0.62, "Gender: male"],
    ];
    const a = analyseSet([file("Output/M2_coefficients.csv", "model_coefficients", "evidence", coefCsv(flat))]);
    expect(a.findings[0].text).toMatch(/none of the 1 terms reached p < .05/);
  });

  it("leaves a robustness collection out of the findings and lists it", () => {
    const long = ["model_id,term,estimate,std_error,statistic,p_value,odds_ratio,or_conf_low,or_conf_high"];
    for (let m = 0; m < 8; m++) long.push(`M${m},x,0.5,0.1,5,0.001,1.65,1.35,2.0`);
    const a = analyseSet([file("Output/robustness_final/04_all_models.csv", "model_coefficients", "evidence", long.join("\n"))]);
    expect(a.findings).toHaveLength(0);
    expect(a.unread[0].reason).toMatch(/Robustness/);
  });
});

describe("analyseSet: assurance", () => {
  it("turns a failed reproduction check into an issue", () => {
    const a = analyseSet([
      file("Output/rep/01_check.csv", "validation_checks", "assurance", "term,expected_odds_ratio,observed_odds_ratio,passed\nx,1.9,1.5,FALSE\ny,2,2,TRUE\n"),
    ]);
    expect(a.checks[0].status).toBe("flag");
    expect(a.caveats[0].severity).toBe("issue");
  });

  it("treats no_obvious_flag as no separation", () => {
    const a = analyseSet([file("Output/d.csv", "diagnostics", "assurance", "model_id,separation_flag,warnings\nM1,no_obvious_flag,\n")]);
    expect(a.checks.find((c) => /^sep-/.test(c.id))?.status).toBe("pass");
  });
});

describe("analyseSet: segments", () => {
  it("writes a proportion finding only when the extreme intervals are apart", () => {
    const csv = [
      "segment_var,segment_level,outcome,prop_pct,se_pct,ci_l_pct,ci_u_pct",
      "gender,Gender: female,dfs_any,60,1,58,62",
      "gender,Gender: male,dfs_any,70,1,68,72",
      "region,Region: A,dfs_any,60,3,54,66",
      "region,Region: B,dfs_any,63,3,57,69",
    ].join("\n");
    const a = analyseSet([file("Output/D3_by_segment.csv", "proportions", "evidence", csv)]);
    expect(a.findings).toHaveLength(1);
    expect(a.findings[0].text).toMatch(/Gender: male was highest at 70.0%/);
  });

  it("describes what separates the clusters and attaches group sizes", () => {
    const profile = "cluster4,score_a,score_b\nCluster 1,5.3,89\nCluster 2,4.0,78\nCluster 3,3.5,54\n";
    const sizes = '"cluster","weighted_total","weighted_share","weighted_percentage"\n"Cluster 1",1,0.2,20\n"Cluster 2",1,0.3,30\n"Cluster 3",1,0.5,50\n';
    const a = analyseSet([
      file("Output/c/profile.csv", "cluster_profile", "evidence", profile),
      file("Output/c/shares.csv", "cluster_profile", "evidence", sizes),
    ]);
    expect(a.findings).toHaveLength(1);
    expect(a.findings[0].text).toMatch(/score b \(Cluster 1 89.0 against Cluster 3 54.0\)|score_b/);
    expect(a.findings[0].text).toMatch(/Cluster 3 50.0%/);
  });
});

describe("analyseSet: tables of odds ratios without coefficients", () => {
  it("sets aside extreme odds ratios with very wide intervals", () => {
    const csv = ["Block,Interaction_Term,OR,CI_low,CI_high,p_value", "B1,a,0.5,0.3,0.8,0.004", "B1,b,95,5,1700,0.002", "B1,c,1.1,0.8,1.5,0.5"].join("\n");
    const a = analyseSet([file("Output/D3_interaction_OR_all.csv", "odds_ratios", "evidence", csv)]);
    expect(a.findings[0].text).toMatch(/2 of 3 terms reached p < .05/);
    expect(a.findings[0].text).toMatch(/1 further terms had extreme odds ratios/);
    expect(a.findings[0].caveats.some((c) => c.severity === "caution")).toBe(true);
  });
});

describe("analyseSet: questionnaire wording", () => {
  it("suggests an item whose wording contains the term group label, and none for derived measures", () => {
    const rows: [number, number, number, number, string][] = [
      [0, 0.5, 0, 1, "(Intercept)"],
      [1.2, 0.2, 6, 0.00001, "Education: Diploma"],
      [0.9, 0.2, 4.5, 0.00001, "Structural (DV6): high"],
    ];
    const files = [file("Output/Model1_coefficients.csv", "model_coefficients", "evidence", coefCsv(rows))];
    const items = [
      { id: "i1", code: "Q5", text: "What is the highest level of education you have completed?" },
      { id: "i2", code: "Q6", text: "Which bank do you use most often?" },
    ];
    const a = analyseSet(files, { items });
    const notes = a.findings[0].caveats.filter((c) => /questionnaire item/.test(c.text));
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toMatch(/Q5/);
    expect(notes[0].text).toMatch(/Education/);
  });
});
