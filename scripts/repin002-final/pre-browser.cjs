
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),fixture=JSON.parse(fs.readFileSync(path.join(dir,'pre-fixture.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_pre'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const c=await connect();try{
await fetch('http://127.0.0.1:55005/__fixture',{method:'POST',headers:{'x-repin002-token':'repin002-final-synthetic'},body:JSON.stringify({mode:'confirmation-prompt'})});
await c.call('Page.navigate',{url:'http://127.0.0.1:3107/runs/'+ids.run});await delay(2000);await c.eval("sessionStorage.setItem('run-section:'+location.pathname,'reports')");await c.call('Page.reload');await delay(1800);
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Reports and decks')).click()");await delay(300);
await c.eval("[...document.querySelectorAll('button')].find(b=>/^(Run again|Extract findings)$/.test(b.innerText)).closest('form').requestSubmit()");await delay(8000);
let text=await c.eval('document.body.innerText');fs.writeFileSync(path.join(dir,'B6-pre-migration.txt'),text);await c.shot('B6-pre-migration');
assert(/0094/.test(text));assert(!text.includes('Re-read and replace'));assert((await p.query('select id from findings where id=$1',[fixture.finding])).rowCount===1);
fs.writeFileSync(path.join(dir,'pre-browser-results.json'),JSON.stringify({id:'B6',status:'running',preMigration:'passed',finding:fixture.finding},null,2));
}catch(e){fs.writeFileSync(path.join(dir,'pre-browser-error.txt'),e.stack);console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
