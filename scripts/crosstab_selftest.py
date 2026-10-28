"""Self-test for the weighted crosstab engine in api/parse-stats-file.py.

Builds a small synthetic .sav with known structure, runs the engine, and
checks every number against an independent pandas/numpy calculation.
Run:  python scripts/crosstab_selftest.py
Exit code is 0 when all checks pass.
"""
import importlib.util
import math
import os
import sys
import tempfile

import numpy as np
import pandas as pd
import pyreadstat

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("psf", os.path.join(HERE, "..", "api", "parse-stats-file.py"))
psf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(psf)

rng = np.random.default_rng(7)
N = 2400
reg = rng.choice([1, 2, 3, 4], size=N, p=[0.45, 0.35, 0.2 - 0.01, 0.01])  # group 4 is tiny
w = np.exp(rng.normal(0, 0.6, N)); w *= N / w.sum()
q1 = rng.choice([1, 2, 3], size=N)
m1 = (rng.random(N) < 0.30 + 0.1 * (reg == 1)).astype(float)
m2 = (rng.random(N) < 0.20).astype(float)
m3 = (rng.random(N) < 0.10).astype(float)
asked3 = rng.random(N) < 0.7           # option 3 only asked of 70%
m3[~asked3] = np.nan
sc = rng.integers(1, 6, N).astype(float)
dk = rng.random(N) < 0.1
sc[dk] = 99.0
df = pd.DataFrame({"reg": reg.astype(float), "wgt": w, "q1": q1.astype(float), "m_1": m1, "m_2": m2, "m_3": m3, "m_4": np.zeros(N), "sc_1": sc})
labels = {
    "reg": {1: "North", 2: "South", 3: "East", 4: "Tiny"},
    "q1": {1: "A", 2: "B", 3: "C"},
    "m_1": {1: "Yes", 0: "No"}, "m_2": {1: "Yes", 0: "No"}, "m_3": {1: "Yes", 0: "No"}, "m_4": {1: "Yes", 0: "No"},
    "sc_1": {99: "Don't know"},
}
tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "t.sav")
pyreadstat.write_sav(df, path, variable_value_labels=labels,
                     column_labels=["Region", "Weight", "Q1", "Brand A", "Brand B", "Brand C", "Brand D", "Rating"])
data = open(path, "rb").read()

fails = []
def data_rows(q):
    """Answer rows of a question, without the base rows."""
    return [r for r in q["rows"] if not r.get("isBase")]

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  " + detail))
    if not ok:
        fails.append(name)

def run(weight):
    return psf.crosstab(data, "t.sav", {
        "columnVars": ["reg"], "weightVar": weight,
        "rowItems": [
            {"key": "q1", "label": "Q1", "vars": ["q1"]},
            {"key": "m", "label": "Brands", "vars": ["m_1", "m_2", "m_3", "m_4"], "stem": ""},
            {"key": "nets", "label": "Nets", "kind": "nets", "vars": [],
             "nets": [{"label": "Any brand", "vars": ["m_1", "m_2", "m_3"]}]},
            {"key": "g", "label": "Ratings", "kind": "grid", "vars": ["sc_1"], "stem": ""},
        ]})

res = run("wgt")
Q = {q["key"]: q for q in res["questions"]}
cols = {c["name"]: i for i, c in enumerate(res["columns"])}
rname = {1: "North", 2: "South", 3: "East", 4: "Tiny"}

# 1. single choice, weighted column %
for rc, ci in cols.items():
    code = {v: k for k, v in rname.items()}[rc]
    m = reg == code
    for row in data_rows(Q["q1"]):
        cat = {"A": 1, "B": 2, "C": 3}[row["label"]]
        exp = w[m & (q1 == cat)].sum() / w[m].sum() * 100
        got = row["pct"][ci]
        if rc == "Tiny" and int((reg == 4).sum()) < 10:
            check("suppressed cell hidden (Tiny n<10)", got is None, str(got))
        else:
            if rc == "Tiny":
                check("thin column (10-29) shows figure but no test", row["sig"][ci] == 0 and row["p"][ci] is None)
            check(f"single col% {rc} {row['label']}", got is not None and abs(got - exp) < 0.06, f"{got} vs {exp:.2f}")
# 2. columns sum to 100
for rc, ci in cols.items():
    if rc == "Tiny":
        continue
    tot = sum(r["pct"][ci] for r in data_rows(Q["q1"]))
    check(f"single col sums to 100 ({rc})", abs(tot - 100) < 0.25, str(tot))

# 3. multiple response: each option on its own base
mrows = {r["variable"]: r for r in data_rows(Q["m"]) if not r.get("isBase")}
for var, arr in [("m_1", m1), ("m_2", m2), ("m_3", m3)]:
    for rc in ("North", "South", "East"):
        m = (reg == {v: k for k, v in rname.items()}[rc]) & ~np.isnan(arr)
        exp = w[m & (arr == 1)].sum() / w[m].sum() * 100
        got = mrows[var]["pct"][cols[rc]]
        check(f"multi {var} {rc} (own base)", abs(got - exp) < 0.06, f"{got} vs {exp:.2f}")
bm3 = mrows["m_3"]["base"][cols["North"]]["n"]
check("option 3 base is smaller than option 1 base", bm3 < mrows["m_1"]["base"][cols["North"]]["n"])

# 3b. an option nobody chose still has its row, at 0%
check("never-chosen option kept as a row", "m_4" in mrows and mrows["m_4"]["pct"][cols["North"]] == 0.0)
dic = psf.dictionary(data, "t.sav")
mset = [x for x in dic["sets"] if x["key"] == "m"]
check("dictionary keeps never-chosen option in its set", bool(mset) and "m_4" in mset[0]["vars"])

# 4. net: counted once per person, base = answered at least one
anyv = (~np.isnan(m1)) | (~np.isnan(m2)) | (~np.isnan(m3))
anysel = (np.nan_to_num(m1) == 1) | (np.nan_to_num(m2) == 1) | (np.nan_to_num(m3) == 1)
net = [r for r in data_rows(Q["nets"]) if not r.get("isBase")][0]
for rc in ("North", "South", "East"):
    m = (reg == {v: k for k, v in rname.items()}[rc]) & anyv
    exp = w[m & anysel].sum() / w[m].sum() * 100
    got = net["pct"][cols[rc]]
    check(f"net any-of {rc}", abs(got - exp) < 0.06, f"{got} vs {exp:.2f}")
    memb = [mrows[v]["pct"][cols[rc]] for v in ("m_1", "m_2", "m_3")]
    check(f"net >= largest member ({rc})", got + 0.06 >= max(memb))
    check(f"net <= sum of members ({rc})", got <= sum(memb) + 0.2, f"{got} vs {sum(memb)}")

# 5. means exclude don't know
for rc in ("North", "South"):
    m = (reg == {v: k for k, v in rname.items()}[rc]) & (sc != 99)
    exp = (w[m] * sc[m]).sum() / w[m].sum()
    got = data_rows(Q["g"])[0]["pct"][cols[rc]]
    check(f"mean excludes DK ({rc})", abs(got - exp) < 0.006, f"{got} vs {exp:.3f}")

# 6. complement z-test
rc = "North"; m = reg == 1; c = (reg != 1) & (reg != 4) | (reg == 4)  # complement within banner = all others
row = data_rows(Q["q1"])[0]
sel = q1 == 1
def stats(mask):
    ww = w[mask]; n_eff = ww.sum() ** 2 / (ww ** 2).sum(); return (w[mask & sel].sum() / ww.sum()), n_eff
p1, e1 = stats(m); p2, e2 = stats(c)
# Pooled under the null hypothesis on effective bases (batch 47): the two groups' shares combined.
p0 = (p1 * e1 + p2 * e2) / (e1 + e2)
z = (p1 - p2) / math.sqrt(p0 * (1 - p0) * (1 / e1 + 1 / e2))
pv = math.erfc(abs(z) / math.sqrt(2))
got_p = row["p"][cols[rc]]
check("complement z-test p-value", got_p is not None and abs(got_p - pv) < 0.0006, f"{got_p} vs {pv:.4f}")

# 7. all weights = 1 matches plain pandas crosstab
res1 = run(None)
Q1 = {q["key"]: q for q in res1["questions"]}
ct = pd.crosstab(df["q1"], df["reg"], normalize="columns") * 100
for row in data_rows(Q1["q1"]):
    cat = {"A": 1, "B": 2, "C": 3}[row["label"]]
    got = row["pct"][cols["North"]]
    check(f"unweighted equals pandas ({row['label']})", abs(got - ct.loc[cat, 1]) < 0.06, f"{got} vs {ct.loc[cat,1]:.2f}")

# 8. grouped categories: column group and row net
resg = psf.crosstab(data, "t.sav", {
    "columnVars": ["reg"], "weightVar": "wgt",
    "columnGroups": {"reg": [{"label": "North+South", "cats": ["North", "South"]}]},
    "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"], "groups": [{"label": "A or B", "cats": ["A", "B"]}]}]})
gnames = [c["name"] for c in resg["columns"]]
check("column group replaces its members", gnames == ["North+South", "East", "Tiny"], str(gnames))
qg = resg["questions"][0]
m = np.isin(reg, [1, 2])
exp = w[m & np.isin(q1, [1, 2])].sum() / w[m].sum() * 100
netg = [r for r in data_rows(qg) if r.get("isNet")][0]
check("row group NET value on grouped column", abs(netg["pct"][0] - exp) < 0.06, f"{netg['pct'][0]} vs {exp:.2f}")
a, b = data_rows(qg)[0]["pct"][1], data_rows(qg)[1]["pct"][1]
check("single-choice NET equals sum of its categories (East)", abs(netg["pct"][1] - (a + b)) < 0.15, f"{netg['pct'][1]} vs {a + b}")
cl = psf.categories(data, "t.sav", "reg")
check("categories listing", [c["label"] for c in cl["categories"]] == ["North", "South", "East", "Tiny"], str(cl))
try:
    psf.crosstab(data, "t.sav", {"columnVars": ["reg"], "weightVar": "wgt",
        "columnGroups": {"reg": [{"label": "x", "cats": ["North", "South"]}, {"label": "y", "cats": ["South", "East"]}]},
        "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"]}]})
    check("overlapping column groups rejected", False)
