"""Writes the small synthetic FMCG brand tracker used by trackerFmcg.db.test.ts (R5, 30 October 2026).

Two waves of a snack brand tracker as SPSS files with variable and answer labels only (no question numbers, types or
sets), the form Grant's raw files most often take. Four brands, 240 respondents a wave, a weight. Questions per brand:
"Aware", "Would consider", "Ever bought", "Bought in the past 3 months" (wave 1) or "Bought in the past month" (wave 2:
the same variable names with a changed time window, so the usage change must be withheld), and "Buy most often" (BUMO),
which is also asked once as the single-choice brand question. Consideration is asked only of those aware of the brand
(blank otherwise), so its base is the aware respondents. Deterministic (seeded). Run from the repository root:
    python3 fixtures/tracker-fmcg/make_fmcg.py
"""
import os
import numpy as np
import pandas as pd
import pyreadstat

HERE = os.path.dirname(os.path.abspath(__file__))
BRANDS = {1: "Crunchos", 2: "Nutty Bar", 3: "Fresh Bake", 4: "Golden Crisp"}


def wave(n, seed, window_words):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({"resp_id": np.arange(1, n + 1, dtype=float)})
    df["weight"] = np.round(rng.uniform(0.6, 1.4, n), 4)
    labels = {"resp_id": "Respondent ID", "weight": "Weight"}
    value_labels = {}
    yes_no = {0.0: "No", 1.0: "Yes"}
    most = rng.choice([1, 2, 3, 4, 98], size=n, p=[0.3, 0.25, 0.2, 0.15, 0.1]).astype(float)
    for code, brand in BRANDS.items():
        aware = (rng.uniform(size=n) < [0.9, 0.8, 0.7, 0.6][code - 1]) | (most == code)
        consider = np.where(aware, (rng.uniform(size=n) < 0.6) | (most == code), np.nan)
        ever = aware & ((rng.uniform(size=n) < 0.55) | (most == code))
        recent = ever & ((rng.uniform(size=n) < 0.5) | (most == code))
        df[f"aware_b{code}"] = aware.astype(float)
        df[f"consider_b{code}"] = consider  # 0.0 / 1.0, blank when not aware (not asked)
        df[f"ever_b{code}"] = ever.astype(float)
        df[f"bought_window_b{code}"] = recent.astype(float)
        df[f"bumo_b{code}"] = (most == code).astype(float)
        labels.update({
            f"aware_b{code}": f"Aware {brand}",
            f"consider_b{code}": f"Would consider {brand}",
            f"ever_b{code}": f"Ever bought {brand}",
            f"bought_window_b{code}": f"Bought in the {window_words} {brand}",
            f"bumo_b{code}": f"Buy most often {brand}",
        })
        value_labels[f"aware_b{code}"] = {0.0: "Not aware", 1.0: "Aware"}
        for stem in ("consider", "ever", "bought_window", "bumo"):
            value_labels[f"{stem}_b{code}"] = yes_no
    df["most_often"] = most
    labels["most_often"] = "Brand bought most often"
    value_labels["most_often"] = {**{float(c): b for c, b in BRANDS.items()}, 98.0: "None of these"}
    return df, labels, value_labels


for number, seed, words in ((1, 20261030, "past 3 months"), (2, 20261031, "past month")):
    df, labels, vls = wave(240, seed, words)
    pyreadstat.write_sav(df, os.path.join(HERE, f"fmcg_wave{number}.sav"), column_labels=labels, variable_value_labels=vls)
    print("wrote", f"fmcg_wave{number}.sav", df.shape)
