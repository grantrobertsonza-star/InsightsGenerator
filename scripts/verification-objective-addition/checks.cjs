const fs=require("fs"),path=require("path"),ts=require("typescript"),crypto=require("crypto"),assert=require("assert/strict");
const files=["src/lib/objectiveCandidateActions.ts","src/lib/db.ts","src/lib/runSync.ts","src/lib/objectiveLines.ts","supabase/migrations/0083_objective_candidate_text_uniq.sql"];
const hash=()=>Object.fromEntries(files.map(p=>[p,crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")]));
const before=hash();let state,log,released,mode,refreshes,failRefresh=false;
function reset(rows=[],options={}){state={rows:structuredClone(rows),summary:{}};log=[];released=0;mode={...options};refreshes=0;failRefresh=false}
function connect(){let snapshot,save,aborted=false;return{release(){released++},async query(sql,p=[]){const q=sql.replace(/\s+/g," ").trim();log.push({q,p});const ret=(rows=[],rowCount=rows.length)=>({rows,rowCount});
if(q==="begin"){snapshot=structuredClone(state);return ret()}
if(q==="rollback"){state=snapshot;aborted=false;return ret()}
if(q.startsWith("rollback to savepoint")){state=structuredClone(save);aborted=false;return ret()}
if(aborted)throw Error("current transaction is aborted");
if(q.startsWith("select set_config"))return ret();
if(q.startsWith("savepoint")){save=structuredClone(state);return ret()}
if(q.startsWith("release savepoint")||q==="commit")return ret();
if(q.startsWith("insert into objective_candidates")){
 if(mode.permission){aborted=true;throw Error("permission denied for table objective_candidates")}
 if(q.includes("on conflict")&&mode.noIndex){aborted=true;throw Error("there is no unique or exclusion constraint matching the ON CONFLICT specification")}
 if(mode.insertFailure){mode.insertFailure=false;aborted=true;throw Error("injected insert failure")}
 const exists=state.rows.some(r=>r.run_id===p[1]&&r.source==="researcher_authored"&&r.status!=="rejected"&&r.candidate_text.trim()===p[2]);
 if(q.includes("on conflict")&&exists)return ret([],0);
 state.rows.push({run_id:p[1],candidate_text:p[2],source:"researcher_authored",status:"accepted"});return ret([],1);
}
if(q.startsWith("select 1 from objective_candidates"))return ret(state.rows.filter(r=>r.run_id===p[0]&&r.source==="researcher_authored"&&r.status!=="rejected"&&r.candidate_text.trim()===p[1]).slice(0,1));
if(q.startsWith("select candidate_text from objective_candidates"))return ret(state.rows.filter(r=>r.run_id===p[0]&&r.status==="accepted").map(r=>({candidate_text:r.candidate_text})));
if(q.startsWith("update runs set research_objective")){if(mode.syncFailure){aborted=true;throw Error("injected sync failure")}state.summary[p[1]]=p[0];return ret([],1)}
throw Error("UNEXPECTED SQL "+q);
}}}
const mocks={"pg":{Pool:class{async connect(){return connect()}}},"next/cache":{revalidatePath(){}},
"./objectiveFramer":{generateObjectiveCandidates:async()=>{throw Error("out of scope")}},
"./objectiveQualityScorer":{refreshObjectiveQuality:async()=>{refreshes++;if(failRefresh){failRefresh=false;throw Error("injected post-commit refresh failure")}}},
"./objectiveValidator":{refreshObjectiveValidationQuietly:async()=>{}}};
const cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function("require","module","exports",js)(s=>s in mocks?mocks[s]:s.startsWith(".")?load(path.resolve(path.dirname(file),s+".ts")):require(s),m,m.exports);return m.exports}
const {addOwnObjectiveCandidate:add}=load(files[0]);const passed=[];
async function test(name,fn){await fn();passed.push(name)}
(async()=>{
await test("empty input: no transaction or refresh",async()=>{reset();await add("r"," \n ");assert.equal(log.length,0);assert.equal(refreshes,0)});
await test("trimmed repeated addition and accepted-summary sync",async()=>{reset();await add("r","  Measure loyalty  ");await add("r","Measure loyalty");assert.equal(state.rows.length,1);assert.equal(state.summary.r,"Measure loyalty");assert.equal(log.filter(x=>x.q.startsWith("update runs")).length,1);assert.equal(released,2)});
await test("distinct wording remains independently addable",async()=>{reset();await add("r","A");await add("r","B");assert.equal(state.rows.length,2);assert.equal(state.summary.r,"1. A\n2. B")});
await test("existing accepted/pending researcher conflict is no-op",async()=>{for(const status of ["accepted","pending"]){reset([{run_id:"r",candidate_text:"A",status,source:"researcher_authored"}]);await add("r","A");assert.equal(state.rows.length,1);assert(!log.some(x=>x.q.startsWith("update runs")))}});
await test("rejected and AI rows do not block deliberate addition",async()=>{for(const row of [{status:"rejected",source:"researcher_authored"},{status:"accepted",source:"ai_suggested"}]){reset([{run_id:"r",candidate_text:"A",...row}]);await add("r","A");assert.equal(state.rows.length,2)}});
await test("same wording in another run is independent",async()=>{reset([{run_id:"other",candidate_text:"A",status:"accepted",source:"researcher_authored"}]);await add("r","A");assert.equal(state.rows.length,2);assert.equal(state.summary.r,"A")});
await test("missing-index error rolls back savepoint before fallback",async()=>{reset([],{noIndex:true});await add("r","A");assert.equal(state.rows.length,1);assert.equal(state.summary.r,"A");const rollback=log.findIndex(x=>x.q.startsWith("rollback to savepoint"));const select=log.findIndex(x=>x.q.startsWith("select 1"));assert(rollback>=0&&select>rollback);assert.equal(log.at(-1).q,"commit");assert.equal(released,1)});
await test("missing-index fallback duplicate is no-op",async()=>{reset([{run_id:"r",candidate_text:" A ",status:"accepted",source:"researcher_authored"}],{noIndex:true});await add("r","A");assert.equal(state.rows.length,1);assert(!log.some(x=>x.q.startsWith("update runs")));assert.equal(log.at(-1).q,"commit")});
await test("permission failure is not misclassified as missing index",async()=>{reset([],{permission:true});await assert.rejects(()=>add("r","A"),/permission denied/);assert.equal(state.rows.length,0);assert.equal(log.at(-1).q,"rollback");assert(!log.some(x=>x.q.startsWith("select 1")));assert.equal(released,1)});
await test("sync failure rolls back insertion then retry succeeds",async()=>{reset([],{syncFailure:true});await assert.rejects(()=>add("r","A"),/sync failure/);assert.equal(state.rows.length,0);mode.syncFailure=false;await add("r","A");assert.equal(state.rows.length,1);assert.equal(state.summary.r,"A")});
await test("fallback insert failure rolls back and clean retry succeeds",async()=>{reset([],{noIndex:true,insertFailure:true});await assert.rejects(()=>add("r","A"),/insert failure/);assert.equal(state.rows.length,0);await add("r","A");assert.equal(state.rows.length,1);assert.equal(state.summary.r,"A")});
await test("postcommit refresh failure then retry does not duplicate",async()=>{reset();failRefresh=true;await assert.rejects(()=>add("r","A"),/post-commit/);assert.equal(state.rows.length,1);await add("r","A");assert.equal(state.rows.length,1)});
const after=hash();assert.deepEqual(after,before,"Source changed; invalidate results");
console.log(JSON.stringify({passed:passed.length,cases:passed,hashes:after,limitations:["Controlled pg boundary; no real constraints, locks, RLS or competing transactions","Quality/validation/framer external boundaries controlled; active publication modules never loaded","Pre-0083 fallback is sequential recovery only, not concurrency-safe"]},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
