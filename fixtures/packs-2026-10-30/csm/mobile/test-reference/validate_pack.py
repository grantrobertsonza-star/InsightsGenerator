from pathlib import Path
import sys,json,datetime
import numpy as np
import openpyxl
P=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
REF=P if (P/'metadata.json').exists() else P/'test-reference';meta=json.loads((REF/'metadata.json').read_text());expected=json.loads((REF/'reference_results.json').read_text());count=0;nr=0;ne=0
DRIVERS={'reliability':['reliable_accurate','reliable_correct'],'responsiveness':['responsive_speed','responsive_updates'],'assurance':['assurance_knowledge','assurance_confidence'],'empathy':['empathy_understood','empathy_respect'],'access_and_clarity':['access_ease','access_clarity']}
for w in [1,2,3]:
 data={}
 for ds,specs,lab in [('Relationship',meta['company_specs'],meta['company_labels']),('Channel',meta['channel_specs'],meta['channel_labels']),('Noncustomer',meta['noncustomer_specs'],meta['noncustomer_labels'])]:
  f=P/f"{meta['prefix']}_CSM_{ds}_Wave_{w}.xlsx";wb=openpyxl.load_workbook(f,read_only=True,data_only=True);it=iter(wb.worksheets[0].values);header=list(next(it));assert header==[x['variable'] for x in specs];rows=[dict(zip(header,r)) for r in it];data[ds]=rows
  allowed={}
  for variable,_,value,_ in lab:allowed.setdefault(variable,set()).add(value)
  for r in rows:
   assert isinstance(r['respondent_id'],str)
   if ds=='Noncustomer': assert r['respondent_id'].startswith('NC')
   else: assert len(r['respondent_id'])==8 and r['respondent_id'].startswith('0')
   assert r['wave']==w and r['weight']>0
   for k,v in allowed.items():assert r[k] is None or r[k] in v,(f.name,k,r[k])
   count+=1
  wb.close()
 rel=data['Relationship'];events=data['Channel'];assert len(rel)==1000;nr+=len(rel);ne+=len(events);lookup={r['respondent_id']:r for r in rel};assert len(lookup)==1000
 keys=set();eids=set()
 for e in events:
  r=lookup[e['respondent_id']];ch=e['channel'];key=(e['respondent_id'],ch);assert key not in keys;keys.add(key);assert e['experience_id'] not in eids;eids.add(e['experience_id'])
  assert 'company_csat5' not in e
  for k in ['wave','company','weight','age','age_band','gender','province','income','settlement','segment','tenure_months']:assert e[k]==r[k],k
  assert r[f'channel_used_c{ch:02}']==1
  delta=(datetime.date.fromisoformat(e['interview_date'])-datetime.date.fromisoformat(e['contact_date'])).days;assert 0<=delta<=30 and delta==e['days_ago']
  assert (e['digital_mode'] is not None)==(ch==3)
  assert e['staff_contact']==int(ch!=3)
  assert (e['wait_minutes'] is not None)==(e['staff_contact']==1)
  assert (e['digital_response_seconds'] is not None)==(ch==3)
  assert e[f"reasons_r{e['primary_reason']:02}"]==1
  assert (e['problem_resolution'] is not None)==(e['problem_present']==1)
  if e['problem_resolution'] in [1,2,3]:assert e['first_contact_resolution']==int(e['problem_resolution']==1 and e['contacts_same_need']==1)
  else:assert e['first_contact_resolution'] is None
  for k in ['transferred','put_on_hold','callback_promised','used_ivr']:assert (e[k] is not None)==(ch==1)
  assert (e['number_transfers'] is not None)==(e['transferred']==1)
  assert (e['callback_outcome'] is not None)==(e['callback_promised']==1)
  for k in ['ivr_csat5','ivr_clarity5']:assert (e[k] is not None)==(e['used_ivr']==1)
  for k in ['agent_introduced','agent_polite','preferred_language_assisted','driver_assurance_knowledge','driver_empathy_understood','driver_empathy_respect']:assert (e[k] is not None)==(e['staff_contact']==1)
  for k in ['branch_tidy5','branch_accessible5']:assert (e[k] is not None)==(ch==2)
  for dim,items in DRIVERS.items():
   vs=[e['driver_'+x] for x in items];valid=[v for v in vs if v is not None and 1<=v<=5];v=e['dimension_'+dim]
   assert (v is None)==(len(valid)<2)
   if v is not None:assert abs(v-sum(valid)/2)<1e-6
 for r in rel:
  for k in ['complaint_resolution','complaint_handling_csat5']+[f'complaint_reason_r{i:02}' for i in range(1,7)]:assert (r[k] is not None)==(r['complaint3m']==1)
  assert r['channel_none']==int(not any(r[f'channel_used_c{i:02}'] for i in range(1,5)))
  for ch in range(1,5):assert ((r['respondent_id'],ch) in keys)==bool(r[f'channel_used_c{ch:02}']);assert (r[f'channel_contacts_c{ch:02}']>0)==bool(r[f'channel_used_c{ch:02}'])

 # Added modules retain one task anchor and an independent noncustomer sample.
 for r in rel:
  picks=[i for i in range(1,7) if r[f'stay_reason_r{i:02}']==1]
  exclusive=r['stay_none']+r['stay_dk']
  assert (bool(picks) and exclusive==0) or (not picks and exclusive==1)
  assert r['stay_primary'] in picks if picks else r['stay_primary']==(97 if r['stay_none'] else 99)
  jfields=[s['variable'] for s in meta['company_specs'] if s['variable'].startswith('journey_') and s['variable']!='journey_recent30']
  bfields=[s['variable'] for s in meta['company_specs'] if s['variable'].startswith('benchmark_')]
  if r['journey_recent30']==0:
   assert all(r[k] is None for k in jfields+bfields)
  else:
   assert r['journey_id']==r['respondent_id']+'-J'
   assert 0<=r['journey_last_days_ago']<=r['journey_start_days_ago']<=30
   seq=[int(x) for x in r['journey_sequence'].split('>')]
   assert len(seq)==r['journey_contacts'] and len(seq)>0
   used=set(seq);assert r['journey_multichannel']==int(len(used)>1)
   for ch in range(1,5):
    assert r[f'journey_channel_c{ch:02}']==int(ch in used)
    assert seq.count(ch)<=r[f'channel_contacts_c{ch:02}']
    if ch in used:assert r[f'channel_used_c{ch:02}']==1
   assert (r['journey_digital_mode'] is not None)==(3 in used)
   assert r['journey_completed']==(None if r['journey_status']==9 else int(r['journey_status']==1))
   if r['benchmark_recent_same_task30']==1:
    assert r['benchmark_provider']!=r['company']
    assert r['benchmark_task']==r['journey_task'] and 0<=r['benchmark_days_ago']<=30
    valid=r['journey_csat5'] in range(1,6) and r['benchmark_csat5'] in range(1,6)
    assert r['benchmark_gap5']==(r['journey_csat5']-r['benchmark_csat5'] if valid else None)
   else:assert all(r[k] is None for k in bfields if k!='benchmark_recent_same_task30')
 nc=data['Noncustomer'];assert len(nc)==500
 assert len({r['respondent_id'] for r in nc})==500
 assert not {r['respondent_id'] for r in nc}&set(lookup)
 for r in nc:
  assert r['focal_company']==1 and r['current_focal_use']==0 and r['company']!=1
  assert 18<=r['age']<=69 and r['weight']==1
  assert (r['focal_consider5'] is not None)==(r['focal_awareness']==1)
  for i in range(1,7):assert (r[f'expect_level_d{i:02}'] is not None)==(r['focal_awareness']==1)
  for k in ['alternative_task','alternative_days_ago','alternative_channel','alternative_csat5']:
   assert (r[k] is not None)==(r['alternative_recent30']==1)
  if r['alternative_recent30']==1:assert 0<=r['alternative_days_ago']<=30
  assert not any(k in r for k in ['company_csat5','recommend_0to10','channel_csat5','journey_csat5'])
 # CSV fixtures must contain exactly the exported workbook data, not stale schemas.
 import csv
 for ds,records in data.items():
  csvpath=REF/f"{meta['prefix']}_CSM_{ds}_Wave_{w}.csv"
  with csvpath.open(newline='') as f:
   csvrows=list(csv.DictReader(f))
  assert len(csvrows)==len(records)
  assert list(csvrows[0])==list(records[0])
  for a,b in zip(csvrows,records):
   for k,v in b.items():
    if v is None:assert a[k]==''
    elif isinstance(v,(int,float)):assert abs(float(a[k])-v)<1e-10
    else:assert a[k]==v

 # Independent NumPy recalc of every stored reference statistic from exported cells.
 for ex in [x for x in expected if x['wave']==w]:
  rows=[r for r in data[ex['dataset']] if (ex['company']==0 or r['company']==ex['company']) and (ex['channel']==0 or r.get('channel')==ex['channel'])];field=ex['variable'];stat=ex['statistic']
  v=np.array([np.nan if r[field] is None else r[field] for r in rows],float);wt=np.array([r['weight'] for r in rows],float)
  upper=5 if stat in ['t2b','top','b2b','mean5'] or stat.startswith('dist') else 7 if stat in ['ease','mean7'] else 10 if stat in ['nps','risk'] else 1
  lower=0 if stat in ['nps','risk','yes'] else 1
  if stat=='mean_gap': lower,upper=-4,4
  ok=(v>=lower)&(v<=upper);v=v[ok];wt=wt[ok];den=wt.sum()
  if len(v)==0:assert ex['expected'] is None;continue
  score=(v>=4) if stat=='t2b' else (v==5) if stat=='top' else (v<=2) if stat=='b2b' else (v==int(stat[-1])) if stat.startswith('dist') else ((v>=9).astype(int)-(v<=6).astype(int)) if stat=='nps' else (v>=8) if stat=='risk' else (v>=6) if stat=='ease' else v
  num=float(wt@score);val=num/den*(1 if stat.startswith('mean') else 100)
  assert abs(val-ex['expected'])<1e-6,(w,field,stat,val,ex['expected']);assert abs(den-ex['weighted_base'])<1e-6;assert len(v)==ex['raw_base'];count+=1
 # Distributions remain a partition, unlike MR selections.
 for co in [0]+list(range(1,len(meta['brands'])+1)):
  rr=[x for x in expected if x['wave']==w and x['dataset']=='Relationship' and x['company']==co and x['variable']=='company_csat5' and x['statistic'].startswith('dist')];assert abs(sum(x['expected'] for x in rr)-100)<1e-6
res={'status':'passed','relationship_records':nr,'channel_records':ne,'noncustomer_records':1500,'reference_results':len(expected),'record_and_metric_checks':count,'scope':'Exported fixture integrity, joins, routes and reference arithmetic. Not an application acceptance pass.'};(REF/'validation_results.json').write_text(json.dumps(res,indent=2));print(json.dumps(res))
