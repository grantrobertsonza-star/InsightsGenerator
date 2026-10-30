"""Validate separate CSM datasets, routes, metadata and acceptance targets.

python validate_separate_pack.py --xlsx
Optional --baseline and --combined paths add independent preservation and
cross-representation checks. No app import, JSON mapping or RNG is required.
"""
from pathlib import Path
from collections import Counter
import argparse,csv,json,math,hashlib,re,sys,zipfile,xml.etree.ElementTree as E
sys.path.insert(0,str(Path(__file__).resolve().parent/'quality_checks'))
from validation_rules import *

def metadata(base):
 result={}
 for ds,key in [('Relationship','company'),('Channel','channel'),('Noncustomer','noncustomer')]:
  _,sp=read_csv(base/'test-reference'/f'{ds}_Codebook.csv');result[key+'_specs']=sp
  _,ls=read_csv(base/'test-reference'/f'{ds}_Labels.csv')
  result[key+'_labels']=[[l['variable'],l['label'],float(l['value']),l['value_label']] for l in ls]
 return result

def matrix_check(path,sheet,csvpath,numeric=()):
 h,rows=read_csv(csvpath);xlsx_csv_check(path,h,rows,set(numeric),sheet)

def workbook_structure(path):
 ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(path) as z:
  for name in z.namelist():
   if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
    x=E.fromstring(z.read(name));check(not x.findall('.//x:f',ns),f'unexpected formula in static raw/metadata workbook {path} {name}')
    check(not x.findall('.//x:c[@t="e"]',ns),f'Excel error cell {path} {name}')
    check(x.find('x:sheetViews/x:sheetView/x:pane',ns) is not None,f'missing frozen pane {path} {name}')
  COUNT['xlsx_files_checked']+=1