except ValueError:
    check("overlapping column groups rejected", True)


# 9. CSV and Excel case-level files go through the same engine
rng2 = np.random.default_rng(7)
M = 600
cdf = pd.DataFrame({
    "Gender": rng2.choice(["Male", "Female"], size=M),
    "Province": rng2.choice([1, 2, 3], size=M),
    "Weight": rng2.uniform(0.5, 2.0, size=M).round(3),
    "Q5_1": rng2.choice([0, 1], size=M, p=[0.6, 0.4]),
    "Q5_2": rng2.choice([0, 1], size=M, p=[0.7, 0.3]),
    "Q5_3": rng2.choice([0, 1], size=M, p=[0.9, 0.1]),
    "Satisfaction": rng2.choice([1, 2, 3, 4, 5], size=M),
})
csv_bytes = cdf.to_csv(index=False).encode("utf-8")
xl_path = os.path.join(tmp, "t.xlsx")
cdf.to_excel(xl_path, index=False)
xl_bytes = open(xl_path, "rb").read()
for fname, blob in (("t.csv", csv_bytes), ("t.xlsx", xl_bytes)):
    d2 = psf.dictionary(blob, fname)
    names = [v["name"] for v in d2["variables"]]
    check(f"{fname}: dictionary lists every column", names == list(cdf.columns), str(names))
    check(f"{fname}: weight column recognised", [v for v in d2["variables"] if v["name"] == "Weight"][0]["weightLike"])
    check(f"{fname}: Q5 flags grouped as a multiple-response set", any(x["kind"] == "multi" for x in d2["sets"]), str(d2["sets"]))
    r2 = psf.crosstab(blob, fname, {"columnVars": ["Gender"], "weightVar": "Weight",
        "rowItems": [{"key": "p", "label": "Province", "vars": ["Province"]}]})
    cc = {c["name"]: i for i, c in enumerate(r2["columns"])}
    ok = True
    for row in data_rows(r2["questions"][0]):
        if row.get("isBase"):
            continue
        code = int(float(row["label"])) if str(row["label"]).replace(".0", "").isdigit() else None
        for g in ("Male", "Female"):
            mm = (cdf["Gender"] == g).to_numpy()
            exp = cdf.loc[mm & (cdf["Province"] == code), "Weight"].sum() / cdf.loc[mm, "Weight"].sum() * 100
            got = row["pct"][cc[g]]
            if got is None or abs(got - exp) > 0.06:
                ok = False
    check(f"{fname}: weighted column % matches pandas", ok)
    d3 = psf.categories(blob, fname, "Gender")
    check(f"{fname}: categories listing", sorted(c["label"] for c in d3["categories"]) == ["Female", "Male"], str(d3))


# 10. Excel workbooks: labels from other sheets
import io
def _wb(sheets, startrows=None):
    buf = io.BytesIO()
    with pd.ExcelWriter(buf) as w:
        for k, (frame, sr, hdr) in sheets.items():
            frame.to_excel(w, sheet_name=k, index=False, startrow=sr, header=hdr)
    return buf.getvalue()
xd = pd.DataFrame({"gender": rng2.choice([1, 2], 300), "prov": rng2.choice([1, 2, 3], 300), "wgt": rng2.uniform(.5, 2, 300).round(3)})
xv = pd.DataFrame({"Variable": ["gender", "prov", "wgt"], "Label": ["Gender of respondent", "Province", "Weight"]})
xl_vals = pd.DataFrame({"Variable": ["gender", "gender", "prov", "prov", "prov"], "Value": [1, 2, 1, 2, 3], "Value label": ["Male", "Female", "Gauteng", "Limpopo", "Western Cape"]})
b1 = _wb({"Data": (xd, 0, True), "Variables": (xv, 0, True), "Values": (xl_vals, 0, True)})
d1 = psf.dictionary(b1, "w.xlsx")
labs = {v["name"]: v["label"] for v in d1["variables"]}
check("xlsx: variable labels read from a Variables sheet", labs["gender"] == "Gender of respondent", str(labs))
check("xlsx: value labels read from a Values sheet", [c["label"] for c in psf.categories(b1, "w.xlsx", "prov")["categories"]] == ["Gauteng", "Limpopo", "Western Cape"])
check("xlsx: dictionary reports which sheets were used", d1.get("sheets", {}).get("values") == "Values")
comb = pd.DataFrame({"Variable": ["gender", None, "prov", None, None], "Label": ["Gender of respondent", None, "Province", None, None], "Value": [1, 2, 1, 2, 3], "Value label": ["Male", "Female", "Gauteng", "Limpopo", "Western Cape"]})
b2 = _wb({"Survey": (xd, 0, True), "Codebook": (comb, 2, True)})
d2 = psf.dictionary(b2, "w2.xlsx")
check("xlsx: combined codebook sheet with a title row and blank repeats", {v["name"]: v["label"] for v in d2["variables"]}["prov"] == "Province" and [c["label"] for c in psf.categories(b2, "w2.xlsx", "gender")["categories"]] == ["Male", "Female"])
check("xlsx: a single-sheet workbook is unchanged", psf.dictionary(_wb({"Sheet1": (xd, 0, True)}), "w3.xlsx").get("sheets") is None)

# 11. questionnaire overlay: labels only where the file has none
od = pd.DataFrame({"q1": rng2.choice([1, 2], 200), "q2": rng2.choice([1, 2, 3], 200), "gender": rng2.choice(["M", "F"], 200)})
ob = od.to_csv(index=False).encode()
ov = {"variableLabels": {"q1": "Q1. Do you have a bank account?", "gender": "Should not apply"}, "valueLabels": {"q1": {"1": "Yes", "2": "No"}, "q2": {"1": "Low", "2": "Mid", "3": "High"}}}
c1 = psf.categories(ob, "o.csv", "q1", ov)
check("overlay: value labels from a questionnaire name the categories", [c["label"] for c in c1["categories"]] == ["Yes", "No"], str(c1))
check("overlay: variable label is filled where the file only has the name", c1["label"] == "Q1. Do you have a bank account?")
check("overlay: no overlay leaves categories as codes", [c["label"] for c in psf.categories(ob, "o.csv", "q1")["categories"]] != ["Yes", "No"])
xt = psf.crosstab(ob, "o.csv", {"columnVars": ["q1"], "rowItems": [{"key": "q2", "label": "q2", "vars": ["q2"]}], "weightVar": None, "overlay": ov})
check("overlay: crosstab columns and rows use the questionnaire labels", [c["name"] for c in xt["columns"]][:2] == ["Yes", "No"] or [c["name"] for c in xt["columns"]][1:3] == ["Yes", "No"], str([c["name"] for c in xt["columns"]]))
check("overlay: crosstab row labels", {r["label"] for r in data_rows(xt["questions"][0]) if not r.get("isBase")} >= {"Low", "Mid", "High"}, str([r["label"] for r in data_rows(xt["questions"][0])]))
vd = pd.DataFrame({"q1": [1, 2, 1, 2] * 50}); vlab = _wb({"Data": (vd, 0, True), "Values": (pd.DataFrame({"Variable": ["q1", "q1"], "Value": [1, 2], "Value label": ["File yes", "File no"]}), 0, True)})
check("overlay: never replaces labels the file already has", [c["label"] for c in psf.categories(vlab, "v.xlsx", "q1", ov)["categories"]] == ["File yes", "File no"])

# multiple-comparison correction can only switch flags off, and adjusted p is never below raw p
base_args = {"columnVars": ["reg"], "weightVar": "wgt", "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"]}]}
raw_res = psf.crosstab(data, "t.sav", dict(base_args, correction="none"))
for method, word in (("bonferroni", "Bonferroni"), ("fdr", "Benjamini-Hochberg")):
    adj_res = psf.crosstab(data, "t.sav", dict(base_args, correction=method))
    ok_off, ok_p = True, True
    for rr, ar in zip(data_rows(raw_res["questions"][0]), data_rows(adj_res["questions"][0])):
        for k in range(len(raw_res["columns"])):
            if ar["sig"][k] != 0 and rr["sig"][k] == 0:
                ok_off = False
            if ar["pAdj"][k] is not None and ar["pAdj"][k] + 1e-9 < rr["p"][k]:
                ok_p = False
    check(f"{method}: flags only switch off", ok_off)
    check(f"{method}: adjusted p is never below raw p", ok_p)
    check(f"{method}: footer names the correction", word in adj_res["notes"]["test"])
check("engine default is uncorrected and says so", "not corrected" in psf.crosstab(data, "t.sav", base_args)["notes"]["test"])
check("notes carry the design and overlap statements", all(k in raw_res["notes"] for k in ("design", "overlap")))

# column-pair letters against an independent pooled pairwise z test (no correction)
lt = psf.crosstab(data, "t.sav", dict(base_args, correction="none"))
lcols = {c["name"]: i for i, c in enumerate(lt["columns"])}
check("columns carry letters", [c["letter"] for c in lt["columns"]][:3] == ["A", "B", "C"])
ok_letters = True
def _ne(x):
    return x.sum() ** 2 / (x ** 2).sum()
for row in data_rows(lt["questions"][0]):
    cat = {"A": 1, "B": 2, "C": 3}[row["label"]]
    names = ["North", "South", "East"]
    codes = {"North": 1, "South": 2, "East": 3}
    for a in names:
        exp = ""
        for b in names:
            if a == b:
                continue
            ma, mb = reg == codes[a], reg == codes[b]
            pa = w[ma & (q1 == cat)].sum() / w[ma].sum(); pb = w[mb & (q1 == cat)].sum() / w[mb].sum()
            na_, nb_ = _ne(w[ma]), _ne(w[mb])
            p0_ = (pa * na_ + pb * nb_) / (na_ + nb_)
            se = math.sqrt(p0_ * (1 - p0_) * (1 / na_ + 1 / nb_))
            z = (pa - pb) / se
            if math.erfc(abs(z) / math.sqrt(2)) < 0.05 and z > 0:
                exp += lt["columns"][lcols[b]]["letter"]
        got = row["letters"][lcols[a]]
        if sorted(got) != sorted(exp):
            ok_letters = False
