"""Self-test for the indicator data reader (indicator_observations in api/parse-stats-file.py, batch 54).

Every expected value is read from the fixture files independently (Python's csv module, or a cell
picked by hand from Grant's downloads), never from the reader's own output. Covers every recognised
layout and every refusal. When Grant's full downloads are present (INDICATOR_FULL_FILES, default the
attachment folder of 28 October 2026), the full DHS long and wide files are compared and the 13.6 MB
FinData file is read in a child process with its time and peak memory printed; when they are absent
those checks print NOT RUN, never PASS.

Run:  python3 scripts/indicator_selftest.py   (exit code 0 when all checks pass)
Also run at the end of scripts/crosstab_selftest.py.
"""
import csv
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "..", "api", "parse-stats-file.py")
FIX = os.path.join(HERE, "..", "fixtures", "indicator-data")
FULL = os.environ.get("INDICATOR_FULL_FILES", "/mnt/user-data/attachments/2029d29d-347f-5d3f-9a5d-a57af1db9390")

spec = importlib.util.spec_from_file_location("psf_ind", ENGINE)
psf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(psf)

fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:400]))
    if not ok:
        fails.append(name)


def read(name, data=None):
    if data is None:
        with open(os.path.join(FIX, name), "rb") as f:
            data = f.read()
    return psf.indicator_observations(data, name)


def refused(name, data, *needles):
    try:
        psf.indicator_observations(data, name)
    except ValueError as exc:
        msg = str(exc)
        return all(n in msg for n in needles), msg
    return False, "not refused"


def obs_map(r):
    """{(indicator code or label, breakdown codes, area, period): value as written}."""
    out = {}
    for si, ai, period, value, _st, _note in r["observations"]:
        s = r["series"][si]
        key = (s["indicatorCode"] or s["indicatorLabel"], tuple((b["dimension"], b["code"]) for b in s["breakdowns"]), r["areas"][ai]["code"], period)
        out[key] = value
    return out


