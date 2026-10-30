"""Independent reference values for the Moments & needs page (trackerMoments.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md: relevant_c01..c12 is the
category moments set, cep_cXX_bYY the brand recall links, code 1 = selected, weight the analysis weight), not from
the app's code. For each of those variables in the data file:
  share    = 100 * sum(w * (x == 1)) / sum(w) over respondents with a value (a blank is missing and leaves the base)
  base     = the count of respondents with a value
with w the weight column (weighted) or 1 (unweighted).

  python3 moment_reference.py shares <file.sav|file.csv>      -> JSON {weighted: {var: [share, base]}, unweighted: ...}
  python3 moment_reference.py variant <in.csv> <out.csv> <kind> -> writes a changed copy of the CSV:
      none_and_blank: rows 1-5 select no moment (relevant_c01..c12 = 0, relevant_none = 1); rows 6-8 leave
                      relevant_c02 blank
      no_relevance:   every relevant_* column removed
"""
import json
import sys

import pandas as pd

MOMENTS = [f"relevant_c{i:02d}" for i in range(1, 13)]
LINKS = [f"cep_c{c:02d}_b{b:02d}" for c in range(1, 13) for b in range(1, 11)]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def shares(path):
    df = read(path)
    out = {"weighted": {}, "unweighted": {}}
    for name in MOMENTS + LINKS:
        if name not in df.columns:
            continue
        valid = df[name].notna()
        x = (df.loc[valid, name] == 1).astype(float)
        for kind, w in (("weighted", df.loc[valid, "weight"].astype(float)), ("unweighted", pd.Series(1.0, index=x.index))):
            out[kind][name] = [float(100.0 * (w * x).sum() / w.sum()), int(valid.sum())]
    print(json.dumps(out))


def variant(src, dst, kind):
    df = pd.read_csv(src)
    if kind == "none_and_blank":
        df.loc[0:4, MOMENTS] = 0
        df.loc[0:4, "relevant_none"] = 1
        df["relevant_c02"] = df["relevant_c02"].astype("Float64")
        df.loc[5:7, "relevant_c02"] = pd.NA
    elif kind == "no_relevance":
        df = df.drop(columns=[c for c in df.columns if c.startswith("relevant_")])
    else:
        raise SystemExit(f"unknown variant {kind}")
    df.to_csv(dst, index=False)


if __name__ == "__main__":
    if sys.argv[1] == "shares":
        shares(sys.argv[2])
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: shares <file> | variant <in> <out> <kind>")
