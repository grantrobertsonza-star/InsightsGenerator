
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs'),{mod}=require('./actual.cjs');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),doc=JSON.parse(fs.readFileSync(path.join(dir,'uploaded-document.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_post'}),app=new Pool({connectionString:'postgres://repin002_final_post_app@127.0.0.1:55496/repin002_final_20261015_post'}),results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms)),save=()=>fs.writeFileSync(path.join(dir,'confirmation-results.json'),JSON.stringify(results,null,2));
const mode=async m=>fetch('http://127.0.0.1:55005/__fixture',{method:'POST',headers:{'x-repin002-token':'repin002-final-synthetic'},body:JSON.stringify({mode:m})});
(async()=>{const c=await connect();try{
const old=(await p.query("insert into findings(tenant_id,run_id,source_document_id,origin,finding_text,source_quote,finding_kind,theme,status,provenance_tracked) values($1,$2,$3,'stated','Legacy synthetic one','The synthetic report states that satisfaction is 80% and loyalty is 40%.','fact','Synthetic','accepted',false),($1,$2,$3,'stated','Legacy synthetic two','The synthetic report states that satisfaction is 80% and loyalty is 40%.','fact','Synthetic','accepted',false) returning id",[ids.tenant,ids.run,doc.id])).rows.map(x=>x.id);
fs.writeFileSync(path.join(dir,'legacy-ids.json'),JSON.stringify(old));
const protectedBefore=(await p.query('select id from findings where source_document_id=$1 and id<>all($2)',[doc.id,old])).rows.map(x=>x.id);
await mode('confirmation-prompt');await c.call('Page.reload');await delay(2000);
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Reports and decks')).click()");await delay(500);
const clickReport="(()=>{const li=[...document.querySelectorAll('li')].find(x=>x.innerText.includes('synthetic-complete.txt')&&[...x.querySelectorAll('button')].some(b=>b.innerText==='Run again'));[...li.querySelectorAll('button')].find(b=>b.innerText==='Run again').closest('form').requestSubmit()})()";
await c.eval(clickReport);await delay(8000);
let text=await c.eval('document.body.innerText');fs.writeFileSync(path.join(dir,'B5-prompt.txt'),text);await c.shot('B5-prompt');
assert(text.includes('predate review tracking'));const offered=await c.eval("[...document.querySelectorAll('input[name=findingId]')].map(i=>i.value)");assert(old.every(id=>offered.includes(id)));
process.env.DEFAULT_TENANT_ID=ids.tenant;const db=mod('src/lib/db.ts',{pg:{Pool:class{constructor(){return app}}}}),prov=mod('src/lib/findingProvenance.ts'),actions=mod('src/lib/findingActions.ts',{'next/cache':{revalidatePath(){}},'./db':db,'./findingProvenance':prov});
await actions.setFindingStatus(ids.run,old[0],'accepted');
await mode('complete');
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Re-read and replace')).closest('form').requestSubmit()");await delay(10000);
assert((await p.query('select id from findings where id=$1',[old[0]])).rowCount===1);assert((await p.query('select id from findings where id=$1',[old[1]])).rowCount===0);assert((await p.query('select id from finding_history where original_finding_id=$1',[old[1]])).rowCount===1);
assert((await p.query('select id from findings where id=any($1)',[protectedBefore])).rowCount===protectedBefore.length);
await c.call('Page.reload');await delay(2000);text=await c.eval('document.body.innerText');fs.writeFileSync(path.join(dir,'B5-confirmed.txt'),text);await c.shot('B5-confirmed');
results.push({id:'B5',status:'passed',offered,reviewedAfterPrompt:old[0],retired:old[1],protectedBefore});save();
// Native downstream failure/retry; capture real action outputs rather than mocked refresh calls.
await mode('downstream-fail');await c.eval(clickReport);await delay(8000);
const errs=(await p.query("select event,detail from trace where run_id=$1 and event='decision_framer_error' order by id desc limit 1",[ids.run])).rows;assert(errs.length&&JSON.stringify(errs).includes('Controlled synthetic failure'));
assert((await p.query('select id from findings where id=$1',[old[0]])).rowCount===1);
await mode('complete');await c.eval(clickReport);await delay(9000);
assert((await p.query('select id from findings where id=$1',[old[0]])).rowCount===1);
results.push({id:'D2',status:'passed',failureTrace:errs});save();
const counts={};for(const table of ['verdicts','insights','decision_candidates','synthesized_insights','recommendations','objective_quality']){
const sql=table==='verdicts'?'select count(*)::int n from verdicts v join findings f on f.id=v.finding_id where f.run_id=$1':'select count(*)::int n from '+table+' where run_id=$1';counts[table]=(await p.query(sql,[ids.run])).rows[0].n;
}
const events=JSON.parse(fs.readFileSync(path.join(dir,'model-events.json'))),tools=[...new Set(events.map(e=>e.name))];
const traces=(await p.query("select event,detail from trace where run_id=$1 and event like '%error%' order by id",[ids.run])).rows;
fs.writeFileSync(path.join(dir,'downstream-state.json'),JSON.stringify({counts,tools,traces},null,2));
assert(Object.values(counts).every(n=>n>0),'Nonempty downstream branch missing: '+JSON.stringify(counts));
results.push({id:'D1',status:'passed',counts,tools,limitations:'Deterministic local model validates orchestration/persistence only; stated-insight validation requires separately eligible fixture if absent'});save();
}catch(e){results.push({status:'failure_or_fixture_gap',error:e.stack});save();console.error(e.stack);process.exitCode=1}finally{c.close();await p.end();await app.end()}})();
