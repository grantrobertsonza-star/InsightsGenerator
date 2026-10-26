
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs'),dir=path.resolve('scripts/p2a-integration/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55498/p2a_20261015_main'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
const results=[],save=()=>fs.writeFileSync(path.join(dir,'browser-recovery-results.json'),JSON.stringify(results,null,2));
(async()=>{const c=await connect();try{
const select=async name=>{await c.eval("[...document.querySelectorAll('p[title]')].find(p=>p.title==="+JSON.stringify(name)+").click()");await delay(800);await c.eval("[...document.querySelectorAll('summary')].filter(s=>['Preview what was read','Data quality','Variables'].includes(s.innerText)).forEach(s=>{if(!s.parentElement.open)s.click()})");await delay(1800)};
await c.call('Page.reload');await delay(1800);await select('unsupported-id.xlsx');
let text=await c.eval('document.body.innerText');assert(text.includes('AccountID')&&text.includes('blanked out')&&text.includes('re-upload'));assert(text.includes('0007')&&text.includes('0008'));
fs.writeFileSync(path.join(dir,'G5-warning-reload.txt'),text);await c.shot('G5-warning-reload');results.push({gate:'G5',browser:'passed'});save();
const doc=(await p.query("select id from documents where run_id=$1 and source_filename='sparse-dense.xlsx'",[ids.run])).rows[0].id;
const before=(await p.query('select id from document_tables where document_id=$1 and crosstab is not null',[doc])).rows.map(x=>x.id);
await p.query("update documents set selected_sheet='Removed' where id=$1",[doc]);await c.call('Page.reload');await delay(1800);await select('sparse-dense.xlsx');
text=await c.eval('document.body.innerText');fs.writeFileSync(path.join(dir,'G6-missing-sheet.txt'),text);await c.shot('G6-missing-sheet');assert(text.includes('Removed'));
const panel=await c.eval("(()=>{const s=[...document.querySelectorAll('summary')].find(s=>s.innerText==='Preview what was read');return s.parentElement.innerText})()");assert(panel.includes('Removed'));assert(!panel.includes('001\t0'));
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Analytics')).click()");await delay(500);await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('sparse-dense.xlsx')).click()");await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Crosstabs')).click()");await delay(1700);
text=await c.eval('document.body.innerText');fs.writeFileSync(path.join(dir,'G6-missing-workspace.txt'),text);await c.shot('G6-missing-workspace');assert(text.includes('Removed'));
assert.deepEqual((await p.query('select id from document_tables where document_id=$1 and crosstab is not null',[doc])).rows.map(x=>x.id),before);
results.push({gate:'G6',missingPreview:'passed',missingCalculation:'passed',oldSavedTables:before});save();
// Recovery is a new upload, not silent reselection of the broken document.
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Close (Esc)'))?.click()");await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText==='Import data').click()");await delay(300);
const recovery=path.join(dir,'recovered-sparse-dense.xlsx');fs.copyFileSync(path.join(dir,'sparse-dense.xlsx'),recovery);
const dom=await c.call('DOM.getDocument'),input=await c.call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[name=rawTableFiles]'});await c.call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[recovery]});await c.eval("document.querySelector('input[name=rawTableFiles]').closest('form').requestSubmit()");await delay(2500);
await select('recovered-sparse-dense.xlsx');text=await c.eval('document.body.innerText');assert(text.includes('40 rows'));fs.writeFileSync(path.join(dir,'G6-reupload-recovered.txt'),text);await c.shot('G6-reupload-recovered');
const recovered=(await p.query("select id,selected_sheet from documents where run_id=$1 and source_filename='recovered-sparse-dense.xlsx'",[ids.run])).rows[0];assert.equal(recovered.selected_sheet,'Dense');results.find(x=>x.gate==='G6').reupload='passed';save();
}catch(e){results.push({status:'failed_or_timing_error',error:e.stack});save();console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
