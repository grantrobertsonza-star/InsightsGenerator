// PREPARED, NOT INTEGRATION-EXECUTED. No writes unless target guard + marker + roles pass.

import fs from 'node:fs';

import assert from 'node:assert/strict';

import crypto from 'node:crypto';

import {createRequire} from 'node:module';

import {targets} from './safety.mjs';

import {application,functions} from './application.mjs';

const require=createRequire(import.meta.url);

if(process.env.REPIN002_ALLOW_DISPOSABLE_WRITES!=='YES'){

 console.log('BLOCKED: disabled; 0 integration cases executed, no connections opened.');

}else await main();

async function main(){

 const cfg=targets(),{Pool}=require('pg');

 const admin=new Pool({connectionString:cfg.admin,max:3}),pool=new Pool({connectionString:cfg.app,max:6});

 const locks=[];let currentGroup=null;
 const results=[],fixtures=[],files=JSON.parse(fs.readFileSync('scripts/repin002-integration/sources.json','utf8'));

 const checkHashes=()=>{for(const [p,h]of Object.entries(files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),h,'Source changed '+p)};

 let app,T,R;

 async function test(name,fn){currentGroup=name;try{await fn();results.push({name,status:'passed'});console.log('PASS '+name)}catch(e){results.push({name,status:'failed',error:e.message});throw e}}

 try{

 checkHashes();

 const marker=await pool.query('select environment_id from public.repin002_environment_guard where environment_id=$1 and synthetic_only',[cfg.id]);assert.equal(marker.rowCount,1);

 const role=await pool.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');assert(!role.rows[0].rolsuper&&!role.rows[0].rolbypassrls);

 assert.equal((await pool.query("select 1 from pg_tables where schemaname='public' and tablename in ('findings','finding_history','runs','documents') and tableowner=current_user")).rowCount,0);

 assert.equal((await admin.query("select 1 from information_schema.columns where table_schema='public' and table_name='findings' and column_name='provenance_tracked'")).rowCount,0,'Use fresh through0093 database');

 T=crypto.randomUUID();R=crypto.randomUUID();process.env.DEFAULT_TENANT_ID=T;

 delete process.env.DATABASE_URL;

 app=application(pool);

 await admin.query('insert into tenants(id,name) values($1,$2)',[T,'REP-IN-002 synthetic']);

 await app.withTenant(T,c=>c.query("insert into runs(id,tenant_id,status) values($1,$2,'draft')",[R,T]));

 const scope=fn=>app.withTenant(T,fn);

 async function document(){const id=crypto.randomUUID();await scope(c=>c.query("insert into documents(id,tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,$3,'report','synthetic.txt',$4)",[id,T,R,'repin002/'+cfg.id+'/'+id+'.txt']));fixtures.push(id);return id}

 async function finding(d,text='Old',extra={}){const id=crypto.randomUUID();await scope(c=>c.query("insert into findings(id,tenant_id,run_id,origin,finding_text,finding_kind,theme,source_document_id,source_quote,status) values($1,$2,$3,'stated',$4,$5,'Auto',$6,$7,'accepted')",[id,T,R,text,extra.kind||'fact',d,extra.quote||text]));return id}

 const current=d=>scope(async c=>(await c.query('select * from findings where source_document_id=$1 order by id',[d])).rows);

 const staged=(text='Fresh',rawIndex=0,links=[])=>({finding_text:text,finding_kind:'fact',theme:'Auto',data_type:null,source_quote:text,pageNumber:null,quoteVerified:true,groundedByFindingId:null,extractionCaveats:[],rawIndex,supportRawIndices:links});

 const params=(d,chunks=[{chunkIndex:0,findings:[staged()]}],patch={})=>({tenantId:T,runId:R,documentId:d,stagedChunks:chunks,partial:false,onlyReplacePending:false,archiveReason:'manual_reextract',confirmedLegacyIds:new Set(),...patch});

 const publish=(p,client)=>client?app.publishReplacement(client,p):scope(c=>app.publishReplacement(c,p));

 const legacyDoc=await document(),legacy=await finding(legacyDoc),legacy2=await finding(legacyDoc,'Legacy2');

 await test('pre0094 action saves but confirmation cannot retire unknown',async()=>{await app.setFindingTheme(R,legacy,'Human');const r=await publish(params(legacyDoc,undefined,{confirmedLegacyIds:new Set([legacy])}));assert.equal(r.reason,'provenance_unavailable');assert.equal((await current(legacyDoc)).find(f=>f.id===legacy).theme,'Human')});

 await test('actual0094 defaults, rerun and constraint',async()=>{

 await admin.query(fs.readFileSync('supabase/migrations/0094_finding_review_provenance.sql','utf8'));

 assert.equal((await current(legacyDoc))[0].provenance_tracked,false);

 const d=await document(),f=await finding(d);const row=(await current(d))[0];assert.equal(row.id,f);assert.equal(row.provenance_tracked,true);assert.equal(row.human_reviewed_at,null);

 await assert.rejects(scope(c=>c.query("update findings set human_review_action='invalid' where id=$1",[f])),e=>e.code==='23514');

 await admin.query(fs.readFileSync('supabase/migrations/0094_finding_review_provenance.sql','utf8'));assert.equal((await current(legacyDoc))[0].provenance_tracked,false);

 });

 await test('single/bulk/edit provenance and reread protection',async()=>{const d=await document(),ids=[];for(let i=0;i<5;i++)ids.push(await finding(d,'Protected'+i));await app.setFindingStatus(R,ids[0],'accepted');await app.setManyFindingStatuses(R,[ids[1]],'accepted');await app.setFindingTheme(R,ids[2],'Human');await app.setFindingKind(R,ids[3],'hypothesis');await app.setFindingNote(R,ids[4],'note');await app.setFindingNote(R,ids[4],'');const before=await current(d);await publish(params(d));for(const row of before)assert.deepEqual((await current(d)).find(f=>f.id===row.id),row)});

 await test('legacy scoped confirmation rechecks protection and unlisted IDs',async()=>{const other=await document(),foreign=await finding(other);assert.equal((await publish(params(legacyDoc))).reason,'legacy_unconfirmed');await app.setFindingStatus(R,legacy,'accepted');await publish(params(legacyDoc,undefined,{confirmedLegacyIds:new Set([legacy,legacy2,foreign])}));assert((await current(legacyDoc)).some(f=>f.id===legacy));assert(!(await current(legacyDoc)).some(f=>f.id===legacy2));assert((await current(other)).some(f=>f.id===foreign))});

 await test('history copies all provenance on explicit rejected regeneration',async()=>{const d=await document(),f=await finding(d);await app.setFindingTheme(R,f,'Human');await app.setFindingStatus(R,f,'rejected');const row=(await current(d))[0];await publish(params(d,undefined,{onlyReplacePending:true}));const hist=await scope(async c=>(await c.query('select * from finding_history where original_finding_id=$1',[f])).rows[0]);for(const k of ['human_reviewed_at','human_review_action','human_edited_at','human_edited_fields','provenance_tracked'])assert.deepEqual(hist[k],row[k])});



 await test('provenance write failure rolls back its researcher mutation',async()=>{for(const which of ['review','edit']){const d=await document(),id=await finding(d);const before=await current(d);

 const ctx={TENANT_ID:T,revalidatePath(){},...app,withTenant:async(t,fn)=>scope(c=>fn({query:(sql,p)=>sql.includes(which==='review'?'human_reviewed_at = now()':'human_edited_at = now()')?c.query('select 1/0'):c.query(sql,p)}))};

 const names=which==='review'?['setFindingStatus']:['setFindingTheme'];const action=functions('src/lib/findingActions.ts',names,ctx)[names[0]];

 await assert.rejects(action(R,id,which==='review'?'rejected':'Human'));

 assert.deepEqual(await current(d),before);

 }});

 await test('real dependency cascades and archived provenance in one publication',async()=>{

 const d=await document(),id=await finding(d),v=crypto.randomUUID(),i=crypto.randomUUID(),r=crypto.randomUUID();

 await app.setFindingStatus(R,id,'rejected');

 await scope(async c=>{

 await c.query("insert into verdicts(id,tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,$3,'robust','Synthetic','single_pass','single_source')",[v,T,id]);

 await c.query("insert into insights(id,tenant_id,run_id,finding_id,decision_context,headline,observation,tension,implication) values($1,$2,$3,$4,'Synthetic','Synthetic','Synthetic','Synthetic','Synthetic')",[i,T,R,id]);

 await c.query("insert into recommendations(id,tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered) values($1,$2,$3,$4,'Synthetic','Synthetic','Synthetic','Synthetic','Synthetic','low','Synthetic','Synthetic')",[r,T,R,i]);

 });

 const p=params(d,undefined,{onlyReplacePending:true});

 await assert.rejects(scope(c=>publish(p,{query:(sql,args)=>sql.includes('insert into findings')?c.query('select 1/0'):c.query(sql,args)})));

 await scope(async c=>{for(const [table,key] of [['findings',id],['verdicts',v],['insights',i],['recommendations',r]])assert.equal((await c.query('select id from '+table+' where id=$1',[key])).rowCount,1)});

 await scope(async c=>{for(const [table,col,key] of [['finding_history','original_finding_id',id],['verdict_history','original_verdict_id',v],['insight_history','original_insight_id',i],['recommendation_history','original_recommendation_id',r]])assert.equal((await c.query('select * from '+table+' where '+col+'=$1',[key])).rowCount,0)});

 await publish(p);

 await scope(async c=>{

 for(const [table,key]of [['findings',id],['verdicts',v],['insights',i],['recommendations',r]])assert.equal((await c.query('select id from '+table+' where id=$1',[key])).rowCount,0);

 assert.equal((await c.query('select * from finding_history where original_finding_id=$1',[id])).rowCount,1);

 for(const [table,col,key] of [['verdict_history','original_verdict_id',v],['insight_history','original_insight_id',i],['recommendation_history','original_recommendation_id',r]])assert.equal((await c.query('select * from '+table+' where '+col+'=$1',[key])).rowCount,1);

 });

 });

 await test('support union, same quote distinct claim and republication',async()=>{const d=await document(),old=await finding(d,'Old'),i=await finding(d,'Insight',{kind:'stated_insight',quote:'Shared'});await app.setFindingStatus(R,i,'accepted');await scope(c=>c.query('update findings set cited_support_finding_ids=$1 where id=$2',[JSON.stringify([old]),i]));

 const dup=(raw,links)=>({...staged('Insight',raw,links),finding_kind:'stated_insight',source_quote:'Shared'});

 const chunks=[{chunkIndex:0,findings:[staged('A'),dup(1,[0]),dup(2,[0,0,1]),{...staged('Distinct claim',3),source_quote:'Shared'}]},{chunkIndex:1,findings:[staged('B'),dup(1,[0,0,1])]}];

 await publish(params(d,chunks));const rows=await current(d),a=rows.find(f=>f.finding_text==='A'),b=rows.find(f=>f.finding_text==='B');assert.deepEqual(rows.find(f=>f.id===i).cited_support_finding_ids,[old,a.id,b.id]);assert.equal(rows.filter(f=>f.finding_kind==='stated_insight').length,1);assert(rows.some(f=>f.finding_text==='Distinct claim'));await publish(params(d,chunks));const after=await current(d);for(const id of [old,i,a.id,b.id])assert.deepEqual(after.find(f=>f.id===id),rows.find(f=>f.id===id));assert.equal(after.filter(f=>f.finding_text==='Distinct claim').length,1);

 });

 await test('partial and archive/insert/final-union faults roll back',async()=>{for(const phase of ['partial','archive','insert','union']){const d=await document(),f=await finding(d);let p=params(d);if(phase==='union'){await app.setFindingStatus(R,f,'accepted');p=params(d,[{chunkIndex:0,findings:[staged('A'),{...staged('Old',1,[0]),source_quote:'Old'}]}])}const before=await current(d);if(phase==='partial'){assert.equal((await publish({...p,partial:true})).published,false)}else{

 await assert.rejects(scope(c=>{const proxy={query:(sql,args)=>{const hit=phase==='archive'?sql.includes('insert into finding_history'):phase==='insert'?sql.includes('insert into findings'):sql.includes('update findings set cited_support_finding_ids');return hit?c.query('select 1/0'):c.query(sql,args)}};return publish(p,proxy)}));assert.deepEqual(await current(d),before);await publish(p);}

 }});

 async function begin(c){await c.query('begin');await c.query("select set_config('app.current_tenant_id',$1,true)",[T])}

 async function waitBlocked(waiter,holder){const deadline=Date.now()+5000;while(Date.now()<deadline){const r=await admin.query("select wait_event_type,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=$1",[waiter]);if(r.rows[0]?.wait_event_type==='Lock'&&r.rows[0].blockers.includes(holder)){locks.push({group:currentGroup,observedAt:new Date().toISOString(),waiterPid:waiter,holderPid:holder,...r.rows[0]});return;}await new Promise(r=>setTimeout(r,25))}throw Error('Observed lock barrier not reached')}

 async function race(existing,rollback,reverse){const d=await document();if(existing)await finding(d);const a=await pool.connect(),b=await pool.connect();let pending;try{await begin(a);await begin(b);const apid=(await a.query('select pg_backend_pid() as pid')).rows[0].pid,bpid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;await publish(params(d,[{chunkIndex:0,findings:[staged(reverse?'B':'A')]}]),a);pending=publish(params(d,[{chunkIndex:0,findings:[staged(reverse?'A':'B')]}]),b);pending.catch(()=>{});await waitBlocked(bpid,apid);await a.query(rollback?'rollback':'commit');await pending;await b.query('commit');assert.equal((await current(d)).find(f=>!f.human_reviewed_at).finding_text,reverse?'A':'B')}finally{await a.query('rollback');await b.query('rollback');a.release();b.release();if(pending)await pending.catch(()=>{})}}

 await test('observed competing publications: initially empty',()=>race(false,false,false));

 await test('observed competing publications: existing, reversed arrival',()=>race(true,false,true));

 await test('lock holder rollback releases waiting publication',()=>race(true,true,false));

 await test('researcher edit commits first and protects during waiting publication',async()=>{const d=await document(),id=await finding(d);const a=await pool.connect(),b=await pool.connect();let pending;try{await begin(a);await begin(b);const apid=(await a.query('select pg_backend_pid() pid')).rows[0].pid,bpid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;

 await a.query('update findings set theme=$1 where id=$2',['Human',id]);await app.recordHumanEdit(a,[id],'theme');

 pending=publish(params(d),b);pending.catch(()=>{});await waitBlocked(bpid,apid);await a.query('commit');await pending;await b.query('commit');assert.equal((await current(d)).find(f=>f.id===id).theme,'Human');

 }finally{await a.query('rollback');await b.query('rollback');a.release();b.release();if(pending)await pending.catch(()=>{})}});



 await test('publication commits first then waiting edit preserves retained ID',async()=>{

 const d=await document(),id=await finding(d);await app.setFindingStatus(R,id,'accepted');

 const a=await pool.connect(),b=await pool.connect();let pending;try{await begin(a);await begin(b);

 const apid=(await a.query('select pg_backend_pid() pid')).rows[0].pid,bpid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;

 await publish(params(d),a);

 const action=functions('src/lib/findingActions.ts',['setFindingTheme'],{...app,TENANT_ID:T,revalidatePath(){},withTenant:async(t,fn)=>fn(b)}).setFindingTheme;

 pending=action(R,id,'Human after publication');pending.catch(()=>{});

 await waitBlocked(bpid,apid);await a.query('commit');await pending;await b.query('commit');

 assert.equal((await current(d)).find(f=>f.id===id).theme,'Human after publication');

 }finally{await a.query('rollback');await b.query('rollback');a.release();b.release();if(pending)await pending.catch(()=>{})}

 });

 checkHashes();

 console.log(JSON.stringify({results,tenant:T,run:R,documents:fixtures,limitations:['No framework/browser/storage/model','Automatic-theme guard fixtures remain companion protocol; exact deployed-role equivalence not established']},null,2));

 }catch(e){console.error(JSON.stringify({results,status:'failed or blocked',error:e.message,tenant:T,run:R,documents:fixtures},null,2));process.exitCode=1}

 finally{
 const plan=JSON.parse(fs.readFileSync('scripts/repin002-integration/plan.json','utf8')).plannedCoreGroups;
 for(const name of plan)if(!results.some(r=>r.name===name))results.push({name,status:currentGroup?'not run':'blocked',reason:currentGroup?'Stopped after earlier group failure':'Environment/setup precondition failed'});
 const output={results,locks,tenant:T,run:R,documents:fixtures,sourceHashes:files};
 if(process.env.REPIN002_RESULTS_FILE){const path=require('path'),target=path.resolve(process.env.REPIN002_RESULTS_FILE),base=path.resolve('scripts/repin002-integration/runs')+path.sep;assert(target.startsWith(base),'Result path outside retained test directory');fs.writeFileSync(target,JSON.stringify(output,null,2)+'\n')}
 await pool.end();await admin.end()
 }

}

