"""Independent reference values for the Category overview page (trackerCategory.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md: A3 `aware_bYY`, F1
`consider_bYY`, O3 `bought12_bYY`, 1 = selected, ten tracked brands b01..b10; "Repertoires exclude Other" and the
derived `n_aware`, `n_consider`, `n_bought12` = "Sum of tracked ... indicators; excludes Other"; C1 `decision_style`
1 Preferred brand first, 2 Brief comparison, 3 Extensive comparison; O5 `acquisition_channel` codes 1 to 7, asked when
last_acquired = 1; `weight` the analysis weight), not from the app's code. With w the weight column (weighted) or 1:
  repertoire of a stage S (aware, consider, bought12):
      count_i = sum over YY of (S_bYY == 1) for respondent i; mean = sum(w * count) / sum(w) over every respondent,
      or null when any respondent has a blank for any brand (a partial answer cannot be counted);
      derived = the same weighted mean of the pack's own n_<S> column, when the file has it (a second, independent
      reading the first must equal)
  decision_style and acquisition_channel: valid = not blank; share of code c = 100 * sum(w * (x == c)) / sum(w) over
      valid; base = count of valid

  python3 category_reference.py shares <file.sav|file.csv>
      -> JSON {weighted: {repertoire: {S: [mean, derived]}, decision_style: {code: share}, decision_style_base,
               acquisition_channel: {...}, acquisition_channel_base}, unweighted: ..., respondents}
  python3 category_reference.py variant <in.csv> <out.csv> <kind>  -> writes a changed copy of the CSV:
      boundary: one respondent's consider_b05 blank (the considered repertoire cannot be counted); two respondents'
                decision_style blank (outside its base); the first channel answer set to 7, Other (kept as an answer)
      no_category: decision_style and acquisition_channel removed
"""
import json
import sys

import pandas as pd

BRANDS = [f"b{b:02d}" for b in range(1, 11)]
STAGES = ["aware", "consider", "bought12"]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def shares(path):
    df = read(path)
    out = {"respondents": int(len(df))}
    for kind in ("weighted", "unweighted"):
        w = df["weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=df.index)
        res = {"repertoire": {}}
        for s in STAGES:
            cols = df[[f"{s}_{b}" for b in BRANDS]]
            mean = None if cols.isna().any().any() else float((w * (cols == 1).sum(axis=1)).sum() / w.sum())
            derived = float((w * df[f"n_{s}"]).sum() / w.sum()) if f"n_{s}" in df.columns and df[f"n_{s}"].notna().all() else None
            res["repertoire"][s] = [mean, derived]
        for q in ("decision_style", "acquisition_channel"):
            if q not in df.columns:
                continue
            valid = df[q].notna()
            res[q] = {str(int(c)): float(100 * (w[valid] * (df.loc[valid, q] == c)).sum() / w[valid].sum()) for c in sorted(df.loc[valid, q].unique())}
            res[f"{q}_base"] = int(valid.sum())
        out[kind] = res
    print(json.dumps(out))


def variant(src, dst, kind):
    df = pd.read_csv(src)
    if kind == "no_category":
        df.drop(columns=["decision_style", "acquisition_channel"]).to_csv(dst, index=False)
    elif kind == "boundary":
        df["consider_b05"] = df["consider_b05"].astype("Float64")
        df.loc[df.index[0], "consider_b05"] = pd.NA
        df["decision_style"] = df["decision_style"].astype("Float64")
        df.loc[df.index[1:3], "decision_style"] = pd.NA
        answered = df.index[df["acquisition_channel"].notna()]
        if len(answered) < 1:
            raise SystemExit("the file has no channel answer")
        df.loc[answered[0], "acquisition_channel"] = 7
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
