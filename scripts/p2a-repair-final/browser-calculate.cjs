
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs'),dir=path.resolve('scripts/p2a-repair-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55502/p2ar_20261015_main'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const c=await connect();try{
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Analytics')).click()");await delay(400);
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('sparse-dense.xlsx')).click()");
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Crosstabs')).click()");await delay(1800);
await c.eval("[...document.querySelectorAll('button')].filter(b=>b.innerText==='Row'&&b.getClientRects().length&&['Q1','Q1 (3)','Q1 (2)'].includes(b.parentElement.parentElement.querySelector('[title]')?.title)).forEach(b=>b.click())");await delay(400);
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText==='Add table to set').click()");
const doc=(await p.query("select id from documents where run_id=$1 and source_filename='sparse-dense.xlsx'",[ids.run])).rows[0].id;
let row;for(let i=0;i<80;i++){row=(await p.query('select id,crosstab,overrides_snapshot from document_tables where document_id=$1 and crosstab is not null order by created_at desc limit 1',[doc])).rows[0];if(row)break;await delay(300)}
assert(row,'native saved calculation');assert.equal(row.crosstab.provenance.selectedSheet,'Dense');assert.equal(row.overrides_snapshot['Q1 (2)'].type,'continuous');assert.deepEqual(Object.keys(row.overrides_snapshot),['Q1 (2)']);
const q=row.crosstab.questions;assert.equal(q.length,3);for(const question of q.filter(x=>x.key==='Q1'||x.key==='Q1 (3)'))for(const r of question.rows.filter(r=>!r.isBase))assert.equal(r.total.pct,50);
fs.writeFileSync(path.join(dir,'browser-native-calculation.json'),JSON.stringify(row,null,2));
await delay(1200);fs.writeFileSync(path.join(dir,'browser-native-calculation.txt'),await c.eval('document.body.innerText'));await c.shot('browser-native-calculation');
await c.call('Page.reload');await delay(2000);await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('sparse-dense.xlsx')).click()");await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Crosstabs')).click()");await delay(1400);
const text=await c.eval('document.body.innerText');assert(text.includes('Dense'));assert(text.includes('All tables (1)'));fs.writeFileSync(path.join(dir,'browser-calculation-reload.txt'),text);await c.shot('browser-calculation-reload');
}catch(e){fs.writeFileSync(path.join(dir,'browser-calculate-error.txt'),e.stack);console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
