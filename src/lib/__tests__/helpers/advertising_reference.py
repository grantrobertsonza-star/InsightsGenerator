"""Independent reference values for the Advertising & WOM page (trackerAdvertising.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md: AD2 `adprompt_bYY` 0 No,
1 Yes, 9 Not sure (substantive, reported separately), asked of those aware of the brand; W1 `wom_bYY` 1 positive,
2 negative, 3 mixed, 4 neutral, 5 not heard, "unaware is a sixth reported state derived from blank"; the Word of
mouth reference row: "Six states, sum to 100", all eligible; `weight` the analysis weight), not from the app's code.
For each brand YY, with w the weight column (weighted) or 1 (unweighted):
  recall:  valid = adprompt_bYY not blank; yes = 100 * sum(w * (adprompt == 1)) / sum(w) over valid;
           not_sure = 100 * sum(w * (adprompt == 9)) / sum(w) over valid; base = count of valid
  wom:     all eligible = every respondent; for each code c in 1..5: 100 * sum(w * (wom == c)) / sum(w);
           unaware = 100 * sum(w * wom blank) / sum(w); base = count of respondents;
           exclusive = (no respondent with aware_bYY == 1 and wom blank) and (none with aware_bYY == 0 and a wom answer)

  python3 advertising_reference.py shares <file.sav|file.csv>
      -> JSON {weighted: {recall: {bYY: [yes, not_sure, base]}, wom: {bYY: {"1": share, ..., "unaware": share,
               "base": n, "exclusive": bool}}}, unweighted: ...}
  python3 advertising_reference.py variant <in.csv> <out.csv> <kind>  -> writes a changed copy of the CSV:
      boundary: the first three respondents aware of BMW who answered No to BMW's recall answer Not sure (9: in the
                base, not yes); the next two aware of BMW have their BMW recall answer blank (outside the base); the
                first respondent unaware of Ford is given a Ford word of mouth answer (1), so Ford's groups are not
                exclusive
      no_advertising: every wom_*, adprompt_* and adrecall_* column removed
"""
import json
import sys

import pandas as pd

BRANDS = [f"b{b:02d}" for b in range(1, 11)]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def shares(path):
    df = read(path)
    out = {}
    for kind in ("weighted", "unweighted"):
        w_all = df["weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=df.index)
        recall, wom = {}, {}
        for b in BRANDS:
            a = df[f"adprompt_{b}"] if f"adprompt_{b}" in df.columns else None
            if a is not None:
                valid = a.notna()
                w = w_all[valid]
                recall[b] = [float(100 * (w * (a[valid] == 1)).sum() / w.sum()), float(100 * (w * (a[valid] == 9)).sum() / w.sum()), int(valid.sum())]
            if f"wom_{b}" in df.columns:
                x = df[f"wom_{b}"]
                total = w_all.sum()
                g = {str(c): float(100 * (w_all * (x == c)).sum() / total) for c in range(1, 6)}
                g["unaware"] = float(100 * (w_all * x.isna()).sum() / total)
                g["base"] = int(len(df))
                aware = df[f"aware_{b}"]
                g["exclusive"] = bool(not ((aware == 1) & x.isna()).any() and not ((aware == 0) & x.notna()).any())
                wom[b] = g
        out[kind] = {"recall": recall, "wom": wom}
    print(json.dumps(out))


def variant(src, dst, kind):
    df = pd.read_csv(src)
    if kind == "no_advertising":
        df.drop(columns=[c for c in df.columns if c.startswith(("wom_", "adprompt_", "adrecall_"))]).to_csv(dst, index=False)
        print(json.dumps({}))
        return
    if kind != "boundary":
        raise SystemExit(f"unknown variant {kind}")
    df["adprompt_b08"] = df["adprompt_b08"].astype("Float64")
    df["wom_b03"] = df["wom_b03"].astype("Float64")
    no = df.index[(df["aware_b08"] == 1) & (df["adprompt_b08"] == 0)]
    if len(no) < 5:
        raise SystemExit("the file has too few BMW-aware respondents answering No for this variant")
    df.loc[no[:3], "adprompt_b08"] = 9
    df.loc[no[3:5], "adprompt_b08"] = pd.NA
    unaware_ford = df.index[df["aware_b03"] == 0][:1]
    if len(unaware_ford) < 1:
        raise SystemExit("the file has no respondent unaware of Ford")
    df.loc[unaware_ford, "wom_b03"] = 1
    df.to_csv(dst, index=False)
    print(json.dumps({"not_sure": [int(i) for i in no[:3]], "blank": [int(i) for i in no[3:5]], "unaware_ford_with_wom": [int(i) for i in unaware_ford]}))


if __name__ == "__main__":
    if sys.argv[1] == "shares":
        shares(sys.argv[2])
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: shares <file> | variant <in> <out> <kind>")
