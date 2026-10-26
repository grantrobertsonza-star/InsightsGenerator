"""Verification of the weighted crosstab engine on the FinScope SA 2024 file.

Run from the app folder:
    python scripts/finscope_verify.py "<path to FinScope SA 2024.sav>" "<folder with R output csv files>" "<output folder>"

What it does
1. Weight audit (invalid weights, sum against the R benchmark, Kish design effect, efficiency).
2. Missing code audit (which variables carry 997 to 999 style codes that the file does not declare as missing).
3. Rebuilds DV1 (dfs_any) from the documented R script, runs it through the engine by Province, Metro,
   Gender (question A2, as the R script defines it) and Age group, and compares every cell with the R survey output (point estimates must agree
   because the same weights are used; standard errors are expected to differ because the engine ignores strata and PSU).
4. Checks the engine against independent pandas/numpy calculations on real survey questions,
   including a multiple-response set, a net and an average.
Writes finscope_verify_report.md and finscope_verify_cells.csv to the output folder.
"""
import importlib.util
import math
import os
import sys
import tempfile

import numpy as np
import pandas as pd
import pyreadstat

SAV = sys.argv[1]
RDIR = sys.argv[2]
OUT = sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("psf", os.path.join(HERE, "..", "api", "parse-stats-file.py"))
psf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(psf)

WEIGHT = "BENCHWGT_Mid_year"
EXPECTED_POP = 44591256.0000294
lines = []
cells = []
fails = []


def data_rows(q):
    """Answer rows only: the base rows (unweighted n, effective base) are not answers."""
    return [r for r in q["rows"] if not r.get("isBase")]


def base_rows(q):
    return [r for r in q["rows"] if r.get("isBase")]


def say(s=""):
    print(s)
    lines.append(s)


def check(name, ok, detail=""):
    say(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "   " + detail))
    if not ok:
        fails.append(name)


raw, meta = pyreadstat.read_sav(SAV)
df = raw.copy()
df.columns = [c.lower() for c in df.columns]
say(f"# FinScope engine verification\n\nFile: {os.path.basename(SAV)}, {len(df)} cases, {df.shape[1]} variables.\n")

# ---------------------------------------------------------------- 1. weights
w = df[WEIGHT.lower()].astype(float).to_numpy()
bad = int((~np.isfinite(w) | (w <= 0)).sum())
sw = float(np.nansum(w))
n_eff = sw**2 / float(np.nansum(w**2))
say("## 1. Weight audit")
say(f"- Weight variable: {WEIGHT}. Invalid (missing, zero or negative): {bad}.")
say(f"- Sum of weights: {sw:,.2f}; R benchmark {EXPECTED_POP:,.2f}; difference {sw - EXPECTED_POP:,.4f}.")
say(f"- Kish effective n: {n_eff:,.0f} of {len(w)} cases; design effect from weights alone {len(w) / n_eff:.3f}; weighting efficiency {n_eff / len(w) * 100:.1f}%.")
check("weights are all valid", bad == 0)
check("sum of weights matches the R benchmark", abs(sw - EXPECTED_POP) < 0.5)

# ---------------------------------------------------------------- 2. missing codes
say("\n## 2. Missing code audit")
declared = meta.missing_ranges or {}
say(f"- Variables with user-missing ranges declared in the file: {len(declared)}.")
labels = meta.variable_value_labels or {}
dk_re = pd.Series(dtype=object)
import re
dk = re.compile(r"^\s*(don.?t know|refus|not applicable|n/?a\b|no answer|not asked)", re.I)
rows = []
for var, vl in labels.items():
    codes = [(k, v) for k, v in vl.items() if dk.match(str(v))]
    if codes and var.lower() in df.columns:
        x = df[var.lower()]
        cnt = int(x.isin([c for c, _ in codes]).sum())
        rows.append({"variable": var, "codes": "; ".join(f"{int(c) if float(c).is_integer() else c}={v}" for c, v in codes), "cases": cnt})
