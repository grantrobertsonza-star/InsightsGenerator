"""Independent reference values for the Audience & media page (trackerAudience.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md: O3 `bought12_bYY` past 12
month acquisition, 1 = selected; S1 `age_band` 1 18-24, 2 25-34, 3 35-49, 4 50-69; P1 `media_m01..m12` 1 = selected,
`media_none` outside the set; the chart map's "Buyer demographics: each brand past-12-month acquirers, compare with
eligible category sample; show small bases" and "Media: seven-day media use"; `weight` the analysis weight), not from
the app's code. BMW is code 8 (b08). For each group (category: every respondent; acquirers: bought12_b08 == 1), with
w the weight column (weighted) or 1 (unweighted):
  age:   valid = age_band not blank; share of code c = 100 * sum(w * (age_band == c)) / sum(w) over valid; base = count
  media: valid = media_mXX not blank; share = 100 * sum(w * (media_mXX == 1)) / sum(w) over valid; base = count
and acquirers_n = the count of acquirers.

  python3 audience_reference.py shares <file.sav|file.csv>
      -> JSON {acquirers_n, weighted: {category: {age: {code: [share, base]}, media: {media_mXX: [share, base]}},
               acquirers: {...}}, unweighted: ...}
  python3 audience_reference.py variant <in.csv> <out.csv> <kind>  -> writes a changed copy of the CSV:
      boundary: the first 35 respondents are BMW acquirers (bought12_b08 = 1, everyone else 0: a base of 35, flagged
                as small); two of them have age_band blank (outside the age base only); one of them uses no listed
                media (media_mXX = 0, media_none = 1: in the media base, selecting none)
      none: nobody acquired BMW (bought12_b08 = 0 for all)
      no_audience: age_band and every media_* column removed
"""
import json
import sys

import pandas as pd

MEDIA = [f"media_m{m:02d}" for m in range(1, 13)]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def profile(df, w):
    out = {"age": {}, "media": {}}
    if "age_band" in df.columns:
        valid = df["age_band"].notna()
        for c in sorted({int(x) for x in df.loc[valid, "age_band"]} | {1, 2, 3, 4}):
            out["age"][str(c)] = [float(100 * (w[valid] * (df.loc[valid, "age_band"] == c)).sum() / w[valid].sum()) if valid.any() else None, int(valid.sum())]
    for m in MEDIA:
        if m in df.columns:
            valid = df[m].notna()
            out["media"][m] = [float(100 * (w[valid] * (df.loc[valid, m] == 1)).sum() / w[valid].sum()) if valid.any() else None, int(valid.sum())]
    return out


def shares(path):
    df = read(path)
    acq = df["bought12_b08"] == 1
    out = {"acquirers_n": int(acq.sum())}
    for kind in ("weighted", "unweighted"):
        w = df["weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=df.index)
        out[kind] = {"category": profile(df, w), "acquirers": profile(df[acq], w[acq])}
    print(json.dumps(out))


def variant(src, dst, kind):
    df = pd.read_csv(src)
    if kind == "no_audience":
        df.drop(columns=[c for c in df.columns if c == "age_band" or c.startswith("media_")]).to_csv(dst, index=False)
    elif kind == "none":
        df["bought12_b08"] = 0
        df.to_csv(dst, index=False)
    elif kind == "boundary":
        df["bought12_b08"] = 0
        df.loc[df.index[:35], "bought12_b08"] = 1
        df["age_band"] = df["age_band"].astype("Float64")
        df.loc[df.index[:2], "age_band"] = pd.NA
        for m in MEDIA:
            df.loc[df.index[2], m] = 0
        df.loc[df.index[2], "media_none"] = 1
        df.to_csv(dst, index=False)
    else:
        raise SystemExit(f"unknown variant {kind}")
    print(json.dumps({}))


if __name__ == "__main__":
    if sys.argv[1] == "shares":
        shares(sys.argv[2])
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: shares <file> | variant <in> <out> <kind>")
