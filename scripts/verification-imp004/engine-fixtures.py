"""Read-only IMP-004 engine fixtures. No storage/database requests or file parsing."""
import importlib.util, json, pandas as pd
spec=importlib.util.spec_from_file_location("engine","api/parse-stats-file.py")
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out=[]
def run(name,values,labels,missing=None):
    frame=pd.DataFrame({"q":values})
    meta=m._PlainMeta(value_labels={"q":labels} if labels else {}, variable_measure={"q":"ordinal"},missing_ranges=missing)
    # Controlled decoded-file boundary; dictionary and crosstab implementations remain real.
    m._read=lambda *a,**k:(frame.copy(),meta)
    result=m.crosstab(b"","synthetic.sav",{"columnVars":[],"rowItems":[{"key":"q","label":"q","vars":["q"]}],"typeOverrides":{"q":"categorical"}})
    question=result["questions"][0]
    rows=[r for r in question["rows"] if "rawCode" in r]
    assert not result["skipped"], result["skipped"]
    return rows,question,m.dictionary(b"","synthetic.sav")
labels={i:"Answer "+str(i) for i in range(1,6)}
for label_mode in ("labelled","unlabelled"):
    rows,q,d=run(label_mode,list(range(1,6))*20,labels if label_mode=="labelled" else None)
    assert abs(q["desc"]["mean"]-3)<1e-9
    out.append({"name":label_mode,"bars":[{"label":r["label"],"rawCode":r["rawCode"],"pct":r["pct"][0]} for r in rows],"expectedMean":3,"expectedTop2":40})
rows,q,d=run("zero top",list(range(1,5))*25,labels)
assert len(rows)==5 and next(r for r in rows if r["rawCode"]=="5")["pct"][0]==0
out.append({"name":"zero_top","bars":[{"label":r["label"],"rawCode":r["rawCode"],"pct":r["pct"][0]} for r in rows],"expectedMean":2.5,"expectedTop2":25})
rows,q,d=run("sparse NPS",[0]*40+[10]*60,{i:str(i) for i in range(11)})
assert len(rows)==11 and all(r["pct"][0]==0 for r in rows if r["rawCode"] not in ("0","10"))
# Native reader represents declared-missing observations as NaN. This checks audit metadata,
# not decoding of an actual SAV missing-range definition.
rows,q,d=run("declared missing",[1,2,3,4,5]*20+[float("nan")]*5,labels,{"q":[{"lo":99,"hi":99}]})
assert d["audit"]["dk"]["declaredMissing"]==1
assert q["rows"][0]["count"][0]==100
for k in range(1,13):
    counts=[k,2*k,3*k,4*k,100-10*k] if k<=9 else [10,20,30,40,0]
    values=[code for code,n in enumerate(counts,1) for _ in range(n)]
    rows,q,d=run("generated",values,labels)
    assert sum(r["count"][0] for r in rows)==100
    assert set(r["rawCode"] for r in rows)=={"1","2","3","4","5"}
    expected_mean=sum(values)/len(values)
    assert abs(q["desc"]["mean"]-expected_mean)<0.00051
    out.append({"name":"generated_"+str(k),"bars":[{"label":r["label"],"rawCode":r["rawCode"],"pct":r["pct"][0]} for r in rows],"expectedMean":expected_mean,"expectedTop2":sum(v>=4 for v in values)})
print(json.dumps({"engineCases":17,"summaryFixtures":out}))