check("column-pair letters equal an independent pooled pairwise z test", ok_letters)

# first-order Rao-Scott whole-table test against an independent calculation
tt = lt["questions"][0].get("tableTests") or []
check("single questions carry a whole-table test", len(tt) == 1 and tt[0]["df"] > 0, str(tt))
if tt:
    okm = np.isfinite(np.asarray(q1, dtype=float)) & np.isfinite(np.asarray(reg, dtype=float)) & (np.asarray(w, dtype=float) > 0)
    qa, ra, wa = np.asarray(q1)[okm], np.asarray(reg)[okm], np.asarray(w, dtype=float)[okm]
    rcats, ccats = sorted(set(qa)), sorted(set(ra))
    T = np.array([[wa[(qa == a) & (ra == b)].sum() for b in ccats] for a in rcats])
    T = T * (_ne(wa) / T.sum())
    E = np.outer(T.sum(axis=1), T.sum(axis=0)) / T.sum()
    x2 = float(((T - E) ** 2 / E).sum())
    check("Rao-Scott chi-square equals an independent calculation", abs(tt[0]["chi2"] - x2) < 0.01, f"{tt[0]['chi2']} vs {x2}")
    check("Rao-Scott p equals the chi-square tail", abs(tt[0]["p"] - psf._chi2_sf(x2, tt[0]["df"])) < 1e-3)
    check("whole-table test is no more significant than the unadjusted one", tt[0]["nEff"] <= wa.size + 1e-9)
check("notes explain the whole-table test", "Rao-Scott" in raw_res["notes"].get("tableTest", ""))

# Taylor series (linearised) variance for a stratified cluster design
rngd = np.random.default_rng(11)
nrow = 1500
strata_ = rngd.integers(0, 5, nrow)
psu_ = strata_ * 100 + rngd.integers(0, 12, nrow)
grp_ = np.where(rngd.random(nrow) < 0.5, "A", "B")
base_p = 0.35 + 0.1 * (grp_ == "A") + 0.05 * (psu_ % 3)  # clustered propensity
y_ = (rngd.random(nrow) < base_p).astype(int) + 1
w_ = rngd.uniform(0.5, 2.5, nrow)
dd = pd.DataFrame({"grp": grp_, "y": y_, "w": w_, "psu": psu_, "str": strata_, "row": np.arange(nrow)})
dbytes = dd.to_csv(index=False).encode()
rd = psf.crosstab(dbytes, "d.csv", {"columnVars": ["grp"], "rowItems": [{"key": "y", "label": "Y", "vars": ["y"]}], "weightVar": "w",
                                      "design": {"psu": "psu", "strata": "str"}, "correction": "none"})
check("design is described in the notes", "Taylor series" in rd["notes"]["design"] and rd["notes"]["designUsed"]["nPsu"] > 10)

def _svy_var(zvec, st, ps):
    tot = {}
    for z_, s_, p_ in zip(zvec, st, ps):
        tot[(s_, p_)] = tot.get((s_, p_), 0.0) + z_
    out = 0.0
    for s_ in set(k[0] for k in tot):
        ts = [v for k, v in tot.items() if k[0] == s_]
        nh = len(ts)
        m_ = sum(ts) / nh
        out += nh / (nh - 1) * sum((v - m_) ** 2 for v in ts)
    return out

def _ratio_z(mask, sel):
    sw_ = w_[mask].sum()
    pj = w_[mask & sel].sum() / sw_
    return pj, np.where(mask, w_ * ((sel.astype(float)) - pj) / sw_, 0.0)

from scipy.stats import t as _scipy_t
_design_df = len(set(zip(strata_, psu_))) - len(set(strata_))
ok_se = True
for row in data_rows(rd["questions"][0]):
    cat = int(row["label"])
    sel = y_ == cat
    ka = grp_ == "A"
    pa, za = _ratio_z(ka, sel)
    pb, zb = _ratio_z(~ka, sel)
    se_ = math.sqrt(_svy_var(za - zb, strata_, psu_))
    z_ = (pa - pb) / se_
    # Design-based tests use a Student t reference with the design degrees of freedom (PSUs minus
    # strata), as R's survey package and Stata's svy do; computed here from the data, not the engine.
    p_exp = 2 * _scipy_t.sf(abs(z_), _design_df)
    got_p = row["p"][0]
    if got_p is None or abs(got_p - p_exp) > 6e-5:
        ok_se = False
check("Taylor variance of the column vs rest difference equals an independent loop calculation", ok_se)

# every case its own PSU, no strata, unit weights: variance reduces to p(1-p)/(n-1) per domain
one = pd.DataFrame({"grp": np.where(np.arange(600) % 2 == 0, "A", "B"), "y": (rngd.random(600) < 0.4).astype(int) + 1, "psu": np.arange(600)})
ro = psf.crosstab(one.to_csv(index=False).encode(), "o.csv", {"columnVars": ["grp"], "rowItems": [{"key": "y", "label": "Y", "vars": ["y"]}], "weightVar": None,
                                                              "design": {"psu": "psu", "strata": None}, "correction": "none"})
r0 = data_rows(ro["questions"][0])[0]
ya = (one["y"][one["grp"] == "A"] == 1).mean(); yb = (one["y"][one["grp"] == "B"] == 1).mean()
N_ = 600
va = N_ / (N_ - 1) * ya * (1 - ya) / 300; vb = N_ / (N_ - 1) * yb * (1 - yb) / 300
# The standard error reduces to the simple random sample one; the reference distribution stays the
# design t with 600 PSUs - 1 stratum = 599 degrees of freedom (Codex RP0-V01: this check used the normal
# tail, 0.55657, while the engine correctly reports the t tail, 0.55680).
z_closed = (ya - yb) / math.sqrt(va + vb)
p_closed = 2 * _scipy_t.sf(abs(z_closed), 600 - 1)
p_normal = math.erfc(abs(z_closed) / math.sqrt(2))
check("one case per PSU reduces to the simple random sample formula (design t reference, 599 df)", r0["p"][0] is not None and abs(r0["p"][0] - p_closed) < 6e-5, f"{r0['p'][0]} vs {p_closed}")
check("the check tells the t reference from the normal one (they differ by more than its tolerance)", abs(p_closed - p_normal) > 6e-5, f"{p_closed} vs {p_normal}")
# Without a design the reference is the normal: same data, no design.
ro_n = psf.crosstab(one.to_csv(index=False).encode(), "o.csv", {"columnVars": ["grp"], "rowItems": [{"key": "y", "label": "Y", "vars": ["y"]}], "weightVar": None, "correction": "none"})
r0n = data_rows(ro_n["questions"][0])[0]
z_srs = (ya - yb) / math.sqrt(ya * (1 - ya) / 300 + yb * (1 - yb) / 300)
check("without a design the test uses the normal reference", r0n["p"][0] is not None and abs(r0n["p"][0] - math.erfc(abs(z_srs) / math.sqrt(2))) < 1e-3, f"{r0n['p'][0]} vs {math.erfc(abs(z_srs) / math.sqrt(2))}")

# clustering must not make the test more certain than ignoring it, on clustered data
rn = psf.crosstab(dbytes, "d.csv", {"columnVars": ["grp"], "rowItems": [{"key": "y", "label": "Y", "vars": ["y"]}], "weightVar": "w", "correction": "none"})
check("without a design the notes say the design is not modelled", "not modelled" in rn["notes"]["design"])
check("whole-table test is reported under a design", bool(rd["questions"][0].get("tableTests")))

# means under a design: one case per PSU, unit weights, closed form per column and complement
xm = pd.DataFrame({"grp": np.where(np.arange(800) % 2 == 0, "A", "B"), "x": rngd.normal(10, 3, 800) + (np.arange(800) % 2) * 0.8, "psu": np.arange(800)})
rm = psf.crosstab(xm.to_csv(index=False).encode(), "m.csv", {"columnVars": ["grp"], "rowItems": [{"key": "x", "label": "X", "vars": ["x"]}], "weightVar": None,
                                                              "design": {"psu": "psu", "strata": None}, "correction": "none"})
xa = xm["x"][xm["grp"] == "A"].to_numpy(); xb = xm["x"][xm["grp"] == "B"].to_numpy()
def _mv(v):
    n = len(v)
    return v.mean(), n / (n - 1) * ((v - v.mean()) ** 2).sum() / n ** 2
(ma, vma), (mb, vmb) = _mv(xa), _mv(xb)
p_mean = math.erfc(abs((ma - mb) / math.sqrt(vma + vmb)) / math.sqrt(2))
got_pm = data_rows(rm["questions"][0])[0]["p"][0]
check("mean under a design (one case per PSU) matches the closed form", got_pm is not None and abs(got_pm - p_mean) < 2e-3, f"{got_pm} vs {p_mean}")

# blank PSU values: counted, treated as unclustered, no failure
mp = xm.copy(); mp["psu"] = mp["psu"].astype(object); mp.loc[mp.index[:40], "psu"] = None
rmp = psf.crosstab(mp.to_csv(index=False).encode(), "mp.csv", {"columnVars": ["grp"], "rowItems": [{"key": "x", "label": "X", "vars": ["x"]}], "weightVar": None,
                                                                "design": {"psu": "psu", "strata": None}, "correction": "none"})
check("cases with a blank PSU are counted and the table still builds", rmp["notes"]["designUsed"]["casesMissingDesign"] == 40)

# a design variable that is not in the file gives a named error
try:
    psf.crosstab(xm.to_csv(index=False).encode(), "m.csv", {"columnVars": ["grp"], "rowItems": [{"key": "x", "label": "X", "vars": ["x"]}], "weightVar": None,
                                                           "design": {"psu": "nope", "strata": None}, "correction": "none"})
    check("a missing design variable is rejected with a clear message", False)
