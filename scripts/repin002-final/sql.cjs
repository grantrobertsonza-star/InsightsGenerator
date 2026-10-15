
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('assert/strict'),{Pool}=require('pg');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),runtime=meta.runtime;
function mod(rel,mocks={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(runtime,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(s=>{if(s in mocks)return mocks[s];throw Error('Unlisted dependency '+s)},m,m.exports);return m.exports}
function functions(rel,names,ctx){const sf=ts.createSourceFile(rel,fs.readFileSync(path.join(runtime,rel),'utf8'),99,true,ts.ScriptKind.TSX);let text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf).replace(/^export /,'')).join('\n');return new Function(...Object.keys(ctx),ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+';return {'+names.join(',')+'}')(...Object.values(ctx))}
const admin=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_post'}),pool=new Pool({connectionString:'postgres://repin002_final_post_app@127.0.0.1:55496/repin002_final_20261015_post'});
const results=[];const save=()=>fs.writeFileSync(path.join(dir,'sql-results.json'),JSON.stringify(results,null,2));
(async()=>{try{
const t=(await admin.query("insert into tenants(name) values('REP final synthetic') returning id")).rows[0].id;
const r=(await admin.query("insert into runs(tenant_id,decision_statement) values($1,'Synthetic decision') returning id",[t])).rows[0].id;
const d=(await admin.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report','synthetic.txt','synthetic-only') returning id",[t,r])).rows[0].id;
fs.writeFileSync(path.join(dir,'fixture-ids.json'),JSON.stringify({tenant:t,run:r,document:d},null,2));
const db=mod('src/lib/db.ts',{pg:{Pool:class{constructor(){return pool}}}}),prov=mod('src/lib/findingProvenance.ts');
const ctx={TENANT_ID:t,...db,...prov,revalidatePath(){},describeChart:()=>'Synthetic chart claim',describeBrandHealthSection:()=>({text:'Synthetic brand claim',theme:'Automatic'}),describeCsmSection:()=>({text:'Synthetic CSM claim',theme:'Automatic'}),brandHealthFindingKey:()=>'q',csmFindingKey:()=>'q',describeWaveNps:()=>'Synthetic wave NPS claim',describeWaveChart:()=>'Synthetic wave chart claim',describeWaveDriverTable:()=>'Synthetic wave driver claim'};
const report={outcomeLabel:'Synthetic outcome',result:{outcome:'continuous',fit:{rSquared:.4},warnings:[],predictors:1,n:100,method:'linear',rows:[]}};
const a=(await admin.query("insert into driver_analyses(tenant_id,run_id,document_id,title,request,report) values($1,$2,$3,'Synthetic','{}',$4) returning id",[t,r,d,report])).rows[0].id;
ctx.require=s=>{if(s==='./driverFindings')return mod('src/lib/driverFindings.ts');throw Error(s)};
const specs=[
['chartActions.ts','addChartFindingAction','removeChartFindingAction',[r,d,{variable:'q',label:'Q',series:[],n:100},null],[r,d,'q',null]],
['npsActions.ts','addNpsFindingAction','removeNpsFindingAction',[r,d,{variable:'q',label:'Q',segments:[],designQualifications:[]}],[r,d,'q']],
['brandHealthActions.ts','addBrandHealthFindingAction','removeBrandHealthFindingAction',[r,d,{conversions:[]},'awareness'],[r,d,'awareness','q']],
['csmActions.ts','addCsmFindingAction','removeCsmFindingAction',[r,d,{segmentVar:null},'overall'],[r,d,'overall','q',null]],
['waveTrackingActions.ts','addWaveNpsFindingAction','removeWaveNpsFindingAction',[r,{variable:'q',label:'Q',segments:[{label:'Wave1',nps:10,n:100}]}],[r,'q']],
['waveTrackingActions.ts','addWaveChartFindingAction','removeWaveChartFindingAction',[r,{variable:'q',label:'Q',series:[]}],[r,'q']],
['waveTrackingActions.ts','addWaveDriverFindingAction','removeWaveDriverFindingAction',[r,{outcome:'q',outcomeLabel:'Q',rows:[]}],[r,'q']],
['drivers.ts','addDriverFindings','removeDriverFindings',[t,r,a],[t,r,a]]];
const group={id:'P1',status:'running',cells:[]};results.push(group);save();
for(const [file,add,remove,addArgs,removeArgs] of specs){
const f=functions('src/lib/'+file,[add,remove],ctx);
let currentIds=[];
for(const [phase,name,args]of [['add',add,addArgs],['remove',remove,removeArgs],['revive',add,addArgs]]){
const before=(await admin.query('select id from findings where run_id=$1',[r])).rows.map(x=>x.id);
const out=await f[name](...args);assert.notEqual(out?.ok,false,JSON.stringify(out));
let rows=(await admin.query('select id,human_review_action,human_reviewed_at,status from findings where run_id=$1',[r])).rows;
if(phase==='add'){rows=rows.filter(x=>!before.includes(x.id));currentIds=rows.map(x=>x.id);}else rows=rows.filter(x=>currentIds.includes(x.id));
assert.equal(rows.length,currentIds.length);assert(rows.every(x=>x.status===(phase==='remove'?'rejected':'accepted')));
assert(rows.length>0,name+' no rows');assert(rows.every(x=>x.human_reviewed_at&&x.human_review_action===(phase==='remove'?'tool_remove':'tool_add')));
group.cells.push({tool:add,phase,ids:rows.map(x=>x.id),status:'passed'});save();
}}
group.status='passed';save();
for(const [id,index]of [['T2',2],['T3',3]]){
const [file,add,,args]=specs[index],f=functions('src/lib/'+file,[add],ctx);
const source=index===2?'brand_health_tool':'csm_tool';
const ids=(await admin.query("select id from findings where run_id=$1 and stated_stats->>'source'=$2",[r,source])).rows.map(x=>x.id);assert.equal(ids.length,1);
for(const human of [true,false]){
await admin.query("update findings set theme='Prior',human_edited_fields=$2 where id=$1",[ids[0],human?['theme']:[]]);
const out=await f[add](...args);assert.notEqual(out.ok,false,JSON.stringify(out));
const row=(await admin.query('select theme from findings where id=$1',[ids[0]])).rows[0];assert.equal(row.theme,human?'Prior':'Automatic');
}
results.push({id,status:'passed',controls:2});save();
}
const b=(await admin.query("insert into coding_codebooks(tenant_id,run_id,document_id,version,source) values($1,$2,$3,1,'edited') returning id",[t,r,d])).rows[0].id;
const c=(await admin.query("insert into coding_codes(tenant_id,codebook_id,position,name,definition) values($1,$2,0,'Synthetic code','Synthetic definition') returning id",[t,b])).rows[0].id;
await admin.query("insert into coding_code_meta(tenant_id,document_id,code_key,theme) values($1,$2,'synthetic code','Automatic')",[t,d]);
const coded=(await admin.query("insert into findings(tenant_id,run_id,source_document_id,origin,finding_text,theme,coding_code_id,human_edited_fields) values($1,$2,$3,'coded','Human control','Prior',$4,array['theme']),($1,$2,$3,'coded','Automatic control','Prior',$4,'{}') returning id",[t,r,d,c])).rows;
const sync=functions('src/lib/codingMeta.ts',['syncFindingThemes','metaAvailable'],ctx);
await sync.syncFindingThemes(t,d);
const actual=(await admin.query('select finding_text,theme from findings where id=any($1) order by finding_text',[coded.map(x=>x.id)])).rows;
assert.deepEqual(actual.map(x=>x.theme),['Automatic','Prior']);results.push({id:'T1',status:'passed',actual});save();
}catch(e){results.push({status:'failed',error:e.stack});save();console.error(e.stack);process.exitCode=1}
finally{await pool.end();await admin.end()}})();
