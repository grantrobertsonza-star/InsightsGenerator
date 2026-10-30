"""Independent reference values for the Audience and Media pages' R5 additions (trackerAudienceProfiles.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md: D1 `gender`, D2 `province`,
D4 `income` single choice, codes as listed; O3 `bought12_bYY` past 12 month acquisition, 1 = selected; P1
`media_m01..m12`, 1 = selected; `weight` the analysis weight) and from the method statements in
claude/d2-design-2026-10-29.md, D3f, not from the app's code. With w the weight (weighted) or 1 (unweighted):

  profile share of code c among group G = 100 * sum(w * (x == c)) / sum(w) over G's members with x not blank; base =
      the count of those members. Every code on the variable's label list or given is reported, in code order.
  media share of m among group G = 100 * sum(w * (m == 1)) / sum(w) over G's members with m not blank; base = count.
  index = focal share / comparison share * 100.
  test (the usual two-proportion z-test, shares pooled under the null, on Kish effective bases neff = (sum w)^2 /
      sum w^2): z = (p1 - p2) / sqrt(p0 (1 - p0) (1/n1 + 1/n2)), p0 = (p1 n1 + p2 n2) / (n1 + n2); two-sided
      p = erfc(|z| / sqrt(2)); "higher" / "lower" when p < 0.05, else "no_difference". Against all eligible the
      focal group is compared with the eligible respondents not in it (bought12_bYY answered and not 1); against
      another brand the two acquirer groups are compared as two groups.

  python3 profile_reference.py profiles <file.sav> <focal_var> <var>...   -> JSON {acquirers_n, weighted: {category:
      {var: {code: [share, base]}}, acquirers: ...}, unweighted: ...}
  python3 profile_reference.py media <file.sav> <focal_var> [<comparison_var>] -> JSON {focal_n, comparison_n,
      weighted: {m: {focal: [share, base], comparison: [share, base], index, z, p, decision}}, unweighted: ...}
  python3 profile_reference.py variant <in.sav> <out.sav> <kind>   -> writes a changed copy (labels kept):
      reworded: gender asked as "Sex of respondent" (1 Male, 2 Female, 3 Other, 4 Refused) and income as "Total
                household earnings per month" (bands written "R0 - R14 999" ... "R80 000+", 99 Refused)
      no_income: the income column removed
      no_province: the province column removed
      large: BMW acquirers (bought12_b08) are the first 300 respondents using Instagram (media_m03) and the first 60
             not using it; Toyota acquirers (bought12_b01) respondents 400 to 599 (both groups of 50 or more, so the
             Media page tests them)
  python3 profile_reference.py codebook <in.json> <out.json>  -> the pack's metadata.json with gender and income
      reworded as in "reworded" (the CSV-codebook form)
"""
import json
import math
import sys

import pandas as pd
import pyreadstat

REWORDED = {
    "gender": ("Sex of respondent", {1: "Male", 2: "Female", 3: "Other", 4: "Refused"}),
    "income": ("Total household earnings per month", {1: "R0 - R14 999", 2: "R15 000 to R29 999", 3: "R30 000 to R49 999", 4: "R50 000 to R79 999", 5: "R80 000+", 99: "Refused"}),
}
MEDIA = [f"media_m{m:02d}" for m in range(1, 13)]


def read(path):
    df, meta = pyreadstat.read_sav(path)
    return df, meta