except ValueError as e:
    check("a missing design variable is rejected with a clear message", "nope" in str(e))

# ---- Base rows, effective base, unweighted cell n and NET columns (9 October) ----
res_u = run(None)
code_of = {"North": 1, "South": 2, "East": 3, "Tiny": 4}
for label, r_ in (("weighted", res), ("unweighted", res_u)):
    Qb = {q["key"]: q for q in r_["questions"]}
    for key in ("q1", "m", "nets", "g"):
        first = Qb[key]["rows"][0]
        check(f"{label}: {key} starts with a base row", bool(first.get("isBase")) and first["label"].startswith("Base:"), first.get("label", ""))
effs = [r for q in res["questions"] for r in q["rows"] if r.get("isEffBase")]
check("weighted run: one effective base row per question", len(effs) == len(res["questions"]), str(len(effs)))
check("unweighted run: no effective base row", not any(r.get("isEffBase") for q in res_u["questions"] for r in q["rows"]))
Qw = {q["key"]: q for q in res["questions"]}
Qu = {q["key"]: q for q in res_u["questions"]}
colsu = {c["name"]: i for i, c in enumerate(res_u["columns"])}
for name, code in code_of.items():
    ci, cu = cols[name], colsu[name]
    m_ = reg == code
    brow = Qw["q1"]["rows"][0]
    check(f"base row n equals valid answers ({name})", brow["count"][ci] == int(m_.sum()), f"{brow['count'][ci]} vs {int(m_.sum())}")
    ww = w[m_]
    kish = (ww.sum() ** 2) / (ww ** 2).sum()
    eff = Qw["q1"]["rows"][1]
    check(f"effective base equals Kish n ({name})", eff["isEffBase"] and eff["count"][ci] == int(round(kish)), f"{eff['count'][ci]} vs {kish:.1f}")
    # category cell counts add up to the base (single response, every case answered)
    cn = sum(r["nCell"][ci] for r in data_rows(Qw["q1"]))
    check(f"single response: cell n adds up to the base ({name})", cn == int(m_.sum()), f"{cn} vs {int(m_.sum())}")
    for r in data_rows(Qu["q1"]):
        cat = {"A": 1, "B": 2, "C": 3}[r["label"]]
        check(f"unweighted: cell n equals count ({name} {r['label']})", r["nCell"][cu] == int(round(r["count"][cu])) == int(((reg == code) & (q1 == cat)).sum()))
# multiple response base: answered any option, option rows each on their own n
brow = Qw["m"]["rows"][0]
anyv = ~np.isnan(m1) | ~np.isnan(m2) | ~np.isnan(m3) | ~np.isnan(np.zeros(N))
check("multiple response base row counts answered-any", brow["total"]["count"] == int(anyv.sum()), str(brow["total"]["count"]))
# NET column: all cases with a valid banner value
check("one NET entry per banner variable", len(res["nets"]) == 1 and res["nets"][0]["n"] == int(np.isin(reg, [1, 2, 3, 4]).sum()))
for r in data_rows(Qw["q1"]):
    cat = {"A": 1, "B": 2, "C": 3}[r["label"]]
    nt = r["net"][0]
    exp = w[q1 == cat].sum() / w.sum() * 100
    check(f"NET column pct ({r['label']})", nt["pct"] is not None and abs(nt["pct"] - exp) < 0.06, f"{nt['pct']} vs {exp:.2f}")
    check(f"NET column n ({r['label']})", nt["nCell"] == int((q1 == cat).sum()))
    check(f"NET column row % is 100 ({r['label']})", nt["rowPct"] == 100.0)
# base rows and NET columns are never tested, flagged or lettered
for q in res["questions"]:
    for r in q["rows"]:
        if r.get("isBase"):
            check(f"base row carries no test ({q['key']})", all(x == 0 for x in r["sig"]) and all(x is None for x in r["p"]) and "letters" not in r)
        for nt in r.get("net", []):
            if not {"p", "sig", "letters"} & set(nt):
                continue
            check("NET column carries no test", False)
check("NET entries carry no p, flag or letter", True)


# 12. No banner variable: one column of all respondents, descriptive statistics, no tests.
def wstats(x, wt):
    sw = wt.sum(); neff = sw ** 2 / (wt ** 2).sum()
    mean = (wt * x).sum() / sw
    var = (wt * (x - mean) ** 2).sum() / sw * neff / (neff - 1)
    return mean, var, math.sqrt(var), float(x.min()), float(x.max())

for wname, wt_all in (("weighted", w), ("unweighted", np.ones(N))):
    ov = psf.crosstab(data, "t.sav", {
        "columnVars": [], "weightVar": "wgt" if wname == "weighted" else None,
        "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"]},
                     {"key": "g", "label": "Ratings", "kind": "grid", "vars": ["sc_1"], "stem": ""},
                     {"key": "m", "label": "Brands", "vars": ["m_1", "m_2"], "stem": ""}]})
    check(f"no banner: flagged as overall ({wname})", ov["overall"] is True and len(ov["columns"]) == 1 and ov["columns"][0]["name"] == "All respondents")
    check(f"no banner: column equals total ({wname})", ov["columns"][0]["n"] == ov["total"]["n"] == N)
    Qo = {q["key"]: q for q in ov["questions"]}
    for q in ov["questions"]:
        for r in q["rows"]:
            check(f"no banner: no tests or letters ({wname} {q['key']} {r['label']})", all(x == 0 for x in r["sig"]) and all(x is None for x in r["p"]) and not any(r.get("letters") or []))
        check(f"no banner: no whole-table test ({wname} {q['key']})", not q.get("tableTests"))
    # frequencies: column pct equals total pct, and the answers add to 100
    rows_q1 = data_rows(Qo["q1"])
    check(f"no banner: single choice percentages add to 100 ({wname})", abs(sum(r["pct"][0] for r in rows_q1) - 100) < 0.31)
    for r in rows_q1:
        cat = {"A": 1, "B": 2, "C": 3}[r["label"]]
        exp = wt_all[q1 == cat].sum() / wt_all.sum() * 100
        check(f"no banner: frequency % ({wname} {r['label']})", abs(r["pct"][0] - exp) < 0.06 and r["pct"][0] == r["total"]["pct"], f"{r['pct'][0]} vs {exp:.2f}")
        check(f"no banner: n equals the unweighted count ({wname} {r['label']})", r["nCell"][0] == int((q1 == cat).sum()))
    # a nominal single question (labels A, B, C) gets no mean of its codes
    check(f"no banner: nominal single has no descriptive statistics ({wname})", "desc" not in Qo["q1"])
    # grid item: don't know (99) excluded, as for averages
    ok_ = ~dk
    gd = data_rows(Qo["g"])[0]["desc"]
    mean_g, var_g, sd_g, mn_g, mx_g = wstats(sc[ok_], wt_all[ok_])
    check(f"no banner: rating mean excludes don't know ({wname})", abs(gd["mean"] - mean_g) < 0.0006 and gd["n"] == int(ok_.sum()), f"{gd['mean']} vs {mean_g}")
    check(f"no banner: rating SD, variance, range ({wname})", abs(gd["sd"] - sd_g) < 0.0006 and abs(gd["variance"] - var_g) < 0.0006 and gd["max"] == mx_g and gd["min"] == mn_g)
    # weighted median: the smallest value whose cumulative weight reaches half
    xs = sc[ok_]; ws = wt_all[ok_]; o = np.argsort(xs, kind="mergesort")
    cmed = xs[o][np.searchsorted(np.cumsum(ws[o]), 0.5 * ws.sum())]
    check(f"no banner: weighted median ({wname})", gd["median"] == cmed, f"{gd['median']} vs {cmed}")


# 12b. Coded single questions: descriptives only for ordered scales, not for nominal categories.
rngo = np.random.default_rng(5)
od_ = pd.DataFrame({"sat": rngo.integers(1, 6, 400).astype(float), "gender": rngo.choice([2.0, 3.0], 400), "wgt": rngo.uniform(0.5, 2, 400)})
po_ = os.path.join(tmp, "o.sav")
pyreadstat.write_sav(od_, po_, variable_value_labels={
    "sat": {1: "Very dissatisfied", 2: "Dissatisfied", 3: "Neutral", 4: "Satisfied", 5: "Very satisfied"},
    "gender": {2: "Male", 3: "Female"}}, column_labels=["Satisfaction", "Gender", "Weight"])
ro_ = psf.crosstab(open(po_, "rb").read(), "o.sav", {"columnVars": [], "weightVar": "wgt", "rowItems": [
    {"key": "sat", "label": "Sat", "vars": ["sat"]}, {"key": "gender", "label": "Gender", "vars": ["gender"]}]})
Qd_ = {q["key"]: q for q in ro_["questions"]}
check("labelled ordered scale gets descriptive statistics", "desc" in Qd_["sat"])
check("gender codes get no descriptive statistics", "desc" not in Qd_["gender"])
m_exp = (od_["sat"] * od_["wgt"]).sum() / od_["wgt"].sum()
check("ordered scale mean equals the weighted mean of codes", abs(Qd_["sat"]["desc"]["mean"] - m_exp) < 0.0006, f"{Qd_['sat']['desc']['mean']} vs {m_exp}")


