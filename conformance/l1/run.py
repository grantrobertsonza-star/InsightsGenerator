"""L1 conformance runner: reads every case in gen.py through the app's real data reader.

Reader functions called (api/parse-stats-file.py, loaded as a module from its file path; no storage,
no network, no signing):
  - read_table(file_bytes, filename, args)   the stored preview of a CSV/TSV/.txt/Excel file, which is
                                             _read_raw, the read every calculation uses
  - _read_raw(file_bytes, filename, None, layout, selected_sheet)
                                             the calculation read: data frame and metadata (labels,
                                             value labels, missing declarations, measure levels)
  - convert(file_bytes, filename)            the stored preview of an SPSS/Stata/SAS file
  - dictionary(file_bytes, filename, args)   only for the weightLike flag of stats cases
  - _check_import_limits(file_bytes)         the shared size rule, for the byte-limit boundary cases
The read cache (_READ_CACHE) is cleared after every case.

Usage: python3 conformance/l1/run.py [--rebuild] [--only PREFIX] [--skip-heavy]
Writes conformance/l1/results.json and prints a summary. Exit code 1 when any case fails.
"""

import argparse
import importlib.util
import json
import math
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FIXTURES = os.path.join(HERE, "fixtures")
ENGINE_PATH = os.path.join(ROOT, "api", "parse-stats-file.py")

sys.dont_write_bytecode = True  # keep the library folder free of __pycache__
sys.path.insert(0, HERE)
import gen  # noqa: E402


