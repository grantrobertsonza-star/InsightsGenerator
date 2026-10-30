"""Read-only validation of exported synthetic fixtures. Requires openpyxl and numpy."""
from pathlib import Path
import json,math,sys
import openpyxl
import numpy as np
P=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
REF=P if (P/"metadata.json").exists() else P/"test-reference"
meta=json.loads((REF/'metadata.json').read_text());expected=json.loads((REF/'reference_results.json').read_text())['results'];names=[v['variable'] for v in meta['variables']]
checks=0
allowed={}
for var,_,code,_ in meta['labels']:allowed.setdefault(var,set()).add(code)
seen=set()
for w in range(1,4):
 wb=openpyxl.load_workbook(P/f'Insurer_Brand_Tracker_Wave_{w}.xlsx',read_only=True,data_only=True)
 sh=wb['Respondents'];it=iter(sh.values);head=list(next(it));assert head==names
 rows=[dict(zip(head,r)) for r in it];assert len(rows)==1000
 for r in rows:
  assert isinstance(r['respondent_id'],str) and len(r['respondent_id'])==8 and r['respondent_id'].startswith('0')
  assert r['respondent_id'] not in seen;seen.add(r['respondent_id'])
  assert r['wave']==w and r['synthetic']==1
  assert r['category_active']==1 or r['next_acquire']==1
  assert r['category_active']==int(any(r[f'current_b{j:02}'] for j in range(1,11)) or r['current_other'])
  for k in range(1,5):assert (r[f'product_p{k:02}'] is None)==(r['category_active']==0)
  assert (r['experience_resolution'] is not None)==(r['experience_event']==1)
  for var,vals in allowed.items():assert r[var] is None or r[var] in vals,(var,r[var])
  for b in range(1,11):
   k=f'b{b:02}'
   assert r['firstchoice_'+k]<=r['shortlist_'+k]<=r['consider_'+k]<=r['aware_'+k]
   assert r['unaided_'+k]<=r['aware_'+k]
   assert r['cep_links_'+k]==sum(r[f'cep_c{c:02}_'+k] for c in range(1,13))
   assert r['mental_'+k]==int(r['cep_links_'+k]>0)
   assert not(r['opinion_'+k]==1 and r['consider_'+k])
   for var in ['opinion','adprompt','wom']:assert (r[var+'_'+k] is None)==(r['aware_'+k]==0)
   for a in range(1,11):assert (r[f'attr_a{a:02}_'+k] is None)==(r['aware_'+k]==0)
   assert (r['repeat_'+k] is None)==(r['started12_'+k]==0)
   assert r['repeat_event_'+k]==int(r['started12_'+k] and r['repeat_'+k]==1)
  for a in range(1,11):
   s=sum(r[f'attr_a{a:02}_b{b:02}'] or 0 for b in range(1,11));assert not(s and (r[f'attr_none_a{a:02}'] or r[f'attr_dk_a{a:02}']))
  assert (r['start_channel'] is not None)==(r['last_acquired']==1)
  checks+=1
 data={k:np.array([r[k] if r[k] is not None else np.nan for r in rows],dtype=float) for k in names if meta['variables'][names.index(k)]['data_type']!='text'}
 for e in expected:
  if e['wave']!=w:continue
  weights=data['weight'] if e['weighting']=='weighted' else np.ones(1000);den=weights.sum();val=None
  if e['metric'] in ['aware','unaided','consider','shortlist','firstchoice','current','started12','repeat_event','adrecall']:
   b=meta['brands'].index(e['brand'])+1;val=100*(weights@data[f"{e['metric']}_b{b:02}"])/den
  elif e['metric']=='relevance':
   c=meta['ceps'].index(e['item'])+1;val=100*(weights@data[f'relevant_c{c:02}'])/den
  elif e['metric'] in ['link_all','link_among_aware']:
   b=meta['brands'].index(e['brand'])+1;c=meta['ceps'].index(e['item'])+1;dd=den if e['metric']=='link_all' else weights@data[f'aware_b{b:02}'];val=100*(weights@data[f'cep_c{c:02}_b{b:02}'])/dd
  elif e['metric']=='effective_base':val=den**2/(weights@weights)
  if val is not None:assert abs(val-e['expected'])<1e-6,(w,e['metric'],val,e['expected']);checks+=1
 # Invariants for memory metrics and sum-to-100 metrics, both weighting choices.
 for tag in ['weighted','unweighted']:
  ref=[e for e in expected if e['wave']==w and e['weighting']==tag]
  get=lambda metric,brand:next(e['expected'] for e in ref if e['metric']==metric and e['brand']==brand)
  assert abs(sum(get('mental_market_share',b) for b in meta['brands'])-100)<1e-6
  for b in meta['brands']:
   assert abs(get('average_links_all',b)-get('mental_penetration',b)/100*get('network_size',b))<1e-6
   assert abs(sum(get(x,b) for x in ['Positive','Negative','Mixed','Neutral','Not heard','Unaware'])-100)<1e-6
   checks+=2
 wb.close()
# Verify metric workbook numeric values agree exactly with machine-readable results.
wb=openpyxl.load_workbook(P/'Reference_Metrics.xlsx',read_only=True,data_only=True)
it=iter(wb['Reference metrics'].values);assert list(next(it))==meta['reference_headers'];count=0
for a,b in zip(it,expected):
 for i,k in enumerate(meta['reference_headers']):
  av=a[i];bv=b[k]
  if isinstance(bv,(int,float)):assert abs(av-bv)<1e-7
  else:assert (av or '')==(bv or '')
 count+=1
assert count==len(expected)
result={'status':'passed','respondent_records_checked':3000,'reference_rows':count,'checked_assertions_or_records':checks,'limitations':'Fixture integrity and reference checks, not an application or model pass.'}
(REF/'validation_results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

# Validate the additive generic measurement extension as well as the original fixture.
import subprocess,sys
subprocess.run([sys.executable,str((REF if "REF" in globals() else P)/"validate_extension.py"),str(P)],check=True)