def fixture_rows(name):
    with open(os.path.join(FIX, name), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


DIMS = ("FREQ", "SEX", "AGE", "URBANISATION", "COMP_BREAKDOWN_1", "COMP_BREAKDOWN_2", "COMP_BREAKDOWN_3")


def dhs_key(row, period):
    return (row["INDICATOR"], tuple((d, row[d]) for d in DIMS), row["REF_AREA"], period)


# --- Data360 / SDMX long ------------------------------------------------------------------------------
long_r = read("DHS_SD.csv")
check("DHS long: recognised as Data360 / SDMX long", long_r["layout"] == "sdmx_long", long_r["layout"])
check("DHS long: reader named", long_r["reader"] == psf.INDICATOR_READER)
lm = obs_map(long_r)
zaf = ("RH_ANCC_W_IRN", (("FREQ", "A"), ("SEX", "F"), ("AGE", "_T"), ("URBANISATION", "_Z"), ("COMP_BREAKDOWN_1", "ANCC_IRN_03"), ("COMP_BREAKDOWN_2", "_Z"), ("COMP_BREAKDOWN_3", "_Z")), "ZAF", "2016")
check("DHS long: ZAF RH_ANCC_W_IRN 2016 ANCC_IRN_03 = 89.8 (hand-picked cell)", lm.get(zaf) == "89.8", lm.get(zaf))
rows = fixture_rows("DHS_SD.csv")
expected = {dhs_key(r, r["TIME_PERIOD"]): r["OBS_VALUE"] for r in rows if r["OBS_VALUE"].strip()}
check("DHS long: every observation equals its file row read with the csv module", lm == expected, f"{len(lm)} vs {len(expected)}")
dims = [d["column"] for d in long_r["provenance"]["dimensions"]]
check("DHS long: breakdown dimensions are the generic code columns, FREQ first; bookkeeping and attributes are not", dims == list(DIMS), dims)
s0 = next(s for s in long_r["series"] if s["breakdowns"][4]["code"] == "ANCC_IRN_03")
check("DHS long: breakdown code and label kept", s0["breakdowns"][4] == {"dimension": "COMP_BREAKDOWN_1", "code": "ANCC_IRN_03", "label": "Timelapse: Three years preceding the survey"}, s0["breakdowns"][4])
check("DHS long: one unit per series, code and label", (s0["unitCode"], s0["unitLabel"], s0["unitMult"]) == ("PT_W_SUB", "Percentage of women in the same subgroup", 0), (s0["unitCode"], s0["unitLabel"], s0["unitMult"]))
check("DHS long: indicator label kept", s0["indicatorLabel"].startswith("Percentage of women with a live birth"))
areas = {a["code"]: a["label"] for a in long_r["areas"]}
check("DHS long: area codes with labels", areas.get("ZAF") == "South Africa" and areas.get("COG") == "Congo, Rep.", areas)
check("DHS long: status codes with labels", long_r["provenance"]["statuses"] == {"A": "Normal value"}, long_r["provenance"]["statuses"])
check("DHS long: source named", long_r["provenance"]["sources"] == [{"code": "DHS_SD", "label": "Survey Based Indicators"}], long_r["provenance"]["sources"])
zrow = next(o for o in long_r["observations"] if long_r["areas"][o[1]]["code"] == "ZAF" and o[2] == "2016" and long_r["series"][o[0]] is s0)
check("DHS long: observation status and note (COMMENT_OBS) kept", zrow[4:] == ["A", "DHS, 2016"], zrow)

# --- Data360 wide -------------------------------------------------------------------------------------
wide_r = read("DHS_SD_WIDEF.csv")
check("DHS wide: recognised as Data360 wide", wide_r["layout"] == "data360_wide", wide_r["layout"])
wm = obs_map(wide_r)
cog = ("RH_ANCC_W_IRN", zaf[1], "COG", "2011")
check("DHS wide: COG RH_ANCC_W_IRN 2011 ANCC_IRN_03 = 84.4 (hand-picked cell)", wm.get(cog) == "84.4", wm.get(cog))
check("DHS wide: a blank year cell is an absent observation, never zero", ("RH_ANCC_W_IRN", zaf[1], "COG", "2010") not in wm)
wrows = fixture_rows("DHS_SD_WIDEF.csv")
wexp = {dhs_key(r, y): r[y] for r in wrows for y in r if y.isdigit() and len(y) == 4 and r[y].strip()}
check("DHS wide: every non-blank year cell, read with the csv module, is one observation", wm == wexp, f"{len(wm)} vs {len(wexp)}")
check("DHS long and wide fixtures give identical observations", lm == wm, set(lm) ^ set(wm))
check("DHS long and wide: identical series and areas", [s["key"] for s in long_r["series"]] == [s["key"] for s in wide_r["series"]] and long_r["areas"] == wide_r["areas"])

# --- FinData wide slice -------------------------------------------------------------------------------
fin = read("WB_FINDATA_WIDEF.csv")
fm = obs_map(fin)
usa = ("FD_FDI_OVRL", (("FREQ", "A"), ("EV_CRITERIA", "_T"), ("SEGMENT", "FM")), "USA", "2006")
check("FinData: USA FD_FDI_OVRL overall, Financial Markets, 2006 = 71.9801025390625 (hand-picked cell)", fm.get(usa) == "71.9801025390625", fm.get(usa))
check("FinData: other dimension columns (EV_CRITERIA, SEGMENT) read generically", [d["column"] for d in fin["provenance"]["dimensions"]] == ["FREQ", "EV_CRITERIA", "SEGMENT"])
frows = fixture_rows("WB_FINDATA_WIDEF.csv")
fexp = {(r["INDICATOR"], (("FREQ", r["FREQ"]), ("EV_CRITERIA", r["EV_CRITERIA"]), ("SEGMENT", r["SEGMENT"])), r["REF_AREA"], y): r[y] for r in frows for y in r if y.isdigit() and r[y].strip()}
check("FinData: observations equal the non-blank cells; the blank 'Missing value' rows add none and are not duplicates", fm == fexp, f"{len(fm)} vs {len(fexp)}")
check("FinData: an exponent spelling is kept as written", all(v == fexp[k] for k, v in fm.items()))
check("FinData: statuses include the missing-value code from the blank rows", fin["provenance"]["statuses"].get("O") == "Missing value", fin["provenance"]["statuses"])

# --- WDI wide (synthetic layout fixture) ----------------------------------------------------------------
wdi = read("WDI_layout_synthetic.csv")
wd = obs_map(wdi)
check("WDI: recognised after its Data Source lines", wdi["layout"] == "wdi_wide" and wdi["provenance"]["headerRow"] == 5, (wdi["layout"], wdi["provenance"].get("headerRow")))
check("WDI: values as written", wd.get(("TEST.B", (), "ZAF", "2023")) == "106" and wd.get(("TEST.A.ZS", (), "KEN", "2021")) == "79.2", wd)
check("WDI: '..' and blank are absent", ("TEST.A.ZS", (), "KEN", "2022") not in wd and ("TEST.B", (), "ZAF", "2022") not in wd)
check("WDI: source and update date from the lines above the header", wdi["provenance"]["sources"] == [{"code": None, "label": "World Development Indicators"}] and wdi["provenance"]["lastUpdated"] == "2026-01-28", wdi["provenance"])
check("WDI: unit not stated (it is part of the indicator name), never invented", all(s["unitCode"] is None and s["unitLabel"] is None and s["unitMult"] is None for s in wdi["series"]))
check("WDI: area labels from Country Name", {a["code"]: a["label"] for a in wdi["areas"]} == {"KEN": "Kenya", "ZAF": "South Africa"})

# --- Label and value (Findex) ---------------------------------------------------------------------------
fx = read("findex_ZAF_2024_indicator_percent.csv")
check("Findex: recognised as a label and value table", fx["layout"] == "label_value")
check("Findex: area ZAF and year 2024 from the file name, stated as such", fx["areas"] == [{"code": "ZAF", "label": None}] and fx["provenance"]["areaFrom"] == "file name" and fx["provenance"]["periodFrom"] == "file name", (fx["areas"], fx["provenance"]))
acc = next(s for s in fx["series"] if s["indicatorLabel"] == "Account (%, age 15+)")
acc_obs = next(o for o in fx["observations"] if fx["series"][o[0]] is acc)
check("Findex: Account (%, age 15+) stored as written, 0.811259662052011", acc_obs[3] == "0.811259662052011" and acc_obs[2] == "2024", acc_obs)
check("Findex: values 0 to 1 labelled % are proportions (scale recorded, never rescaled)", acc["valueScale"] == "proportion" and acc["unitCode"] == "%", acc)
check("Findex: base population from the label kept", acc["baseDescription"] == "age 15+", acc["baseDescription"])
net = next(s for s in fx["series"] if "(% internet users, age 15+)" in s["indicatorLabel"])
check("Findex: '(% internet users, age 15+)' base is 'internet users, age 15+'", net["baseDescription"] == "internet users, age 15+", net["baseDescription"])
plain = {r["Indicator name"]: r["Value"] for r in fixture_rows("findex_ZAF_2024_indicator_percent.csv")}
check("Findex: every value equals its row read with the csv module", {fx["series"][o[0]]["indicatorLabel"]: o[3] for o in fx["observations"]} == plain)
bt = read("findex_ZAF_2024_indicator_percent_by_topic.csv")
grp = next(s for s in bt["series"] if s["indicatorLabel"] == "Own a mobile phone (%, age 15+)")
check("Findex by topic: grouping columns kept as groups, not breakdowns", grp["breakdowns"] == [] and grp["groups"] == [{"column": "Topic", "value": "2024"}, {"column": "Sub Topic 1", "value": "Digital connectivity"}, {"column": "Sub Topic 2", "value": "Access"}], grp)
topic_rows = {r["Indicator name"]: r["Value"] for r in fixture_rows("findex_ZAF_2024_indicator_percent_by_topic.csv")}
check("Findex by topic: values as written", {bt["series"][o[0]]["indicatorLabel"]: o[3] for o in bt["observations"]} == topic_rows)
anon = psf.indicator_observations(b"Indicator name,Value\n\"Account (%, age 15+)\",0.81\n", "country summary.csv")
check("Label and value: no area or year in the file name: unknown, stated, not invented", anon["areas"] == [{"code": None, "label": None}] and anon["observations"][0][2] is None and anon["provenance"]["areaFrom"] is None and anon["provenance"]["periodFrom"] is None, anon["areas"])
pct = psf.indicator_observations(b"Indicator name,Value\n\"Account (%, age 15+)\",81.1\n\"Saved (%, age 15+)\",0.5\n", "x_ZAF_2024.csv")
check("Label and value: percent values above 1 are percentages as written (scale percent)", {s["valueScale"] for s in pct["series"]} == {"percent"})
nopct = psf.indicator_observations(b"Indicator name,Value\nMean age,41.2\n", "x_ZAF_2024.csv")
check("Label and value: a label without % has no unit and no scale", nopct["series"][0]["unitCode"] is None and nopct["series"][0]["valueScale"] is None)

# --- IMF data portal wide (slices of Grant's downloads) -----------------------------------------------
il = read("IMF_STA_IL_slice.csv")
check("IMF: recognised as the IMF data portal wide layout", il["layout"] == "imf_wide", il["layout"])
im = obs_map(il)
gbr_m = ("RXF11ORA_REVS", (("UNIT", "USD"), ("FREQUENCY", "M")), "GBR", "1999-M07")
check("IMF IL: GBR.RXF11ORA_REVS.USD.M 1999-M07 = 8543.3092353324 (hand-picked cell)", im.get(gbr_m) == "8543.3092353324", im.get(gbr_m))
check("IMF IL: GBR.RXF11ORA_REVS.USD.Q 1999-Q3 = 8522.092879368 and .A 2015 = 18508.383", im.get(("RXF11ORA_REVS", (("UNIT", "USD"), ("FREQUENCY", "Q")), "GBR", "1999-Q3")) == "8522.092879368" and im.get(("RXF11ORA_REVS", (("UNIT", "USD"), ("FREQUENCY", "A")), "GBR", "2015")) == "18508.383")
check("IMF IL: ZAF.RGV_REVS.FTO.A 2025 = 4.035", im.get(("RGV_REVS", (("UNIT", "FTO"), ("FREQUENCY", "A")), "ZAF", "2025")) == "4.035")
with open(os.path.join(FIX, "IMF_STA_IL_slice.csv"), newline="", encoding="utf-8-sig") as f:
    il_rows = list(csv.DictReader(f))
il_exp = {}
for r in il_rows:
    c, ind, unit, fr = r["SERIES_CODE"].split(".")
    for k, v in r.items():
        if k[:1].isdigit() and v.strip():
            il_exp[(ind, (("UNIT", unit), ("FREQUENCY", fr)), c, k)] = v
check("IMF IL: every non-blank period cell, read with the csv module, is one observation of its series", im == il_exp, f"{len(im)} vs {len(il_exp)}")
ora = {fr: next(x for x in il["series"] if x["indicatorCode"] == "RXF11ORA_REVS" and x["breakdowns"][1]["code"] == fr) for fr in ("M", "Q", "A")}
check("IMF IL: frequency is part of the series: monthly, quarterly and annual are three series, each with its own periods", len({id(v) for v in ora.values()}) == 3 and all(k[3].startswith("1999-M") or k[3][:4].isdigit() for k in im if k[1][1] == ("FREQUENCY", "M")))
check("IMF IL: series identity is the SERIES_CODE parts; the code is kept", ora["M"]["groups"][0] == {"column": "SERIES_CODE", "value": "{COUNTRY}.RXF11ORA_REVS.USD.M"} and ora["M"]["breakdowns"] == [{"dimension": "UNIT", "code": "USD", "label": "US dollar"}, {"dimension": "FREQUENCY", "code": "M", "label": "Monthly"}], ora["M"])
check("IMF IL: UNIT is the unit (code from SERIES_CODE, label from the column) and SCALE Millions the unit multiplier 6", (ora["M"]["unitCode"], ora["M"]["unitLabel"], ora["M"]["unitMult"]) == ("USD", "US dollar", 6), ora["M"])
check("IMF IL: area code from SERIES_CODE, label from COUNTRY", {a["code"]: a["label"] for a in il["areas"]} == {"GBR": "United Kingdom", "ZAF": "South Africa"}, il["areas"])
check("IMF IL: dataset description kept once (source, publisher, licence, citation, update date)", il["provenance"]["dataset"].get("DATASET") == "IMF.STA:IL(13.0.1)" and il["provenance"]["dataset"].get("PUBLISHER") == "International Monetary Fund (IMF)" and il["provenance"]["dataset"].get("LICENSE", "").startswith("© International Monetary Fund") and "SUGGESTED_CITATION" in il["provenance"]["dataset"] and il["provenance"]["dataset"].get("UPDATE_DATE", "").startswith("2026-10-28"), il["provenance"]["dataset"].keys())
check("IMF IL: source named from the dataset", il["provenance"]["sources"] == [{"code": "IMF.STA:IL(13.0.1)", "label": "International Monetary Fund (IMF)"}], il["provenance"]["sources"])
check("IMF IL: always-blank dimension columns ignored and listed, not breakdowns", "SECTOR" in il["provenance"]["ignoredColumns"] and all(b["dimension"] != "SECTOR" for s in il["series"] for b in s["breakdowns"]))
check("IMF IL: blank cells are absent, never zero", ("RXF11ORA_REVS", (("UNIT", "USD"), ("FREQUENCY", "M")), "GBR", "1999-M06") not in im)
wp = read("IMF_STA_WPAIAX_slice.csv")
wpm = obs_map(wp)
check("IMF WPAIAX: ZAF._T.SHARE_EMERG_AI_PCT.M 2026-M04 = 0.920160711 (hand-picked cell)", wpm.get(("SHARE_EMERG_AI_PCT", (("OCCUPATION", "_T"), ("FREQUENCY", "M")), "ZAF", "2026-M04")) == "0.920160711")
check("IMF WPAIAX: GBR._T.POSTINGS_ENGLISH.A 2025 = 99.76; a written 0 stays a value", wpm.get(("POSTINGS_ENGLISH", (("OCCUPATION", "_T"), ("FREQUENCY", "A")), "GBR", "2025")) == "99.76" and wpm.get(("SHARE_EMERG_AI_PCT_LOW", (("OCCUPATION", "_T"), ("FREQUENCY", "M")), "ZAF", "2023-M01")) == "0")
check("IMF WPAIAX: other dimension columns (OCCUPATION) read generically; no UNIT or SCALE column: not stated", all(s["breakdowns"][0]["dimension"] == "OCCUPATION" and s["unitCode"] is None and s["unitMult"] is None for s in wp["series"]))

with open(os.path.join(FIX, "IMF_STA_IL_slice.csv"), "rb") as f:
    il_bytes = f.read()
il_text = il_bytes.decode("utf-8-sig")
il_head = next(csv.reader(io.StringIO(il_text)))


def il_edit(fn):
    rows = list(csv.reader(io.StringIO(il_text)))
    fn(rows)
    out = io.StringIO()
    csv.writer(out, lineterminator="\n").writerows(rows)
    return out.getvalue().encode("utf-8")


def set_il(row_index, col, value):
    def fn(rows):
        rows[row_index][il_head.index(col)] = value
    return fn


annual_row = next(i for i, r in enumerate(list(csv.reader(io.StringIO(il_text)))) if r[1] == "GBR.RXF11ORA_REVS.USD.A")
ok, msg = refused("IMF_IL.csv", il_edit(set_il(annual_row, "1999-M07", "1.5")), "column 1999-M07", "not a annual period", "GBR.RXF11ORA_REVS.USD.A")
check("IMF: a value in a period column of another frequency is refused, never moved", ok, msg)
ok, msg = refused("IMF_IL.csv", il_edit(set_il(1, "SCALE", "Lakhs")), "'Lakhs'", "not one of")
check("IMF: an unknown SCALE is refused naming it", ok, msg)
ok, msg = refused("IMF_IL.csv", il_edit(set_il(1, "FREQUENCY", "Weekly")), "'Weekly'")
check("IMF: an unknown FREQUENCY is refused naming it", ok, msg)
ok, msg = refused("IMF_IL.csv", il_edit(set_il(1, "COUNTRY", "Britain")), "COUNTRY", "do not always go together")
check("IMF: a SERIES_CODE part with two labels is refused (codes and labels cannot be matched)", ok, msg)
ok, msg = refused("IMF_IL.csv", il_edit(set_il(1, "SERIES_CODE", "GBR.RXF11ORA_REVS.USD")), "SERIES_CODE values have 3 or 4 parts")
check("IMF: SERIES_CODE parts that do not line up with the dimension columns are refused", ok, msg)

# --- OECD Data Explorer SDMX-CSV (slices of Grant's downloads) -----------------------------------------
oe = read("OECD_FDI_INC_AGGR_filtered_slice.csv")
check("OECD: recognised as OECD SDMX-CSV", oe["layout"] == "oecd_sdmx", oe["layout"])
om = obs_map(oe)
with open(os.path.join(FIX, "OECD_FDI_INC_AGGR_filtered_slice.csv"), newline="", encoding="utf-8") as f:
    oecd_rows = list(csv.DictReader(f))
ODIMS = ["FREQ", "UNIT_MEASURE", "MEASURE_PRINCIPLE", "ACCOUNTING_ENTRY", "TYPE_ENTITY", "FDI_COMP", "SECTOR", "COUNTERPART_AREA", "LEVEL_COUNTERPART", "ACTIVITY", "FDI_COLLECTION_ID", "CURRENCY"]
check("OECD: breakdowns are every dimension code column, UNIT_MEASURE and CURRENCY among them; attributes are not", [d["column"] for d in oe["provenance"]["dimensions"]] == ODIMS, [d["column"] for d in oe["provenance"]["dimensions"]])


def okey(r, period=None):
    return (r["MEASURE"], tuple((d, r[d]) for d in ODIMS), r["REF_AREA"], period or r["TIME_PERIOD"])


oexp = {okey(r): r["OBS_VALUE"] for r in oecd_rows if r["OBS_VALUE"].strip()}
check("OECD: every value equals its row read with the csv module; blank values are absent", om == oexp, f"{len(om)} vs {len(oexp)}")
deu = next(r for r in oecd_rows if r["REF_AREA"] == "DEU" and r["UNIT_MEASURE"] == "USD_EXC" and r["MEASURE_PRINCIPLE"] == "A" and r["ACCOUNTING_ENTRY"] == "D" and r["TYPE_ENTITY"] == "ALL" and r["TIME_PERIOD"] == "2026-Q1")
check("OECD: DEU FDI income total, USD, asset/liability, expenditure, all units, 2026-Q1 = 25492.743445693 (hand-picked cell)", om.get(okey(deu)) == "25492.743445693", om.get(okey(deu)))
nld = next(r for r in oecd_rows if r["REF_AREA"] == "NLD" and r["UNIT_MEASURE"] == "RC" and r["MEASURE_PRINCIPLE"] == "A" and r["ACCOUNTING_ENTRY"] == "C" and r["TYPE_ENTITY"] == "ALL" and r["TIME_PERIOD"] == "2026-Q2")
check("OECD: NLD in reported currency (EUR), revenue, 2026-Q2 = 73820 (hand-picked cell)", om.get(okey(nld)) == "73820", om.get(okey(nld)))
s_rc = [s for s in oe["series"] if any(b["dimension"] == "UNIT_MEASURE" and b["code"] == "RC" for b in s["breakdowns"])]
cur = {b["code"] for s in s_rc for b in s["breakdowns"] if b["dimension"] == "CURRENCY"}
check("OECD: reported currency is split by CURRENCY: each series is one currency, so areas in CHF, EUR and GBP are never one line or one unit", cur == {"CHF", "EUR", "GBP"} and all(len({b["code"] for b in s["breakdowns"] if b["dimension"] == "CURRENCY"}) == 1 for s in s_rc), cur)
eur = next(s for s in s_rc if any(b == {"dimension": "CURRENCY", "code": "EUR", "label": "Euro"} for b in s["breakdowns"]))
check("OECD: labels paired by position (code column, then the column headed in words)", eur["indicatorLabel"] == "FDI income - total" and (eur["unitCode"], eur["unitLabel"], eur["unitMult"]) == ("RC", "Reported currency", 6), eur)
check("OECD: area labels from the 'Reference area' column", {a["code"]: a["label"] for a in oe["areas"]}.get("EST") == "Estonia")
check("OECD: source named from STRUCTURE_ID and STRUCTURE_NAME", oe["provenance"]["sources"] == [{"code": "OECD.DAF.INV:DSD_FDI@DF_FDI_INC_AGGR(1.0)", "label": "FDI income main aggregates, BMD4"}], oe["provenance"]["sources"])
conf = [r for r in oecd_rows if r["CONF_STATUS"] == "C" and not r["OBS_VALUE"].strip()]
check("OECD: values withheld as confidential (CONF_STATUS C, no value) are listed as withheld, never zero, never a value", len(conf) == 10 and len(oe["provenance"]["withheld"]) == 10 and all(okey(r) not in om for r in conf) and all(w[1] == "EST" for w in oe["provenance"]["withheld"]), (len(conf), len(oe["provenance"]["withheld"])))
check("OECD: the file's own status labels kept", oe["provenance"]["statuses"] == {"A": "Normal value"}, oe["provenance"]["statuses"])
# The codes-only download: the same file without its label columns.
with open(os.path.join(FIX, "OECD_FDI_INC_AGGR_filtered_slice.csv"), newline="", encoding="utf-8") as f:
    grid_rows = list(csv.reader(f))
keep_cols = [i for i, n in enumerate(grid_rows[0]) if psf._IND_CODE_NAME.match(n)]
buf = io.StringIO()
csv.writer(buf, lineterminator="\n").writerows([[r[i] for i in keep_cols] for r in grid_rows])
codes_only = psf.indicator_observations(buf.getvalue().encode("utf-8"), "OECD_codes.csv")
check("OECD codes only: the same observations, labels unknown (shown as codes)", obs_map(codes_only) == om and codes_only["provenance"]["labelsKnown"] is False and all(a["label"] is None for a in codes_only["areas"]), codes_only["provenance"].get("labelsKnown"))
# OECD reference information (Grant approved, 28 October 2026): read as notes, never as observations.
with open(os.path.join(FIX, "OECD_FDI_INC_AGGR_reference.csv"), "rb") as f:
    ref_bytes = f.read()
ref = psf.indicator_observations(ref_bytes, "OECD_reference.csv")
check("OECD notes: recognised as reference information, no observations", ref["layout"] == "oecd_notes" and ref["series"] == [] and ref["observations"] == [], ref["layout"])
check("OECD notes: the dataflow kept, so notes apply only to data of the same dataflow", ref["provenance"]["dataflow"] == "OECD.DAF.INV:DSD_FDI@DF_FDI_INC_AGGR(1.0)", ref["provenance"]["dataflow"])
with open(os.path.join(FIX, "OECD_FDI_INC_AGGR_reference.csv"), newline="", encoding="utf-8-sig") as f:
    ref_rows = list(csv.reader(f))
ref_head = ref_rows[0]
field_idx = [i for i, n in enumerate(ref_head) if i > ref_head.index("TIME_PERIOD") and psf._IND_CODE_NAME.match(n)]
english_cells = sum(1 for r in ref_rows[1:] for i in field_idx if r[i].startswith('en:"'))
check("OECD notes: one note per English text in the file (counted independently: cells starting en:\")", len(ref["notes"]) == english_cells == 129, (len(ref["notes"]), english_cells))
nld = [n for n in ref["notes"] if n["key"] == {"REF_AREA": "NLD", "MEASURE": "T_D4P_F", "FDI_COLLECTION_ID": "AGGR"} and n["field"] == "DATA_SOURCE"]
check(
    "OECD notes: NLD FDI income total, 2009, data source: the break in series between 2008 and 2009 (hand-picked), English only",
    len(nld) == 1 and nld[0]["period"] == "2009" and nld[0]["text"].startswith("Note from the Central Bank of Netherlands: There is a \u2018break in series\u2019 between 2008 and 2009 (FDI flows and income)") and "Banque" not in nld[0]["text"] and nld[0]["fieldLabel"] == "Data source" and nld[0]["keyLabels"].get("REF_AREA") == "Netherlands",
    nld,
)
anyarea = [n for n in ref["notes"] if n["key"] == {"MEASURE": "T_D4P_F"}]
check("OECD notes: a note with '~' for the area names only MEASURE, so it applies to every area", len(anyarea) == 1 and anyarea[0]["field"] == "STAT_CONC_DEF" and anyarea[0]["text"].startswith("FDI financial") and anyarea[0]["period"] is None, anyarea)
quoted = [n for n in ref["notes"] if n["key"] == {"TYPE_ENTITY": "ALL"}]
check("OECD notes: escaped quotation marks inside a text are read as quotation marks", len(quoted) == 1 and '"How multinational enterprises channel investments through multiple countries"' in quoted[0]["text"] and "fr:" not in quoted[0]["text"], quoted[0]["text"][-200:] if quoted else None)
other = ref_bytes.replace(b"OECD.DAF.INV:DSD_FDI@DF_FDI_INC_AGGR(1.0)", b"OECD.SDD.NAD:DSD_NAMAIN1@DF_QNA(1.0)")
check("OECD notes of another dataflow are read with that dataflow (they match no FDI data)", psf.indicator_observations(other, "QNA_reference.csv")["provenance"]["dataflow"] == "OECD.SDD.NAD:DSD_NAMAIN1@DF_QNA(1.0)")
oecd_lines = open(os.path.join(FIX, "OECD_FDI_INC_AGGR_filtered_slice.csv"), encoding="utf-8").read().splitlines()
oh = next(csv.reader([oecd_lines[0]]))
bad = next(csv.reader([oecd_lines[1]]))
bad[oh.index("UNIT_MULT")] = "3"
buf = io.StringIO()
csv.writer(buf, lineterminator="\n").writerows([oh, bad] + [next(csv.reader([x])) for x in oecd_lines[2:]])
ok, msg = refused("OECD.csv", buf.getvalue().encode("utf-8"), "more than one unit multiplier")
check("OECD: two unit multipliers in one series are refused", ok, msg)

# --- Other file types -----------------------------------------------------------------------------------
with open(os.path.join(FIX, "DHS_SD.csv"), "rb") as f:
    dhs_bytes = f.read()
tsv = "\n".join("\t".join(r) for r in csv.reader(io.StringIO(dhs_bytes.decode("utf-8")))).encode("utf-8")
check("TSV: the same observations as the CSV", obs_map(psf.indicator_observations(tsv, "DHS_SD.tsv")) == lm)
try:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"
    for i, r in enumerate(csv.reader(io.StringIO(dhs_bytes.decode("utf-8")))):
        if i > 0:
            r = [float(c) if j == 14 else c for j, c in enumerate(r)]  # OBS_VALUE as a number cell
        ws.append(r)
    wb.create_sheet("Notes").append(["Downloaded from Data360"])
    buf = io.BytesIO()
    wb.save(buf)
    xr = psf.indicator_observations(buf.getvalue(), "DHS_SD.xlsx")
    xm = obs_map(xr)
    # A number cell has no written spelling: 71.0 in the CSV is the number 71 in the workbook.
    check("Excel: number cells give the same observations and numbers as the CSV text", set(xm) == set(lm) and all(float(xm[k]) == float(lm[k]) for k in lm) and xr["provenance"]["sheet"] == "Data", xr["provenance"].get("sheet"))
    wb.copy_worksheet(ws).title = "Copy"
    buf2 = io.BytesIO()
    wb.save(buf2)
    ok, msg = refused("DHS_SD.xlsx", buf2.getvalue(), "'Data'", "'Copy'", "choosing one is not supported")
    check("Excel: two sheets of indicator data are refused by name, not chosen", ok, msg)
except ImportError:
    print("NOT RUN Excel checks: openpyxl is not installed")

# --- Refusals ------------------------------------------------------------------------------------------
with open(os.path.join(FIX, "DHS_SD_DATADICT.csv"), "rb") as f:
    ok, msg = refused("DHS_SD_DATADICT.csv", f.read(), "not in a recognised indicator layout", "'VARIABLE_ID'", "Data360 / SDMX long")
check("A data dictionary is refused, naming its columns and the layouts that are read", ok, msg)
ok, msg = refused("survey.csv", b"respondent_id,age,q1\n1,34,2\n2,51,1\n", "not in a recognised indicator layout", "'respondent_id'")
check("A respondent file is refused, never read as indicator data", ok, msg)

long_lines = dhs_bytes.decode("utf-8").splitlines()
header = next(csv.reader([long_lines[0]]))


def long_with(edit_row=None, extra=None, header_edit=None):
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n")
    h = list(header)
    if header_edit:
        h = header_edit(h)
    w.writerow(h)
    for i, r in enumerate(csv.reader(long_lines[1:])):
        if header_edit:
            r = header_edit(r, row=True)
        if edit_row and i == 0:
            r = edit_row(list(r))
        w.writerow(r)
    if extra:
        w.writerow(extra)
    return out.getvalue().encode("utf-8")


def set_col(col, value):
    def edit(r):
        r[header.index(col)] = value
        return r
    return edit


ok, msg = refused("DHS_SD.csv", long_with(set_col("UNIT_MEASURE", "NUMBER")), "more than one unit", "RH_ANCC_W_IRN", "COMP_BREAKDOWN_1=", "NUMBER", "PT_W_SUB")
check("A series with two units is refused, naming the series and both units", ok, msg)
ok, msg = refused("DHS_SD.csv", long_with(set_col("UNIT_MULT", "3")), "more than one unit multiplier", "RH_ANCC_W_IRN")
check("A series with two unit multipliers is refused, naming the series", ok, msg)
first = next(csv.reader(long_lines[1:2]))
dup = list(first)
dup[header.index("OBS_VALUE")] = "12.5"
ok, msg = refused("DHS_SD.csv", long_with(extra=dup), "second value for the same indicator", "12.5")
check("Two values for one series, area and period are refused, never one chosen", ok, msg)
ok, msg = refused("DHS_SD.csv", long_with(set_col("OBS_VALUE", "1,234")), "'1,234'", "not a plain number", "Line 2")
check("A value that is not a plain number is refused with its line", ok, msg)
ok, msg = refused("DHS_SD.csv", long_with(set_col("TIME_PERIOD", "FY2015")), "'FY2015'", "not a year")
check("A period that is not a year (or year with quarter or month) is refused", ok, msg)
blank_long = long_with(set_col("OBS_VALUE", ""))
blank_r = psf.indicator_observations(blank_long, "DHS_SD.csv")
check("A blank OBS_VALUE is an absent observation (one fewer, counted), never zero", len(blank_r["observations"]) == len(lm) - 1 and blank_r["provenance"]["absentCells"] == 1, (len(blank_r["observations"]), blank_r["provenance"]["absentCells"]))


def drop(col):
    def edit(r, row=False):
        i = header.index(col)
        return r[:i] + r[i + 1:]
    return edit


ok, msg = refused("DHS_SD.csv", long_with(header_edit=drop("UNIT_MEASURE")), "no UNIT_MEASURE column")
check("A Data360 file without UNIT_MEASURE is refused naming it", ok, msg)
ok, msg = refused("sdmx.csv", b"STRUCTURE,REF_AREA,SUBJECT,TIME_PERIOD,OBS_VALUE\nx,ZAF,GDP,2020,1.5\n", "neither an INDICATOR column", "nor a MEASURE column")
check("An SDMX file with neither INDICATOR nor MEASURE is refused by name", ok, msg)
ok, msg = refused("both.csv", b"FREQ,REF_AREA,INDICATOR,UNIT_MEASURE,TIME_PERIOD,OBS_VALUE,2020\nA,ZAF,X,PT,2020,1,2\n", "both TIME_PERIOD/OBS_VALUE columns and year columns")
check("A file with both long and wide value columns is refused", ok, msg)
ok, msg = refused("labels.csv", b"FREQ,REF_AREA,Reference area,INDICATOR,UNIT_MEASURE,TIME_PERIOD,OBS_VALUE\nA,ZAF,South Africa,X,PT,2020,1\n", "'Reference area'", "neither a Data360 column")
check("An unexplained column (OECD-style label column) is refused, not read as a breakdown", ok, msg)
ok, msg = refused("x_ZAF_2024.csv", b"Indicator name,Value\nAccount (%),0.8\nAccount (%),0.7\n", "'Account (%)'", "line 2", "line 3")
check("A label and value table naming one indicator twice is refused", ok, msg)
ok, msg = refused("blank.csv", b"FREQ,REF_AREA,INDICATOR,UNIT_MEASURE,2020,2021\nA,ZAF,X,PT,,\n", "every value cell is blank")
check("A recognised file with no values is refused (nothing to read), not stored empty", ok, msg)
ok, msg = refused("DHS_SD.sav", b"x", "CSV, TSV, delimited text (.txt) and Excel")
check("A non-table file type is refused", ok, msg)
wide_dup = (
    b"FREQ,REF_AREA,INDICATOR,UNIT_MEASURE,OBS_STATUS,2020,2021\n"
    b"A,ZAF,X,PT,A,1.5,\n"
    b"A,ZAF,X,PT,E,1.6,2.0\n"
)
ok, msg = refused("dup.csv", wide_dup, "second value", "1.5", "1.6")
check("Wide: two rows giving a value for the same cell are refused", ok, msg)
ok, msg = refused("wdi.csv", b"Country Name,Country Code,Indicator Name,Indicator Code,2020,Notes\nSouth Africa,ZAF,X,X.1,1,n\n", "'Notes'", "not a year")
check("WDI: a column after the four names that is not a year is refused", ok, msg)
limits = dict(psf.IMPORT_LIMITS)
n_values = len(lm)
try:
    # Indicator data counts values, not rows (Grant, 28 October 2026): the case limit does not apply.
    psf.IMPORT_LIMITS["maxCases"] = 5
    check("The case (row) limit does not apply to indicator data", len(psf.indicator_observations(dhs_bytes, "DHS_SD.csv")["observations"]) == n_values)
    psf.IMPORT_LIMITS["maxIndicatorValues"] = n_values
    check("A file with exactly the values limit is read", len(psf.indicator_observations(dhs_bytes, "DHS_SD.csv")["observations"]) == n_values)
    psf.IMPORT_LIMITS["maxIndicatorValues"] = n_values - 1
    ok, msg = refused("DHS_SD.csv", dhs_bytes, "values for indicator data", "nothing was read")
    check("One value over the values limit is refused, naming the limit", ok and f"{limits['maxIndicatorValues']:,}" in msg, msg)
    psf.IMPORT_LIMITS["maxIndicatorValues"] = n_values - 1
    ok, msg = refused("DHS_SD_WIDEF.csv", open(os.path.join(FIX, "DHS_SD_WIDEF.csv"), "rb").read(), "values for indicator data")
    check("The values limit counts values in the wide layout too (blank cells are not values)", ok, msg)
    psf.IMPORT_LIMITS["maxIndicatorValues"] = 10**9
    psf.IMPORT_LIMITS["maxFileBytes"] = len(dhs_bytes) - 1
    ok, msg = refused("DHS_SD.csv", dhs_bytes, "MB limit")
    check("The byte limit still applies to indicator data", ok, msg)
finally:
    psf.IMPORT_LIMITS.update(limits)
check("The shared limits file names a values limit for indicator data", isinstance(limits.get("maxIndicatorValues"), int) and limits["maxIndicatorValues"] > 0, limits)

# --- Full downloads (Grant's files), when present -------------------------------------------------------
full_long = os.path.join(FULL, "4d6745cb-DHS_SD.csv")
full_wide = os.path.join(FULL, "d7110d2d-DHS_SD_WIDEF.csv")
full_fin = os.path.join(FULL, "a3a07561-WB_FINDATA_WIDEF.csv")
if os.path.exists(full_long) and os.path.exists(full_wide):
    with open(full_long, "rb") as f:
        fl = psf.indicator_observations(f.read(), "DHS_SD.csv")
    with open(full_wide, "rb") as f:
        fw = psf.indicator_observations(f.read(), "DHS_SD_WIDEF.csv")
    check("Full DHS: long and wide downloads give identical observations (607 each)", obs_map(fl) == obs_map(fw) and len(fl["observations"]) == 607, (len(fl["observations"]), len(fw["observations"])))
    check("Full DHS: ZAF 2016 ANCC_IRN_03 = 89.8 and COG 2011 = 84.4", obs_map(fl).get(zaf) == "89.8" and obs_map(fw).get(cog) == "84.4")
else:
    print(f"NOT RUN full DHS long and wide comparison: files not found under {FULL}")
if os.path.exists(full_fin):
    with open(full_fin, newline="", encoding="utf-8") as f:
        frs = list(csv.DictReader(f))
    expected_cells = sum(1 for r in frs for y, v in r.items() if y.isdigit() and v.strip())
    probe = (
        "import importlib.util, json, resource, sys, time\n"
        f"spec = importlib.util.spec_from_file_location('p', {ENGINE!r}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        f"data = open({full_fin!r}, 'rb').read(); t = time.perf_counter()\n"
        "r = m.indicator_observations(data, 'WB_FINDATA_WIDEF.csv'); el = time.perf_counter() - t\n"
        "o = [x for x in r['observations'] if r['areas'][x[1]]['code'] == 'USA' and r['series'][x[0]]['indicatorCode'] == 'FD_FDI_OVRL' and [b['code'] for b in r['series'][x[0]]['breakdowns']] == ['A', '_T', 'FM'] and x[2] == '2006']\n"
        "print(json.dumps({'seconds': round(el, 2), 'peakMB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, 'bytes': len(data), 'rows': r['provenance']['dataRows'], 'observations': len(r['observations']), 'series': len(r['series']), 'areas': len(r['areas']), 'answerMB': round(len(json.dumps(r)) / 1e6, 1), 'usa2006': o[0][3] if o else None}))\n"
    )
    run = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    if run.returncode != 0:
        check("Full FinData (13.6 MB) read", False, run.stderr[-400:])
    else:
        m = json.loads(run.stdout.strip().splitlines()[-1])
        print(f"MEASURED full FinData: {m}")
        check("Full FinData: read within the import limits (bytes and rows)", m["bytes"] <= psf.IMPORT_LIMITS["maxFileBytes"] and m["rows"] <= psf.IMPORT_LIMITS["maxCases"], m)
        check("Full FinData: one observation per non-blank year cell (counted with the csv module)", m["observations"] == expected_cells, (m["observations"], expected_cells))
        check("Full FinData: 229 areas and USA FD_FDI_OVRL overall FM 2006 = 71.9801025390625", m["areas"] == 229 and m["usa2006"] == "71.9801025390625", m)
else:
    print(f"NOT RUN full FinData measurement: file not found under {FULL}")

full_imf_small = os.path.join(FULL, "87ea45d8-dataset_2026-10-28T09_57_26.638861416Z_DEFAULT_INTEGRATION_IMF.STA_WPAIAX_2.0.0.csv")
full_imf_big = os.environ.get("INDICATOR_IMF_IL", "/mnt/user-data/uploads/dataset_2026-10-28T09_58_56_037207864Z_DEFAULT_INTEGRATION_IMF_STA_IL_13_0_1.csv")
if os.path.exists(full_fin):
    # Grant, 28 October 2026: the long FinData export (one row per value, 249,113 rows) is read like the
    # wide download. Built here from the wide file in Data360 long column order, read in a child process.
    probe = (
        "import csv, importlib.util, json, os, resource, sys, tempfile, time\n"
        f"spec = importlib.util.spec_from_file_location('p', {ENGINE!r}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        f"src = {full_fin!r}\n"
        "r = csv.reader(open(src, newline='', encoding='utf-8')); h = next(r)\n"
        "years = [i for i, c in enumerate(h) if c.isdigit()]; meta = [i for i, c in enumerate(h) if not c.isdigit()]; pos = [h[i] for i in meta].index('SEGMENT') + 1\n"
        "mh = [h[i] for i in meta]; out = tempfile.NamedTemporaryFile('w', suffix='.csv', delete=False, newline='', encoding='utf-8')\n"
        "w = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator='\\n'); w.writerow(mh[:pos] + ['TIME_PERIOD', 'OBS_VALUE'] + mh[pos:])\n"
        "for row in r:\n    md = [row[i] for i in meta]\n    [w.writerow(md[:pos] + [h[i], row[i]] + md[pos:]) for i in years if row[i] != '']\n"
        "out.close(); data = open(out.name, 'rb').read(); os.remove(out.name); t = time.perf_counter()\n"
        "lr = m.indicator_observations(data, 'WB_FINDATA_LONG.csv'); el = time.perf_counter() - t\n"
        "key = lambda res: sorted((res['series'][o[0]]['key'], res['areas'][o[1]]['code'], o[2], o[3]) for o in res['observations'])\n"
        "same = key(lr) == key(m.indicator_observations(open(src, 'rb').read(), 'WB_FINDATA_WIDEF.csv'))\n"
        "print(json.dumps({'layout': lr['layout'], 'rows': lr['provenance']['dataRows'], 'bytes': len(data), 'values': len(lr['observations']), 'seconds': round(el, 2), 'peakMB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, 'sameAsWide': same}))\n"
    )
    run = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    m = json.loads(run.stdout.strip().splitlines()[-1]) if run.returncode == 0 else {"error": run.stderr[-400:]}
    print(f"MEASURED long FinData (built from the wide download): {m}")
    check("Long FinData (249,113 rows, more than the 100,000-row case limit) is read like the wide download: identical observations", m.get("layout") == "sdmx_long" and m.get("rows") == 249113 and m.get("sameAsWide") is True, m)
else:
    print(f"NOT RUN long FinData check: file not found under {FULL}")
full_oecd = os.path.join(FULL, "2f62dbbd-OECD.DAF.INVDSD_FDIDF_FDI_INC_AGGRfiltered2026-10-28_11-02-51.csv")
full_oecd_ref = os.path.join(FULL, "62fe8d5d-dataflowOECD.DAF.INVDSD_FDIDF_FDI_INC_AGGRcomplete2026-10-28T10_03_05Z.csv")
if os.path.exists(full_oecd) and os.path.exists(full_oecd_ref):
    with open(full_oecd, newline="", encoding="utf-8-sig") as f:
        full_rows = list(csv.DictReader(f))
    with open(full_oecd, "rb") as f:
        fo = psf.indicator_observations(f.read(), "OECD_filtered.csv")
    check("Full OECD filtered download: one observation per row with a value (918), 134 blank, 34 withheld as confidential", len(fo["observations"]) == sum(1 for r in full_rows if r["OBS_VALUE"].strip()) == 918 and len(fo["provenance"]["withheld"]) == 34, (len(fo["observations"]), len(fo["provenance"]["withheld"])))
    with open(full_oecd_ref, "rb") as f:
        full_ref = psf.indicator_observations(f.read(), "OECD_reference.csv")
    check("Full OECD reference information file (79 rows) is read as 129 English notes", full_ref["layout"] == "oecd_notes" and len(full_ref["notes"]) == 129)
else:
    print(f"NOT RUN full OECD files: not found under {FULL}")
if os.path.exists(full_imf_small):
    with open(full_imf_small, "rb") as f:
        fw_imf = psf.indicator_observations(f.read(), "IMF.STA_WPAIAX.csv")
    check("Full IMF WPAIAX (1,601 series codes): read; 13,908 values; 198 areas", len(fw_imf["observations"]) == 13908 and len(fw_imf["areas"]) == 198, (len(fw_imf["observations"]), len(fw_imf["areas"])))
else:
    print(f"NOT RUN full IMF WPAIAX: file not found under {FULL}")
if os.path.exists(full_imf_big):
    probe = (
        "import importlib.util, json, resource, sys, time\n"
        f"spec = importlib.util.spec_from_file_location('p', {ENGINE!r}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        f"data = open({full_imf_big!r}, 'rb').read(); t = time.perf_counter()\n"
        "try:\n    m.indicator_observations(data, 'IMF_STA_IL.csv'); msg = None\nexcept ValueError as e:\n    msg = str(e)\n"
        "print(json.dumps({'seconds': round(time.perf_counter() - t, 2), 'peakMB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, 'bytes': len(data), 'refused': msg}))\n"
    )
    run = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    m = json.loads(run.stdout.strip().splitlines()[-1]) if run.returncode == 0 else {"error": run.stderr[-300:]}
    print(f"MEASURED full IMF IL (90.6 MB, 2,745,880 values): {m}")
    check("Full IMF IL: within the byte limit but over the values limit: refused, naming the limit", m.get("bytes", 10**9) <= psf.IMPORT_LIMITS["maxFileBytes"] and f"{psf.IMPORT_LIMITS['maxIndicatorValues']:,} values" in (m.get("refused") or ""), m)
else:
    print(f"NOT RUN full IMF IL measurement: file not found at {full_imf_big}")

print("\n%d failed" % len(fails) if fails else "\nAll indicator checks passed")
sys.exit(1 if fails else 0)