def weights(df, kind):
    return df["weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=df.index)


def profile(df, w, var, codes):
    valid = df[var].notna()
    out = {}
    for c in codes:
        share = float(100 * (w[valid] * (df.loc[valid, var] == c)).sum() / w[valid].sum()) if valid.any() else None
        out[str(int(c))] = [share, int(valid.sum())]
    return out


def profiles(path, focal, variables):
    df, meta = read(path)
    acq = df[focal] == 1
    out = {"acquirers_n": int(acq.sum())}
    for kind in ("weighted", "unweighted"):
        w = weights(df, kind)
        out[kind] = {"category": {}, "acquirers": {}}
        for var in variables:
            codes = sorted({float(k) for k in (meta.variable_value_labels.get(var) or {})} | {float(x) for x in df[var].dropna()})
            out[kind]["category"][var] = profile(df, w, var, codes)
            out[kind]["acquirers"][var] = profile(df[acq], w[acq], var, codes)
    print(json.dumps(out))


def share_of(df, w, m):
    valid = df[m].notna()
    sw = w[valid]
    return (float((sw * (df.loc[valid, m] == 1)).sum() / sw.sum()) if valid.any() else None, int(valid.sum()), float(sw.sum() ** 2 / (sw ** 2).sum()) if valid.any() else 0.0)


def z_test(p1, n1, p2, n2):
    p0 = (p1 * n1 + p2 * n2) / (n1 + n2)
    se = math.sqrt(p0 * (1 - p0) * (1 / n1 + 1 / n2))
    if se == 0:
        return None, None
    z = (p1 - p2) / se
    return z, math.erfc(abs(z) / math.sqrt(2))


def media(path, focal, comparison):
    df, _ = read(path)
    f = df[focal] == 1
    c = (df[comparison] == 1) if comparison else pd.Series(True, index=df.index)
    # The test's other group: the other brand's acquirers, or the eligible respondents who are not focal acquirers.
    rest = (df[comparison] == 1) if comparison else (df[focal].notna() & (df[focal] != 1))
    out = {"focal_n": int(f.sum()), "comparison_n": int(c.sum())}
    for kind in ("weighted", "unweighted"):
        w = weights(df, kind)
        out[kind] = {}
        for m in MEDIA:
            pf, nf, ef = share_of(df[f], w[f], m)
            pc, nc, _ = share_of(df[c], w[c], m)
            pr, _, er = share_of(df[rest], w[rest], m)
            z, p = z_test(pf, ef, pr, er)
            decision = "untested" if p is None else ("higher" if z > 0 else "lower") if p < 0.05 else "no_difference"
            out[kind][m] = {"focal": [100 * pf, nf], "comparison": [100 * pc, nc], "index": 100 * pf / pc if pc else None, "z": z, "p": p, "decision": decision}
    print(json.dumps(out))


def write(df, meta, out, labels=None, value_labels=None):
    labels = dict(zip(meta.column_names, meta.column_labels)) if labels is None else labels
    value_labels = dict(meta.variable_value_labels) if value_labels is None else value_labels
    cols = list(df.columns)
    pyreadstat.write_sav(df, out, column_labels=[labels.get(c) or c for c in cols], variable_value_labels={k: v for k, v in value_labels.items() if k in cols})


def variant(src, dst, kind):
    df, meta = read(src)
    labels = dict(zip(meta.column_names, meta.column_labels))
    value_labels = dict(meta.variable_value_labels)
    if kind == "reworded":
        for var, (wording, answers) in REWORDED.items():
            labels[var] = wording
            value_labels[var] = {float(k): v for k, v in answers.items()}
    elif kind == "no_income":
        df = df.drop(columns=["income"])
    elif kind == "no_province":
        df = df.drop(columns=["province"])
    elif kind == "large":
        insta = df["media_m03"] == 1
        df["bought12_b08"] = 0.0
        df.loc[df.index[insta.to_numpy()][:300], "bought12_b08"] = 1.0
        df.loc[df.index[(~insta).to_numpy()][:60], "bought12_b08"] = 1.0
        df["bought12_b01"] = 0.0
        df.loc[df.index[400:600], "bought12_b01"] = 1.0
    else:
        raise SystemExit(f"unknown variant {kind}")
    write(df, meta, dst, labels, value_labels)
    print(json.dumps({}))


def codebook(src, dst):
    with open(src, encoding="utf8") as fh:
        cb = json.load(fh)
    for v in cb["variables"]:
        if v["variable"] in REWORDED:
            v["label"] = REWORDED[v["variable"]][0]
    cb["labels"] = [l for l in cb["labels"] if l[0] not in REWORDED] + [[var, wording, code, text] for var, (wording, answers) in REWORDED.items() for code, text in answers.items()]
    with open(dst, "w", encoding="utf8") as fh:
        json.dump(cb, fh)
    print(json.dumps({}))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "profiles":
        profiles(sys.argv[2], sys.argv[3], sys.argv[4:])
    elif cmd == "media":
        media(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    elif cmd == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "codebook":
        codebook(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("usage: profiles | media | variant | codebook")
