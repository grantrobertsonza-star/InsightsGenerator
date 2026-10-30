"""Measures the indicator data reader on synthetic Data360 files of increasing size (batch 54, Grant's
decision of 28 October 2026: the indicator limit counts values, set from measurement against the deployed
reader's 2,048 MB and 60 s, vercel.json).

For each size it writes a synthetic Data360 long file (one row per value, FinData's columns and label
columns) and a wide file (one row per series and area, 45 year columns, every cell filled), reads each in
a fresh child process (time and peak resident memory), and writes the reader's answer to
<out>/<name>.json so the save path can be measured on the same answers (indicatorLimitMeasure.db.test.ts).
The values limit is lifted in the measuring child process only; the byte limit still applies, so sizes
past 100 MB are reported as refused.

Run:  python3 scripts/measure_indicator_limits.py <out dir> [long:N | wide:N | N ...]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "..", "api", "parse-stats-file.py")

LONG_HEADER = [
    "STRUCTURE", "STRUCTURE_ID", "ACTION", "FREQ", "REF_AREA", "INDICATOR", "EV_CRITERIA", "UNIT_MEASURE", "SEGMENT",
    "TIME_PERIOD", "OBS_VALUE", "AGG_METHOD", "UNIT_TYPE", "DECIMALS", "DATABASE_ID", "TIME_FORMAT", "UNIT_MULT",
    "OBS_STATUS", "OBS_CONF", "FREQ_LABEL", "REF_AREA_LABEL", "INDICATOR_LABEL", "EV_CRITERIA_LABEL",
    "UNIT_MEASURE_LABEL", "SEGMENT_LABEL", "AGG_METHOD_LABEL", "UNIT_TYPE_LABEL", "DECIMALS_LABEL",
    "DATABASE_ID_LABEL", "TIME_FORMAT_LABEL", "UNIT_MULT_LABEL", "OBS_STATUS_LABEL", "OBS_CONF_LABEL",
]
YEARS = [str(y) for y in range(1980, 2025)]
SEGMENTS = [("FM", "Financial Markets"), ("BK", "Banks"), ("_T", "Overall"), ("NBFI", "Non-Bank Financial Institutions")]
CRITERIA = [("_T", "Overall"), ("EF", "Efficiency"), ("ST", "Stability"), ("DH", "Depth")]


def area(i):
    return f"A{i:04d}", f"Synthetic area {i}"


def series_meta(s):
    seg = SEGMENTS[s % len(SEGMENTS)]
    crit = CRITERIA[(s // len(SEGMENTS)) % len(CRITERIA)]
    ind = f"FD_SYN{s // 16:03d}"
    return ind, crit, seg


def row_prefix(ind, crit, seg, a):
    return ["datastructure", "WB.DEC.IG:DS_FINDI(1.0.0)", "I", "A", a[0], ind, crit[0], "0_TO_100", seg[0]]


def row_attrs():
    return ["MEDIAN", "IX", "1", "WB_FINDATA", "602", "0", "A", "PU"]


def row_labels(ind, crit, seg, a):
    return ["Annual", a[1], f"Synthetic financial development indicator {ind}", crit[1], "0-100 scale", seg[1], "Median", "Index", "One",
            "Financial Development Indicators (FinData)", "CCYY", "Units", "Normal value", "Public"]


def q(cells):
    return ",".join('"' + c + '"' for c in cells) + "\n"


def write_long(path, values):
    areas = 229
    with open(path, "w", encoding="utf-8") as f:
        f.write(q(LONG_HEADER))
        n = 0
        s = 0
        while n < values:
            ind, crit, seg = series_meta(s)
            for ai in range(areas):
                a = area(ai)
                for y in YEARS:
                    if n >= values:
                        break
                    v = f"{(n * 37 % 10000) / 100:.13f}"
                    f.write(q(row_prefix(ind, crit, seg, a) + [y, v] + row_attrs() + row_labels(ind, crit, seg, a)))
                    n += 1
            s += 1


def write_wide(path, values):
    header = [h for h in LONG_HEADER if h not in ("TIME_PERIOD", "OBS_VALUE")] + YEARS
    areas = 229
    with open(path, "w", encoding="utf-8") as f:
        f.write(q(header))
        n = 0
        s = 0
        while n < values:
            ind, crit, seg = series_meta(s)
            for ai in range(areas):
                if n >= values:
                    break
                a = area(ai)
                cells = []
                for _y in YEARS:
                    if n < values:
                        cells.append(f"{(n * 37 % 10000) / 100:.13f}")
                        n += 1
                    else:
                        cells.append("")
                f.write(q(row_prefix(ind, crit, seg, a) + row_attrs() + row_labels(ind, crit, seg, a) + cells))
            s += 1


PROBE = """
import importlib.util, json, os, resource, sys, time
spec = importlib.util.spec_from_file_location('p', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.IMPORT_LIMITS['maxIndicatorValues'] = 10**12  # lifted for the measurement only
data = open(sys.argv[2], 'rb').read(); t = time.perf_counter()
try:
    r = m.indicator_observations(data, os.path.basename(sys.argv[2]))
    el = time.perf_counter() - t
    text = json.dumps(r, allow_nan=False)
    open(sys.argv[3], 'w').write(text)
    out = {'ok': True, 'seconds': round(el, 2), 'values': len(r['observations']), 'answerMB': round(len(text) / 1e6, 1)}
except ValueError as e:
    out = {'ok': False, 'seconds': round(time.perf_counter() - t, 2), 'refused': str(e)[:160]}
out.update(bytesMB=round(len(data) / 1e6, 1), peakMB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024)
print(json.dumps(out))
"""


def main():
    """Sizes as layout:values (long:200000 wide:2000000); a bare number measures both layouts."""
    out = sys.argv[1]
    jobs = []
    for arg in sys.argv[2:] or ["long:100000", "long:200000", "wide:500000", "wide:1000000", "wide:2000000"]:
        layout, _, n = arg.rpartition(":")
        jobs += [(lay, int(n)) for lay in ([layout] if layout else ["long", "wide"])]
    os.makedirs(out, exist_ok=True)
    writers = {"long": write_long, "wide": write_wide}
    for layout, n in jobs:
        src = os.path.join(out, f"synthetic_{layout}_{n}.csv")
        writers[layout](src, n)
        res = subprocess.run([sys.executable, "-c", PROBE, ENGINE, src, os.path.join(out, f"synthetic_{layout}_{n}.json")], capture_output=True, text=True)
        line = res.stdout.strip().splitlines()[-1] if res.returncode == 0 else json.dumps({"ok": False, "error": res.stderr[-300:]})
        print(json.dumps({"layout": layout, "values": n, **json.loads(line)}), flush=True)
        os.remove(src)


if __name__ == "__main__":
    main()
