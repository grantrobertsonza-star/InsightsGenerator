"""Read-only fixture validation. Requires openpyxl. Run with research pack folder."""
from pathlib import Path
import csv,json,sys,math
import openpyxl
P=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
REF=P if (P/'metadata.json').exists() else P/'test-reference'
m=json.loads((REF/'metadata.json').read_text());prefix=m.get('prefix','Car');event=m.get('event_stem','bought12')
names=[v['variable'] for v in m['variables']];newnames=names[m['measurement_extension']['source_columns_preserved']:];allowed={}
for v,_,code,_ in m['labels']:allowed.setdefault(v,set()).add(code)
refs=json.loads((REF/'reference_results.json').read_text())['results'];newrefs=[e for e in refs if e['chart']=='Measurement extension'];checks=0;summary=[]
def canonical(x):
 if x is None or x=='':return None
 try:return float(x)
 except:return x
def norm(x):return ' '.join((x or '').casefold().split())
for w in range(1,4):
 wb=openpyxl.load_workbook(P/f'{prefix}_Brand_Tracker_Wave_{w}.xlsx',read_only=True,data_only=True)
 vals=list(wb['Respondents'].values);head=list(vals[0]);assert head==names;assert len(vals)==1001
 rows=[dict(zip(head,x)) for x in vals[1:]]
 with open(REF/f'{prefix}_Brand_Tracker_Wave_{w}.csv') as f: cr=list(csv.reader(f))
 assert cr[0]==names and len(cr)==1001
 assert all(canonical(a)==canonical(b) for r,c in zip(vals[1:],cr[1:]) for a,b in zip(r,c))
 cb=list(wb['Codebook'].values);assert [r[0] for r in cb[1:]]==names
 lab=[list(r) for r in wb['Labels'].values][1:];assert lab==m['labels']
 for r in rows:
  assert isinstance(r['respondent_id'],str) and len(r['respondent_id'])==8
  for k in newnames:
   if k in allowed:assert r[k] is None or r[k] in allowed[k],(k,r[k])
  for b in range(1,11):
   for stem in ['needsfit','different','pricejustify']:assert (r[f'{stem}_b{b:02}'] is None)==(r[f'aware_b{b:02}']==0)
  assert r['choice_episode_eligible']==int(r['last_acquired']==1)
  ep=[k for k in newnames if k.startswith('choice_') and k!='choice_episode_eligible']
  if not r['choice_episode_eligible']:assert all(r[k] is None for k in ep)
  else:
   assert r['choice_actual'] is not None and r['choice_ideal'] is not None
   if r['choice_actual'] in range(1,11):assert r[f'{event}_b{r["choice_actual"]:02}']==1
   if r['choice_actual']==96:assert r[event+'_other']==1
   assert (r['choice_actual_other'] is not None)==(r['choice_actual']==96)
   assert (r['choice_ideal_other'] is not None)==(r['choice_ideal']==96)
   known=r['choice_actual']!=99 and r['choice_ideal'] not in [98,99]
   assert (r['choice_gap'] is not None)==known
   if known:
    actual=norm(r['choice_actual_other']) if r['choice_actual']==96 else r['choice_actual']
    ideal=norm(r['choice_ideal_other']) if r['choice_ideal']==96 else r['choice_ideal']
    assert r['choice_gap']==int(actual!=ideal)
   keys=[f'choice_barrier_r{i:02}' for i in range(1,11)]+['choice_barrier_none','choice_barrier_dk']
   if r['choice_gap']==1:
    assert all(r[k] in [0,1] for k in keys)
    assert sum(r[k] for k in keys)>0
    assert not((r['choice_barrier_none'] or r['choice_barrier_dk']) and sum(r[k] for k in keys)>1)
    assert (r['choice_barrier_other'] is not None)==(r['choice_barrier_r10']==1)
   else:assert all(r[k] is None for k in keys+['choice_barrier_other'])
  checks+=1
 for e in [e for e in newrefs if e['wave']==w]:
  weights=[r['weight'] if e['weighting']=='weighted' else 1 for r in rows];metric=e['metric'];b=m['brands'].index(e['brand'])+1 if e['brand'] in m['brands'] else None
  if metric.startswith(('needsfit_','different_','pricejustify_')):
   stem,mode=metric.rsplit('_',1);key=f'{stem}_b{b:02}'
   base=[i for i,r in enumerate(rows) if (r[f'aware_b{b:02}']==1 if mode=='dk' else r[key] in range(1,6))]
   f=lambda i: int(rows[i][key]==9) if mode=='dk' else (rows[i][key] if mode=='mean' else int(rows[i][key]>=4))
  elif metric=='choice_gap_rate':
   base=[i for i,r in enumerate(rows) if r['choice_gap'] in [0,1]];f=lambda i:rows[i]['choice_gap']
  elif metric in ['choice_actual_share','choice_ideal_share']:
   base=[i for i,r in enumerate(rows) if r['choice_gap'] in [0,1]];key=metric.removesuffix('_share');f=lambda i:int(rows[i][key]==b)
  else:
   key=metric.removesuffix('_rate');base=[i for i,r in enumerate(rows) if r['choice_gap']==1];f=lambda i:rows[i][key]
  den=sum(weights[i] for i in base);num=sum(weights[i]*f(i) for i in base);val=(100 if e['unit']=='percent' else 1)*num/den if den else None
  assert len(base)==e['raw_base'] and abs(num-e['numerator'])<1e-6 and abs(den-e['denominator'])<1e-6
  assert (val is None and e['expected'] is None) or abs(val-e['expected'])<1e-6
  checks+=1
 # Each item is separately generated, not copied from image or value associations.
 for b in range(1,11):
  assert [r[f'needsfit_b{b:02}'] for r in rows] != [r[f'different_b{b:02}'] for r in rows]
  assert [r[f'needsfit_b{b:02}'] for r in rows] != [r[f'pricejustify_b{b:02}'] for r in rows]
 summary.append({'wave':w,'rows':len(rows),'columns':len(head),'episode_base':sum(r['choice_episode_eligible'] for r in rows),'known_pair_base':sum(r['choice_gap'] in [0,1] for r in rows),'gap_base':sum(r['choice_gap']==1 for r in rows)})
 wb.close()
result={'status':'passed','extension_version':'2026-10-30','checks':checks,'waves':summary,'reference_metrics_checked':len(newrefs),'scope':'CSV XLSX metadata labels routes independent response streams and new reference arithmetic; no live dashboard import performed'}
(REF/'extension_validation_results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
