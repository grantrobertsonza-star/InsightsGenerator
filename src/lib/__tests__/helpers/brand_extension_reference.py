"""Independent reference for the brand dashboard extension tests (r6brandext), written from Grant's
"03 Claude Dashboard Extension Guide" and the packs' 02 analysis guides, never from the app's code.

Commands (all print JSON to stdout):
  xlsx-refs <Reference_Metrics.xlsx>
      The "Measurement extension" rows of a pack's reference workbook, as reference_results.json lists them.
  variant <in.csv> <in metadata.json> <out.csv> <out metadata.json> <kind>
      A test file made from a pack's CSV and JSON codebook:
        edges     route breaks, unexpected missing, and the episode cases of the guide's acceptance list (Other names
                  that match after normalising, that differ, a blank name, a typed tracked-brand name, no ideal,
                  cannot recall, same and different tracked brands), the file's gap flag and reasons kept consistent;
        rescaled  every weight multiplied by 3.7 (percentages must not move);
        review    a second needs-fit family with its own wording (needsfit2_bXX), so needs fit is ambiguous.
  expected <file.csv> <metadata.json> [aliases.json]
      Every figure the tests compare, weighted and unweighted, by the guide's definitions.
"""
import json
import math
import sys

import pandas as pd


def norm(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ""
    return " ".join(str(x).casefold().split())


def xlsx_refs(path):
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb["Reference metrics"].values)
    head = list(rows[0])
    out = [dict(zip(head, r)) for r in rows[1:] if r and r[1] == "Measurement extension"]
    print(json.dumps(out))


def read(csv):
    return pd.read_csv(csv, dtype=str, keep_default_na=False)


def num(s):
    return pd.to_numeric(s.replace("", float("nan")), errors="coerce")


def variant(src, meta_src, out, meta_out, kind):
    d = read(src)
    m = json.load(open(meta_src))
    if kind == "rescaled":
        d["weight"] = (num(d["weight"]) * 3.7).map(lambda v: repr(float(v)))
    elif kind == "review":
        names = m["brands"]
        for b in range(1, 11):
            src_col = f"needsfit_b{b:02}"
            col = f"needsfit2_b{b:02}"
            # A second needs-fit rating with its own wording: the same answers shifted, routed by awareness.
            v = num(d[src_col])
            d[col] = v.map(lambda x: "" if math.isnan(x) else str(int(x if x == 9 else (x % 5) + 1)))
            label = f"{names[b - 1]} fits my personal needs for personal banking better than most."
            m["variables"].append({"variable": col, "label": label, "question": "E1b", "data_type": "numeric", "question_type": "ordinal", "mr_set": "", "selected_value": None,
                                   "universe": f"Brand aware: aware_b{b:02}=1", "derivation": "", "unit": "code", "option_label": label})
            for code, lab in [(1, "Strongly disagree"), (2, "Disagree"), (3, "Neither agree nor disagree"), (4, "Agree"), (5, "Strongly agree"), (9, "Do not know enough to judge")]:
                m["labels"].append([col, label, code, lab])
    elif kind == "edges":
        aw = num(d["aware_b01"])
        nf = num(d["needsfit_b01"])
        unaware = d.index[aw == 0][:2]
        aware_rated = d.index[(aw == 1) & nf.between(1, 5)][:2]
        # Route breaks: two respondents not aware of brand 1 hold a needs-fit rating (never in any base).
        d.loc[unaware, "needsfit_b01"] = "4"
        # Unexpected missing: two aware respondents with no needs-fit answer (missing, never valid).
        d.loc[aware_rated, "needsfit_b01"] = ""
        el = d.index[num(d["choice_episode_eligible"]) == 1]
        reasons = [f"choice_barrier_r{i:02}" for i in range(1, 11)] + ["choice_barrier_none", "choice_barrier_dk"]
        cases = [
            # actual, actual name, ideal, ideal name
            ("96", "  synthetic OTHER   brand a ", "96", "Synthetic other brand A"),  # same Other after normalising
            ("96", "Synthetic other brand A", "96", "Synthetic other brand C"),  # different Other names
            ("96", "", "1", ""),  # an Other with no name: unresolved
            ("8", "", "96", "FNB"),  # a tracked brand typed as Other: not matched without a confirmed alias
            ("3", "", "98", ""),  # no particular ideal
            ("99", "", "2", ""),  # cannot recall the actual brand
            ("4", "", "4", ""),  # same tracked brand
            ("5", "", "9", ""),  # different tracked brands
        ]
        for row, (a, an, i, iname) in zip(el[:len(cases)], cases):
            d.at[row, "choice_actual"] = a
            d.at[row, "choice_actual_other"] = an
            d.at[row, "choice_ideal"] = i
            d.at[row, "choice_ideal_other"] = iname
            known = a not in ("99",) and i not in ("98", "99") and not (a == "96" and not norm(an)) and not (i == "96" and not norm(iname))
            if known:
                ia = norm(an) if a == "96" else a
                ii = norm(iname) if i == "96" else i
                gap = int(ia != ii)
                d.at[row, "choice_gap"] = str(gap)
            else:
                gap = None
                d.at[row, "choice_gap"] = ""
            for k in reasons + ["choice_barrier_other"]:
                d.at[row, k] = ""
            if gap == 1:
                for k in reasons:
                    d.at[row, k] = "0"
                d.at[row, "choice_barrier_r01"] = "1"
    else:
        raise SystemExit(f"unknown variant {kind}")
    d.to_csv(out, index=False)
    json.dump(m, open(meta_out, "w"))


