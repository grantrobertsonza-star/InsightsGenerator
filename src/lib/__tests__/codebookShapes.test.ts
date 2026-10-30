import { PYTHON } from "./helpers/pythonEngine";
// Batch 56 (conformance L2, import test library 28 October 2026): codebook shapes whose answer codes were silently
// lost, or whose headers and title rows were read as variables, through the ACTUAL engine (codebook_items).
// Expected values are written out by hand from the file contents, never from the app's output. Each was a failing
// library case (E037 to E129, X004, FX01/FX05) and passes now; controls show the rules do not over-reach.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;

const DRIVER = String.raw`
import importlib.util, io, json, sys, csv
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
def csvb(rows):
    b = io.StringIO(); csv.writer(b).writerows(rows); return b.getvalue().encode()
def book(sheets):
    wb = Workbook(); wb.remove(wb.active)
    for name, rows in sheets:
        ws = wb.create_sheet(name)
        for r in rows: ws.append(r)
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def read(b, name, tool="codebook_items"):
    try:
        r = getattr(eng, tool)(b, name, {})
        return {"items": [{"v": i["variable"], "label": i.get("label"), "opts": [[o["code"], o["label"]] for o in i.get("options", [])]} for i in r["items"]], "sheets": r.get("sheets"), "skipped": r.get("skippedSheets")}
    except Exception as e:
        return {"error": str(e)}
W = lambda values: csvb([["Variable", "Label", "Values"], ["q1", "Recommend", values], ["q2", "Satisfied", values], ["age", "Age in years", "as is"]])
out = {
  "braces": read(W("{1, Yes}, {2, No}"), "cb.csv"),
  "dot": read(W("1. Yes, 2. No"), "cb.csv"),
  "colon": read(W("1: Yes, 2: No"), "cb.csv"),
  "plain": read(W("1 Yes, 2 No"), "cb.csv"),
  "not_codes": read(W("5 or more, 3 to 4"), "cb.csv"),
  "titles": read(csvb([["Customer survey 2026"], ["Codebook"], ["Version 3"], ["Prepared by Fieldwork Ltd"], ["Contact: data team"], ["Confidential"], ["See notes sheet"], ["Variable", "Label", "Values"], ["q1", "Recommend", "1=Yes, 2=No"], ["age", "Age", "as is"]]), "cb.csv"),
  "var_lab": read(csvb([["Var", "Lab", "Vals"], ["q1", "Recommend", "1=Yes, 2=No"], ["q2", "Satisfied", "1=Yes, 2=No"], ["age", "Age", "as is"]]), "cb.csv"),
  "long_value_code": read(csvb([["Variable Name", "Value Code", "Value Label"], ["q1", "1", "Yes"], ["q1", "2", "No"], ["q2", "1", "Male"], ["q2", "2", "Female"]]), "cb.csv"),
  "spss_values": read(book([("Variable Values", [["", "Value", "Label"], ["q1", 1, "Yes"], ["", 2, "No"], ["q2", 1, "Male"], ["", 2, "Female"]])]), "cb.xlsx"),
  "spss_split": read(book([("Variable Information", [["Variable", "Position", "Label"], ["q1", 1, "Would you recommend us?"], ["q2", 2, "Gender"]]), ("Variable Values", [["Value", "", "Label"], ["q1", 1, "Yes"], ["", 2, "No"], ["q2", 1, "Male"], ["", 2, "Female"]])]), "cb.xlsx"),
  "headerless_long": read(csvb([["q1", "Would you recommend us?", "1", "Yes"], ["q1", "Would you recommend us?", "2", "No"], ["q2", "Satisfaction", "1", "Very satisfied"], ["q2", "Satisfaction", "98", "Don't know"], ["age", "Age in years", "", ""]]), "cb.csv"),
  "across": read(csvb([["Variable", "Label", "1", "2", "9"], ["q1", "Recommend", "Yes", "No", "Don't know"], ["q2", "Satisfied", "Yes", "No", "Don't know"], ["q3", "Return", "Yes", "No", "Don't know"]]), "cb.csv"),
  "pairs": read(csvb([["Variable", "Label", "Code1", "Label1", "Code2", "Label2"], ["q1", "Recommend", "1", "Yes", "2", "No"], ["q2", "Satisfied", "1", "Yes", "2", "No"], ["q3", "Return", "1", "Yes", "2", "No"]]), "cb.csv"),
  "indented": read(csvb([["Variable", "Label", "Values"], ["q1", "Recommend", ""], ["", "", "1=Yes"], ["", "", "2=No"], ["q2", "Gender", ""], ["", "", "1=Male"], ["", "", "2=Female"], ["q3", "Return", "1=Yes, 2=No"]]), "cb.csv"),
  "mr_sets": read(book([("Codebook", [["Variable", "Label", "Values"], ["Q13_1", "News: TV", "0=No, 1=Yes"], ["Q13_2", "News: radio", "0=No, 1=Yes"], ["Q14", "Age", "as is"]]), ("MR sets", [["Set", "Label", "Variables"], ["$Q13", "News sources", "Q13_1 Q13_2"], ["$Q45", "Hardship", "Q45_1 Q45_2"]])]), "cb.xlsx"),
  "question_map": read(book([("Findex", [["Indicator Name", "Filter", "Question", "Key"], ["Fin1", "", "1. An account can be used to save, 2. to pay", "1"], ["Fin2", "", "Do you have a debit card?", "1"], ["Fin3", 'Fin1 or Fin2 = "yes"', "Thinking only about your account", "2"]])]), "map.xlsx"),
  "or_other": read(book([("survey", [["type", "name", "label"], ["select_one yn or_other", "q1", "Recommend?"]]), ("choices", [["list_name", "name", "label"], ["yn", "1", "Yes"], ["yn", "2", "No"]])]), "form.xlsx", "instrument_sheet"),
}
print(json.dumps(out))
`;

