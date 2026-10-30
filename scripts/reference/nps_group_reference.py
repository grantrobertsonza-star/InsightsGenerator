"""Independent reference for the NPS group-against-rest test (D2b), using statsmodels, not the engine.

The difference between a group's NPS and the rest's is the coefficient of a group indicator in a weighted least-squares
regression of d (+100 promoter, -100 detractor, 0 passive) on an intercept and that indicator, over the cases answering
in that banner variable. Its cluster-robust (sandwich) variance without small-sample correction, multiplied by G / (G - 1)
for G clusters, is the with-replacement Taylor variance of a one-stratum cluster design (the survey package's
convention). With every case its own cluster it is the unclustered with-replacement variance.

Run: python3 scripts/reference/nps_group_reference.py  (prints the fixture and the reference values as JSON)."""
import json, random
import numpy as np
import statsmodels.api as sm

rng = random.Random(20261029)
rows = []
for i in range(240):
    group = ["A", "B", "C"][i % 3]
    psu = i // 20  # 12 clusters of 20
    shift = {"A": 1.5, "B": 0.0, "C": -1.0}[group]
    score = i % 11 if i < 33 else max(0, min(10, round(rng.gauss(7 + shift, 2.2))))
    weight = round(0.5 + rng.random() * 1.5, 3)
    rows.append({"id": i + 1, "group": group, "psu": psu, "w": weight, "nps": score})


def reference(rows, clustered):
    d = np.array([100.0 if r["nps"] >= 9 else -100.0 if r["nps"] <= 6 else 0.0 for r in rows])
    w = np.array([r["w"] for r in rows])
    out = {}
    for g in ["A", "B", "C"]:
        x = np.array([1.0 if r["group"] == g else 0.0 for r in rows])
        X = sm.add_constant(x)
        groups = np.array([r["psu"] for r in rows]) if clustered else np.arange(len(rows))
        fit = sm.WLS(d, X, weights=w).fit(cov_type="cluster", cov_kwds={"groups": groups, "use_correction": False})
        G = len(set(groups.tolist()))
        se = float(np.sqrt(fit.cov_params()[1, 1] * G / (G - 1)))
        out[g] = {"difference": float(fit.params[1]), "se": se}
    return out


if __name__ == "__main__":
    print(json.dumps({"rows": rows, "clustered": reference(rows, True), "unclustered": reference(rows, False)}))