# 13. Association measures against independent calculations (scipy) on an expanded table.
from scipy import stats as _st
from scipy.stats.contingency import association as _assoc
rng2 = np.random.default_rng(11)
for shape in ((2, 2), (3, 4), (4, 3)):
    Tt = rng2.integers(5, 60, size=shape).astype(float)
    a = psf._association(Tt)
    rr, cc = shape
    xr = np.repeat(np.arange(rr), Tt.sum(axis=1).astype(int))
    xc = np.concatenate([np.repeat(np.arange(cc), Tt[i].astype(int)) for i in range(rr)])
    check(f"association {shape}: Cramer's V", abs(a["cramersV"] - _assoc(Tt.astype(int), method="cramer", correction=False)) < 0.0006)
    check(f"association {shape}: contingency C", abs(a["contingencyC"] - _assoc(Tt.astype(int), method="pearson", correction=False)) < 0.0006)
    # tau-b from scipy (tie corrected), computed on the expanded cases
    tb = _st.kendalltau(xr, xc, variant="b").statistic
    check(f"association {shape}: Kendall tau-b", abs(a["tauB"] - tb) < 0.0006, f"{a['tauB']} vs {tb}")
    tc = _st.kendalltau(xr, xc, variant="c").statistic
    check(f"association {shape}: Kendall tau-c", abs(a["tauC"] - tc) < 0.002, f"{a['tauC']} vs {tc}")
    # Somers d with the answer (rows) dependent on the banner (columns)
    sd = _st.somersd(xc, xr).statistic
    check(f"association {shape}: Somers d", abs(a["somersD"] - sd) < 0.0006, f"{a['somersD']} vs {sd}")
    # gamma by brute force over pairs of cells
    C_ = D_ = 0.0
    for i in range(rr):
        for j in range(cc):
            C_ += Tt[i, j] * Tt[i + 1:, j + 1:].sum()
            D_ += Tt[i, j] * Tt[i + 1:, :j].sum()
    check(f"association {shape}: gamma", abs(a["gamma"] - (C_ - D_) / (C_ + D_)) < 0.0006)
    # lambda (answer predicted from banner)
    la = (Tt.max(axis=0).sum() - Tt.sum(axis=1).max()) / (Tt.sum() - Tt.sum(axis=1).max())
    check(f"association {shape}: lambda", abs(a["lambdaAnswer"] - la) < 0.0006, f"{a['lambdaAnswer']} vs {la}")
    # scale invariance: multiplying every count by a constant changes nothing
    b = psf._association(Tt * 37.5)
    check(f"association {shape}: unchanged when weights are rescaled", all(abs(a[k] - b[k]) < 1e-3 for k in a if a[k] is not None))
a22 = psf._association(np.array([[30.0, 10.0], [10.0, 30.0]]))
check("association 2x2: phi has the sign of the association", abs(a22["phi"] - 0.5) < 0.0006)

# 14. Options from the SPSS review: don't know default, filter, shares of responses, shape, sparse cells.
from scipy import stats as _st2
xs_ = sc[~dk]
ovu = psf.crosstab(data, "t.sav", {"columnVars": [], "weightVar": None,
        "rowItems": [{"key": "g", "label": "Ratings", "kind": "grid", "vars": ["sc_1"], "stem": ""}]})
dsc = [r for r in ovu["questions"][0]["rows"] if not r.get("isBase")][0]["desc"]
check("describe: skewness equals scipy (bias=False)", abs(dsc["skewness"] - _st2.skew(xs_, bias=False)) < 0.002, f"{dsc['skewness']} vs {_st2.skew(xs_, bias=False)}")
check("describe: kurtosis equals scipy (bias=False)", abs(dsc["kurtosis"] - _st2.kurtosis(xs_, bias=False)) < 0.002, f"{dsc['kurtosis']} vs {_st2.kurtosis(xs_, bias=False)}")
check("describe: sum and mode", abs(dsc["sum"] - xs_.sum()) < 0.01 and dsc["mode"] == float(pd.Series(xs_).mode().min()))
check("describe: p10 and p90 are observed values in range", 1 <= dsc["p10"] <= dsc["p90"] <= 5)
check("describe: histogram shares add to about 100", abs(sum(h["pct"] for h in dsc["hist"]) - 100) < 0.6, str(dsc["hist"]))
chk_p = psf.crosstab(data, "t.sav", {"columnVars": [], "weightVar": None, "percentiles": [5, 95],
        "rowItems": [{"key": "g", "label": "Ratings", "kind": "grid", "vars": ["sc_1"], "stem": ""}]})
check("describe: chosen percentiles returned", [e["p"] for e in [r for r in chk_p["questions"][0]["rows"] if not r.get("isBase")][0]["desc"]["percentiles"]] == [5.0, 95.0])

# Fisher exact against scipy
for tab in ([[3, 9], [12, 4]], [[0, 7], [5, 5]], [[20, 30], [25, 18]], [[1, 1], [1, 1]]):
    f_ = psf._fisher_exact_2x2(*sum(tab, []))
    e_ = _st2.fisher_exact(tab).pvalue
    check(f"fisher exact {tab}", abs(f_ - e_) < 1e-4, f"{f_} vs {e_}")

# Don't know: excluded from the base by default, kept on request
dkreq = {"columnVars": ["reg"], "weightVar": None, "rowItems": [{"key": "s", "label": "Rating", "vars": ["sc_1"]}]}
r_ex = psf.crosstab(data, "t.sav", dkreq)
r_in = psf.crosstab(data, "t.sav", {**dkreq, "excludeDk": False})
lab_ex = [r["label"] for r in data_rows(r_ex["questions"][0])]
lab_in = [r["label"] for r in data_rows(r_in["questions"][0])]
check("don't know: no row by default", not any("know" in x.lower() for x in lab_ex), str(lab_ex))
check("don't know: own row when included", any("know" in x.lower() for x in lab_in), str(lab_in))
n_ex = sum(r["total"]["count"] for r in data_rows(r_ex["questions"][0]))
check("don't know: base is the substantive answers", abs(n_ex - (~dk).sum()) < 0.5, f"{n_ex} vs {(~dk).sum()}")
check("don't know: flag and note returned", r_ex["excludeDk"] is True and r_in["excludeDk"] is False and "left out" in r_ex["notes"]["dkNote"])

# Filter (layer): base and shares restricted to one group, design intact
lay = psf.crosstab(data, "t.sav", {"columnVars": [], "weightVar": None, "layer": {"variable": "reg", "category": "North"},
        "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"]}]})
mN = reg == 1
check("layer: total base is the filtered group", lay["total"]["n"] == int(mN.sum()), f"{lay['total']['n']} vs {mN.sum()}")
a_ = data_rows(lay["questions"][0])[0]
exp_a = (q1[mN] == 1).mean() * 100
check("layer: percentage computed inside the group", abs(a_["total"]["pct"] - exp_a) < 0.06, f"{a_['total']['pct']} vs {exp_a}")
check("layer: reported", lay["filters"][0]["variable"] == "reg" and "Filtered" in lay["notes"]["filterNote"])
# Filters: several conditions at once, answers in a list, a numeric range, not-in
def _flt(filters, w_="wgt"):
    return psf.crosstab(data, "t.sav", {"columnVars": [], "weightVar": w_, "filters": filters,
        "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"]}]})
fa = _flt([{"variable": "reg", "op": "in", "values": ["North", "South"]}, {"variable": "sc_1", "op": "between", "min": 2, "max": 4}], None)
mA = np.isin(reg, [1, 2]) & (sc >= 2) & (sc <= 4) & (sc != 99)
check("filters: list plus numeric range, base is the intersection", fa["total"]["n"] == int(mA.sum()), f"{fa['total']['n']} vs {mA.sum()}")
ra_ = data_rows(fa["questions"][0])[0]
check("filters: percentage inside the intersection", abs(ra_["total"]["pct"] - (q1[mA] == 1).mean() * 100) < 0.06)
check("filters: range excludes the don't know code", _flt([{"variable": "sc_1", "op": "between", "min": 1}], None)["total"]["n"] == int(((sc >= 1) & (sc != 99)).sum()))
fn = _flt([{"variable": "reg", "op": "notIn", "values": ["Tiny"]}], None)
check("filters: not in", fn["total"]["n"] == int((reg != 4).sum()))
check("filters: described in the notes", "North or South" in fa["notes"]["filterNote"] and "from 2 to 4" in fa["notes"]["filterNote"])
for bad_ in ([{"variable": "reg", "op": "in", "values": []}], [{"variable": "sc_1", "op": "between"}], [{"variable": "reg", "op": "in", "values": ["Nowhere"]}]):
    try:
        _flt(bad_)
        check("filters: bad filter is refused", False)
    except ValueError:
        check("filters: bad filter is refused", True)
# a filter changes nothing about the design: weighted domain estimate equals the plain subset
fw = _flt([{"variable": "reg", "op": "in", "values": ["East"]}])
mE = reg == 3
check("filters: weighted percentage equals the subset", abs(data_rows(fw["questions"][0])[0]["total"]["pct"] - (w[mE] * (q1[mE] == 1)).sum() / w[mE].sum() * 100) < 0.06)

# Share of responses
rp = psf.crosstab(data, "t.sav", {"columnVars": ["reg"], "weightVar": "wgt", "rowItems": [{"key": "m", "label": "Brands", "vars": ["m_1", "m_2", "m_3", "m_4"], "stem": ""}]})
orows = data_rows(rp["questions"][0])
for k in range(len(rp["columns"])):
    tot_ = sum((r["respPct"][k] or 0) for r in orows)
    check(f"share of responses adds to 100 (column {k})", abs(tot_ - 100) < 0.5 or all(r["respPct"][k] is None for r in orows), str(tot_))
m1_ = [r for r in orows if r["label"] == "Brand A"]
den_ = sum(r["count"][0] for r in orows)
check("share of responses = count over mentions", abs(m1_[0]["respPct"][0] - m1_[0]["count"][0] / den_ * 100) < 0.06)

# Expected-count warning
xt = psf.crosstab(data, "t.sav", {"columnVars": ["reg"], "weightVar": None, "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"]}]})
tt_ = xt["questions"][0]["tableTests"][0]
U_ = pd.crosstab(q1, reg).to_numpy().astype(float)
E_ = np.outer(U_.sum(1), U_.sum(0)) / U_.sum()
check("expected counts: share under 5", abs(tt_["lowExpectedPct"] - (E_ < 5).mean() * 100) < 0.06, f"{tt_['lowExpectedPct']}")
check("expected counts: smallest value", abs(tt_["minExpected"] - E_.min()) < 0.01)

