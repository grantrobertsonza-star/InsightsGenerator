"""Small, independently knowable U&A checks shared by the engine self-test and library suite."""
import numpy as np
import pandas as pd


def run_checks(engine, check):
    n = 120
    gate = np.array([0] * 40 + [1] * 80)
    answered = np.array([4] * 40 + [1] * 70 + [2] * 10)
    value = np.array([np.nan] * 40 + [1] * 30 + [0] * 40 + [np.nan] * 10)
    w = np.array([1.0, 3.0] * 60)
    amount = np.array([np.nan] * 40 + list(range(1, 71)) + [np.nan] * 10)
    frame = pd.DataFrame({"gate": gate, "state": answered, "value": value, "amount": amount, "module": np.tile([1, 2, 3], 40), "aware": np.tile([0, 1], 60), "w": w, "scaled": w * 17})
    data = frame.to_csv(index=False).encode()
    codes = lambda var, *v: {"op": "codes", "variable": var, "codes": [str(x) for x in v]}
    spec = {"id": "incidence", "label": "Same-window incidence", "variable": "value", "kind": "percent", "selectedCodes": ["1"], "answered": codes("state", 1), "logicalZero": codes("gate", 0)}

    def compute(specs, weight="w"):
        return engine.crosstab(data, "ua.csv", {"columnVars": [], "rowItems": [{"key": "value", "label": "V", "vars": ["value"]}], "weightVar": weight, "uaMetrics": specs})["uaMetrics"]

    a = compute([spec])[0]
    valid = (answered == 1) | (gate == 0)
    expected = w[(value == 1)].sum() / w[valid].sum() * 100
    check("UA: only confirmed same-window non-use becomes logical zero", abs(a["value"] - expected) < 1e-10 and a["validBase"]["n"] == 110)
    raw = compute([{**spec, "logicalZero": None}])[0]
    check("UA: treating routed blanks as missing changes incidence; the declared zero rule matters", abs(raw["value"] - a["value"]) > 10 and raw["validBase"]["n"] == 70)
    mean_spec = {"id": "mean", "label": "Answered user mean", "variable": "amount", "kind": "mean", "eligible": codes("gate", 1), "answered": codes("state", 1)}
    m = compute([mean_spec])[0]
    mask = (gate == 1) & (answered == 1)
    expected_mean = float(np.average(amount[mask], weights=w[mask]))
    check("UA: numeric means exclude unanswered users instead of imputing zero", abs(m["value"] - expected_mean) < 1e-10 and m["eligibleBase"]["n"] == 80 and m["validBase"]["n"] == 70)
    scaled = compute([spec, mean_spec], "scaled")
    check("UA: percentages, means and Kish bases are invariant to weight rescaling", abs(scaled[0]["value"] - a["value"]) < 1e-10 and abs(scaled[1]["value"] - m["value"]) < 1e-10 and abs(scaled[1]["validBase"]["nEff"] - m["validBase"]["nEff"]) < 1e-10)
    check("UA: exact weighted bases rescale without display rounding", abs(scaled[0]["validBase"]["w"] - a["validBase"]["w"] * 17) < 1e-10)
    split_spec = {**spec, "id": "split", "logicalZero": None, "assigned": codes("module", 2), "eligible": codes("aware", 1)}
    split = compute([split_spec])[0]
    check("UA: split-sample assignment precedes brand eligibility and valid answers", split["assignedBase"]["n"] == 40 and split["eligibleBase"]["n"] == 20 and split["validBase"]["n"] == int(((frame.module == 2) & (frame.aware == 1) & (frame.state == 1)).sum()))
    try:
        compute([{**spec, "eligible": codes("missing_variable", 1)}])
        refused = False
    except ValueError:
        refused = True
    check("UA: missing route variable refuses, not an all-case fallback", refused)
    check("UA: a corrected retry gives the original result", compute([spec])[0]["value"] == a["value"])
    tiny = {**mean_spec, "eligible": {"op": "range", "variable": "amount", "min": 1, "max": 2}}
    check("UA: the existing engine small-base threshold suppresses a tiny mean", compute([tiny])[0]["value"] is None)
    text_frame = frame.assign(words=["Original response " + str(i) for i in range(n)])
    text_spec = {"id": "words", "variable": "words", "kind": "verbatim", "assigned": codes("module", 2), "eligible": codes("aware", 1), "answered": codes("state", 1)}
    text_result = engine.crosstab(text_frame.to_csv(index=False).encode(), "ua.csv", {"columnVars": [], "rowItems": [{"key": "value", "label": "V", "vars": ["value"]}], "weightVar": "w", "uaMetrics": [text_spec]})["uaMetrics"][0]
    text_mask = (frame.module == 2) & (frame.aware == 1) & (frame.state == 1)
    check("UA: verbatim samples retain eligible source row and text, without thematic invention", text_result["value"] == int(text_mask.sum()) and text_result["quotes"][0]["row"] == int(np.flatnonzero(text_mask)[0]) + 1 and len(text_result["quotes"]) == 6)
    return {"incidence": a["value"], "mean": m["value"], "split": split}


if __name__ == "__main__":
    import importlib.util
    import os
    import json
    spec = importlib.util.spec_from_file_location("engine", os.path.join(os.path.dirname(__file__), "..", "api", "parse-stats-file.py"))
    engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
    failures = []
    result = run_checks(engine, lambda name, ok: failures.append(name) if not ok else None)
    print(json.dumps({"failed": failures, "values": result}))
    raise SystemExit(bool(failures))
