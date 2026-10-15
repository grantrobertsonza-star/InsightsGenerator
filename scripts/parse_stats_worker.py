"""Long-lived worker for the local SPSS/Stata/SAS engine.

Starting Python, importing pandas and reading the data file are each slow, and
the one-shot runner (parse_stats_local.py) pays all three on every call. This
process pays them once: it loads api/parse-stats-file.py a single time, keeps
the last couple of parsed files in memory (see _READ_CACHE there), and answers
requests until its input closes.

Protocol: one JSON object per line on stdin and on stdout.
  request  {"id": 1, "src": "<path to the data file>", "sourceFilename": "x.sav",
            "action": "crosstab", "args": {...}}
  response {"id": 1, "result": {...}}   or   {"id": 1, "error": "message"}
A first line {"ready": true} is written once the engine has loaded. Anything
the engine prints goes to stderr so it cannot corrupt the protocol.
"""
import importlib.util
import json
import os
import sys


def main() -> int:
    real_out = sys.stdout
    sys.stdout = sys.stderr  # stray prints must not reach the protocol stream

    def send(obj) -> None:
        real_out.write(json.dumps(obj) + "\n")
        real_out.flush()

    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, "..", "api", "parse-stats-file.py")
    spec = importlib.util.spec_from_file_location("parse_stats_file", target)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # raises if pyreadstat is missing: the caller then falls back
    import numpy  # noqa: F401  (warm the heavy imports before the first request)
    import pandas  # noqa: F401

    send({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            with open(req["src"], "rb") as f:
                data = f.read()
            name = req.get("sourceFilename", "upload.sav")
            action = req.get("action", "convert")
            args = req.get("args") or {}
            if action == "dictionary":
                result = mod.dictionary(data, name, args)
            elif action == "categories":
                result = mod.categories(data, name, args["variable"], args.get("overlay"), args.get("layout"), args.get("selectedSheet"))
            elif action == "columns":
                result = mod.driver_columns(data, name, args)
            elif action == "crosstab":
                result = mod.crosstab(data, name, args)
            else:
                result = mod.convert(data, name)
            send({"id": req_id, "result": result})
        except Exception as exc:  # noqa: BLE001 - reported to the caller, worker stays up
            send({"id": req_id, "error": str(exc)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
