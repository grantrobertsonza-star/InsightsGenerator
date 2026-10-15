
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs'),dir=path.resolve('scripts/p2a-integration/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55498/p2a_20261015_main'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const c=await connect();try{
const target=(await p.query("select id from documents where run_id=$1 and source_filename='sparse-dense.xlsx'",[ids.run])).rows[0].id;
const change="(()=>{const r=[...document.querySelectorAll('tr')].find(r=>r.querySelector('td')?.textContent==='Q1 (2)');const s=r.querySelector('select');s.value='continuous';s.dispatchEvent(new Event('change',{bubbles:true}));})()";
await c.eval(change);
for(let i=0;i<50;i++){const q=(await p.query('select variable_overrides from documents where id=$1',[target])).rows[0].variable_overrides;if(q['Q1 (2)']?.type==='continuous')break;await delay(300)}
const overrides=(await p.query('select variable_overrides from documents where id=$1',[target])).rows[0].variable_overrides;assert.deepEqual(Object.keys(overrides),['Q1 (2)']);assert.equal(overrides['Q1 (2)'].type,'continuous');
await c.call('Page.reload');await delay(1800);await c.eval("[...document.querySelectorAll('p[title]')].find(p=>p.title==='sparse-dense.xlsx').click()");await delay(800);
await c.eval("(()=>{const s=[...document.querySelectorAll('summary')].find(s=>s.innerText==='Variables');if(!s.parentElement.open)s.click()})()");await delay(1000);
const values=await c.eval("[...document.querySelectorAll('tr')].filter(r=>r.querySelector('td')).map(r=>({name:r.querySelector('td').textContent,type:r.querySelector('select')?.value}))");assert.equal(values.find(r=>r.name==='Q1 (2)').type,'continuous');assert.notEqual(values.find(r=>r.name==='Q1').type,'continuous');assert.notEqual(values.find(r=>r.name==='Q1 (3)').type,'continuous');
fs.writeFileSync(path.join(dir,'browser-correction-saved.json'),JSON.stringify({document:target,overrides,visible:values},null,2));fs.writeFileSync(path.join(dir,'browser-correction-saved.txt'),await c.eval('document.body.innerText'));await c.shot('browser-correction-saved');
}catch(e){fs.writeFileSync(path.join(dir,'browser-correction-error.txt'),e.stack);console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