check("don't know pattern accepts a curly apostrophe", all(psf._DK_RE.match(x) for x in ("Don\u2019t know", "Don't Know", "Refused", "Not applicable")) and not psf._DK_RE.match("Donated"))

# 15. Subtotals, net score and mean score (Likert style rows)
def _grp(groups, **kw):
    return psf.crosstab(data, "t.sav", {"columnVars": ["reg"], "weightVar": "wgt", **kw, "rowItems": [{"key": "q1", "label": "Q1", "vars": ["q1"], "groups": groups}]})
gs = [{"label": "A vs C", "cats": ["A"], "minus": ["C"], "kind": "score", "place": "above"},
      {"label": "Q1", "cats": [], "kind": "mean", "place": "end"},
      {"label": "A or B", "cats": ["A", "B"], "place": "below"}]
rg = _grp(gs)
labs_ = [r["label"] for r in rg["questions"][0]["rows"] if not r.get("isBase")]
check("groups: placement above, below and end", labs_ == ["Net score: A vs C", "A", "B", "NET: A or B", "C", "Mean score: Q1"], str(labs_))
rows_ = {r["label"]: r for r in rg["questions"][0]["rows"]}
vq_ = np.isin(q1, [1, 2, 3])
for ci, (cname, mk_) in enumerate([("North", reg == 1), ("South", reg == 2), ("East", reg == 3)]):
    ww = w[mk_]; qq = q1[mk_]
    ns_ = (ww * ((qq == 1) * 100.0 - (qq == 3) * 100.0)).sum() / ww.sum()
    mn_ = (ww * qq).sum() / ww.sum()
    check(f"net score equals share positive minus share negative ({cname})", abs(rows_["Net score: A vs C"]["pct"][ci] - ns_) < 0.011, f"{rows_['Net score: A vs C']['pct'][ci]} vs {ns_}")
    check(f"mean score equals weighted mean of codes ({cname})", abs(rows_["Mean score: Q1"]["pct"][ci] - mn_) < 0.006, f"{rows_['Mean score: Q1']['pct'][ci]} vs {mn_}")
    chk_sub = rows_["NET: A or B"]["pct"][ci]
    check(f"subtotal equals the sum of its answers ({cname})", abs(chk_sub - (rows_["A"]["pct"][ci] + rows_["B"]["pct"][ci])) < 0.11)
# net score test equals an independent difference-of-means z test (no design)
ysc = np.where(q1 == 1, 100.0, np.where(q1 == 3, -100.0, 0.0))
def _wm(x, wt):
    sw = wt.sum(); ne = sw ** 2 / (wt ** 2).sum(); m = (wt * x).sum() / sw
    return m, (wt * (x - m) ** 2).sum() / sw * ne / (ne - 1), ne
mN, vN, nN = _wm(ysc[reg == 1], w[reg == 1])
rest_ = np.isin(reg, [2, 3, 4])
mR, vR, nR = _wm(ysc[rest_], w[rest_])
z_ = (mN - mR) / math.sqrt(vN / nN + vR / nR)
from scipy import stats as _st3
p_exp = 2 * _st3.norm.sf(abs(z_))
check("net score tested like a mean against the other columns", rows_["Net score: A vs C"]["p"][0] is not None and abs(rows_["Net score: A vs C"]["p"][0] - p_exp) < 0.0006, f"{rows_['Net score: A vs C']['p'][0]} vs {p_exp}")
bad = _grp([{"label": "bad", "cats": ["A"], "minus": ["A"], "kind": "score"}])
check("net score with overlapping answers is skipped with a reason", any("overlap" in x["reason"] for x in bad["skipped"]))
tb_ = [r for r in rg["questions"][0]["rows"] if not r.get("isBase") and not r.get("isNet")]
check("total row ignores subtotals and scores", len(tb_) == 3)

# Batch 47 regression (Grant, 27 October 2026): a 0% cell against a small share. 0 of 53 in column A,
# 11 of 947 in column B, unweighted. The unpooled test gives a zero variance for A and p = 0.0008, so it
# flagged A as significantly lower. Pooled under the null hypothesis: p0 = 11/1000,
# se = sqrt(p0 (1 - p0) (1/53 + 1/947)), z = -0.789, p = 0.430 (Fisher's exact test gives p = 1.0).
zr = pd.DataFrame({"grp": ["A"] * 53 + ["B"] * 947, "y": [2] * 53 + [1] * 11 + [2] * 936, "psu": np.arange(1000)})
zr_args = {"columnVars": ["grp"], "rowItems": [{"key": "y", "label": "Y", "vars": ["y"]}], "weightVar": None, "correction": "none"}
rz = psf.crosstab(zr.to_csv(index=False).encode(), "z.csv", zr_args)
zrow = next(r for r in data_rows(rz["questions"][0]) if r["label"] == "1")
p0r = 11 / 1000
z_ref = (0 - 11 / 947) / math.sqrt(p0r * (1 - p0r) * (1 / 53 + 1 / 947))
p_ref = math.erfc(abs(z_ref) / math.sqrt(2))
check("0 of 53 vs 11 of 947: pooled p-value (0.430, not 0.0008)", zrow["p"][0] is not None and abs(zrow["p"][0] - p_ref) < 1e-3 and abs(p_ref - 0.4302) < 1e-3, f"{zrow['p'][0]} vs {p_ref}")
check("0 of 53 vs 11 of 947: the 0% cell is not flagged lower", zrow["sig"][0] == 0, str(zrow["sig"]))
check("0 of 53 vs 11 of 947: no column letters either way", not any(zrow.get("letters") or []), str(zrow.get("letters")))
check("the notes name the pooled test and its method version", "pooled" in rz["notes"]["test"] and rz["notes"].get("methodVersion") == psf.TABLE_METHOD)
check("no design: nothing reported as untested", rz["notes"].get("degenerateUntested") is None)
# Boundary: a real difference is still found by the pooled test (0 of 200 vs 60 of 800).
big = pd.DataFrame({"grp": ["A"] * 200 + ["B"] * 800, "y": [2] * 200 + [1] * 60 + [2] * 740})
rb = psf.crosstab(big.to_csv(index=False).encode(), "b.csv", zr_args)
brow = next(r for r in data_rows(rb["questions"][0]) if r["label"] == "1")
check("pooled test still flags a clear difference at 0% (0 of 200 vs 60 of 800)", brow["sig"][0] == -1 and brow["p"][0] < 0.001, f"{brow['sig']} {brow['p']}")
# Under a design a 0% share has no linearised variance: the cell is left untested and the notes say so.
rzd = psf.crosstab(zr.to_csv(index=False).encode(), "z.csv", dict(zr_args, design={"psu": "psu", "strata": None}))
zdrow = next(r for r in data_rows(rzd["questions"][0]) if r["label"] == "1")
check("design: the 0% cell is untested (no p, no flag)", zdrow["p"][0] is None and zdrow["sig"][0] == 0, f"{zdrow['p']} {zdrow['sig']}")
check("design: the notes count the untested cells", bool(rzd["notes"].get("degenerateUntested")) and "0% or 100%" in rzd["notes"]["degenerateUntested"])

# Batch 47 regression: run-together non-answer labels ("DontKnow", "Not_applicable") are non-answers too,
# in the banner and in the rows, when non-answers are excluded; kept when the researcher includes them.
rk_ = np.random.default_rng(47)
dkn = pd.DataFrame({"ivr": rk_.choice([1, 2, 3], 600), "sat": rk_.choice([1, 2, 3, 4], 600)})
dk_path = os.path.join(tempfile.mkdtemp(), "dk.sav")
pyreadstat.write_sav(dkn, dk_path, variable_value_labels={"ivr": {1: "Yes", 2: "No", 3: "DontKnow"}, "sat": {1: "Good", 2: "Fair", 3: "Poor", 4: "Not_applicable"}})
dk_bytes = open(dk_path, "rb").read()
dk_args = {"columnVars": ["ivr"], "rowItems": [{"key": "sat", "label": "Sat", "vars": ["sat"]}], "weightVar": None, "correction": "none"}
rdk = psf.crosstab(dk_bytes, "dk.sav", dk_args)
check("run-together 'DontKnow' is not a banner column when non-answers are excluded", [c["name"] for c in rdk["columns"]] == ["Yes", "No"], str([c["name"] for c in rdk["columns"]]))
dk_rows = [r["label"] for r in data_rows(rdk["questions"][0])]
check("'Not_applicable' is not an answer row when non-answers are excluded", "Not_applicable" not in dk_rows and {"Good", "Fair", "Poor"} <= set(dk_rows), str(dk_rows))
sub_ = dkn[(dkn["ivr"] == 1) & (dkn["sat"] != 4)]
exp_good = (sub_["sat"] == 1).mean() * 100
got_good = next(r for r in data_rows(rdk["questions"][0]) if r["label"] == "Good")["pct"][0]
check("the base excludes the non-answers (Good among Yes, answering)", abs(got_good - exp_good) < 0.06, f"{got_good} vs {exp_good}")
rkeep = psf.crosstab(dk_bytes, "dk.sav", dict(dk_args, excludeDk=False))
check("with non-answers included, 'DontKnow' and 'Not_applicable' stay", "DontKnow" in [c["name"] for c in rkeep["columns"]] and "Not_applicable" in [r["label"] for r in data_rows(rkeep["questions"][0])])
check("ordinary words that start like a non-answer are still answers", not any(psf._DK_RE.match(x) for x in ("Donations", "Nature", "Domestic", "Noise", "Yes", "No")))

