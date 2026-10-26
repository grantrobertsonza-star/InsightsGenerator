"""Long-lived worker for the local SPSS/Stata/SAS engine.

Starting Python, importing pandas and reading the data file are each slow, and
the one-shot runner (parse_stats_local.py) pays all three on every call. This
process pays them once: it loads api/parse-stats-file.py, keeps the last couple
of parsed files in memory (see _READ_CACHE there), and answers requests until its
input closes.

The worker outlives a `next dev` hot reload (parseStatsFile.ts keeps it on
globalThis), so before each request it checks whether the engine or the import
limits it reads at load time (api/import-limits.json) have changed on disk, and
reloads the engine if so. Without this, a long-running dev server kept answering
with the engine and limits it started with: on 2026-10-19 FinScope SA 2024.sav was
still refused at the old 20 MB limit after the limit was raised to 100 MB. A
reload that fails (an engine edited mid-save, say) fails that request with the
reason and is retried on the next one; the older engine is not used for it, since
it no longer matches the code on disk.

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


def _fingerprint(paths):
    """Modification time and size of each file; a missing file counts as its own state."""
    out = []
    for p in paths:
        try:
            st = os.stat(p)
            out.append((st.st_mtime_ns, st.st_size))
        except OSError:
            out.append(None)
    return out


def _load_engine(target):
    """A fresh module object each time, so a reload never mixes old and new definitions
    (or the old in-memory read cache, which was built by the old code)."""
    spec = importlib.util.spec_from_file_location("parse_stats_file", target)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    real_out = sys.stdout
    sys.stdout = sys.stderr  # stray prints must not reach the protocol stream

    def send(obj) -> None:
        real_out.write(json.dumps(obj) + "\n")
        real_out.flush()

    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, "..", "api", "parse-stats-file.py")
    watched = [target, os.path.join(here, "..", "api", "import-limits.json")]
    # This script itself cannot be reloaded in place: a worker started before its dispatch changed
    # kept answering new actions with the old one (2026-10-26: a worker from before batch 26 read a
    # workbook's "table" request as an SPSS "convert" and refused ".xlsx"). When it changes on disk
    # the worker answers {"restart": true} and exits; parseStatsFile.ts starts a fresh worker and
    # sends the request again.
    own = [os.path.abspath(__file__)]
    mod = _load_engine(target)  # raises if pyreadstat is missing: the caller then falls back
    loaded_from = _fingerprint(watched)
    started_from = _fingerprint(own)
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
            if _fingerprint(own) != started_from:
                send({"id": req_id, "restart": True})
                return 0
            current = _fingerprint(watched)
            if current != loaded_from:
                try:
                    mod = _load_engine(target)
                except Exception as exc:  # noqa: BLE001
                    raise RuntimeError(f"The statistics engine changed on disk and could not be reloaded: {exc}") from exc
                loaded_from = current
                print("parse_stats_worker: engine or import limits changed on disk; reloaded", file=sys.stderr)
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
            elif action == "table":
                result = mod.read_table(data, name, args)
            elif action == "convert":
                result = mod.convert(data, name)
            else:
                # An action this worker does not know is refused, never run as another one.
                raise ValueError(f"The statistics worker does not know the action {action!r}. Restart the app to load the current engine.")
            send({"id": req_id, "result": result})
        except Exception as exc:  # noqa: BLE001 - reported to the caller, worker stays up
            send({"id": req_id, "error": str(exc)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
