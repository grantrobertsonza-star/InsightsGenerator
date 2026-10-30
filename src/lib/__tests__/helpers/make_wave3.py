"""A third BMW-style wave for the R5 waves tests, made deterministically from the pack's wave 2
(fixtures/tracker-packs/bmw_car/wave2_labels_only_compressed.sav).

Usage: python3 make_wave3.py <out.sav>

What it changes, so the tests have known differences to find:
- every respondent is drawn again from wave 2 with replacement (seed 3), so the shares move by sampling only;
- BMW (brand code 8) consideration rises: a quarter of the respondents aware of BMW who did not consider it now do;
- brand code 10 is renamed (Haval becomes Chery) in every answer list and question wording, so code 10 names another
  brand and must not be compared;
- the word of mouth answer list changes: code 6 "Very positive" is added and a third of each brand's "Mainly
  positive" (1) answers move to it, so word of mouth is a different question and must not be compared;
- the weights are multiplied by a smooth factor of age, so the effective base is below n.
Everything else (variable names, codes, wording) is wave 2's.
"""
import sys

import numpy as np
import pyreadstat


def main(out: str, src: str) -> int:
    df, meta = pyreadstat.read_sav(src)
    rng = np.random.default_rng(3)
    df = df.iloc[rng.integers(0, len(df), len(df))].reset_index(drop=True)
    df["respondent_id"] = np.arange(30001, 30001 + len(df), dtype=float)
    df["wave"] = 3.0
    lift = (df["aware_b08"] == 1) & (df["consider_b08"] == 0) & (rng.random(len(df)) < 0.25)
    df.loc[lift, "consider_b08"] = 1.0
    df["weight"] = df["weight"] * (0.6 + 0.8 * (df["age"].fillna(40) - 18) / 60.0)
    value_labels = {k: dict(v) for k, v in meta.variable_value_labels.items()}
    for name in [c for c in df.columns if c.startswith("wom_b")]:
        value_labels[name] = {**value_labels.get(name, {}), 6.0: "Very positive"}
        move = (df[name] == 1) & (rng.random(len(df)) < 1 / 3)
        df.loc[move, name] = 6.0
    for name, labels in value_labels.items():
        value_labels[name] = {code: label.replace("Haval", "Chery") for code, label in labels.items()}
    column_labels = [(meta.column_names_to_labels.get(c) or "").replace("Haval", "Chery") for c in df.columns]
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].fillna("")
    pyreadstat.write_sav(df, out, column_labels=column_labels, variable_value_labels=value_labels)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