# Batch 48: the Mean tick adds a mean row above each rating-scale question, and names the others.
rk48 = np.random.default_rng(48)
n48 = 500
sat48 = rk48.integers(0, 11, n48).astype(float)
sat48[rk48.random(n48) < 0.08] = 99.0  # don't know
d48 = pd.DataFrame({"seg": rk48.choice([1, 2], n48).astype(float), "sat": sat48, "region": rk48.choice([1, 2, 3], n48).astype(float), "w": np.exp(rk48.normal(0, 0.4, n48))})
p48 = os.path.join(tempfile.mkdtemp(), "m48.sav")
sat_labels = {float(k): str(k) for k in range(11)}; sat_labels[99.0] = "Don't know"
pyreadstat.write_sav(d48, p48, variable_value_labels={"seg": {1: "Seg A", 2: "Seg B"}, "sat": sat_labels, "region": {1: "North", 2: "South", 3: "East"}})
b48 = open(p48, "rb").read()
a48 = {"columnVars": ["seg"], "rowItems": [{"key": "sat", "label": "Satisfaction", "vars": ["sat"]}, {"key": "region", "label": "Region", "vars": ["region"]}], "weightVar": "w", "correction": "none"}
r48 = psf.crosstab(b48, "m48.sav", dict(a48, meanRows=True))
qs48 = {q["key"]: q for q in r48["questions"]}
sat_rows = [r for r in qs48["sat"]["rows"] if not r.get("isBase")]
check("Mean tick: the first row after the bases is the mean", sat_rows[0].get("autoMean") is True and sat_rows[0]["label"] == "Mean" and sat_rows[0].get("isMean") is True, str([r["label"] for r in sat_rows][:3]))
for ci, code in enumerate([1.0, 2.0]):
    mk = (d48["seg"] == code) & (d48["sat"] != 99)
    exp48 = float((d48["w"][mk] * d48["sat"][mk]).sum() / d48["w"][mk].sum())
    check(f"Mean tick: weighted mean of the codes, don't know left out (column {ci})", abs(sat_rows[0]["pct"][ci] - exp48) < 0.006, f"{sat_rows[0]['pct'][ci]} vs {exp48}")
mkT = d48["sat"] != 99
check("Mean tick: total mean", abs(sat_rows[0]["total"]["pct"] - float((d48["w"][mkT] * d48["sat"][mkT]).sum() / d48["w"][mkT].sum())) < 0.006)
check("Mean tick: a mean is tested like any mean (p-values present)", any(p is not None for p in sat_rows[0]["p"]))
check("Mean tick: no mean for codes that are not a scale", not any(r.get("autoMean") for r in qs48["region"]["rows"]))
check("Mean tick: the question without a mean is named", "Region" in (r48["notes"].get("meanNotAdded") or "") and "Satisfaction" not in (r48["notes"].get("meanNotAdded") or ""))
r48off = psf.crosstab(b48, "m48.sav", a48)
check("no Mean tick (or a request saved before it): no mean row, nothing named", not any(r.get("autoMean") for q in r48off["questions"] for r in q["rows"]) and r48off["notes"].get("meanNotAdded") is None and r48off["notes"].get("meanRows") is False)
own = dict(a48, meanRows=True, rowItems=[{"key": "sat", "label": "Satisfaction", "vars": ["sat"], "groups": [{"label": "Satisfaction", "kind": "mean", "place": "end", "cats": [str(k) for k in range(11)]}]}])
r48own = psf.crosstab(b48, "m48.sav", own)
means48 = [r for r in r48own["questions"][0]["rows"] if r.get("isMean")]
check("a question with its own mean group gets no second mean", len(means48) == 1 and not means48[0].get("autoMean"), str([r["label"] for r in means48]))

# Indicator data reader (batch 54): its own self-test, run here so this gate covers it.
import subprocess  # noqa: E402

_ind = subprocess.run([sys.executable, os.path.join(HERE, "indicator_selftest.py")], capture_output=True, text=True)
print(_ind.stdout.rstrip())
check("indicator data reader self-test (scripts/indicator_selftest.py)", _ind.returncode == 0, _ind.stderr[-400:])

# CT5K-F01 (Codex, 28 October 2026): row percentages and shares of responses were divided from counts
# already rounded to one decimal for display, so multiplying every positive weight by one constant changed
# them (with weights of 1/1024 the selected answer's row % read 0/0/100 and a share of responses was blank
# despite 100 unweighted cases). Expected values below are written by hand from the counts, not from the engine.
def _rows_by(q, key="label"):
    return {r.get(key): r for r in q["rows"] if not r.get("isBase")}

def _close(a, b, tol=0.051):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol

def _all_close(a, b, tol=0.051):
    return isinstance(a, list) and len(a) == len(b) and all(_close(x, y, tol) for x, y in zip(a, b))

ra = []
for g in range(3):
    k_sel, k_m2 = [10, 30, 60][g], [30, 50, 70][g]
    for i in range(100):
        ra.append({"Y": 1.0 if i < k_sel else 2.0, "G": float(g + 1), "H": 1.0 if i % 2 == 0 else 2.0,
                   "M_1": float(i < k_sel), "M_2": float(i < k_m2),
                   # K_1 is chosen only in the third group; nobody chose K_2. Both answered by everyone.
                   "K_1": float(g == 2 and i < 20), "K_2": 0.0, "W": 1.0})
dA = pd.DataFrame(ra)
pA = os.path.join(tempfile.mkdtemp(), "ct5k.sav")
pyreadstat.write_sav(dA, pA, variable_value_labels={
    # Code 3 is declared and never used: its row is kept with a zero count in every column.
    "Y": {1: "Selected", 2: "Other", 3: "Never"}, "G": {1: "G1", 2: "G2", 3: "G3"}, "H": {1: "Even", 2: "Odd"},
    "M_1": {0: "No", 1: "Yes"}, "M_2": {0: "No", 1: "Yes"}, "K_1": {0: "No", 1: "Yes"}, "K_2": {0: "No", 1: "Yes"}})
bA = open(pA, "rb").read()

def _ct5k(cols_, weight_scale, rows_):
    d = dA.copy()
    d["W"] = weight_scale
    p = os.path.join(tempfile.mkdtemp(), "ct5k.sav")
    pyreadstat.write_sav(d, p, variable_value_labels={
        "Y": {1: "Selected", 2: "Other", 3: "Never"}, "G": {1: "G1", 2: "G2", 3: "G3"}, "H": {1: "Even", 2: "Odd"},
        "M_1": {0: "No", 1: "Yes"}, "M_2": {0: "No", 1: "Yes"}, "K_1": {0: "No", 1: "Yes"}, "K_2": {0: "No", 1: "Yes"}})
    return psf.crosstab(open(p, "rb").read(), "ct5k.sav", {"columnVars": cols_, "weightVar": "W", "correction": "none", "rowItems": rows_})

ct5k_items = [
    {"key": "Y", "label": "Y", "vars": ["Y"], "groups": [{"kind": "net", "label": "Picked", "cats": ["Selected"], "place": "end"}]},
    {"key": "M", "label": "M", "vars": ["M_1", "M_2"], "stem": ""},
    {"key": "K", "label": "K", "vars": ["K_1", "K_2"], "stem": ""},
    {"key": "U", "label": "U", "kind": "nets", "vars": [], "nets": [{"label": "Any M", "vars": ["M_1", "M_2"]}]},
]
for scale in [1.0, 1 / 1024, 1e-6, 1000.0, 3.7]:
    tag = f"weights x{scale:g}"
    rt = _ct5k(["G", "H"], scale, ct5k_items)
    qs = {q["key"]: q for q in rt["questions"]}
    y = _rows_by(qs["Y"])
    # G block is columns 0-2, H block columns 3-4: each row % is within its own banner variable.
    check(f"CT5K {tag}: selected answer row % 10/30/60 (G) and 50/50 (H)", _all_close(y["Selected"]["rowPct"], [10.0, 30.0, 60.0, 50.0, 50.0]), str(y["Selected"]["rowPct"]))
    check(f"CT5K {tag}: other answer row % 45/35/20 (G); H 50/50", _all_close(y["Other"]["rowPct"], [45.0, 35.0, 20.0, 50.0, 50.0]), str(y["Other"]["rowPct"]))
    check(f"CT5K {tag}: column % unchanged by weight scale", _all_close(y["Selected"]["pct"], [10.0, 30.0, 60.0, 33.3, 33.3]), str(y["Selected"]["pct"]))
    check(f"CT5K {tag}: NET row % from unrounded counts", _all_close(y["NET: Picked"]["rowPct"], [10.0, 30.0, 60.0, 50.0, 50.0]), str(y["NET: Picked"]["rowPct"]))
    check(f"CT5K {tag}: an answer nobody gave has no row % (zero denominator, explicit None)", y["Never"]["rowPct"] == [None] * 5 and y["Never"]["pct"] == [0.0] * 5, str(y["Never"]["rowPct"]))
    m = _rows_by(qs["M"], "variable")
    check(f"CT5K {tag}: share of responses overall 40/60", _close(m["M_1"]["total"]["respPct"], 40.0) and _close(m["M_2"]["total"]["respPct"], 60.0), f'{m["M_1"]["total"]["respPct"]} {m["M_2"]["total"]["respPct"]}')
    check(f"CT5K {tag}: share of responses per column (G1 25/75, G2 37.5/62.5, G3 46.2/53.8)",
          _all_close(m["M_1"]["respPct"][:3], [25.0, 37.5, 46.2]) and _all_close(m["M_2"]["respPct"][:3], [75.0, 62.5, 53.8]), f'{m["M_1"]["respPct"]} {m["M_2"]["respPct"]}')
    check(f"CT5K {tag}: share of responses in each banner's NET column 40/60", all(_close(nt["respPct"], 40.0) for nt in m["M_1"]["net"]) and all(_close(nt["respPct"], 60.0) for nt in m["M_2"]["net"]), str([nt["respPct"] for nt in m["M_1"]["net"]]))
    check(f"CT5K {tag}: multi-response option row % (M_2 20/33.3/46.7)", _all_close(m["M_2"]["rowPct"][:3], [20.0, 33.3, 46.7]), str(m["M_2"]["rowPct"]))
    k = _rows_by(qs["K"], "variable")
    check(f"CT5K {tag}: zero-selected columns: share of responses unavailable where no option was chosen, 100/0 where one was",
          k["K_1"]["respPct"][:3] == [None, None, 100.0] and k["K_2"]["respPct"][:3] == [None, None, 0.0], f'{k["K_1"]["respPct"]} {k["K_2"]["respPct"]}')
    check(f"CT5K {tag}: an option chosen in one column only: row % 0/0/100; never chosen: None",
          _all_close(k["K_1"]["rowPct"][:3], [0.0, 0.0, 100.0]) and k["K_2"]["rowPct"] == [None] * 5, f'{k["K_1"]["rowPct"]} {k["K_2"]["rowPct"]}')
    check(f"CT5K {tag}: share of responses total with a zero option 100/0", k["K_1"]["total"]["respPct"] == 100.0 and k["K_2"]["total"]["respPct"] == 0.0)
    u = _rows_by(qs["U"])
    check(f"CT5K {tag}: researcher net row % 20/33.3/46.7", _all_close(u["NET: Any M"]["rowPct"][:3], [20.0, 33.3, 46.7]), str(u["NET: Any M"]["rowPct"]))
    # The unrounded figures are saved with the result (countExact, pctExact, seExact), so figures derived
    # in src/lib (NPS, top-box, the export's Total line) never add the display values. Hand counts below.
    check(f"CT5K {tag}: countExact is the unrounded weighted count (10/30/60 cases x weight)",
          _all_close(y["Selected"]["countExact"], [10 * scale, 30 * scale, 60 * scale, 50 * scale, 50 * scale], 1e-9 * max(scale, 1))
          and abs(y["Selected"]["total"]["countExact"] - 100 * scale) <= 1e-9 * max(scale, 1), str(y["Selected"]["countExact"]))
    check(f"CT5K {tag}: pctExact is the unrounded share (H: 50/150 = 33.333...)", _all_close(y["Selected"]["pctExact"], [10.0, 30.0, 60.0, 100 / 3, 100 / 3], 1e-9), str(y["Selected"]["pctExact"]))
    check(f"CT5K {tag}: NET column carries countExact and pctExact", all(abs(nt["pctExact"] - 100 / 3) < 1e-9 and abs(nt["countExact"] - 100 * scale) <= 1e-9 * max(scale, 1) for nt in y["Selected"]["net"]))
    check(f"CT5K {tag}: pctExact is null exactly where pct is", all((a is None) == (b is None) for q in rt["questions"] for r in q["rows"] if not r.get("isBase") for a, b in zip(r["pct"], r["pctExact"])))
    check(f"CT5K {tag}: seExact rounds to se", all((a is None and b is None) or (a is not None and abs(round(b, 2) - a) < 1e-9) for a, b in zip(y["Selected"]["se"], y["Selected"]["seExact"])))
    # Overlapping banner (a multiple-response set as columns): a case can sit in both columns; each row %
    # divides by the sum over that banner's columns, the existing domain. Hand count: every Selected case is
    # in both M_1 and M_2 (100 each); Other cases are only in M_2: 20 + 20 + 10 = 50.
    ro = _ct5k(["set:M"], scale, [ct5k_items[0]])
    yo = _rows_by(ro["questions"][0])
    check(f"CT5K {tag}: overlapping banner row % (Selected 50/50, Other 0/100)", _all_close(yo["Selected"]["rowPct"], [50.0, 50.0]) and _all_close(yo["Other"]["rowPct"], [0.0, 100.0]), f'{yo["Selected"]["rowPct"]} {yo["Other"]["rowPct"]}')

