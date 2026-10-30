"""Response-state preparation for U&A metrics; estimates stay in the Cross tab owner."""
import copy
import numpy as np
import pandas as pd


def condition_mask(df, expr):
    if expr is None:
        return np.ones(len(df), dtype=bool)
    if not isinstance(expr, dict):
        raise ValueError("A U&A condition must be an object.")
    op = expr.get("op")
    if op in ("all", "any"):
        terms = expr.get("terms")
        if not isinstance(terms, list) or not terms:
            raise ValueError("A compound U&A condition needs terms.")
        masks = [condition_mask(df, t) for t in terms]
        return np.logical_and.reduce(masks) if op == "all" else np.logical_or.reduce(masks)
    if op == "differentSets":
        left, right = expr.get("left"), expr.get("right")
        if not left or len(left) != len(right) or any(v not in df for v in left + right):
            raise ValueError("Both recalled baskets need the same declared brand frame.")
        a, b = df[left].to_numpy(float), df[right].to_numpy(float)
        return np.isfinite(a).all(axis=1) & np.isfinite(b).all(axis=1) & (a != b).any(axis=1)
    var = expr.get("variable")
    if var not in df:
        raise ValueError(f"U&A condition variable {var} is not in this file.")
    values = pd.to_numeric(df[var], errors="coerce").to_numpy(float)
    if op == "codes":
        codes = expr.get("codes")
        if not isinstance(codes, list) or not codes:
            raise ValueError("A raw-code condition needs at least one code.")
        return np.isfinite(values) & np.isin(values, [float(c) for c in codes])
    if op == "range":
        return np.isfinite(values) & (values >= float(expr["min"])) & (values <= float(expr["max"]))
    if op == "answered":
        return np.isfinite(values)
    raise ValueError(f"Unsupported U&A condition {op}.")


def prepare_measure(df, spec):
    var = spec.get("variable")
    if var not in df:
        raise ValueError(f"U&A variable {var} is not in this file.")
    eligible = condition_mask(df, spec.get("eligible"))
    assigned = condition_mask(df, spec.get("assigned"))
    eligible &= assigned
    values = (np.where(df[var].notna() & df[var].astype(str).str.strip().ne(""), 1.0, np.nan) if spec.get("kind") == "verbatim" else pd.to_numeric(df[var], errors="coerce").to_numpy(float))
    valid = eligible & condition_mask(df, spec.get("answered")) & np.isfinite(values)
    if spec.get("validCodes"):
        valid &= np.isin(values, [float(c) for c in spec["validCodes"]])
    logical_zero = condition_mask(df, spec["logicalZero"]) if spec.get("logicalZero") else np.zeros(len(df), dtype=bool)
    if (logical_zero & valid & (values != 0)).any():
        raise ValueError("Confirmed non-use conflicts with a recorded nonzero answer. Correct the inputs first.")
    valid |= eligible & logical_zero
    if spec.get("valueVariables"):
        members = spec["valueVariables"]
        if not isinstance(members, list) or not members or any(v not in df for v in members):
            raise ValueError("The repertoire needs declared available member variables.")
        member_values = df[members].to_numpy(float)
        valid &= np.isfinite(member_values).all(axis=1)
        values = member_values.sum(axis=1)
    values = values.copy()
    values[logical_zero] = 0
    if spec.get("valueCondition"):
        values = condition_mask(df, spec["valueCondition"]).astype(float)
    if spec.get("kind") == "percent":
        codes = spec.get("selectedCodes")
        if not codes:
            raise ValueError("A percentage requires declared raw selected codes.")
        values = np.isin(values, [float(c) for c in codes]).astype(float)
    values[~valid] = np.nan
    return assigned, eligible, values


