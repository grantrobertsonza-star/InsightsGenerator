import { PYTHON } from "./helpers/pythonEngine";
// Batch 55 (import test library L1 and L3, 28 October 2026): data-reading faults, through the ACTUAL engine
// (read_table, the stored preview every calculation shares; categories; convert). Files are built here; expected
// values are written out from the cells written, never from the app's output.
//   F1 Excel whole numbers beyond 2^53 reach the preview as exact text, never JSON numbers that merge.
//   F2 an identifier row formatted 0000 in the columns-as-cases layout gives 0007, as rows-as-cases does.
//   F3 .zsav (compressed SPSS) is read like .sav.
//   F4 a skipped empty row does not turn a whole-number variable into decimals.
//   D1 the data sheet is the one holding the most data, not the one with most rows (pivot output beside it).
//   D2 an in-workbook codebook range cell labels both end points (Grant's decision 8), never one glued label.
//   D8 an unlabelled code is shown as 1, not 1.0, when its column also holds blanks.
//   Grant's decisions 6 and 7: blank text is no answer in SPSS and Stata; Not sure is a non-answer, a named don't-know is not.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;

const DRIVER = String.raw`
import importlib.util, io, json, sys, os, tempfile
import pandas as pd, pyreadstat
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
def book(sheets, formats=()):
    wb = Workbook(); wb.remove(wb.active)
    for name, rows in sheets:
        ws = wb.create_sheet(name)
        for r in rows: ws.append(r)
    for sheet, cell, fmt in formats: wb[sheet][cell].number_format = fmt
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def patched(b, old, new):
    # openpyxl writes 9007199254740993 as a double (...992); the cell is set in the sheet XML, as Excel and pandas
    # exports write an int64.
    import zipfile
    src = zipfile.ZipFile(io.BytesIO(b)); out = io.BytesIO(); dst = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename.startswith("xl/worksheets/"):
            assert old.encode() in data, (old, data[:400])
            data = data.replace(old.encode(), new.encode())
        dst.writestr(item, data)
    dst.close(); return out.getvalue()
def preview(b, name, layout=None):
    r = eng.read_table(b, name, {"layout": layout} if layout else {})
    rows = r.get("rows") or []
    # JSON cannot tell 1 from 1.0, so each cell's Python type is returned beside it.
    return {"rows": rows, "types": [{k: type(v).__name__ for k, v in row.items()} for row in rows], "sheet": r.get("sheet") or r.get("dataSheet")}
out = {}
out["bigint"] = preview(patched(book([("Data", [["acct", "q"], [9007199254740992, 1], [9007199254740992, 2], [12, 3]])]), '<c r="A2" t="n"><v>9007199254740992</v>', '<c r="A2" t="n"><v>9007199254740993</v>'), "b.xlsx")
out["flip_pad"] = preview(book([("Data", [["var", "c1", "c2"], ["Respondent ID", 7, 8], ["q", 1, 2]])], [("Data", "B2", "0000"), ("Data", "C2", "0000")]), "f.xlsx", "columns_are_cases")
out["blank_row_csv"] = preview(b"a,b\n1,2\n,\n3,4\n", "x.csv")
out["blank_row_xlsx"] = preview(book([("Data", [["v", "w"], [1, 5], [None, None], [3, 6]])]), "x.xlsx")
pivot = [["Row Labels", "Count"]] + [[f"label {i}", i] for i in range(60)]
data = [["id"] + [f"q{j}" for j in range(20)]] + [[i] + [j % 3 for j in range(20)] for i in range(1, 31)]
out["sheet"] = preview(book([("Data", data), ("Tables", pivot)]), "s.xlsx")
d = tempfile.mkdtemp(); p = os.path.join(d, "x.zsav")
pyreadstat.write_sav(pd.DataFrame({"q": [1.0, 2.0, 1.0]}), p, compress=True, column_labels=["Recommend"], variable_value_labels={"q": {1.0: "Yes", 2.0: "No"}})
zb = open(p, "rb").read()
try:
    out["zsav"] = {"categories": eng.categories(zb, "x.zsav", "q")["categories"], "converted": len(eng.convert(zb, "x.zsav").get("rows", []))}
except Exception as e:
    out["zsav"] = {"error": str(e)}
cbw = book([("Data", [["sat", "nps"], [1, 0], [5, 10], [3, None]]), ("Codebook", [["Variable", "Label", "Response codes"], ["sat", "Satisfaction", "1=Very dissatisfied to 5=Very satisfied; blank=Not asked"], ["nps", "Recommend", "0=Not at all likely; 10=Extremely likely"]])])
out["glued"] = {"sat": eng.categories(cbw, "w.xlsx", "sat")["categories"], "nps": eng.categories(cbw, "w.xlsx", "nps")["categories"]}
blank = {}
for ext, writer in ((".sav", pyreadstat.write_sav), (".dta", pyreadstat.write_dta)):
    pth = os.path.join(d, "blank" + ext)
    writer(pd.DataFrame({"c": ["a", "", "b"]}), pth)
    blank[ext] = eng.categories(open(pth, "rb").read(), "blank" + ext, "c")["categories"]
out["blank_text"] = blank
out["non_answer"] = {t: bool(eng._DK_RE.match(t)) for t in ["Not sure", "Unsure", "Don't know", "Don't know / Refused", "Don't know with which mobile networks or companies", "Don't know which brand"]}
out["one_not_one_point_zero"] = eng.categories(b"q,r\n1,a\n2,b\n,c\n1,d\n", "c.csv", "q")["categories"]
print(json.dumps(out))
`;

