"""Local runner for the SPSS/Stata/SAS conversion, used when the Vercel
Python function (api/parse-stats-file.py) is not being served, e.g. under
plain `next dev`. Reuses that file's convert() so results are identical.

Usage: python scripts/parse_stats_local.py <input> <source_filename> <output.json> [action] [args.json]

action is convert (default), dictionary, categories, columns or crosstab.
"""
import importlib.util
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: parse_stats_local.py <input> <source_filename> <output.json> [action] [args.json]", file=sys.stderr)
        return 2
    src, source_filename, out = sys.argv[1:4]
    action = sys.argv[4] if len(sys.argv) > 4 else "convert"
    args = {}
    if len(sys.argv) > 5:
        with open(sys.argv[5], encoding="utf-8") as f:
            args = json.load(f)
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, "..", "api", "parse-stats-file.py")
    spec = importlib.util.spec_from_file_location("parse_stats_file", target)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # raises ModuleNotFoundError if pyreadstat is missing
    with open(src, "rb") as f:
        data = f.read()
    if action == "dictionary":
        result = mod.dictionary(data, source_filename, args)
    elif action == "categories":
        result = mod.categories(data, source_filename, args["variable"], args.get("overlay"), args.get("layout"), args.get("selectedSheet"))
    elif action == "columns":
        result = mod.driver_columns(data, source_filename, args)
    elif action == "crosstab":
        result = mod.crosstab(data, source_filename, args)
    else:
        result = mod.convert(data, source_filename)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