def run(args):
 root=Path(args.root).resolve();reports=[]
 for sector,prefix in [('banking','Banking'),('mobile','Mobile')]:
  base=root/sector;ref=base/'test-reference';m=metadata(base)
  check(len(m['company_specs'])==100 and len(m['channel_specs'])==88,f'{sector} field counts')
  _,refs=read_csv(ref/'Reference_Metrics.csv')
  for x in refs:
   for k in ['wave','company','channel','raw_base']:x[k]=int(x[k])
   for k in ['expected','numerator','weighted_base']:x[k]=None if x[k]=='' else float(x[k])
  pools={'Relationship':[],'Channel':[]};wavecounts=[]
  for wave in [1,2,3]:
   data={};raw={}
   for ds,key in [('Relationship','company'),('Channel','channel'),('Noncustomer','noncustomer')]:
    name=f'{prefix}_CSM_{ds}_Wave_{wave}';heads,rows=read_csv(ref/(name+'.csv'));sp=m[key+'_specs'];numeric={s['variable'] for s in sp if s['data_type']=='numeric'}
    check(heads==[s['variable'] for s in sp],f'{sector} {name} schema');raw[ds]=rows;data[ds]=typed(rows,sp)
    if ds in pools:pools[ds].extend(rows)
    if args.xlsx:
     path=base/(name+'.xlsx');xlsx_csv_check(path,heads,rows,numeric);workbook_structure(path)
     matrix_check(path,'Codebook',ref/(ds+'_Codebook.csv'),['selected_value'])
     matrix_check(path,'Labels',ref/(ds+'_Labels.csv'),['value'])
     if ds!='Noncustomer':matrix_check(path,'MR sets',ref/(ds+'_MR_Sets.csv'),['selected_value'])
    if args.baseline:
     oldbase=Path(args.baseline)/sector;oldh,oldrows=read_csv(oldbase/'test-reference'/(name+'.csv'))
     check(len(rows)==len(oldrows),f'baseline row count {name}')
     for old,new in zip(oldrows,rows,strict=True):
      for k in oldh:check(scalar_equal(old[k],new[k],k in numeric),f'baseline changed {name} {k}')
     COUNT['baseline_cells_compared']+=len(oldh)*len(oldrows)
     if ds=='Noncustomer':
      for ext,parent in [('xlsx',base),('csv',ref)]:
       old=(oldbase if ext=='xlsx' else oldbase/'test-reference')/(name+'.'+ext)
       check(old.read_bytes()==(parent/(name+'.'+ext)).read_bytes(),f'noncustomer bytes changed {name} {ext}')
   route_checks(data['Relationship'],data['Channel'],data['Noncustomer'],m,wave)
   COUNT['reference_metrics_checked']+=recalc_metrics(refs,data,wave)
   if args.combined:
    _,wide=read_csv(Path(args.combined)/sector/'data'/f'{prefix}_CSM_Combined_Wave_{wave}.csv')
    lookup={(r['wave'],r['respondent_id']):r for r in wide};check(len(lookup)==1000,'combined key count')
    for ds,key in [('Relationship','company'),('Channel','channel')]:
     sp=m[key+'_specs'];numeric={s['variable'] for s in sp if s['data_type']=='numeric'}
     for r in raw[ds]:
      c=lookup[(r['wave'],r['respondent_id'])]
      for s in sp:
       k=s['variable'];target=k if ds=='Relationship' or k in COMMON else f'ch{int(r["channel"]):02}_'+k
       check(scalar_equal(r[k],c[target],k in numeric),f'combined mismatch {sector} {wave} {r["respondent_id"]} {target}')
       COUNT['combined_cells_compared']+=1
   wavecounts.append({'wave':wave,'company_rows':len(data['Relationship']),'channel_rows':len(data['Channel']),'noncustomer_rows':len(data['Noncustomer'])})
  for ds,key in [('Relationship','company'),('Channel','channel')]:
   name=f'{prefix}_CSM_{ds}_All_Waves';heads,rows=read_csv(ref/(name+'.csv'));check(rows==pools[ds],f'pooled exact append {name}')
   numeric={s['variable'] for s in m[key+'_specs'] if s['data_type']=='numeric'}
   unique(rows,['wave','respondent_id']+(['channel'] if ds=='Channel' else []),f'pooled key {name}')
   if args.xlsx:
    path=base/(name+'.xlsx');xlsx_csv_check(path,heads,rows,numeric);workbook_structure(path)
    matrix_check(path,'Codebook',ref/(ds+'_Codebook.csv'),['selected_value']);matrix_check(path,'Labels',ref/(ds+'_Labels.csv'),['value']);matrix_check(path,'MR sets',ref/(ds+'_MR_Sets.csv'),['selected_value'])
  if args.xlsx:
   path=base/'Master_CSM_Codebook.xlsx';workbook_structure(path)
   for ds in ['Relationship','Channel','Noncustomer']:
    matrix_check(path,ds+' variables',ref/(ds+'_Codebook.csv'),['selected_value'])
    matrix_check(path,ds+' labels',ref/(ds+'_Labels.csv'),['value'])
    if ds!='Noncustomer':matrix_check(path,ds+' MR',ref/(ds+'_MR_Sets.csv'),['selected_value'])
   path=base/'CSM_Reference_Metrics.xlsx';workbook_structure(path);matrix_check(path,'Reference metrics',ref/'Reference_Metrics.csv',['wave','company','channel','expected','numerator','weighted_base','raw_base'])
  reports.append({'sector':sector,'waves':wavecounts,'pooled_company':len(pools['Relationship']),'pooled_channel':len(pools['Channel']),'references':len(refs)})
 return {'status':'passed','scope':'Synthetic fixture integrity, complete raw value and metadata readback, routes, weighted arithmetic, pooled exactness and optional cross-format preservation; not an app acceptance test','xlsx_checked':args.xlsx,'checks':dict(COUNT),'sectors':reports}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--root',default=str(Path(__file__).resolve().parent));parser.add_argument('--xlsx',action='store_true');parser.add_argument('--baseline');parser.add_argument('--combined');parser.add_argument('--out')
 args=parser.parse_args();result=run(args)
 text=json.dumps(result,indent=2);print(text)
 if args.out:Path(args.out).write_text(text+'\n')
