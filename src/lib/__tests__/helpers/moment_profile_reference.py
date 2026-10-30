"""Independent reference values for page 02's Moment profile and Moment reach (trackerMomentProfile.db.test.ts).

Written from the BMW pack's specification (claude/tracker-packs-role-spec-2026-10-28.md: cep_cXX_bYY the brand recall
links for 12 moments and 10 brands, aware_bYY awareness, code 1 = selected, `weight` the analysis weight) and from
the contracts in claude/d2-design-2026-10-29.md (D3c, Moment profile and Moment reach), not from the app's code.
w is the weight column (weighted) or 1 (unweighted).

Moment profile, for brand YY and moment XX:
  aware = respondents with aware_bYY == 1
  valid = aware respondents with a value in cep_cXX_bYY (a blank leaves that cell's base)
  share = 100 * sum(w * (cep_cXX_bYY == 1)) / sum(w) over valid;  base = count of valid
  aware_n[bYY] = count of aware respondents

Moment reach, for brand YY over all respondents:
  complete = respondents with a value in every cep_cXX_bYY (XX = 01..12); count = number of those equal to 1
  per_person  = sum(w * count) / sum(w) over complete
  penetration = 100 * sum(w * (count >= 1)) / sum(w) over complete
  per_linker  = sum(w * count) / sum(w) over complete with count >= 1 (None when nobody)
  links       = sum(w * count) over complete
  share       = 100 * links / sum of every brand's links, only when every brand's complete set is every respondent
  base = count of complete; none_valid = respondents with no value in any link; partly = some but not all

  python3 -I moment_profile_reference.py values <file.sav|file.csv>  -> JSON {profile: {weighted, unweighted,
      aware_n}, reach: {weighted, unweighted}}
  python3 -I moment_profile_reference.py variant <in.csv> <out.csv> <kind>  -> a changed copy of the CSV:
      boundary: Haval (b10) aware for only its first 8 aware respondents (aware_b10 = 0 for the rest; a small aware
                base, suppressed); two respondents aware of BMW leave cep_c02_b08 blank (a moment with blanks); one
                respondent leaves every BMW link blank (outside BMW's reach base, counted); nobody links Suzuki
                (every cep_cXX_b07 = 0)
      rescaled: the weight multiplied by 3.7 (every weighted figure unchanged)
"""
import json
import sys

import pandas as pd

BRANDS = [f"b{b:02d}" for b in range(1, 11)]
MOMENTS = [f"c{c:02d}" for c in range(1, 13)]


def read(path):
    if path.endswith(".sav"):
        import pyreadstat

        df, _ = pyreadstat.read_sav(path)
        return df
    return pd.read_csv(path)


def weights(df, kind, index):
    return df.loc[index, "weight"].astype(float) if kind == "weighted" else pd.Series(1.0, index=index)


def profile(df):
    out = {"weighted": {}, "unweighted": {}, "aware_n": {}}
    for b in BRANDS:
        aware = df[f"aware_{b}"] == 1
        out["aware_n"][b] = int(aware.sum())
        for c in MOMENTS:
            name = f"cep_{c}_{b}"
            valid = aware & df[name].notna()
            x = (df.loc[valid, name] == 1).astype(float)
            for kind in ("weighted", "unweighted"):
                w = weights(df, kind, x.index)
                out[kind][name] = [float(100.0 * (w * x).sum() / w.sum()) if w.sum() > 0 else None, int(valid.sum())]
    return out


def reach(df):
    out = {"weighted": {}, "unweighted": {}}
    for kind in ("weighted", "unweighted"):
        rows = {}
        for b in BRANDS:
            cols = [f"cep_{c}_{b}" for c in MOMENTS]
            answered = df[cols].notna()
            complete = answered.all(axis=1)
            count = (df.loc[complete, cols] == 1).sum(axis=1).astype(float)
            w = weights(df, kind, count.index)
            linker = count >= 1
            links = float((w * count).sum())
            rows[b] = {
                "per_person": links / float(w.sum()),
                "penetration": 100.0 * float(w[linker].sum()) / float(w.sum()),
                "per_linker": (links / float(w[linker].sum())) if linker.any() else None,
                "links": links,
                "base": int(complete.sum()),
                "none_valid": int((~answered.any(axis=1)).sum()),
                "partly": int((answered.any(axis=1) & ~complete).sum()),
            }
        every = all(r["base"] == len(df) for r in rows.values())
        total = sum(r["links"] for r in rows.values())
        for r in rows.values():
            r["share"] = 100.0 * r["links"] / total if every and total > 0 else None
        out[kind] = rows
    return out


def variant(src, dst, kind):
    df = pd.read_csv(src)
    if kind == "rescaled":
        df["weight"] = df["weight"].astype(float) * 3.7
    elif kind == "boundary":
        aware10 = df.index[df["aware_b10"] == 1]
        if len(aware10) < 9:
            raise SystemExit("too few respondents aware of Haval for this variant")
        df.loc[aware10[8:], "aware_b10"] = 0
        aware8 = df.index[df["aware_b08"] == 1]
        df["cep_c02_b08"] = df["cep_c02_b08"].astype("Float64")
        df.loc[aware8[:2], "cep_c02_b08"] = pd.NA
        for c in MOMENTS:
            col = f"cep_{c}_b08"
            df[col] = df[col].astype("Float64")
            df.loc[aware8[2:3], col] = pd.NA
            df[f"cep_{c}_b07"] = 0
    else:
        raise SystemExit(f"unknown variant {kind}")
    df.to_csv(dst, index=False)


if __name__ == "__main__":
    if sys.argv[1] == "values":
        d = read(sys.argv[2])
        print(json.dumps({"profile": profile(d), "reach": reach(d)}))
    elif sys.argv[1] == "variant":
        variant(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: values <file> | variant <in> <out> <kind>")