# Ordinary fractional weights, a tiny column and partly missing options, against a direct calculation from
# the case records; then the same table with every weight multiplied by 1/1024 and by 1000 must give the same
# percentages and the same blanks (suppressed tiny column, zero denominators).
rkf = np.random.default_rng(59)
nf = 406
gf = np.concatenate([rkf.choice([1.0, 2.0, 3.0], nf - 6), np.full(6, 4.0)])  # group 4: 6 cases, suppressed
hf = rkf.choice([1.0, 2.0], nf)
yf = rkf.choice([1.0, 2.0, 3.0], nf, p=[0.2, 0.5, 0.3])
mf = {f"M_{j}": (rkf.random(nf) < [0.15, 0.35, 0.6][j - 1]).astype(float) for j in (1, 2, 3)}
mf["M_3"][rkf.random(nf) < 0.25] = np.nan  # option 3 not asked of a quarter
wf = rkf.uniform(0.013, 0.097, nf)
dF = pd.DataFrame({"Y": yf, "G": gf, "H": hf, **mf, "W": wf})
labF = {"Y": {1: "A", 2: "B", 3: "C"}, "G": {1: "G1", 2: "G2", 3: "G3", 4: "Tiny"}, "H": {1: "H1", 2: "H2"},
        **{f"M_{j}": {0: "No", 1: "Yes"} for j in (1, 2, 3)}}

def _ct5k_frac(scale):
    d = dF.copy()
    d["W"] = d["W"] * scale
    p = os.path.join(tempfile.mkdtemp(), "ct5kf.sav")
    pyreadstat.write_sav(d, p, variable_value_labels=labF)
    return psf.crosstab(open(p, "rb").read(), "ct5kf.sav", {"columnVars": ["G", "H"], "weightVar": "W", "correction": "none", "rowItems": [
        {"key": "Y", "label": "Y", "vars": ["Y"]}, {"key": "M", "label": "M", "vars": ["M_1", "M_2", "M_3"], "stem": ""}]})

colsF = [("G", 1.0), ("G", 2.0), ("G", 3.0), ("G", 4.0), ("H", 1.0), ("H", 2.0)]
def _ref_rowpct(sel, valid):
    out = []
    for var, code in colsF:
        num = float(dF["W"][sel & valid & (dF[var] == code)].sum())
        den = sum(float(dF["W"][sel & valid & (dF[v2] == c2)].sum()) for v2, c2 in colsF if v2 == var)
        n = int((valid & (dF[var] == code)).sum())
        out.append(None if n < 10 or den <= 0 else round(100 * num / den, 1))
    return out
def _ref_resppct(opt):
    out = []
    for var, code in colsF:
        col = dF[var] == code
        num = float(dF["W"][col & (dF[opt] == 1)].sum())
        den = sum(float(dF["W"][col & (dF[o] == 1)].sum()) for o in ("M_1", "M_2", "M_3"))
        n = int((col & dF[opt].notna()).sum())
        out.append(None if n < 10 or den <= 0 else round(100 * num / den, 1))
    return out

fr = {s: _ct5k_frac(s) for s in (1.0, 1 / 1024, 1000.0)}
qf = {q["key"]: q for q in fr[1.0]["questions"]}
yfr = _rows_by(qf["Y"], "rawCode")
validY = dF["Y"].notna()
check("CT5K fractional weights: single-answer row % equals the direct calculation", all(_all_close(yfr[str(c)]["rowPct"], _ref_rowpct(dF["Y"] == float(c), validY)) for c in (1, 2, 3)),
      str([(yfr[str(c)]["rowPct"], _ref_rowpct(dF["Y"] == float(c), validY)) for c in (1, 2, 3)]))
mfr = _rows_by(qf["M"], "variable")
check("CT5K fractional weights: share of responses equals the direct calculation", all(_all_close(mfr[o]["respPct"], _ref_resppct(o)) for o in ("M_1", "M_2", "M_3")),
      str([(mfr[o]["respPct"], _ref_resppct(o)) for o in ("M_1", "M_2", "M_3")]))
check("CT5K fractional weights: option row % equals the direct calculation", all(_all_close(mfr[o]["rowPct"], _ref_rowpct(dF[o] == 1, dF[o].notna())) for o in ("M_1", "M_2", "M_3")),
      str([(mfr[o]["rowPct"], _ref_rowpct(dF[o] == 1, dF[o].notna())) for o in ("M_1", "M_2", "M_3")]))
check("CT5K fractional weights: the tiny column stays suppressed", yfr["1"]["rowPct"][3] is None and mfr["M_1"]["respPct"][3] is None)

def _figures(res_):
    out = []
    for q in res_["questions"]:
        for r in q["rows"]:
            if r.get("isBase"):
                continue
            out.append((r["label"], r.get("pct"), r.get("rowPct"), r.get("respPct"), r["total"].get("pct"), r["total"].get("respPct"),
                        [(nt.get("pct"), nt.get("rowPct"), nt.get("respPct")) for nt in r["net"]]))
    return out

def _same_figures(a, b):
    def same(x, y):
        if isinstance(x, (list, tuple)):
            return isinstance(y, (list, tuple)) and len(x) == len(y) and all(same(p, q) for p, q in zip(x, y))
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            return abs(x - y) <= 0.1001  # one display step: a value on a rounding boundary may land either side
        return x == y
    return same(a, b)

base_f = _figures(fr[1.0])
for s in (1 / 1024, 1000.0):
    check(f"CT5K fractional weights x{s:g}: every percentage and every blank unchanged by rescaling", _same_figures(base_f, _figures(fr[s])))

# Mean rows and histograms carry their unrounded figures too (CT5K-F01): the weighted mean of the codes,
# computed here directly, and each value's weighted share.
check("CT5K: a mean row's pctExact is the unrounded weighted mean", all(abs(sat_rows[0]["pctExact"][ci] - float((d48["w"][(d48["seg"] == code) & (d48["sat"] != 99)] * d48["sat"][(d48["seg"] == code) & (d48["sat"] != 99)]).sum() / d48["w"][(d48["seg"] == code) & (d48["sat"] != 99)].sum())) < 1e-9 for ci, code in enumerate([1.0, 2.0])))
h48 = qs48["sat"].get("desc", {}).get("hist") or []
check("CT5K: histogram bars carry pctExact that rounds to pct and adds to 100", bool(h48) and all(abs(round(b["pctExact"], 1) - b["pct"]) < 1e-9 for b in h48) and abs(sum(b["pctExact"] for b in h48) - 100) < 1e-9, str(h48[:2]))

print("\n%d failed" % len(fails) if fails else "\nAll checks passed")
sys.exit(1 if fails else 0)