mc = pd.DataFrame(rows).sort_values("cases", ascending=False)
say(f"- Variables with don't know / refused style labels that the file does NOT declare as missing: {len(mc)} (cases affected in total {int(mc['cases'].sum()):,}).")
say("- The engine drops such codes from averages by label. In percentage tables they appear as ordinary answer categories, which is the usual behaviour, but they also sit in the base. Top rows:")
for _, r in mc.head(8).iterrows():
    say(f"  - {r['variable']}: {r['codes']} ({r['cases']} cases)")
mc.to_csv(os.path.join(OUT, "finscope_missing_code_audit.csv"), index=False)

# ---------------------------------------------------------------- 3. DV1 rebuild
say("\n## 3. DV1 (dfs_any) against the R survey output")


def anyone(cols):
    cols = [c for c in cols if c in df.columns]
    if not cols:
        return np.zeros(len(df), dtype=int)
    return ((df[cols] == 1).sum(axis=1) > 0).astype(int).to_numpy()


import re as _re
cn = list(df.columns)
d3b = [c for c in cn if _re.match(r"d3b_.*_2$", c)]
d7b = [c for c in cn if _re.match(r"d7b_.*_2$", c)]
c3m = [c for c in cn if _re.match(r"c3_.*_3$", c)]
f18c = [c for c in cn if _re.match(r"f18c_.*_(6|7|9)$", c)]
en29 = [f"en29_{i}" for i in range(1, 9)]
co = lambda c: (df[c].fillna(0) == 1).to_numpy() if c in df.columns else np.zeros(len(df), bool)
comp = {
    "p2p_send": anyone(d3b), "p2p_recv": anyone(d7b),
    "b2p": ((anyone(c3m) == 1) | co("c5a_6")).astype(int),
    "p2b": (co("c9a_4") | co("c9a_5") | co("c9a_6")).astype(int),
    "en18": co("en18_23").astype(int), "en31": co("en31").astype(int), "en27": co("en27").astype(int),
    "en29": anyone(en29), "f18c": anyone(f18c),
}
df["dfs_any"] = (sum(comp.values()) > 0).astype(int)
say(f"- Components found: {len(d3b)} D3b, {len(d7b)} D7b, {len(c3m)} C3, {len(f18c)} F18c variables. Unweighted dfs_any = 1 for {int(df['dfs_any'].sum())} of {len(df)} cases.")

ref = pd.read_csv(os.path.join(RDIR, "D3_dfs_any_by_segment.csv"))
df["_w"] = w
df["age_group_x"] = pd.cut(df["age"], [0, 17, 29, 44, 59, 200], labels=["16-17", "18-29", "30-44", "45-59", "60+"])
seg_defs = {
    "gender": ("a2", None), "metro_lab": ("metro", None), "province": ("province", None), "age_group": ("age_group_x", None),
}
vlab = {k.lower(): v for k, v in labels.items()}


def level_name(seg, code):
    if seg == "gender":
        return "Gender: " + {1.0: "male", 2.0: "female"}.get(float(code), str(code))
    if seg == "metro_lab":
        return "Metro: " + vlab["metro"].get(code, str(code))
    if seg == "province":
        return "Province: " + vlab["province"].get(code, str(code))
    return "Age group: " + str(code)


def segment_table(sub):
    out = []
    for seg, (col, _) in seg_defs.items():
        for code, g in sub.groupby(col, observed=True):
            wt = g["_w"].to_numpy()
            p = float((wt * g["dfs_any"]).sum() / wt.sum())
            ne = wt.sum() ** 2 / (wt**2).sum()
            out.append({"segment_var": seg, "segment_level": level_name(seg, code), "p": p * 100, "kish_se": math.sqrt(p * (1 - p) / ne) * 100, "n": len(g), "n_eff": ne})
    return pd.DataFrame(out)


