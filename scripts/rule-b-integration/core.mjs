// PREPARED, NOT DATABASE-EXECUTED. No connection unless explicit guard passes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {targets,environment} from './safety.mjs';
import {application} from './application.mjs';
const require=createRequire(import.meta.url);
if(process.env.RULEB_ALLOW_DISPOSABLE_WRITES!=='YES'){
 console.log('NOT RUN: writes disabled; no connections opened.');
}else await main();
async function main(){
 const cfg=targets(),{Pool}=require('pg');
 const runtime=path.resolve(process.env.RULEB_FROZEN_RUNTIME||'');
 const manifest=JSON.parse(fs.readFileSync(new URL('./source-manifest.json',import.meta.url)));
 function hashes(){for(const [p,h]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime,p))).digest('hex'),h,p);}
 hashes();
 const resultFile=path.resolve('scripts/rule-b-integration/runs/authorized/core-results.json');
 if(fs.existsSync(resultFile))throw Error('Results exist; refuse overwrite');
 fs.mkdirSync(path.dirname(resultFile),{recursive:true});
 const groups=[1,2,3,4].map(id=>({id,status:'not run'})),events=[];
 const admin=new Pool({connectionString:cfg.admin,max:2}),pool=new Pool({connectionString:cfg.app,max:4});
 let a,T,active;
 const save=()=>fs.writeFileSync(resultFile,JSON.stringify({environment,groups,events,tenant:T,sourceArchive:manifest.archiveSha256},null,2));
 const tx=fn=>a.withTenant(T,fn);
 const one=async(c,q,p=[])=>(await c.query(q,p)).rows[0];
 const draft=text=>[{item:{kind:'objective',order:0,text,candidateId:null},qs:[{question:'Synthetic question',request:'Synthetic request',supports_if:'Higher',against_if:'Lower',expectation:null}]}];
 const publish=(c,R,flag=false)=>a.publishGeneratedQuestions(c,{tenantId:T,runId:R,drafted:draft('Brand awareness'),variablesTruncated:flag,pooledCount:2,usedCount:2});
 async function group(id,fn){active=groups[id-1];try{await fn();active.status='passed';}catch(e){active.status='failed';active.error=e.message;throw e;}finally{save();}}
 try{
  assert.equal((await one(admin,'select environment_id from public.ruleb_environment_guard')).environment_id,environment);
  const role=await one(pool,'select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname=current_user');
  assert.equal(role.name,'ruleb_core_app');assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
  assert.equal((await one(admin,"select count(*)::int n from information_schema.columns where table_name='objective_evidence' and column_name='origin_recorded'")).n,0,'Need a fresh through0094 core clone');
  events.push({role});
  delete process.env.DATABASE_URL; // Do not permit the actual module to consume any ambient target.
  a=application(runtime,pool);
  T=(await one(admin,"insert into tenants(name) values('Rule B synthetic integration') returning id")).id;
  const R=(await tx(c=>one(c,"insert into runs(tenant_id,research_objective,decision_statement) values($1,'Brand awareness','Cut costs') returning id",[T]))).id;
  const addCandidate=(kind,text)=>tx(c=>one(c,`insert into ${kind}_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'synthetic','researcher_authored','accepted') returning id`,[T,R,text]));
  const O=(await addCandidate('objective','Brand awareness')).id,D=(await addCandidate('decision','Cut costs')).id;
  const legacy=[];
  for(const [kind,link,source,excluded]of [['objective',O,'auto',false],['decision',D,'auto',false],['objective',null,'manual',false],['objective',null,'edited',true],['objective',null,'auto',true],['objective',null,'edited',false]]){
   legacy.push(await tx(c=>one(c,`insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,question,request_text,objective_candidate_id,decision_candidate_id,source,excluded) values($1,$2,$3,0,$4,'legacy question','synthetic request',$5,$6,$7,$8) returning id`,[T,R,kind,kind==='objective'?'Brand awareness':'Cut costs',kind==='objective'?link:null,kind==='decision'?link:null,source,excluded])));
  }
  events.push({run:R,objective:O,decision:D,legacy});
  const ddl=fs.readFileSync(path.join(runtime,'supabase/migrations/0095_objective_evidence_origin.sql'),'utf8');
  await group(1,async()=>{
   await admin.query(ddl);
   const rows=(await tx(c=>c.query('select id,origin_candidate_id,origin_recorded from objective_evidence where run_id=$1 order by id',[R]))).rows;
   const byId=new Map(rows.map(r=>[r.id,r]));
   assert.equal(byId.get(legacy[0].id).origin_candidate_id,O);assert.equal(byId.get(legacy[1].id).origin_candidate_id,D);
   for(const r of legacy.slice(2)){assert.equal(byId.get(r.id).origin_recorded,false);assert.equal(byId.get(r.id).origin_candidate_id,null);}
   const omitted=await tx(c=>one(c,"insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,question,request_text) values($1,$2,'objective',0,'Brand awareness','omitted','req') returning origin_recorded,origin_candidate_id",[T,R]));
   assert.equal(omitted.origin_recorded,false);assert.equal(omitted.origin_candidate_id,null);
   const before=(await tx(c=>c.query('select * from objective_evidence where run_id=$1 order by id',[R]))).rows;
   await admin.query(ddl);
   assert.deepEqual((await tx(c=>c.query('select * from objective_evidence where run_id=$1 order by id',[R]))).rows,before);
   await assert.rejects(tx(c=>c.query('update objective_evidence set origin_recorded=false,origin_candidate_id=$1 where id=$2',[O,legacy[2].id])),e=>e.code==='23514');
  });
  await group(2,async()=>{
   await tx(async c=>{await c.query('delete from objective_candidates where id=$1',[O]);await c.query('delete from decision_candidates where id=$1',[D]);});
   const loaded=await a.loadObjectiveEvidenceWithCoverage(T,R),groups=a.rollUp(loaded.questions,new Set(loaded.currentItems.map(a.currentItemKey)));
   for(const [id,origin]of [[legacy[0].id,O],[legacy[1].id,D]]){
    const q=loaded.questions.find(q=>q.id===id);assert.equal(q.origin_candidate_id,origin);assert.equal(q.objective_candidate_id,null);assert.equal(q.decision_candidate_id,null);
    assert.equal(a.evidenceIdentity(q).state,'deleted');assert.equal(groups.find(g=>g.questions.some(q=>q.id===id)).orphaned,true);
   }
   const unknown=groups.filter(g=>g.identity==='unknown');assert.ok(unknown.length>=2);assert.equal(new Set(unknown.map(g=>g.key)).size,unknown.length);
  });
  const state=()=>tx(async c=>({questions:(await c.query('select * from objective_evidence where run_id=$1 order by id',[R])).rows,generations:(await c.query('select * from objective_evidence_generations where run_id=$1 order by id',[R])).rows}));
  await group(3,async()=>{
   await tx(c=>publish(c,R));const before=await state();
   await admin.query(`create function public.ruleb_insert_fault() returns trigger language plpgsql as $$ begin if NEW.run_id='${R}'::uuid then raise exception 'Rule B scoped origin INSERT fault'; end if; return NEW; end $$`);
   await admin.query('create trigger ruleb_insert_fault before insert on objective_evidence for each row execute function public.ruleb_insert_fault()');
   try{await assert.rejects(tx(c=>publish(c,R,true)),/Rule B scoped origin INSERT fault/);assert.deepEqual(await state(),before);}
   finally{await admin.query('drop trigger ruleb_insert_fault on objective_evidence');await admin.query('drop function public.ruleb_insert_fault()');}
   await tx(c=>publish(c,R,true));const after=await state();assert.equal(after.generations.filter(g=>g.is_current).length,1);
   for(const old of before.questions.filter(q=>q.source!=='auto'||q.excluded))assert.deepEqual(after.questions.find(q=>q.id===old.id),old);
  });
  await group(4,async()=>{
   let release,arrive;const released=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);const log=[];let paused=false;
   const membership=(await tx(c=>one(c,"insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Snapshot candidate','fixture','researcher_authored','accepted') returning id",[T,R]))).id;
   const before=await a.loadObjectiveEvidenceWithCoverage(T,R);
   let readerConnections=0; const readerSessions=[];
   const observed={async connect(){readerConnections++; const c=await pool.connect();readerSessions.push((await c.query('select pg_backend_pid() as pid')).rows[0]);return{release:()=>c.release(),async query(sql,params){const result=await c.query(sql,params);log.push(sql);if(!paused&&sql.includes('select variables_truncated')){paused=true;arrive();await released;}return result;}};}};
   // Existing global cached pool must not bypass this dedicated observed client adapter.
   delete globalThis.pgPool;const reader=application(runtime,observed);
   const pending=reader.loadObjectiveEvidenceWithCoverage(T,R);
   let deadline;
   try{
    await Promise.race([arrived,new Promise((_,reject)=>deadline=setTimeout(()=>reject(Error('Snapshot read barrier timeout')),10000))]);
    await tx(async c=>{events.push({writerSession:(await c.query('select pg_backend_pid() as pid')).rows[0]});await c.query('delete from objective_candidates where id=$1',[membership]);await c.query("update runs set research_objective='Changed after snapshot',decision_statement='Changed decision' where id=$1",[R]);await publish(c,R,false);});
   }finally{clearTimeout(deadline);release();}
   const old=await pending;assert.equal(readerConnections,1);events.push({readerSessions});assert.deepEqual(old,before);assert.match(log[0],/^begin isolation level repeatable read/);assert.equal(log.at(-1),'commit');
   const fresh=await a.loadObjectiveEvidenceWithCoverage(T,R);assert.notDeepEqual(fresh.currentItems,before.currentItems);assert.equal(fresh.variablesTruncated,false);assert.equal(old.variablesTruncated,true);
   events.push({snapshotSql:log,oldGenerationQuestionIds:old.questions.map(q=>q.id),freshQuestionIds:fresh.questions.map(q=>q.id)});
  });
  hashes();
 }catch(e){events.push({error:e.message});process.exitCode=1;}
 finally{save();await pool.end();await admin.end();}
}
