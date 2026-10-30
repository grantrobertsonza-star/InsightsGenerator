"""Merges conformance/l4/out/*.results.json into conformance/l4/results.json with counts."""
import json, os, glob
HERE = os.path.dirname(os.path.abspath(__file__))
checks = []
extra = {}
for f in sorted(glob.glob(os.path.join(HERE, "out", "*.results.json"))):
    d = json.load(open(f))
    for c in d["checks"]:
        c["runner"] = d["runner"]
        checks.append(c)
    extra[d["runner"]] = d.get("extra", {})
def count(xs):
    return {"checks": len(xs), "pass": sum(c["pass"] for c in xs), "fail": sum(not c["pass"] for c in xs)}
fails = [c for c in checks if not c["pass"]]
summary = {
    "all": count(checks),
    "by_basis": {b: count([c for c in checks if c["basis"] == b]) for b in ("contract", "research")},
    "by_runner": {r: count([c for c in checks if c["runner"] == r]) for r in sorted({c["runner"] for c in checks})},
    "failures_by_severity": {s: sum(1 for c in fails if c.get("severity") == s) for s in ("S1", "S2", "S3")},
    "cases": len({c["case"] for c in checks}),
    "cases_all_pass": len({c["case"] for c in checks} - {c["case"] for c in fails}),
}
json.dump({"summary": summary, "checks": checks, "observations": extra}, open(os.path.join(HERE, "results.json"), "w"), indent=1, default=str)
print(json.dumps(summary, indent=1))