best = None
for dom, sub in [("full sample", df), ("account holders (F1 = 1)", df[df["f1"] == 1])]:
    t = segment_table(sub).merge(ref, on=["segment_var", "segment_level"], how="inner")
    t["abs_diff"] = (t["p"] - t["prop_pct"]).abs()
    say(f"- Domain tried: {dom}. Matched segments: {len(t)}; largest point-estimate difference to R: {t['abs_diff'].max():.4f} percentage points.")
    if best is None or t["abs_diff"].max() < best[1]["abs_diff"].max():
        best = (dom, t, sub)
dom, t, sub = best
say(f"- The R output corresponds to: {dom}.")
check("independent weighted proportions equal the R survey estimates (all matched segments, tolerance 0.001 points)", t["abs_diff"].max() < 0.001, f"max diff {t['abs_diff'].max():.4f}")

# engine run on a derived file
tmp = tempfile.mkdtemp()
sub = sub.copy()
mini = pd.DataFrame({
    "province": sub["province"].astype(float), "metro": sub["metro"].astype(float), "a2": sub["a2"].astype(float),
    "age_group": sub["age_group_x"].cat.codes.astype(float) + 1, "dfs_any": sub["dfs_any"].astype(float), "wgt": sub["_w"],
})
vl = {"province": vlab["province"], "metro": vlab["metro"], "a2": {1: "Male", 2: "Female"},
      "age_group": {1: "16-17", 2: "18-29", 3: "30-44", 4: "45-59", 5: "60+"}, "dfs_any": {1: "Uses DFS", 0: "Does not"}}
path = os.path.join(tmp, "dfs.sav")
pyreadstat.write_sav(mini, path, variable_value_labels=vl, column_labels=["Province", "Metro", "Gender (A2)", "Age group", "DFS any", "Weight"])
data = open(path, "rb").read()
eng_ok = True
for cv, seg, lab in [("province", "province", "Province: "), ("metro", "metro_lab", "Metro: "), ("a2", "gender", "Gender: "), ("age_group", "age_group", "Age group: ")]:
    res = psf.crosstab(data, "dfs.sav", {"columnVars": [cv], "weightVar": "wgt", "rowItems": [{"key": "d", "label": "DFS", "vars": ["dfs_any"]}]})
    q = res["questions"][0]
    row = [r for r in data_rows(q) if r["label"] == "Uses DFS"][0]
    for i, c in enumerate(res["columns"]):
        r = ref[(ref.segment_var == seg) & (ref.segment_level.str.lower() == (lab + c["name"]).lower())]
        if r.empty:
            continue
        rp = float(r.prop_pct.iloc[0])
        rse = float(r.se_pct.iloc[0])
        g = row["pct"][i]
        ne = c["nEff"]
        kse = math.sqrt((rp / 100) * (1 - rp / 100) / ne) * 100 if ne else float("nan")
        cells.append({"banner": cv, "column": c["name"], "engine_pct": g, "R_pct": round(rp, 2), "diff": None if g is None else round(g - rp, 3),
                      "R_design_se": round(rse, 2), "engine_kish_se": round(kse, 2), "se_ratio_design_over_kish": round(rse / kse, 2) if kse else None,
                      "engine_sig": row["sig"][i]})
        if g is None or abs(g - rp) > 0.06:
            eng_ok = False
cdf = pd.DataFrame(cells)
check("engine percentages equal R survey percentages (every banner cell, tolerance 0.06 as shown to one decimal)", eng_ok and len(cdf) > 0, str(cdf[cdf['diff'].abs() > 0.06].head().to_dict("records")))
say(f"- Cells compared: {len(cdf)}.")
ratio = cdf["se_ratio_design_over_kish"].dropna()
say(f"- Design-based standard errors (R, strata and PSU) over the engine's weights-only (Kish) standard errors: median {ratio.median():.2f}, range {ratio.min():.2f} to {ratio.max():.2f}.")
say(f"- Reading: a ratio above 1 means the engine understates uncertainty; a ratio of about {ratio.median():.2f} implies test statistics are inflated by roughly that factor in this file. This is the known and deliberate exclusion of the survey design, and it is now measured.")
cdf.to_csv(os.path.join(OUT, "finscope_verify_cells.csv"), index=False)

