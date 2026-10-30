from pathlib import Path
import csv,json,re,hashlib,math
import numpy as np
import pandas as pd

ROOT=Path('C:/Personal/InsighsAI/TestProjects/CSM Tracker/Updated301026/V2/Banking_and_Telecoms_CSM_Combined_Testing_Base/Banking_and_Telecoms_CSM_Combined')
OUT=Path(__file__).parent

def read_rows(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def fingerprint(p):return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def bases(mask,w):
 a=w[mask]; s=float(a.sum()); q=float((a*a).sum())
 return {'raw':int(mask.sum()),'weighted':s,'kish':s*s/q if q else None}
def estimate(df,var,eligible,scale):
 x=pd.to_numeric(df[var],errors='coerce'); w=pd.to_numeric(df.weight,errors='raise')
 valid=eligible & x.isin(scale)
 b=bases(valid,w); ew=bases(eligible,w)
 results={}
 for mode,weights in [('unweighted',pd.Series(1.,index=df.index)),('weighted',w)]:
  den=float(weights[valid].sum()); stat={}
  def share(sel):return 100*float(weights[valid & sel].sum())/den if den else None
  stat['mean']=float((x[valid]*weights[valid]).sum())/den if den else None
  stat['distribution_percent']={str(k):share(x.eq(k)) for k in scale}
  if scale==list(range(1,6)):stat.update(top_two_percent=share(x.isin([4,5])),top_box_percent=share(x.eq(5)),bottom_two_percent=share(x.isin([1,2])))
  if var=='recommend_0to10':
   stat.update(promoter_percent=share(x.isin([9,10])),passive_percent=share(x.isin([7,8])),detractor_percent=share(x.between(0,6)))
   stat['nps']=stat['promoter_percent']-stat['detractor_percent'] if den else None
  if var=='switch_0to10':stat['risk_8_to_10_percent']=share(x.between(8,10))
  results[mode]=stat
 return {'eligible_base':ew,'valid_base':b,'bases_by_weighting':{'weighted':{'eligible':ew,'valid':b},'unweighted':{'eligible':{'raw':ew['raw'],'weighted':ew['raw'],'kish':ew['raw'] if ew['raw'] else None},'valid':{'raw':b['raw'],'weighted':b['raw'],'kish':b['raw'] if b['raw'] else None}}},'eligible_excluded_from_valid':int((eligible&~valid).sum()),'invalid_response_codes':{str(k):int(v) for k,v in df.loc[eligible&~valid,var].value_counts(dropna=False).items()},'estimates':results}

output={'method':{'source':'Supplied combined testing base; independent CSV/pandas calculation, no app code or pack calculation scripts imported','record_grain':'One synthetic current customer per wave; channel outcomes share the customer row and use only their own channel-user flag','wave_policy':'1, 2 and 3 separately; pooled is explicitly the three independent cross-sections combined with original weights, not a panel or single-period population','population':'Customer files only; optional noncustomers, reference rows and metadata never enter respondent bases','weights':'Unchanged positive finite weight once per customer for company estimates and once within the selected channel. No channel-count adjustment or renormalisation','bases':'Eligible and valid raw n, sum of original weights, Kish (sum w)^2/sum w^2. Unweighted estimator uses unit weights and effective base equals raw n','missing':'Valid satisfaction/continuation/agreement codes 1..5; valid recommend/switch 0..10. Blank, 98, 99 excluded from valid bases; valid zero retained. Routed channel blanks are never zero','statistics':'Mean=sum(w*x)/sum(w); top two=100*sum(w*[4 or 5])/sum(w); NPS=promoter 9..10 percent minus detractor 0..6 percent with passives 7..8 retained; switching risk is declared 8..10 cut-off, not reverse scored satisfaction','scope':'Overall company CSAT refers to past three months or since joining if shorter. Channel CSAT refers to latest experience in past 30 days. Continue and switch refer to next 12 months; price switch is agreement, not actual churn','reference_tolerance':'Counts exact; all expected values and weighted bases compared at absolute 0.000001. Comparisons below cover only the requested core variables, not all pack references','no_inference':'No independent-sample channel test; channels overlap by respondent. Kish alone does not account for dependence. All figures synthetic, not real market evidence'},'sectors':{},'reference_comparisons':[],'sources':[]}
for sector,title in [('banking','Banking'),('mobile','Telecoms')]:
 p=ROOT/sector; book=read_rows(p/'Combined_Codebook.csv'); labs=read_rows(p/'Combined_Labels.csv')
 lm={}
 for r in labs:lm.setdefault(r['variable'],{})[r['value']]=r['value_label']
 allpath=p/'data'/f'{title}_CSM_Combined_All_Waves.csv'
 if not allpath.exists():allpath=next((p/'data').glob('*_All_Waves.csv'))
 df=pd.read_csv(allpath,dtype=str,keep_default_na=False)
 pieces=[pd.read_csv(next((p/'data').glob(f'*_Wave_{i}.csv')),dtype=str,keep_default_na=False) for i in (1,2,3)]
 assert df.shape==(3000,400)
 assert pd.concat(pieces,ignore_index=True).equals(df)
 assert not df.duplicated(['wave','respondent_id']).any()
 weights=pd.to_numeric(df.weight); assert np.isfinite(weights).all() and weights.gt(0).all()
 channel_names={str(i):lm[f'channel_used_c{i:02}']['1'] for i in range(1,5)}
 # Labels on the use flags are Yes/No; the variable dictionary names the channels.
 channel_names={str(i):next(r['label'] for r in book if r['variable']==f'channel_used_c{i:02}') for i in range(1,5)}
 inv=[]
 for r in book:
  v=r['variable']; text=(r['label']+' '+v).lower()
  if not (any(k in text for k in ['satisf','recommend','stay','switch']) or v=='continue5'):continue
  m=re.match(r'ch(\d\d)_',v)
  if m:scope=f"Named channel: {channel_names[str(int(m[1]))]}; latest experience in past 30 days"
  elif v=='journey_csat5':scope='Whole anchored end-to-end task across its contacts and channels; not overall company or an average of channels'
  elif v=='benchmark_csat5':scope='Other named provider comparable recent whole task; not main-company satisfaction'
  else:scope='Company-wide relationship with main provider'
  inv.append({**r,'scope':scope,'scale_codes_and_labels':lm.get(v,{}),'source_evidence':['Combined_Codebook.csv','Combined_Labels.csv','01_Combined_CSM_Questionnaire.docx'],'not_invented':'Channel block existence does not establish applicability; obey its stated route'})
 rows=[]; lookup={}
 companies=['0']+sorted(df.company.unique(),key=int)
 variables=['company_csat5','recommend_0to10','continue5','switch_0to10','price_switch5']+[f'ch{i:02}_channel_csat5' for i in range(1,5)]
 for wave in ['1','2','3','pooled']:
  for company in companies:
   group=(df.wave.eq(wave) if wave!='pooled' else pd.Series(True,index=df.index)) & (df.company.eq(company) if company!='0' else True)
   for var in variables:
    m=re.match(r'ch(\d\d)_',var); eligible=group.copy(); channel=int(m[1]) if m else 0
    if m:eligible &= df[f'channel_used_c{channel:02}'].eq('1')
    scale=list(range(11)) if var in ['recommend_0to10','switch_0to10'] else list(range(1,6))
    result={'wave':wave,'company_code':company,'company_label':'All current customer companies' if company=='0' else lm['company'][company],'channel_code':channel,'channel_label':channel_names[str(channel)] if channel else None,'variable':var,'question':next(r['question'] for r in book if r['variable']==var),**estimate(df,var,eligible,scale)}
    rows.append(result);lookup[(wave,company,var)]=result
 for channel in range(1,5):
  v=f'ch{channel:02}_channel_csat5'; assert not ((~df[f'channel_used_c{channel:02}'].eq('1'))&df[v].ne('')).any()
 refs=read_rows(p/'reference/Reference_Metrics.csv');differences=[]; checked=0;max_delta=0.
 for ref in refs:
  if ref['variable'] not in variables:continue
  result=lookup.get((ref['wave'],ref['company'],ref['variable']))
  if result is None:continue
  s=result['estimates']['weighted'];stat=ref['statistic']
  fields={'t2b':'top_two_percent','top':'top_box_percent','b2b':'bottom_two_percent','mean5':'mean','nps':'nps','risk':'risk_8_to_10_percent'}
  actual=s['distribution_percent'].get(stat[4:]) if stat.startswith('dist') else s.get(fields.get(stat,''))
  if actual is None:continue
  checked+=1; delta=actual-float(ref['expected']);max_delta=max(max_delta,abs(delta))
  raw_ok=result['valid_base']['raw']==int(ref['raw_base']);base_delta=result['valid_base']['weighted']-float(ref['weighted_base'])
  numerator=actual/100*result['valid_base']['weighted'] if ref['unit']=='percent' or stat=='nps' else actual*result['valid_base']['weighted']
  # NPS reference numerator is promoter minus detractor weight, matching the same formula.
  num_delta=numerator-float(ref['numerator']) if ref['numerator'] else None
  receipt={'sector':sector,'wave':ref['wave'],'company':ref['company'],'channel':ref['channel'],'variable':ref['variable'],'statistic':stat,'reference':float(ref['expected']),'computed':actual,'difference':delta,'weighted_base_difference':base_delta,'raw_base_matches':raw_ok,'numerator_difference':num_delta}
  output['reference_comparisons'].append(receipt)
  if abs(delta)>1e-6 or abs(base_delta)>1e-6 or not raw_ok or (num_delta is not None and abs(num_delta)>1e-6):differences.append(receipt)
 output['sectors'][sector]={'customer_rows':len(df),'columns':len(df.columns),'waves':{str(i):int(df.wave.eq(str(i)).sum()) for i in (1,2,3)},'all_waves_equals_concatenation':True,'scope_inventory':inv,'results':rows,'reference_summary':{'comparisons':checked,'maximum_absolute_value_difference':max_delta,'differences_outside_tolerance':differences},'not_measured':['Channel-specific NPS, continue/stay intention and switching likelihood are not asked in the combined channel blocks. Do not apply company responses as channel outcomes.'],'source_files':[str(allpath)]}
 for f in [allpath,p/'Combined_Codebook.csv',p/'Combined_Labels.csv',p/'01_Combined_CSM_Questionnaire.docx',p/'02_Combined_Dashboard_and_Analysis_Guide.docx',p/'reference/Reference_Metrics.csv']+[next((p/'data').glob(f'*_Wave_{i}.csv')) for i in (1,2,3)]:output['sources'].append(fingerprint(f))
(OUT/'csm-reference-values.json').write_text(json.dumps(output,indent=2,ensure_ascii=True,allow_nan=False)+'\n',encoding='utf-8')
print(json.dumps({s:{'result_rows':len(v['results']),'inventory_fields':len(v['scope_inventory']),**v['reference_summary']} for s,v in output['sectors'].items()},indent=2))

