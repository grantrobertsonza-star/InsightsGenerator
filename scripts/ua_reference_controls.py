import json,sys
import numpy as np
import pandas as pd
# Independent fixture arithmetic. No app code or supplied QA values are imported.
df=pd.read_csv(sys.argv[1]); w=df['weight']
checks={}
def result(label, eligible, valid, value, percent=False):
    weights=w[valid]; num=float((weights*value[valid]).sum()); base=float(weights.sum())
    checks[label]={'eligible':int(eligible.sum()),'valid':int(valid.sum()),'base':base,'kish':float(base**2/(weights**2).sum()),'numerator':num,'value':num/base*(100 if percent else 1)}
user=(df.q06_use_recency==1)&(df.q06_use_recency_state==1)
cols=[f'q09_use_p3m_{i}' for i in range(1,8)]
valid=user & (df[[x+'_state' for x in cols]]==1).all(axis=1) & df[cols].notna().all(axis=1)
result('Consumption named-brand repertoire per recent user',user,valid,df[cols].sum(axis=1))
earlier=(df.q28_previous_exists==1)&(df.q28_previous_exists_state==1)
a=[f'q15_last_brand_{i}' for i in range(1,10)]; b=[f'q28_previous_brand_{i}' for i in range(1,10)]
valid=earlier & (df[[x+'_state' for x in a+b]]==1).all(axis=1) & df[a+b].notna().all(axis=1)
changed=pd.Series((df[a].to_numpy()!=df[b].to_numpy()).any(axis=1),index=df.index).astype(float)
result('Most recent versus previous basket change',earlier,valid,changed,True)
print(json.dumps(checks,allow_nan=False))
