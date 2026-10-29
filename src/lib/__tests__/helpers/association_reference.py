"""Independent reference values for the Brand associations page (trackerAssociations.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md, I1 and the Associations
row of section 4: 100 x sum(w x attr_aXX_bYY) / sum(w x aware_bYY), aware of the brand as the base, "don't know"
kept in the base; code 1 = selected; `weight` the analysis weight), not from the app's code. For each brand YY and
attribute XX in the data file:
  aware    = respondents with aware_bYY == 1
  valid    = aware respondents with a value in attr_aXX_bYY (a blank is missing and leaves the base)
  share    = 100 * sum(w * (attr_aXX_bYY == 1)) / sum(w) over valid
  base     = the count of valid respondents
and, per brand, aware_n = the count of aware respondents; with w the weight column (weighted) or 1 (unweighted).

  python3 association_reference.py shares <file.sav|file.csv>
      -> JSON {weighted: {attr_aXX_bYY: [share, base]}, unweighted: ..., aware_n: {bYY: n}}
  python3 association_reference.py variant <in.csv> <out.csv> <kind>  -> writes a changed copy of the CSV:
      boundary: the first four respondents unaware of BMW (aware_b08 = 0) are given attr_aXX_b08 = 1 for every
                attribute (answers outside the aware base, which must not count); the first three aware of BMW answer
                don't know for Reliable (attr_dk_a01 = 1, and attr_a01_bYY = 0 for every brand they are aware of:
                they stay in the base); the next two aware of BMW leave attr_a02_b08 blank (they leave that cell's
                base only)
      no_associations: every attr_* column removed
"""
import json
import sys

import pandas as pd

BRANDS = [f"b{b:02d}" for b in range(1, 11)]
ATTRS = [f"a{a:02d}" for a in range(1, 11)]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def shares(path):
    df = read(path)
    out = {"weighted": {}, "unweighted": {}, "aware_n": {}}
    for b in BRANDS:
        aware = df[f"aware_{b}"] == 1
        out["aware_n"][b] = int(aware.sum())
        for a in ATTRS:
            name = f"attr_{a}_{b}"
            if name not in df.columns:
                continue
            valid = aware & df[name].notna()
            x = (df.loc[valid, name] == 1).astype(float)
            for kind, w in (("weighted", df.loc[valid, "weight"].astype(float)), ("unweighted", pd.Series(1.0, index=x.index))):
                out[kind][name] = [float(100.0 * (w * x).sum() / w.sum()) if w.sum() > 0 else None, int(valid.sum())]
    print(json.dumps(out))


def variant(src, dst, kind):
    df = pd.read_csv(src)
    if kind == "no_associations":
        df.drop(columns=[c for c in df.columns if c.startswith("attr_")]).to_csv(dst, index=False)
        print(json.dumps({}))
        return
    if kind != "boundary":
        raise SystemExit(f"unknown variant {kind}")
    for a in ATTRS:
        df[f"attr_{a}_b08"] = df[f"attr_{a}_b08"].astype("Float64")
    unaware = df.index[df["aware_b08"] == 0][:4]
    aware = df.index[df["aware_b08"] == 1]
    if len(unaware) < 4 or len(aware) < 5:
        raise SystemExit("the file has too few aware or unaware respondents for this variant")
    for a in ATTRS:
        df.loc[unaware, f"attr_{a}_b08"] = 1
    dk = aware[:3]
    df.loc[dk, "attr_dk_a01"] = 1
    for b in BRANDS:
        col = f"attr_a01_{b}"
        df[col] = df[col].astype("Float64")
        df.loc[[i for i in dk if df.at[i, f"aware_{b}"] == 1], col] = 0
    df.loc[aware[3:5], "attr_a02_b08"] = pd.NA
    df.to_csv(dst, index=False)
    print(json.dumps({"unaware_given_answers": [int(i) for i in unaware], "dont_know": [int(i) for i in dk], "blank": [int(i) for i in aware[3:5]]}))


if __name__ == "__main__":
    if sys.argv[1] == "shares":
        shares(sys.argv[2])
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: shares <file> | variant <in> <out> <kind>")