def expected(csv, meta_path, aliases_path=None):
    d = read(csv)
    m = json.load(open(meta_path))
    aliases = json.load(open(aliases_path)) if aliases_path else {}
    brands = m["brands"]
    out = {}
    for mode in ("weighted", "unweighted"):
        w = num(d["weight"]) if mode == "weighted" else pd.Series(1.0, index=d.index)
        res = {"ratings": {}, "episode": {}, "reasons": {}}
        for stem in ("needsfit", "different", "pricejustify"):
            per = {}
            for b in range(1, 11):
                v = num(d[f"{stem}_b{b:02}"])
                aware = num(d[f"aware_b{b:02}"]) == 1
                valid = aware & v.between(1, 5)
                top = valid & (v >= 4)
                dk = aware & (v == 9)
                vw = float(w[valid].sum())
                per[str(b)] = {
                    "aware_n": int(aware.sum()), "aware_w": float(w[aware].sum()),
                    "valid_n": int(valid.sum()), "valid_w": vw,
                    "top2": float(w[top].sum()) / vw * 100 if vw else None,
                    "mean": float((w[valid] * v[valid]).sum()) / vw if vw else None,
                    "dk": float(w[dk].sum()) / float(w[aware].sum()) * 100 if aware.any() else None,
                    "missing_n": int((aware & v.isna()).sum()),
                    "answered_not_aware": int((~aware & v.notna()).sum()),
                    "dist": {str(c): float(w[valid & (v == c)].sum()) / vw * 100 if vw else None for c in range(1, 6)},
                }
            res["ratings"][stem] = per
        a = num(d["choice_actual"])
        i = num(d["choice_ideal"])
        el = num(d["choice_episode_eligible"]) == 1

        def ident(code, name):
            if math.isnan(code) or code in (98, 99):
                return None
            if code == 96:
                n = norm(name)
                if not n:
                    return None
                return aliases.get(n, "other:" + n)
            return "brand:" + str(int(code))

        ia = [ident(x, y) for x, y in zip(a, d["choice_actual_other"])]
        ii = [ident(x, y) for x, y in zip(i, d["choice_ideal_other"])]
        paired = pd.Series([el.iloc[k] and ia[k] is not None and ii[k] is not None for k in range(len(d))], index=d.index)
        pw = float(w[paired].sum())
        diff = pd.Series([paired.iloc[k] and ia[k] != ii[k] for k in range(len(d))], index=d.index)
        ep = {"eligible_n": int(el.sum()), "paired_n": int(paired.sum()), "paired_w": pw, "gap_n": int(diff.sum()), "gap_rate": float(w[diff].sum()) / pw * 100 if pw else None,
              "no_ideal_n": int((el & (i == 98)).sum()),
              "cannot_recall_n": int((el & (i != 98) & ((a == 99) | (i == 99))).sum()),
              "unresolved_n": int(sum(1 for k in range(len(d)) if el.iloc[k] and i.iloc[k] != 98 and a.iloc[k] != 99 and i.iloc[k] != 99 and (ia[k] is None or ii[k] is None))),
              "shares": {}, "fulfilment": {}}
        for b in range(1, 11):
            key = "brand:" + str(b)
            act = pd.Series([paired.iloc[k] and ia[k] == key for k in range(len(d))], index=d.index)
            ide = pd.Series([paired.iloc[k] and ii[k] == key for k in range(len(d))], index=d.index)
            both = act & ide
            ep["shares"][str(b)] = {"actual": float(w[act].sum()) / pw * 100 if pw else None, "ideal": float(w[ide].sum()) / pw * 100 if pw else None}
            ep["fulfilment"][str(b)] = {"preferrers_n": int(ide.sum()), "rate": float(w[both].sum()) / float(w[ide].sum()) * 100 if ide.any() else None}
        oth_a = pd.Series([paired.iloc[k] and str(ia[k]).startswith("other:") for k in range(len(d))], index=d.index)
        oth_i = pd.Series([paired.iloc[k] and str(ii[k]).startswith("other:") for k in range(len(d))], index=d.index)
        ep["shares"]["other"] = {"actual": float(w[oth_a].sum()) / pw * 100 if pw else None, "ideal": float(w[oth_i].sum()) / pw * 100 if pw else None}
        res["episode"] = ep
        gap = num(d["choice_gap"]) == 1
        keys = [f"choice_barrier_r{k:02}" for k in range(1, 11)] + ["choice_barrier_none", "choice_barrier_dk"]
        sel = pd.concat([num(d[k]) == 1 for k in keys], axis=1)
        completed = gap & sel.any(axis=1)
        cw = float(w[completed].sum())
        res["reasons"] = {"eligible_n": int(gap.sum()), "completed_n": int(completed.sum()), "completed_w": cw,
                          "share": {k: float(w[completed & (num(d[k]) == 1)].sum()) / cw * 100 if cw else None for k in keys}}
        out[mode] = res
    print(json.dumps(out))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "xlsx-refs":
        xlsx_refs(sys.argv[2])
    elif cmd == "variant":
        variant(*sys.argv[2:7])
    elif cmd == "expected":
        expected(*sys.argv[2:])
    else:
        raise SystemExit(f"unknown command {cmd}")