type Read = { items?: { v: string; label: string; opts: [string, string][] }[]; sheets?: string[]; skipped?: string[]; error?: string };
const results: Record<string, Read> = PYTHON_OK ? JSON.parse(spawnSync(PYTHON, ["-I", "-c", DRIVER, ENGINE], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout) : {};
const opts = (r: Read, v: string) => r.items?.find((i) => i.v === v)?.opts;
const names = (r: Read) => r.items?.map((i) => i.v);
const YN: [string, string][] = [["1", "Yes"], ["2", "No"]];

describe.skipIf(!PYTHON_OK)("codebook shapes (batch 56, actual engine)", () => {
  it("answer lists without '=': braces, dot, colon, and plain codes running 1, 2", () => {
    for (const k of ["braces", "dot", "colon", "plain"]) {
      expect(opts(results[k], "q1"), k).toEqual(YN);
      expect(opts(results[k], "age"), k).toEqual([]);
    }
  });
  it("control: labels that start with numbers ('5 or more, 3 to 4') are not codes", () => {
    expect(opts(results.not_codes, "q1")).toEqual([]);
  });
  it("seven title rows above the header, and a header 'Var, Lab, Vals', are not variables", () => {
    expect(names(results.titles)).toEqual(["q1", "age"]);
    expect(names(results.var_lab)).toEqual(["q1", "q2", "age"]);
    expect(opts(results.var_lab, "q1")).toEqual(YN);
  });
  it("one row per answer: 'Value Code' headers, SPSS 'Variable Values' tables (both versions), and no header at all", () => {
    expect(opts(results.long_value_code, "q2")).toEqual([["1", "Male"], ["2", "Female"]]);
    expect(opts(results.spss_values, "q1")).toEqual(YN);
    expect(results.spss_split.items).toEqual([
      { v: "q1", label: "Would you recommend us?", opts: YN },
      { v: "q2", label: "Gender", opts: [["1", "Male"], ["2", "Female"]] },
    ]);
    expect(results.headerless_long.items).toEqual([
      { v: "q1", label: "Would you recommend us?", opts: YN },
      { v: "q2", label: "Satisfaction", opts: [["1", "Very satisfied"], ["98", "Don't know"]] },
      { v: "age", label: "Age in years", opts: [] },
    ]);
  });
  it("codes across columns (code headers, or Code1/Label1 pairs) and codes on their own rows under a variable", () => {
    expect(opts(results.across, "q3")).toEqual([["1", "Yes"], ["2", "No"], ["9", "Don't know"]]);
    expect(opts(results.pairs, "q2")).toEqual(YN);
    expect(opts(results.indented, "q1")).toEqual(YN);
    expect(opts(results.indented, "q2")).toEqual([["1", "Male"], ["2", "Female"]]);
    expect(opts(results.indented, "q3")).toEqual(YN);
  });
  it("a multiple-response sets sheet is skipped, not read as variables", () => {
    expect(names(results.mr_sets)).toEqual(["Q13_1", "Q13_2", "Q14"]);
    expect(results.mr_sets.skipped).toEqual(["MR sets"]);
  });
  it("a question map: its header is not a variable, the Question column is the label, the Filter column is never answer codes", () => {
    expect(names(results.question_map)).toEqual(["Fin1", "Fin2", "Fin3"]);
    expect(results.question_map.items?.find((i) => i.v === "Fin1")?.label).toBe("1. An account can be used to save, 2. to pay");
    for (const i of results.question_map.items ?? []) expect(i.opts, i.v).toEqual([]);
  });
  it("XLSForm 'select_one yn or_other' keeps the yn list", () => {
    expect(opts(results.or_other, "q1")).toEqual(YN);
  });
});
