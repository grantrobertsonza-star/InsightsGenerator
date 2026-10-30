"""Independent reference values for the tracker dashboard's segment (R5, trackerSegment.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md) and the segment contract
(claude/d2-design-2026-10-29.md, "R5 Segment"), not from the app's code. A segment is a dict {variable: [codes]}:
a respondent is in it when, for every variable, their answer is one of its codes (a blank answer is no code, so
outside). Within the segment, with w the weight column (weighted) or 1 (unweighted):
  base:        n = count in segment; weighted = sum(w); effective = sum(w)^2 / sum(w^2) (Kish), weighted only
  funnel:      for stage prefix aware / consider / shortlist / firstchoice and brand bYY: valid = value not blank;
               share = 100 * sum(w * (value == 1)) / sum(w) over valid; base = count valid
  association: attr_aXX_bYY among those aware of brand YY (aware_bYY == 1) with a valid answer: share as above,
               base = count; aware_n = count aware of YY in the segment; aware_eff = Kish of the aware respondents
  recall:      every cep_cXX_bYY: share among valid answers, as the funnel
  media:       every media_mXX: share among valid answers, as the funnel
  category:    decision_style: for each code c, 100 * sum(w * (value == c)) / sum(w) over valid answers

  python3 segment_reference.py figures <file.sav|file.csv> '<segment json>'
      -> JSON {n, weighted: {...}, unweighted: {...}} with base, funnel, association, recall, media, category
  python3 segment_reference.py variant <in> <out> <kind>   (writes a changed copy)
      no_woman_label: an SPSS copy whose gender answer list has no code 2 (Woman), answers 2 recoded to 4
      weight_x25:     an SPSS copy with every weight multiplied by 2.5
      blank_gender:   a CSV copy whose first five respondents have no gender answer
"""
import json
import re
import sys

import numpy as np
import pandas as pd

STAGES = ["aware", "consider", "shortlist", "firstchoice"]
BRANDS = [f"b{b:02d}" for b in range(1, 11)]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def share(values, w):
    valid = values.notna()
    if not valid.any():
        return [None, 0]
    return [float(100 * (w[valid] * (values[valid] == 1)).sum() / w[valid].sum()), int(valid.sum())]


def kish(w):
    return float(w.sum() ** 2 / (w ** 2).sum()) if len(w) else 0.0


def figures(path, segment):
    df = read(path)
    inside = pd.Series(True, index=df.index)
    for var, codes in segment.items():
        inside &= df[var].isin([float(c) for c in codes])
    seg = df[inside]
    out = {"n": int(inside.sum())}
    for kind in ("weighted", "unweighted"):
        w = seg["weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=seg.index)
        r = {"base": {"n": int(len(seg)), "weighted": float(w.sum()), "effective": kish(w)}}
        r["funnel"] = {s: {b: share(seg[f"{s}_{b}"], w) for b in BRANDS if f"{s}_{b}" in seg} for s in STAGES}
        aware = seg["aware_b08"] == 1
        r["association"] = {
            "aware_n": int(aware.sum()),
            "aware_eff": kish(w[aware]),
            "attr_a01_b08": share(seg.loc[aware, "attr_a01_b08"], w[aware]),
            "attr_a05_b08": share(seg.loc[aware, "attr_a05_b08"], w[aware]),
        }
        r["recall"] = {v: share(seg[v], w) for v in seg.columns if re.fullmatch(r"cep_c\d+_b\d+", v)}
        r["media"] = {v: share(seg[v], w) for v in seg.columns if re.fullmatch(r"media_m\d+", v)}
        valid = seg["decision_style"].notna()
        r["category"] = {
            str(int(c)): [float(100 * (w[valid] * (seg.loc[valid, "decision_style"] == c)).sum() / w[valid].sum()), int(valid.sum())]
            for c in sorted(seg.loc[valid, "decision_style"].unique())
        }
        out[kind] = r
    print(json.dumps(out))


def variant(src, dst, kind):
    if kind in ("no_woman_label", "weight_x25"):
        import pyreadstat

        df, meta = pyreadstat.read_sav(src)
        labels = dict(meta.variable_value_labels)
        if kind == "no_woman_label":
            labels["gender"] = {k: v for k, v in labels["gender"].items() if k != 2.0}
            df.loc[df["gender"] == 2, "gender"] = 4.0
        else:
            df["weight"] = df["weight"] * 2.5
        pyreadstat.write_sav(df, dst, column_labels=meta.column_names_to_labels, variable_value_labels=labels)
    elif kind == "blank_gender":
        df = pd.read_csv(src)
        df["gender"] = df["gender"].astype("Float64")
        df.loc[df.index[:5], "gender"] = pd.NA
        df.to_csv(dst, index=False)
    else:
        raise SystemExit(f"unknown variant {kind}")
    print(json.dumps({}))


if __name__ == "__main__":
    if sys.argv[1] == "figures":
        figures(sys.argv[2], json.loads(sys.argv[3]))
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: figures <file> <segment json> | variant <in> <out> <kind>")
