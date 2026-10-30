"""Independent reference values for the R6 CSM extension figures the pack's reference_results.json does not publish,
written out with pandas from the pack's CSV fixtures (test-reference/*.csv, which validate_pack.py checks equal the
XLSX cell for cell). Nothing here is shared with the app: the rules are written from the pack instructions.

Usage: python3 csm_extension_reference.py <sector dir> <prefix> <wave> [<company code> <task code>]
Prints one JSON object.
"""
import json
import sys

import pandas as pd

d, prefix, wave = sys.argv[1], sys.argv[2], int(sys.argv[3])
company = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "-" else None
task = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] != "-" else None
ref = f"{d}/test-reference"
rel = pd.read_csv(f"{ref}/{prefix}_CSM_Relationship_Wave_{wave}.csv", dtype={"respondent_id": str, "journey_sequence": str})
ch = pd.read_csv(f"{ref}/{prefix}_CSM_Channel_Wave_{wave}.csv", dtype={"respondent_id": str})
nc = pd.read_csv(f"{ref}/{prefix}_CSM_Noncustomer_Wave_{wave}.csv", dtype={"respondent_id": str})


def share(df, col, codes, valid):
    v = df[df[col].isin(valid)]
    w = v["weight"].sum()
    return {"value": float(v.loc[v[col].isin(codes), "weight"].sum() / w * 100) if w > 0 else None, "raw": int(len(v)), "weighted": float(w)}


def mean(df, col, lo, hi):
    v = df[(df[col] >= lo) & (df[col] <= hi)]
    w = v["weight"].sum()
    return {"value": float((v[col] * v["weight"]).sum() / w) if w > 0 else None, "raw": int(len(v)), "weighted": float(w)}


out = {"leading_zero_ids": int(rel["respondent_id"].str.startswith("0").sum())}
r = rel if company is None else rel[rel["company"] == company]
journey = r[r["journey_recent30"] == 1]
if task is not None:
    journey = journey[journey["journey_task"] == task]
out["completion"] = share(journey, "journey_completed", [1], [0, 1])
out["pending"] = share(journey, "journey_status", [9], [1, 2, 3, 9])
out["journey_csat_t2b"] = share(journey, "journey_csat5", [4, 5], [1, 2, 3, 4, 5])
out["contacts_mean"] = mean(journey, "journey_contacts", 1, 10**6)
seq = journey[journey["journey_sequence"].notna()]
paths = seq.groupby("journey_sequence")["weight"].sum().sort_values(ascending=False)
out["paths"] = [{"path": k, "share": float(v / seq["weight"].sum() * 100)} for k, v in paths.head(3).items()]
distinct = seq["journey_sequence"].map(lambda s: len(set(s.split(">"))))
out["distinct"] = {str(k): float(seq.loc[distinct == k, "weight"].sum() / seq["weight"].sum() * 100) for k in sorted(distinct.unique())}
# Benchmark by channel: single-channel journeys in the alternative's channel, comparable, within 30 days, both valid.
bench = journey[(journey["benchmark_recent_same_task30"] == 1) & journey["benchmark_days_ago"].between(0, 30) & journey["benchmark_gap5"].between(-4, 4)]
out["benchmark_by_channel"] = {}
for k in [1, 2, 3, 4]:
    b = bench[(bench["journey_multichannel"] == 0) & (bench[f"journey_channel_c0{k}"] == 1) & (bench["benchmark_channel"] == k)]
    out["benchmark_by_channel"][str(k)] = mean(b, "benchmark_gap5", -4, 4) if len(b) else None
out["benchmark_recorded"] = {"asked": int(journey["benchmark_recent_same_task30"].notna().sum()), "comparable": int((journey["benchmark_recent_same_task30"] == 1).sum())}
# Reasons for staying (all customers of the company filter).
out["stay_primary"] = {str(int(k)): float(v / r["weight"].sum() * 100) for k, v in r.groupby("stay_primary")["weight"].sum().items()}
pref = r[r["stay_reason_r01"] == 1]
out["coexist"] = {f"r0{i}": share(pref, f"stay_reason_r0{i}", [1], [0, 1]) for i in [3, 4, 5]}
# Channel grain: records with any valid emotion, and their distinct customers.
cc = ch if company is None else ch[ch["company"] == company]
anyv = cc[[f"channel_{e}5" for e in ["reassured", "valued", "frustrated", "anxious"]]].apply(lambda s: s.between(1, 5)).any(axis=1)
out["channel_records"] = int(anyv.sum())
out["channel_distinct_customers"] = int(cc.loc[anyv, "respondent_id"].nunique())
out["channel_frustrated_by_channel"] = {str(k): mean(cc[cc["channel"] == k], "channel_frustrated5", 1, 5) for k in [1, 2, 3, 4]}
# Noncustomers: unit weight, the enforced sample.
n = nc[(nc["current_focal_use"] == 0) & (nc["focal_company"] == 1)].assign(weight=1.0)
out["nc_awareness"] = share(n, "focal_awareness", [1], [0, 1])
out["nc_preferred_channel"] = share(n, "expect_preferred_channel", [3], [1, 2, 3, 4])
out["nc_unaware"] = int((n["focal_awareness"] != 1).sum())
out["nc_unaware_with_expectations"] = int(n.loc[n["focal_awareness"] != 1, [f"expect_level_d0{i}" for i in range(1, 7)]].notna().any(axis=1).sum())
print(json.dumps(out))
