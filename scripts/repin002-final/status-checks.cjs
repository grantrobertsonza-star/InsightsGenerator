
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),doc=JSON.parse(fs.readFileSync(path.join(dir,'uploaded-document.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_post'});
const results=[],delay=ms=>new Promise(r=>setTimeout(r,ms));const save=()=>fs.writeFileSync(path.join(dir,'status-results.json'),JSON.stringify(results,null,2));
const mode=async m=>{const r=await fetch('http://127.0.0.1:55005/__fixture',{method:'POST',headers:{'x-repin002-token':'repin002-final-synthetic'},body:JSON.stringify({mode:m})});assert.equal(r.status,200)};
async function wait(fn,label){for(let i=0;i<100;i++){const r=await fn();if(r)return r;await delay(300)}throw Error('Timeout '+label)}
(async()=>{const c=await connect();try{
const ui=()=>c.eval('document.body.innerText');
const snapshot=async name=>{fs.writeFileSync(path.join(dir,name+'.txt'),await ui());await c.shot(name)};
const reload=async()=>{await c.call('Page.reload');await delay(1800)};
const reports=async()=>{await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Reports and decks')).click()");await delay(500)};
async function extract(filename){
const n=(await p.query("select count(*)::int n from trace where run_id=$1 and event='process_run_batch'",[ids.run])).rows[0].n;
const expr="(()=>{const li=[...document.querySelectorAll('li')].find(x=>x.innerText.includes("+JSON.stringify(filename)+")&&[...x.querySelectorAll('button')].some(b=>/^(Run again|Extract findings)$/.test(b.innerText)));if(!li)throw Error('Report card not found');const b=[...li.querySelectorAll('button')].find(b=>/^(Run again|Extract findings)$/.test(b.innerText));b.closest('form').requestSubmit();})()";
await c.eval(expr);await wait(async()=>((await p.query("select count(*)::int n from trace where run_id=$1 and event='process_run_batch'",[ids.run])).rows[0].n>n),'native action started');await delay(6500);
}
await reports();
let row=(await p.query('select processing_status from documents where id=$1',[doc.id])).rows[0];assert.equal(row.processing_status,'ready');assert.equal((await p.query('select count(*)::int n from findings where source_document_id=$1',[doc.id])).rows[0].n,2);
await reload();await reports();assert((await ui()).includes('2 findings'));await snapshot('B1-reload');results.push({id:'B1',status:'passed',document:doc.id});save();
const before=(await p.query('select id from findings where source_document_id=$1 order by id',[doc.id])).rows.map(x=>x.id);
await p.query("update findings set human_reviewed_at=now(),human_review_action='accept' where id=$1",[before[0]]);
await mode('partial');await extract('synthetic-complete.txt');
row=(await p.query('select processing_status from documents where id=$1',[doc.id])).rows[0];assert.equal(row.processing_status,'incomplete');assert.deepEqual((await p.query('select id from findings where source_document_id=$1 order by id',[doc.id])).rows.map(x=>x.id),before);
await reload();await reports();const partialText=await ui();assert(/incomplete/i.test(partialText));assert(/retry|try|not applied|previous/i.test(partialText));await snapshot('B2-reread');
results.push({id:'B2',status:'running',reread:'passed',preserved:before});save();
await mode('fail');await extract('synthetic-complete.txt');assert.equal((await p.query('select processing_status from documents where id=$1',[doc.id])).rows[0].processing_status,'failed');
assert.deepEqual((await p.query('select id from findings where source_document_id=$1 order by id',[doc.id])).rows.map(x=>x.id),before);
await reload();await reports();assert(/processing failed/.test(await ui()));assert(/try|failed/i.test(await ui()));await snapshot('B3-reload');results.push({id:'B3',status:'passed'});save();
await mode('complete');
await p.query("update documents set processing_status='incomplete' where id=$1",[doc.id]);
await p.query("create function repin002_final_status_fault() returns trigger language plpgsql as $$begin if new.id='"+doc.id+"'::uuid then raise exception 'Synthetic status-write fault'; end if; return new; end$$");
await p.query('create trigger repin002_final_status_fault before update of processing_status on documents for each row execute function repin002_final_status_fault()');
try{await extract('synthetic-complete.txt');assert.equal((await p.query('select processing_status from documents where id=$1',[doc.id])).rows[0].processing_status,'incomplete');await reload();await reports();const text=await ui();assert(/status/i.test(text)&&/retry|try|could not|couldn't|migration/i.test(text));await snapshot('B4-status-failure');}finally{await p.query('drop trigger repin002_final_status_fault on documents');await p.query('drop function repin002_final_status_fault()')}
await extract('synthetic-complete.txt');assert.equal((await p.query('select processing_status from documents where id=$1',[doc.id])).rows[0].processing_status,'ready');results.push({id:'B4',status:'passed'});save();
// New partial first read via actual upload.
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText==='Import data').click()");await delay(500);
const file=path.join(dir,'synthetic-partial.txt');fs.copyFileSync(path.join(dir,'synthetic-complete.txt'),file);
const dom=await c.call('DOM.getDocument'),input=await c.call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[name=reportFiles]'});await c.call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});await c.eval("document.querySelector('input[name=reportFiles]').closest('form').requestSubmit()");
const partial=await wait(async()=>{const q=(await p.query("select id,processing_status from documents where run_id=$1 and source_filename='synthetic-partial.txt'",[ids.run])).rows[0];return q?.processing_status==='ready'?q:null},'partial upload');
await delay(1800);await reports();await mode('partial');await extract('synthetic-partial.txt');
assert.equal((await p.query('select processing_status from documents where id=$1',[partial.id])).rows[0].processing_status,'incomplete');assert((await p.query('select count(*)::int n from findings where source_document_id=$1',[partial.id])).rows[0].n>0);
await reload();await reports();await snapshot('B2-first-partial');const b2=results.find(r=>r.id==='B2');b2.firstRead='passed';b2.status='passed';save();
}catch(e){results.push({status:'failed_or_harness_error',error:e.stack});save();console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