def load_engine():
    spec = importlib.util.spec_from_file_location("parse_stats_file_l1", ENGINE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------- comparison helpers


def type_tag(v):
    if v is None:
        return "null"
    if isinstance(v, float) and v != v:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    return type(v).__name__


def plain(v):
    """numpy/pandas scalar to a Python value."""
    if v is None:
        return None
    if type(v).__name__ in ("NaTType", "NAType"):
        return None
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        try:
            v = v.item()
        except (ValueError, TypeError):
            pass
    if isinstance(v, float) and v != v:
        return None
    return v


def same_value(tag, want, got):
    gt = type_tag(got)
    if tag == "null":
        return gt == "null"
    if tag == "num":
        return gt in ("int", "float") and math.isclose(float(got), float(want), rel_tol=1e-12, abs_tol=1e-12)
    if tag != gt:
        return False
    if tag == "float":
        return math.isclose(got, want, rel_tol=1e-12, abs_tol=0.0) or got == want
    return got == want


def show(v, limit=80):
    r = repr(v)
    return r if len(r) <= limit else r[: limit - 3] + "..."


def check_cells(errors, label, rows, cells):
    for row, col, tag, want in cells:
        if row >= len(rows):
            errors.append(f"{label}: row {row} missing (only {len(rows)} rows)")
            continue
        if col not in rows[row]:
            errors.append(f"{label}: column {col!r} missing")
            continue
        got = plain(rows[row][col])
        if not same_value(tag, want, got):
            errors.append(f"{label}[{row}][{col!r}]: expected {tag} {show(want)}, got {type_tag(got)} {show(got)}")


def check_types(errors, rows, types):
    for col, want in types.items():
        vals = [plain(r.get(col)) for r in rows if col in r]
        tags = {type_tag(v) for v in vals} - {"null"}
        if tags and tags != {want}:
            errors.append(f"type of {col!r}: expected all {want}, got {sorted(tags)}")


def summarise_table(out, limit_rows=4):
    if not isinstance(out, dict):
        return show(out)
    s = {k: out.get(k) for k in ("headers", "encoding", "dateColumns", "sheetName", "unsupportedIdentifierColumns", "sheetSelectionLost") if k in out}
    rows = out.get("rows") or []
    s["nrows"] = len(rows)
    s["rows"] = [{k: show(plain(v), 40) for k, v in r.items()} for r in rows[:limit_rows]]
    if isinstance(s.get("headers"), list) and len(s["headers"]) > 12:
        s["headers"] = s["headers"][:12] + [f"... {len(out['headers'])} in all"]
    return s


def refusal_check(errors, label, exc, phrases):
    msg = str(exc).lower()
    for p in phrases:
        if p.lower() not in msg:
            errors.append(f"{label}: refusal message lacks {p!r}: {show(str(exc), 300)}")


# ---------------------------------------------------------------- case kinds


def run_table(eng, case, data):
    exp = case["expect"]
    args = dict(case["args"])
    errors, actual = [], {}
    try:
        out = eng.read_table(data, case["file"], args)
    except Exception as exc:  # noqa: BLE001
        actual["error"] = f"{type(exc).__name__}: {exc}"
        if "refuse" in exp:
            refusal_check(errors, "read_table", exc, exp["refuse"])
        elif not case["question"]:
            errors.append(f"unexpected refusal: {show(actual['error'], 300)}")
        return errors, actual
    actual = summarise_table(out)
    if "refuse" in exp:
        errors.append("expected a refusal, but the file was read")
        return errors, actual
    if "sheetSelectionLost" in exp:
        if out.get("sheetSelectionLost") != exp["sheetSelectionLost"]:
            errors.append(f"sheetSelectionLost: expected {exp['sheetSelectionLost']}, got {out.get('sheetSelectionLost')}")
        return errors, actual
    rows = out.get("rows", [])
    if "headers" in exp and out.get("headers") != exp["headers"]:
        errors.append(f"headers: expected {show(exp['headers'], 200)}, got {show(out.get('headers'), 200)}")
    if "nrows" in exp and len(rows) != exp["nrows"]:
        errors.append(f"rows: expected {exp['nrows']}, got {len(rows)}")
    check_cells(errors, "cell", rows, exp.get("cells", []))
    check_types(errors, rows, exp.get("types", {}))
    if "json_distinct" in exp:
        # The app parses the stored preview as JSON in JavaScript, where every number is a double.
        col = exp["json_distinct"]
        vals = [plain(r.get(col)) for r in rows if plain(r.get(col)) is not None]
        as_js = [float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v for v in vals]
        if len(set(map(repr, as_js))) != len(set(map(repr, vals))):
            errors.append(f"{col!r}: distinct values merge once the preview JSON is read as doubles: {show(vals, 120)} -> {show(as_js, 120)}")
    for key in ("encoding", "sheetName"):
        if key in exp and out.get(key) != exp[key]:
            errors.append(f"{key}: expected {exp[key]!r}, got {out.get(key)!r}")
    for key in ("dateColumns", "unsupportedIdentifierColumns"):
        if key in exp and sorted(out.get(key) or []) != sorted(exp[key]):
            errors.append(f"{key}: expected {exp[key]}, got {out.get(key)}")
    if "var_labels" in exp or "value_labels" in exp:
        layout = args.get("layout") if args.get("layout") == "columns_are_cases" else None
        _df, meta = eng._read_raw(data, case["file"], None, layout, args.get("selectedSheet") or None)
        check_meta(errors, meta, exp)
    return errors, actual


def check_meta(errors, meta, exp):
    labels = meta.column_names_to_labels or {}
    for name, lab in (exp.get("var_labels") or {}).items():
        if labels.get(name) != lab:
            errors.append(f"variable label of {name}: expected {show(lab)}, got {show(labels.get(name))}")
    vls = meta.variable_value_labels or {}
    for name, want in (exp.get("value_labels") or {}).items():
        got = vls.get(name) or {}
        got_n = {(float(k) if isinstance(k, (int, float)) else k): v for k, v in got.items()}
        want_n = {(float(k) if isinstance(k, (int, float)) else k): v for k, v in want.items()}
        if got_n != want_n:
            errors.append(f"value labels of {name}: expected {show(want_n, 200)}, got {show(got_n, 200)}")
    if "missing_ranges" in exp:
        mr = getattr(meta, "missing_ranges", None) or {}
        for name, want in exp["missing_ranges"].items():
            got = {(plain(d.get("lo")), plain(d.get("hi"))) for d in (mr.get(name) or [])}
            if got != set(want):
                errors.append(f"declared missing of {name}: expected {sorted(want, key=str)}, got {sorted(got, key=str)}")
    if "measure" in exp:
        vm = getattr(meta, "variable_measure", None) or {}
        for name, want in exp["measure"].items():
            if vm.get(name) != want:
                errors.append(f"measure of {name}: expected {want}, got {vm.get(name)}")


def run_stats(eng, case, data):
    exp = case["expect"]
    args = dict(case["args"])
    errors, actual = [], {}
    layout = args.get("layout")
    # calculation read
    try:
        df, meta = eng._read_raw(data, case["file"], None, layout, None)
        rows = [{c: v for c, v in zip(df.columns, rec)} for rec in df.itertuples(index=False, name=None)]
        actual["calc"] = {"names": [str(c) for c in df.columns][:12], "nrows": len(df),
                          "rows": [{k: show(plain(v), 40) for k, v in r.items()} for r in rows[:3]]}
        if "refuse_calc" in exp:
            errors.append("calculation read: expected a refusal, but the file was read")
        else:
            if "names" in exp and [str(c) for c in df.columns] != exp["names"]:
                errors.append(f"names: expected {exp['names']}, got {[str(c) for c in df.columns]}")
            if "nrows" in exp and len(df) != exp["nrows"]:
                errors.append(f"calc rows: expected {exp['nrows']}, got {len(df)}")
            check_cells(errors, "calc", rows, exp.get("calc_cells", []))
            check_meta(errors, meta, exp)
    except Exception as exc:  # noqa: BLE001
        actual["calc_error"] = f"{type(exc).__name__}: {exc}"
        if "refuse_calc" in exp:
            refusal_check(errors, "calc", exc, exp["refuse_calc"])
        elif not case["question"]:
            errors.append(f"calculation read refused unexpectedly: {show(actual['calc_error'], 300)}")
    finally:
        eng._READ_CACHE.clear()
    # preview read (convert takes no layout: the stored preview of a stats file is never flipped)
    if not exp.get("skip_preview") and layout is None:
        try:
            out = eng.convert(data, case["file"])
            prow = out.get("rows", [])
            actual["preview"] = summarise_table(out, 3)
            if "refuse_preview" in exp:
                errors.append("preview: expected a refusal, but the file was read")
            else:
                if "preview_headers" in exp and out.get("headers") != exp["preview_headers"]:
                    errors.append(f"preview headers: expected {show(exp['preview_headers'], 200)}, got {show(out.get('headers'), 200)}")
                if exp.get("preview_unique") and len(set(out.get("headers", []))) != len(out.get("headers", [])):
                    errors.append(f"preview headers not unique: {out.get('headers')}")
                if "nrows" in exp and len(prow) != exp["nrows"]:
                    errors.append(f"preview rows: expected {exp['nrows']}, got {len(prow)}")
                check_cells(errors, "preview", prow, exp.get("preview_cells", []))
        except Exception as exc:  # noqa: BLE001
            actual["preview_error"] = f"{type(exc).__name__}: {exc}"
            if "refuse_preview" in exp:
                refusal_check(errors, "preview", exc, exp["refuse_preview"])
            elif not case["question"]:
                errors.append(f"preview refused unexpectedly: {show(actual['preview_error'], 300)}")
    if "weightLike" in exp:
        try:
            d = eng.dictionary(data, case["file"], {})
            got = {v["name"]: v["weightLike"] for v in d["variables"]}
            for name, want in exp["weightLike"].items():
                if got.get(name) != want:
                    errors.append(f"weightLike of {name}: expected {want}, got {got.get(name)}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"dictionary failed: {exc}")
        finally:
            eng._READ_CACHE.clear()
    return errors, actual


def run_rule(eng, case):
    exp = case["expect"]
    errors, actual = [], {}
    if exp.get("doc_limit"):
        limits = json.load(open(os.path.join(ROOT, "api", "import-limits.json")))
        doc = open(os.path.join(ROOT, "claude", "import-resource-boundary.md"), encoding="utf-8").read()
        stated = f"{limits['maxFileBytes']:,}"
        actual = {"json": limits, "doc_first_line": doc.splitlines()[2] if len(doc.splitlines()) > 2 else doc[:200]}
        if stated not in doc:
            errors.append(f"import-resource-boundary.md does not state {stated} bytes (json limit); it says: {show(actual['doc_first_line'], 200)}")
        return errors, actual
    data = bytes(exp["size"])  # zeros; a refusal must come from the size rule, before parsing
    try:
        via = exp.get("via")
        if via == "read_table":
            eng.read_table(data, case["file"], {})
        elif via == "convert":
            eng.convert(data, case["file"])
        elif via == "_read_raw":
            eng._read_raw(data, case["file"], None, None, None)
        else:
            eng._check_import_limits(data)
        actual["result"] = "allowed"
        if not exp["allowed"]:
            errors.append("expected a size refusal, but the call went on")
    except Exception as exc:  # noqa: BLE001
        actual["result"] = f"{type(exc).__name__}: {exc}"
        if exp["allowed"]:
            errors.append(f"refused at {exp['size']} bytes: {exc}")
        else:
            refusal_check(errors, "size", exc, [exp["phrase"]])
    finally:
        del data
        eng._READ_CACHE.clear()
    return errors, actual


# ---------------------------------------------------------------- main


def build_fixture(case, rebuild):
    path = os.path.join(FIXTURES, case["file"])
    if rebuild or not os.path.exists(path):
        case["build"](path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="regenerate every fixture")
    ap.add_argument("--only", default=None, help="run only cases whose id starts with this")
    ap.add_argument("--skip-heavy", action="store_true", help="skip the 100,000-case limit cases")
    opts = ap.parse_args()
    os.makedirs(FIXTURES, exist_ok=True)
    eng = load_engine()
    results = []
    t0 = time.time()
    for case in gen.CASES:
        if opts.only and not case["id"].startswith(opts.only):
            continue
        if opts.skip_heavy and case.get("heavy"):
            continue
        started = time.time()
        try:
            if case["kind"] == "rule":
                errors, actual = run_rule(eng, case)
            else:
                path = build_fixture(case, opts.rebuild)
                with open(path, "rb") as fh:
                    data = fh.read()
                if case["kind"] == "table":
                    errors, actual = run_table(eng, case, data)
                else:
                    errors, actual = run_stats(eng, case, data)
                if case.get("heavy"):
                    os.unlink(path)  # large limit fixtures are rebuilt on each run, not kept
        except Exception as exc:  # noqa: BLE001 - a harness error is reported as a failure of that case
            errors, actual = [f"harness error: {type(exc).__name__}: {exc}"], {"traceback": traceback.format_exc()[-1500:]}
        finally:
            eng._READ_CACHE.clear()
        if case["question"]:
            status = "question"
        else:
            status = "fail" if errors else "pass"
        results.append({
            "id": case["id"], "status": status, "desc": case["desc"], "clause": case["clause"],
            "file": case["file"], "args": case["args"], "question": case["question"],
            "errors": errors if not case["question"] else [], "actual": actual,
            "seconds": round(time.time() - started, 3),
        })
    counts = {s: sum(1 for r in results if r["status"] == s) for s in ("pass", "fail", "question")}
    with open(os.path.join(HERE, "results.json"), "w", encoding="utf-8") as fh:
        json.dump({"counts": counts, "seconds": round(time.time() - t0, 1), "results": results}, fh, indent=1, ensure_ascii=False, default=str)
    for r in results:
        if r["status"] == "fail":
            print(f"FAIL {r['id']}: {r['desc']}")
            for e in r["errors"]:
                print(f"     {e}")
    print(f"\nL1: {counts['pass']} pass, {counts['fail']} fail, {counts['question']} question "
          f"({len(results)} cases, {time.time() - t0:.1f}s)")
    return 1 if counts["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())
