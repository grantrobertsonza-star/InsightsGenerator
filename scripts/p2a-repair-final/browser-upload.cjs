
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const dir=path.resolve('scripts/p2a-repair-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55502/p2ar_20261015_main'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const c=await connect();try{
await c.call('Page.navigate',{url:'http://127.0.0.1:3113/runs/'+ids.run});await delay(2500);
await c.eval("sessionStorage.setItem('run-section:'+location.pathname,'upload')");await c.call('Page.reload');await delay(2000);
for(const filename of ['cases.csv','sparse-dense.xlsx']){
const dom=await c.call('DOM.getDocument'),input=await c.call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[name=rawTableFiles]'});
assert(input.nodeId);await c.call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[path.join(dir,filename)]});
await c.eval("document.querySelector('input[name=rawTableFiles]').closest('form').requestSubmit()");await delay(3000);
const row=(await p.query('select id,storage_path from documents where run_id=$1 and source_filename=$2',[ids.run,filename])).rows;assert.equal(row.length,1,filename);
}
fs.writeFileSync(path.join(dir,'browser-documents.json'),JSON.stringify((await p.query('select id,source_filename,selected_sheet,storage_path from documents where run_id=$1',[ids.run])).rows,null,2));
fs.writeFileSync(path.join(dir,'browser-upload.txt'),await c.eval('document.body.innerText'));await c.shot('browser-upload');console.log((await c.eval('document.body.innerText')).slice(-4400));
}catch(e){fs.writeFileSync(path.join(dir,'browser-upload-error.txt'),e.stack);console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