# ---------------------------------------------------------------- 3b. Taylor series standard errors against R
say("\n### 3b. Taylor series standard errors against R survey::svymean")
say("- The engine is run on the full sample with the account-holder domain expressed as weight = missing for everyone else, so every case stays in the design (the same as subset() on a survey design object).")
wbp = os.path.join(os.path.dirname(SAV), "Finscope24_benchwgt_MY24.xlsx")
mapp = os.path.join(RDIR, "Survey_design_initial_to_final_strata_map.csv")
exact = os.path.exists(wbp) and os.path.exists(mapp)
full = df.copy()
full["_w2"] = np.where(full["f1"] == 1, w, np.nan)
if exact:
    say("- PSU is the original enumeration area (EACode). Strata are rebuilt exactly as in the R run: the EA-level foreign field comes from Finscope24_benchwgt_MY24.xlsx (merged on QID), combined with metro, NLIgrp, province and population group, then mapped to the final analysis strata with the R run's initial-to-final map (singleton strata already merged).")
    wb = pd.read_excel(wbp)
    wb.columns = [c.lower() for c in wb.columns]
    mp = pd.read_csv(mapp)
    mm = full[["qid", "metro", "nligrp", "province", "res_race"]].merge(wb[["qid", "foreign"]], on="qid", how="left")
    mm["key"] = list(zip(mm["foreign"], mm["metro"], mm["nligrp"], mm["province"], mm["res_race"]))
    mp["key"] = list(zip(mp.foreign_ea_stratum, mp.metro, mp.nli_stratum_group, mp.province, mp.res_race))
    strat_key = mm.merge(mp[["key", "strat_analysis"]], on="key", how="left")["strat_analysis"]
    check("every case maps to one of the R run's final analysis strata", bool(strat_key.notna().all()) and strat_key.nunique() == 96, f"{strat_key.nunique()} strata")
    strat_key = pd.factorize(strat_key)[0]
else:
    say("- Foreign-EA workbook or R strata map not found next to the data, so strata are approximated as metro x NLIgrp x province x population group.")
    strat_key = full.groupby(["metro", "nligrp", "province", "res_race"], observed=True).ngroup()
mini2 = pd.DataFrame({
    "province": full["province"].astype(float), "metro": full["metro"].astype(float), "a2": full["a2"].astype(float),
    "age_group": full["age_group_x"].cat.codes.astype(float) + 1, "dfs_any": full["dfs_any"].astype(float),
    "wgt": full["_w2"], "ea": full["eacode"].astype(float), "strat": strat_key.astype(float),
})
path2 = os.path.join(tmp, "dfs2.sav")
pyreadstat.write_sav(mini2, path2, variable_value_labels=vl, column_labels=["Province", "Metro", "Gender (A2)", "Age group", "DFS any", "Weight", "EA", "Stratum"])
data2 = open(path2, "rb").read()
cells2 = []
for cv, seg, lab in [("province", "province", "Province: "), ("metro", "metro_lab", "Metro: "), ("a2", "gender", "Gender: "), ("age_group", "age_group", "Age group: ")]:
    res = psf.crosstab(data2, "dfs2.sav", {"columnVars": [cv], "weightVar": "wgt", "design": {"psu": "ea", "strata": "strat"},
                                           "rowItems": [{"key": "d", "label": "DFS", "vars": ["dfs_any"]}]})
    row = [r for r in data_rows(res["questions"][0]) if r["label"] == "Uses DFS"][0]
    for i, c in enumerate(res["columns"]):
        r = ref[(ref.segment_var == seg) & (ref.segment_level.str.lower() == (lab + c["name"]).lower())]
        if r.empty or row["se"][i] is None:
            continue
        rp, rse = float(r.prop_pct.iloc[0]), float(r.se_pct.iloc[0])
        cells2.append({"banner": cv, "column": c["name"], "engine_pct": row["pct"][i], "R_pct": round(rp, 2),
                       "R_design_se": round(rse, 3), "engine_taylor_se": row["se"][i], "ratio_engine_over_R": round(row["se"][i] / rse, 3)})
