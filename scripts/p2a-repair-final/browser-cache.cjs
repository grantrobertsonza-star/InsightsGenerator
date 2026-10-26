const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const dir=path.resolve('scripts/p2a-repair-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json')));
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55502/p2ar_20261015_main'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const c=await connect();try{
 const doc=(await p.query("select id from documents where run_id=$1 and source_filename='sparse-dense.xlsx'",[ids.run])).rows[0].id;
 async function wait(fn,label){for(let i=0;i<100;i++){if(await fn())return;await delay(200);}throw Error('Timeout '+label);}
 async function select(){await wait(()=>c.eval("!![...document.querySelectorAll('p[title]')].find(p=>p.title==='sparse-dense.xlsx')"),'file list');await c.eval("[...document.querySelectorAll('p[title]')].find(p=>p.title==='sparse-dense.xlsx').click()");}
 async function shot(name){fs.writeFileSync(path.join(dir,name+'.txt'),await c.eval('document.body.innerText'));await c.shot(name);}
 await select();await c.eval("[...document.querySelectorAll('summary')].filter(s=>s.innerText==='Preview what was read').forEach(s=>{if(!s.parentElement.open)s.click()})");
 await wait(()=>c.eval("document.body.innerText.includes('40 rows')"),'initial cached preview');await shot('cached-valid-before');
 const before=(await p.query('select * from document_tables where document_id=$1 order by id',[doc])).rows;
 await p.query("update documents set selected_sheet='Removed' where id=$1",[doc]);
 await c.call('Page.reload');await select();
 await wait(()=>c.eval("!!document.querySelector('[data-testid=import-preview-recovery]')"),'recovery block');
 const text=await c.eval('document.body.innerText');assert(text.includes('Removed'));assert(text.includes('re-upload'));assert(!text.includes('40 rows'));
 assert.equal(await c.eval("[...document.querySelectorAll('summary')].filter(s=>s.innerText==='Preview what was read').length"),0);
 assert.equal(await c.eval("[...document.querySelectorAll('select[aria-label]')].filter(s=>s.getAttribute('aria-label').startsWith('Data type:')).length"),0);
 await delay(1200);assert.deepEqual((await p.query('select * from document_tables where document_id=$1 order by id',[doc])).rows,before,'No automatic reread or table replacement');await shot('cached-missing-sheet-recovery');
 await p.query("update documents set selected_sheet='Dense' where id=$1",[doc]);await c.call('Page.reload');await select();
 await wait(()=>c.eval("!document.querySelector('[data-testid=import-preview-recovery]') && [...document.querySelectorAll('summary')].some(s=>s.innerText==='Variables')"),'restored preview');
 await c.eval("[...document.querySelectorAll('summary')].filter(s=>['Preview what was read','Variables'].includes(s.innerText)).forEach(s=>{if(!s.parentElement.open)s.click()})");
 await wait(()=>c.eval("!!document.querySelector('select[aria-label=\"Data type: Q1 (2)\"]')"),'correction picker');await shot('cached-recovered');
 fs.writeFileSync(path.join(dir,'cached-preview-result.json'),JSON.stringify({status:'passed',document:doc,missingSheetWithheld:true,noAutomaticReread:true,restoredSelectionRecovered:true},null,2));
 console.log('Cached preview/recovery passed.');
}catch(e){fs.writeFileSync(path.join(dir,'cached-preview-error.txt'),e.stack);console.error(e.stack);process.exitCode=1;}finally{c.close();await p.end();}})();