def dashboard_metrics(file_bytes, filename, args, read, tabulate):
    specs = args.get("uaMetrics")
    if not isinstance(specs, list) or not specs or len(specs) > 700:
        raise ValueError("Choose between 1 and 700 declared U&A measures.")
    df, meta = read(file_bytes, filename, usecols=None, overlay=args.get("overlay"), layout=args.get("layout"), selected_sheet=args.get("selectedSheet"), header_rows_skipped=args.get("headerRowsSkipped"))
    if args.get("filters"):
        raise ValueError("U&A segments must be combined into the declared eligibility conditions, not label filters.")
    measures = []
    first = None
    base_cache = {}
    engine_calls = 0
    for spec in specs:
        if spec.get("kind") not in ("percent", "mean", "sum", "verbatim"):
            raise ValueError("U&A supports percentages, answered-value means and declared weighted totals.")
        assigned, eligible, values = prepare_measure(df, spec)
        weight = spec.get("weightVar", args.get("weightVar"))
        if weight and weight not in df:
            raise ValueError(f"Weight {weight} is not in this file.")
        if weight:
            w = pd.to_numeric(df[weight], errors="coerce").to_numpy(float)
            if not (np.isfinite(w) & (w > 0)).all():
                raise ValueError("The U&A weight has missing, non-finite or nonpositive values. Correct it first.")
        temporary = "__ua_measure__"
        if temporary in df:
            raise ValueError("A reserved U&A calculation name already exists in the data.")
        work = df.copy(deep=False).assign(**{temporary: values})
        work_meta = copy.deepcopy(meta)
        work_meta.column_names_to_labels = {**(meta.column_names_to_labels or {}), temporary: spec.get("label") or spec["id"]}
        work_meta.variable_value_labels = {**(meta.variable_value_labels or {}), temporary: {0: "Not selected", 1: "Selected"} if spec["kind"] in ("percent", "verbatim") else {}}
        request = {"columnVars": [], "rowItems": [{"key": temporary, "label": spec.get("label") or spec["id"], "vars": [temporary]}], "weightVar": weight, "excludeDk": False, "correction": "none", "typeOverrides": {temporary: "categorical" if spec["kind"] in ("percent", "verbatim") else "continuous"}}
        if args.get("design"):
            request["design"] = args["design"]
        # A temporary column represents eligibility and response state only. Ordinary Cross tab
        # percentages, means, exact bases and small-base suppression remain authoritative.
        result = tabulate(file_bytes, filename, request, _loaded=(work, work_meta))
        engine_calls += 1
        if first is None:
            first = result
        rows = result["questions"][0]["rows"] if result.get("questions") else []
        row = next((r for r in rows if not r.get("isBase") and (str(r.get("rawCode")) == "1" if spec["kind"] in ("percent", "verbatim") else r.get("isMean"))), None)
        total = row["total"] if row else None
        exact = total.get("base", {}).get("exact") if total else None
        value = total.get("pctExact") if total else None
        numerator = total.get("countExact") if total and spec["kind"] in ("percent", "verbatim") else (value * exact["w"] if value is not None and exact else None)
        # The base-only requests use the same engine base_stats, including its weight contract.
        bases = []
        for mask in [assigned, eligible]:
            base_key = (weight, mask.tobytes())
            if base_key not in base_cache:
                base_frame = work.assign(**{temporary: np.where(mask, 1.0, np.nan)})
                bresult = tabulate(file_bytes, filename, request, _loaded=(base_frame, work_meta))
                engine_calls += 1
                br = next((r for q in bresult.get("questions", []) for r in q["rows"] if not r.get("isBase")), None)
                base_cache[base_key] = br["total"]["base"].get("exact") if br else {"n": 0, "w": 0.0, "nEff": 0.0}
            bases.append(base_cache[base_key])
        minimum = result.get("notes", {}).get("minBase")
        if minimum is None:
            raise ValueError("The engine did not declare its small-base suppression threshold.")
        if exact and exact["n"] < minimum:
            value = None
            numerator = None
        if spec["kind"] == "sum":
            value = numerator
        quotes = []
        if spec["kind"] == "verbatim" and value is not None:
            positions = np.flatnonzero(np.isfinite(values))
            quotes = [{"row": int(i) + 1, "text": str(df.iloc[i][spec["variable"]])[:2000], "truncated": len(str(df.iloc[i][spec["variable"]])) > 2000} for i in positions[:6]]
            value = exact["n"] if exact else None
        measures.append({"id": spec["id"], "value": value, "numerator": numerator, "assignedBase": bases[0], "eligibleBase": bases[1], "validBase": exact or {"n": 0, "w": 0.0, "nEff": 0.0}, "quotes": quotes, "suppressed": total is not None and value is None, "reason": None if value is not None else "No valid answers or the engine small-base rule suppresses this estimate.", "designApplied": bool(result.get("notes", {}).get("designApplied"))})
    first["notes"]["uaCrosstabCalls"] = engine_calls
    first["uaMetrics"] = measures
    return first
