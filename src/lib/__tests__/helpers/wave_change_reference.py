"""Independent reference values for wave-on-wave change and its significance (trackerWaveChange.db.test.ts, R5 waves).

Written from the figure contracts in claude/d2-design-2026-10-29.md and the test in claude/wave-change.md, with
pandas, numpy and scipy, not from the app's code. Weighted by the file's `weight` column. For every file:
  share(var, code, among)   = 100 * sum(w * (var == code)) / sum(w) over respondents in `among` with a value in var
  n                         = the count of those respondents
  nEff                      = Kish: sum(w)^2 / sum(w^2) over the same respondents
Figures, keyed as the test reads them:
  stage:<aware|consider>:<bYY>     aware_bYY / consider_bYY == 1 among all respondents
  assoc:<aXX>:b08                  attr_aXX_b08 == 1 among respondents with aware_b08 == 1
  moment:<cXX>                     relevant_cXX == 1 among all respondents
  recall:<bYY>                     adprompt_bYY == 1 among those answering it (0, 1 and 9 "not sure" in the base)
  age:<code>                       age_band == code among all respondents
  decision:<code>                  decision_style == code among all respondents
For every pair of files (later, earlier): change = later - earlier in points, and the two-sample test the contract
states: z = (p2 - p1) / sqrt(p0 (1 - p0) (1/nEff1 + 1/nEff2)), p0 = (p1 nEff1 + p2 nEff2) / (nEff1 + nEff2),
p = 2 * (1 - Phi(|z|)) from scipy.stats.norm; not tested when either n < 30 or nEff < 30.

  python3 wave_change_reference.py <w1.sav> <w2.sav> [<w3.sav> ...]
      -> JSON {figures: [{key: [share, n, nEff]}, ...one per file], pairs: {"j-i": {key: [change, z, p]}}}
"""
import json
import sys

import numpy as np
import pandas as pd
import pyreadstat
from scipy.stats import norm

BRANDS = [f"b{b:02d}" for b in range(1, 11)]


def share(df, var, code, among=None):
    if var not in df.columns:
        return None
    sub = df if among is None else df[among]
    sub = sub[sub[var].notna()]
    if len(sub) == 0:
        return None
    w = sub["weight"].to_numpy(dtype=float)
    hit = (sub[var] == code).to_numpy()
    return [100.0 * float((w * hit).sum() / w.sum()), int(len(sub)), float(w.sum() ** 2 / (w ** 2).sum())]


def figures(path):
    df, _ = pyreadstat.read_sav(path)
    out = {}
    for b in BRANDS:
        out[f"stage:aware:{b}"] = share(df, f"aware_{b}", 1)
        out[f"stage:consider:{b}"] = share(df, f"consider_{b}", 1)
        out[f"recall:{b}"] = share(df, f"adprompt_{b}", 1)
    aware8 = df["aware_b08"] == 1
    for a in range(1, 11):
        out[f"assoc:a{a:02d}:b08"] = share(df, f"attr_a{a:02d}_b08", 1, aware8)
    for c in range(1, 13):
        out[f"moment:c{c:02d}"] = share(df, f"relevant_c{c:02d}", 1)
    for code in sorted(df["age_band"].dropna().unique()):
        out[f"age:{int(code)}"] = share(df, "age_band", code)
    for code in sorted(df["decision_style"].dropna().unique()):
        out[f"decision:{int(code)}"] = share(df, "decision_style", code)
    return {k: v for k, v in out.items() if v is not None}


def test(a, b):
    (p1, n1, e1), (p2, n2, e2) = a, b
    change = p2 - p1
    if min(n1, n2) < 30 or min(e1, e2) < 30:
        return [change, None, None]
    q1, q2 = p1 / 100.0, p2 / 100.0
    p0 = (q1 * e1 + q2 * e2) / (e1 + e2)
    se = np.sqrt(p0 * (1 - p0) * (1 / e1 + 1 / e2))
    if se == 0:
        return [change, None, None]
    z = (q2 - q1) / se
    return [change, float(z), float(2 * norm.sf(abs(z)))]


def main(paths):
    figs = [figures(p) for p in paths]
    pairs = {}
    for j in range(len(figs)):
        for i in range(j):
            pairs[f"{j}-{i}"] = {k: test(figs[i][k], figs[j][k]) for k in figs[j] if k in figs[i]}
    print(json.dumps({"figures": figs, "pairs": pairs}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