c2 = pd.DataFrame(cells2)
c2.to_csv(os.path.join(OUT, "finscope_verify_taylor_se.csv"), index=False)
dsg_info = res["notes"]["designUsed"]
rr = c2["ratio_engine_over_R"]
say(f"- Design used by the engine: {dsg_info['nPsu']:,} PSUs in {dsg_info['nStrata']} strata ({dsg_info['pooledPsus']} PSUs pooled from single-PSU strata).")
say(f"- Cells compared: {len(c2)}. Engine Taylor SE over R design SE: median {rr.median():.3f}, range {rr.min():.3f} to {rr.max():.3f}.")
say(f"- For comparison, the weights-only (Kish) SE over R design SE had a median of {1 / ratio.median():.3f}, range {1 / ratio.max():.3f} to {1 / ratio.min():.3f}.")
tol = 0.01 if exact else 0.15
check(f"Taylor SE is within {tol:.0%} of R in every cell" + ("" if exact else " (approximate strata)"), bool(((rr > 1 - tol) & (rr < 1 + tol)).all()), str(c2[(rr <= 1 - tol) | (rr >= 1 + tol)].to_dict("records")))
check("engine percentages with a design equal R (domain kept in the design)", bool((c2["engine_pct"] - c2["R_pct"]).abs().max() < 0.06))

# ---------------------------------------------------------------- 4. real questions vs independent calc
say("\n## 4. Engine against independent calculations on real questions")
full = pd.DataFrame({c: raw[c] for c in raw.columns})
full["_w"] = raw[WEIGHT]


def eng(vars_items, col):
    keep = list(dict.fromkeys([col, WEIGHT] + [v for it in vars_items for v in it["vars"]]))
    p = os.path.join(tmp, "q.sav")
    sub_ = raw[keep]
    pyreadstat.write_sav(sub_, p, variable_value_labels={k: v for k, v in labels.items() if k in keep},
                         column_labels=[meta.column_names_to_labels.get(k) or k for k in keep])
    return psf.crosstab(open(p, "rb").read(), "q.sav", {"columnVars": [col], "weightVar": WEIGHT, "rowItems": vars_items})


# single response: F1 by Metro
res = eng([{"key": "f1", "label": "F1", "vars": ["F1"]}], "Metro")
Q = res["questions"][0]
ok = True
for i, c in enumerate(res["columns"]):
    code = {v: k for k, v in labels["Metro"].items()}[c["name"]]
    m = raw["Metro"] == code
    for r in data_rows(Q):
        fc = {v: k for k, v in labels["F1"].items()}[r["label"]]
        exp = raw.loc[m & (raw["F1"] == fc), WEIGHT].sum() / raw.loc[m, WEIGHT].sum() * 100
        if r["pct"][i] is None or abs(r["pct"][i] - exp) > 0.06:
            ok = False
check("single response F1 by Metro equals independent weighted %", ok)
tot = [sum(r["pct"][i] for r in data_rows(Q)) for i in range(len(res["columns"]))]
check("F1 columns sum to 100", all(abs(t_ - 100) < 0.25 for t_ in tot), str(tot))
for b_ in base_rows(Q):
    say(f"      {b_['label']}: " + ", ".join(str(x) for x in b_["count"]))

