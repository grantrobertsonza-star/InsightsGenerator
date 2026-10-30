"""Independent reference values for the CSM dashboard's segment (R5 CSM segment, trackerCsmSegment.db.test.ts).

Written from the banking CSM pack's questionnaire (fixtures/csm, answer lists in the SPSS files) and the segment
contract (claude/d2-design-2026-10-29.md, "R5 Segment" and "R5 CSM segment"), not from the app's code. A segment is a
dict {variable: [codes]}: a respondent is in it when, for every variable, their answer is one of its codes (a blank
answer is no code, so outside). Within the segment, with w the weight column (weighted) or 1 (unweighted), and only
respondents with a usable weight (finite and above 0):
  base:        n = count; weighted = sum(w); effective = sum(w)^2 / sum(w^2) (Kish)
  a rating:    valid = an answer that is not blank and not a non-answer of its list ("Do not know", "Not applicable");
               share of code c = 100 * sum(w * (value == c)) / sum(w) over valid; mean = sum(c * share) / 100;
               raw = count valid, weighted = sum(w), effective = Kish over valid
  boxes:       satisfaction (company_csat5) and stay (continue5): codes 4 and 5; switch (switch_0to10): 8, 9, 10
  NPS:         recommend_0to10 valid 0 to 10: promoters 9-10, passives 7-8, detractors 0-6 (shares as above);
               score = promoters - detractors
  attributes:  company_driver_d01 .. d06 means as a rating
  drivers:     outcome company_csat5, predictors company_driver_d01 .. d06, non-answers missing, complete cases only;
               weighted least squares with an intercept (coefficients; R^2 = 1 - SSE_w / SST_w about the weighted mean);
               importance = Shapley value of R^2 over every order the predictors can enter (720 orders, each subset's
               R^2 from its own weighted least squares fit), negatives set to 0, shares = value / sum

  python3 csm_segment_reference.py figures <file.sav> '<segment json>'
      -> JSON {weighted: {...}, unweighted: {...}}
  python3 csm_segment_reference.py variant <in.sav> <out.sav> <kind>   (writes a changed copy)
      profile:        the pack's wave with two profile questions added, gender (1 Man, 2 Woman, 3 Another identity;
                      a seeded draw, with 12 respondents left blank) and age_band (1 18-24, 2 25-34, 3 35-49, 4 50+)
      no_age:         the profile copy without age_band (a wave lacking a segment question)
      weight_x25:     every weight multiplied by 2.5
"""
import itertools
import json
import sys

import numpy as np
import pandas as pd
import pyreadstat

NON_ANSWER = ("do not know", "don't know", "not applicable", "refused")
DRIVERS = [f"company_driver_d{j:02d}" for j in range(1, 7)]


def read(path):
    return pyreadstat.read_sav(path)


def code_text(v):
    f = float(v)
    return str(int(f)) if f.is_integer() else str(f)


def segment_mask(df, seg):
    m = np.ones(len(df), dtype=bool)
    for var, codes in seg.items():
        col = df[var]
        m &= np.array([pd.notna(x) and code_text(x) in set(codes) for x in col], dtype=bool)
    return m


def kish(w):
    return float(w.sum() ** 2 / (w ** 2).sum()) if len(w) else None


def valid_codes(meta, var):
    labels = meta.variable_value_labels.get(var) or {}
    return {float(k) for k, v in labels.items() if str(v).strip().lower() not in NON_ANSWER}, sorted(float(k) for k, v in labels.items() if str(v).strip().lower() not in NON_ANSWER)


def rating(df, meta, var, w):
    ok, order = valid_codes(meta, var)
    x = df[var].to_numpy(dtype=float)
    v = np.isin(x, list(ok))
    xv, wv = x[v], w[v]
    sw = wv.sum()
    shares = {code_text(c): float(100 * wv[xv == c].sum() / sw) for c in order}
    return {
        "shares": shares,
        "mean": float((xv * wv).sum() / sw),
        "raw": int(v.sum()),
        "weighted": float(sw),
        "effective": kish(wv),
    }


def box(r, codes):
    return sum(r["shares"].get(str(c), 0.0) for c in codes)


def wls(X, y, w):
    A = np.column_stack([np.ones(len(y)), X])
    sw = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(A * sw[:, None], y * sw, rcond=None)
    pred = A @ beta
    ybar = (w * y).sum() / w.sum()
    sse = (w * (y - pred) ** 2).sum()
    sst = (w * (y - ybar) ** 2).sum()
    return beta, 1 - sse / sst


