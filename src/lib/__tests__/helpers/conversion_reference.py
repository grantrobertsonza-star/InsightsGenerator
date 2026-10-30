"""Independent reference values for the brand dashboard's Conversion view (trackerConversion.db.test.ts).

Written from the contract (claude/d2-design-2026-10-29.md, D3h) and the BMW pack's coding (stage_bYY: 1 selected,
0 not selected; `weight` the analysis weight), not from the app's code. The stages present in the file, in funnel
order (aware, consider, shortlist, firstchoice); each step is a stage to the next stage present. For brand YY and a
step S to T:
  at_S       = respondents with S_bYY == 1 (any other value, a don't know code or a blank is not at S)
  known_T    = at_S respondents with T_bYY in {0, 1}
  conversion = 100 * sum(w * (T_bYY == 1)) / sum(w) over known_T
  base       = count of known_T; converted = count of known_T with T_bYY == 1
  unknown    = count of at_S with a T_bYY value other than 0 or 1 (don't know, unlabelled codes)
  no_answer  = count of at_S with T_bYY blank
  non_nested = count of respondents with T_bYY == 1 and S_bYY != 1 (blank included)
  share_ratio = 100 * share(T) / share(S), each share the weighted percentage with code 1 among all respondents
                with a 0 or 1 answer (the ratio a dashboard must NOT report as conversion)
with w the weight column (weighted) or 1 (unweighted). No suppression is applied here; the test applies the
engine's minimum base itself.

  python3 conversion_reference.py conversions <file.sav>
      -> JSON {weighted: {"S>T": {bYY: {...}}}, unweighted: ..., steps: ["S>T", ...]}
  python3 conversion_reference.py variant <in.sav> <out> <kind> [metadata.json]  -> writes a changed copy:
      no_consideration, rescaled: <out> as SPSS with the file's labels kept
      boundary:
        non-nested: the first 40 respondents not aware of brand 10 are given consider_b10 = 1
        written as CSV (<out>.csv) with the pack's metadata.json as its codebook (<out>.metadata.json), so the
        stage questions are grouped by the codebook's question and set, whatever answers the data holds:
        unknown at T: the first 30 respondents aware of BMW (b08) answer consider_b08 = 9, which the codebook labels
          Don't know; the next 5 answer consider_b08 = 7, a code no list labels
        unknown at S: the next 20 aware of BMW answer aware_b08 = 9, labelled Don't know (no longer at S)
        small base: all but the first 8 respondents shortlisting brand 9 are set to shortlist_b09 = 0 and
          firstchoice_b09 = 0 (8 at shortlist, kept nested)
        blank at T: the first 6 respondents shortlisting brand 7 have firstchoice_b07 blank
      no_consideration: every consider_* column removed
      rescaled: the weight multiplied by 3.7
"""
import json
import sys

import numpy as np
import pandas as pd
import pyreadstat

BRANDS = [f"b{b:02d}" for b in range(1, 11)]
CHAIN = ["aware", "consider", "shortlist", "firstchoice"]


def read(path):
    if path.endswith(".sav"):
        return pyreadstat.read_sav(path)[0]
    return pd.read_csv(path)


def conversions(path):
    df = read(path)
    present = [s for s in CHAIN if f"{s}_b01" in df.columns]
    steps = list(zip(present, present[1:]))
    out = {"weighted": {}, "unweighted": {}, "steps": [f"{s}>{t}" for s, t in steps]}
    for kind in ("weighted", "unweighted"):
        w_all = df["weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=df.index)
        for s, t in steps:
            k = f"{s}>{t}"
            out[kind][k] = {}
            for b in BRANDS:
                S, T = df[f"{s}_{b}"], df[f"{t}_{b}"]
                at_s = S == 1
                known = at_s & T.isin([0, 1])
                w = w_all[known]
                conv = float(100.0 * (w * (T[known] == 1)).sum() / w.sum()) if w.sum() > 0 else None

                def share(x):
                    ok = x.isin([0, 1])
                    return float(100.0 * (w_all[ok] * (x[ok] == 1)).sum() / w_all[ok].sum())

                out[kind][k][b] = {
                    "conversion": conv,
                    "base": int(known.sum()),
                    "converted": int((known & (T == 1)).sum()),
                    "at_s": int(at_s.sum()),
                    "unknown": int((at_s & T.notna() & ~T.isin([0, 1])).sum()),
                    "no_answer": int((at_s & T.isna()).sum()),
                    "non_nested": int(((T == 1) & (S != 1)).sum()),
                    "share_ratio": 100.0 * share(T) / share(S),
                }
    print(json.dumps(out))


def variant(src, dst, kind, codebook_src=None):
    df, meta = pyreadstat.read_sav(src)
    labels = dict(meta.variable_value_labels)
    if kind == "no_consideration":
        df = df.drop(columns=[c for c in df.columns if c.startswith("consider_")])
    elif kind == "rescaled":
        df["weight"] = df["weight"] * 3.7
    elif kind == "boundary":
        unaware10 = df.index[df["aware_b10"] == 0][:40]
        df.loc[unaware10, "consider_b10"] = 1
        aware8 = df.index[df["aware_b08"] == 1]
        df.loc[aware8[:30], "consider_b08"] = 9
        df.loc[aware8[30:35], "consider_b08"] = 7
        df.loc[aware8[35:55], "aware_b08"] = 9
        short9 = df.index[df["shortlist_b09"] == 1]
        df.loc[short9[8:], ["shortlist_b09", "firstchoice_b09"]] = 0
        short7 = df.index[df["shortlist_b07"] == 1]
        df.loc[short7[:6], "firstchoice_b07"] = np.nan
    else:
        raise SystemExit(f"unknown variant {kind}")
    if kind == "boundary":
        # Whole numbers stay whole in the CSV (1, not 1.0); blanks stay blank.
        for c in df.columns:
            x = df[c]
            if pd.api.types.is_float_dtype(x) and x.dropna().apply(float.is_integer).all():
                df[c] = x.astype("Int64")
        df.to_csv(dst, index=False)
        meta_json = json.load(open(codebook_src, encoding="utf-8"))
        meta_json["labels"] = meta_json["labels"] + [
            ["consider_b08", "Consideration BMW", 9, "Don't know"],
            ["aware_b08", "Prompted resolved recognition BMW", 9, "Don't know"],
        ]
        with open(dst + ".metadata.json", "w", encoding="utf-8") as f:
            json.dump(meta_json, f)
        print(json.dumps({"rows": int(len(df))}))
        return
    names = list(df.columns)
    pyreadstat.write_sav(
        df,
        dst,
        column_labels=[meta.column_names_to_labels.get(c) or c for c in names],
        variable_value_labels={c: v for c, v in labels.items() if c in names},
        variable_measure={c: v for c, v in (meta.variable_measure or {}).items() if c in names},
    )
    print(json.dumps({"rows": int(len(df)), "columns": len(names)}))

if __name__ == "__main__":
    if sys.argv[1] == "conversions":
        conversions(sys.argv[2])
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        raise SystemExit("usage: conversions <file> | variant <in> <out> <kind>")