type Out = Record<string, { rows?: Record<string, unknown>[]; sheet?: string; categories?: { label: string; n: number }[]; converted?: number; error?: string; sat?: { label: string }[]; nps?: { label: string }[] } | { label: string; n: number }[]>;
const run = PYTHON_OK ? spawnSync(PYTHON, ["-I", "-c", DRIVER, ENGINE], { encoding: "utf8", maxBuffer: 1 << 26 }) : null;
const R: Out = run && run.status === 0 ? JSON.parse(run.stdout) : {};
const rows = (k: string) => (R[k] as { rows: Record<string, unknown>[] }).rows;

describe.skipIf(!PYTHON_OK)("data reading repairs (batch 55, actual engine)", () => {
  it("the driver ran", () => expect(run?.status, run?.stderr).toBe(0));
  it("F1: Excel whole numbers beyond 2^53 are exact text, so two identifiers never merge", () => {
    expect(rows("bigint").map((r) => r.acct)).toEqual(["9007199254740993", "9007199254740992", "12"]);
  });
  it("F2: a 0000 identifier row in the columns-as-cases layout gives 0007 and 0008", () => {
    expect(rows("flip_pad").map((r) => r["Respondent ID"])).toEqual(["0007", "0008"]);
  });
  it("F4: an empty row is not a case and leaves whole numbers whole (CSV and Excel)", () => {
    expect(rows("blank_row_csv")).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    expect(rows("blank_row_xlsx")).toEqual([{ v: 1, w: 5 }, { v: 3, w: 6 }]);
    const types = (k: string) => (R[k] as unknown as { types: Record<string, string>[] }).types;
    expect(types("blank_row_csv")).toEqual([{ a: "int", b: "int" }, { a: "int", b: "int" }]);
    expect(types("blank_row_xlsx")).toEqual([{ v: "int", w: "int" }, { v: "int", w: "int" }]);
  });
  it("D1: the sheet with the respondents is read, not the longer pivot output beside it", () => {
    expect(rows("sheet")).toHaveLength(30);
    expect(Object.keys(rows("sheet")[0])).toContain("q19");
  });
  it("F3: .zsav is read like .sav, with its labels", () => {
    const z = R.zsav as { categories: { label: string; n: number }[]; converted: number; error?: string };
    expect(z.error).toBeUndefined();
    expect(z.categories).toEqual([{ label: "Yes", n: 2 }, { label: "No", n: 1 }]);
  });
  it("D2: a range cell labels both end points (Grant's decision 8), never one glued label; codes between stay unlabelled", () => {
    const g = R.glued as { sat: { label: string }[]; nps: { label: string }[] };
    // Order is the existing rule for partly labelled variables: labelled codes in label order, then unlabelled ones.
    expect(g.sat.map((c) => c.label)).toEqual(["Very dissatisfied", "Very satisfied", "3"]);
    expect(g.nps.map((c) => c.label)).toEqual(["Not at all likely", "Extremely likely"]);
  });
  it("decision 6: a blank text answer is no answer in SPSS and Stata too (not a category, not in the base)", () => {
    const b = R.blank_text as unknown as Record<string, { label: string; n: number }[]>;
    for (const ext of [".sav", ".dta"]) expect(b[ext], ext).toEqual([{ label: "a", n: 1 }, { label: "b", n: 1 }]);
  });
  it("decision 7: Not sure is a non-answer; a don't-know that names its subject is an answer", () => {
    expect(R.non_answer).toEqual({ "Not sure": true, Unsure: true, "Don't know": true, "Don't know / Refused": true, "Don't know with which mobile networks or companies": false, "Don't know which brand": false });
  });
  it("D8: an unlabelled code with blanks in its column is shown as 1, not 1.0", () => {
    expect((R.one_not_one_point_zero as { label: string }[]).map((c) => c.label)).toEqual(["1", "2"]);
  });
});