def drivers(df, meta, w):
    def numeric(var):
        ok, _ = valid_codes(meta, var)
        x = df[var].to_numpy(dtype=float)
        return np.where(np.isin(x, list(ok)), x, np.nan)

    y = numeric("company_csat5")
    X = np.column_stack([numeric(v) for v in DRIVERS])
    keep = np.isfinite(y) & np.isfinite(X).all(axis=1) & np.isfinite(w) & (w > 0)
    y, X, wk = y[keep], X[keep], w[keep]
    beta, r2 = wls(X, y, wk)
    p = X.shape[1]
    sub = {(): 0.0}
    for k in range(1, p + 1):
        for s in itertools.combinations(range(p), k):
            sub[s] = wls(X[:, list(s)], y, wk)[1]
    value = np.zeros(p)
    orders = list(itertools.permutations(range(p)))
    for order in orders:
        seen = []
        for j in order:
            before = sub[tuple(sorted(seen))]
            seen.append(j)
            value[j] += sub[tuple(sorted(seen))] - before
    value /= len(orders)
    value = np.maximum(value, 0)
    shares = value / value.sum()
    return {
        "n": int(keep.sum()),
        "rSquared": float(r2),
        "coefficients": {v: float(b) for v, b in zip(DRIVERS, beta[1:])},
        "shares": {v: float(s) for v, s in zip(DRIVERS, shares)},
    }


def figures(path, seg):
    df, meta = read(path)
    m = segment_mask(df, seg)
    out = {}
    for side in ("weighted", "unweighted"):
        w_all = df["weight"].to_numpy(dtype=float) if side == "weighted" else np.ones(len(df))
        usable = np.isfinite(w_all) & (w_all > 0)
        d = df[m & usable].reset_index(drop=True)
        w = w_all[m & usable]
        sat = rating(d, meta, "company_csat5", w)
        stay = rating(d, meta, "continue5", w)
        sw_ = rating(d, meta, "switch_0to10", w)
        rec = rating(d, meta, "recommend_0to10", w)
        pro = box(rec, [9, 10])
        pas = box(rec, [7, 8])
        det = box(rec, range(0, 7))
        out[side] = {
            "base": {"n": int(len(d)), "weighted": float(w.sum()), "effective": kish(w)},
            "satisfaction": {**sat, "box": box(sat, [4, 5])},
            "stay": {**stay, "box": box(stay, [4, 5])},
            "switch": {**sw_, "box": box(sw_, [8, 9, 10])},
            "nps": {"promoters": pro, "passives": pas, "detractors": det, "score": pro - det, "raw": rec["raw"], "weighted": rec["weighted"], "effective": rec["effective"]},
            "attributes": {v: rating(d, meta, v, w) for v in DRIVERS},
            "drivers": drivers(d, meta, w) if len(d) >= 20 else None,
        }
    return out


def write(df, meta, out):
    pyreadstat.write_sav(
        df,
        out,
        column_labels={c: meta.column_names_to_labels.get(c) or c for c in df.columns},
        variable_value_labels={c: v for c, v in meta.variable_value_labels.items() if c in df.columns},
    )


def variant(src, out, kind):
    df, meta = read(src)
    if kind in ("profile", "no_age"):
        rng = np.random.default_rng(20261030)
        gender = rng.choice([1.0, 2.0, 3.0], size=len(df), p=[0.485, 0.485, 0.03])
        gender[:12] = np.nan
        age = rng.choice([1.0, 2.0, 3.0, 4.0], size=len(df), p=[0.2, 0.3, 0.3, 0.2])
        df["gender"] = gender
        meta.column_names_to_labels["gender"] = "Gender"
        meta.variable_value_labels["gender"] = {1.0: "Man", 2.0: "Woman", 3.0: "Another identity"}
        if kind == "profile":
            df["age_band"] = age
            meta.column_names_to_labels["age_band"] = "Age group"
            meta.variable_value_labels["age_band"] = {1.0: "18-24", 2.0: "25-34", 3.0: "35-49", 4.0: "50+"}
    elif kind == "weight_x25":
        df["weight"] = df["weight"] * 2.5
    else:
        raise SystemExit(f"unknown variant {kind}")
    write(df, meta, out)


if __name__ == "__main__":
    if sys.argv[1] == "figures":
        print(json.dumps(figures(sys.argv[2], json.loads(sys.argv[3]))))
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