# average: Age by Province (Age is numeric without labels)
res = eng([{"key": "age", "label": "Age", "vars": ["Age"]}], "Province")
row = data_rows(res["questions"][0])[0]
ok = True
for i, c in enumerate(res["columns"]):
    code = {v: k for k, v in labels["Province"].items()}[c["name"]]
    m = raw["Province"] == code
    exp = (raw.loc[m, "Age"] * raw.loc[m, WEIGHT]).sum() / raw.loc[m, WEIGHT].sum()
    if row["pct"][i] is None or abs(row["pct"][i] - exp) > 0.06:
        ok = False
check("average Age by Province equals independent weighted mean", ok)

# multiple response: the largest dichotomy family in the file
dic = psf.dictionary(open(SAV, "rb").read(), os.path.basename(SAV))
sets = sorted(dic.get("sets", []), key=lambda s: -len(s["vars"]))
sets = [s for s in sets if 3 <= len(s["vars"]) <= 25]
say(f"- Multiple-response sets detected by the dictionary: {len(dic.get('sets', []))}.")
tested = 0
for s in sets[:3]:
    res = eng([{"key": s["key"], "label": s.get("label") or s["key"], "vars": s["vars"], "stem": s.get("stem", "")}], "Province")
    Q = res["questions"][0]
    rows = {r["variable"]: r for r in Q["rows"] if not r.get("isBase")}
    ok, bad_n = True, 0
    for v, r in rows.items():
        for i, c in enumerate(res["columns"]):
            code = {vv: k for k, vv in labels["Province"].items()}[c["name"]]
            vl_ = labels.get(v) or {}
            sel_code = psf._selected_code(raw[v], vl_)
            if sel_code is None:
                continue
            m = (raw["Province"] == code) & raw[v].notna()
            if m.sum() == 0 or r["pct"][i] is None:
                continue
            exp = raw.loc[m & (raw[v] == sel_code), WEIGHT].sum() / raw.loc[m, WEIGHT].sum() * 100
            if abs(r["pct"][i] - exp) > 0.06:
                ok = False
                bad_n += 1
    check(f"multiple response set {s['key']} ({len(s['vars'])} options) matches independent calc, each option on its own base", ok, f"{bad_n} cells differ")
    tested += 1
check("at least one multiple-response set was tested", tested > 0)

# complement z test (independent)
res = eng([{"key": "en31", "label": "EN31", "vars": ["EN31"]}], "Province")
Q = res["questions"][0]
yes = [r for r in data_rows(Q) if r["label"] == "Yes"][0]
ok = True
codes = {v: k for k, v in labels["Province"].items()}
for i, c in enumerate(res["columns"]):
    m = raw["Province"] == codes[c["name"]]
    o = (raw["Province"] != codes[c["name"]]) & raw["Province"].notna()
    v = raw["EN31"].isin([1, 2])

    def st(mask):
        mm = mask & v
        ww = raw.loc[mm, WEIGHT]
        p_ = raw.loc[mm & (raw["EN31"] == 1), WEIGHT].sum() / ww.sum()
        return p_, ww.sum() ** 2 / (ww**2).sum(), int(mm.sum())
    p1, e1, n1 = st(m)
    p2, e2, _ = st(o)
    z = (p1 - p2) / math.sqrt(p1 * (1 - p1) / e1 + p2 * (1 - p2) / e2)
    pv = math.erfc(abs(z) / math.sqrt(2))
    expect = 0 if (pv >= 0.05 or n1 < 30) else (1 if z > 0 else -1)
    if yes["sig"][i] != expect:
        ok = False
check("significance flags equal an independent two-proportion z test against the complement (EN31 by Province)", ok)

say("\n## Summary")
say(f"{len(fails)} check(s) failed." if fails else "All checks passed.")
open(os.path.join(OUT, "finscope_verify_report.md"), "w", encoding="utf-8").write("\n".join(lines))
sys.exit(1 if fails else 0)
