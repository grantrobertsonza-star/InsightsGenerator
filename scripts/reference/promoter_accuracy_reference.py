"""Independent reference for the promoter model's classification accuracy and its majority-class baseline (D2b), using
statsmodels' weighted logistic regression (GLM, binomial, frequency weights), not the app's own fit.

Accuracy: the weighted share of cases whose fitted probability is on the same side of 0.5 as their outcome.
Baseline: the weighted share of the larger outcome group (always guessing it). Printed as JSON with the fixture."""
import json, random
import numpy as np
import statsmodels.api as sm

rng = random.Random(4242)
rows = []
for i in range(300):
    x1 = rng.randint(0, 10)
    x2 = rng.randint(1, 5)
    x3 = rng.randint(0, 1)
    eta = -4.0 + 0.45 * x1 + 0.3 * x2 + 0.6 * x3
    p = 1 / (1 + np.exp(-eta))
    y = 1 if rng.random() < p else 0
    rows.append({"x1": x1, "x2": x2, "x3": x3, "y": y, "w": round(0.5 + rng.random(), 3)})

X = sm.add_constant(np.array([[r["x1"], r["x2"], r["x3"]] for r in rows], dtype=float))
y = np.array([r["y"] for r in rows], dtype=float)
w = np.array([r["w"] for r in rows])
fit = sm.GLM(y, X, family=sm.families.Binomial(), freq_weights=w).fit()
pred = (fit.predict(X) >= 0.5).astype(float)
accuracy = float((w * (pred == y)).sum() / w.sum())
share1 = float((w * y).sum() / w.sum())
print(json.dumps({"rows": rows, "accuracy": accuracy, "baseline": max(share1, 1 - share1), "coef": fit.params.tolist()}))
