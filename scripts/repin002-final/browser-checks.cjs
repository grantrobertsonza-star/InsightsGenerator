
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json')));
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_post'}),results=[];
const save=()=>fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify(results,null,2));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,max=45000){const deadline=Date.now()+max;while(Date.now()<deadline){const v=await fn();if(v)return v;await delay(500)}throw Error('Timeout '+label)}
(async()=>{const c=await connect();try{
await c.call('Page.navigate',{url:'http://127.0.0.1:3106/runs/'+ids.run});await delay(1500);await c.eval("sessionStorage.setItem('run-section:'+location.pathname,'upload')");await c.call('Page.reload');await delay(2000);
const file=path.join(dir,'synthetic-complete.txt'),unit='The synthetic report states that satisfaction is 80% and loyalty is 40%. ';
fs.writeFileSync(file,unit.repeat(Math.ceil(30000/unit.length)).slice(0,30000));
const dom=await c.call('DOM.getDocument'),input=await c.call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[name=reportFiles]'});
assert(input.nodeId,'actual report picker');await c.call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});
await c.eval("document.querySelector('input[name=reportFiles]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('input[name=reportFiles]').closest('form').requestSubmit()");
const doc=await wait(async()=>{const r=await p.query("select id,processing_status,storage_path from documents where run_id=$1 and source_filename='synthetic-complete.txt'",[ids.run]);return r.rows[0]?.processing_status==='ready'?r.rows[0]:null},'upload');
fs.writeFileSync(path.join(dir,'uploaded-document.json'),JSON.stringify(doc));
await delay(2500);console.log(await c.eval("JSON.stringify([...document.querySelectorAll('button')].map(b=>({text:b.innerText,visible:!!b.getClientRects().length})))"));fs.writeFileSync(path.join(dir,'after-upload.txt'),await c.eval('document.body.innerText'));await c.shot('after-upload');
results.push({id:'B1',status:'running',upload:'passed',document:doc});save();
}catch(e){results.push({status:'blocked',error:e.stack});save();console.error(e.stack);process.exitCode=1}
finally{c.close();await p.end()}})();
