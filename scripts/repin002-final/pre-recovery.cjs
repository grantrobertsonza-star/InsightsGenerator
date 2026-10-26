
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),f=JSON.parse(fs.readFileSync(path.join(dir,'pre-fixture.json'))),p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_pre'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const c=await connect();try{
await c.call('Page.reload');await delay(1800);await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText==='Run again').closest('form').requestSubmit()");await delay(7000);
assert((await c.eval('document.body.innerText')).includes('predates review tracking'));await c.shot('B6-post-migration-prompt');
await fetch('http://127.0.0.1:55005/__fixture',{method:'POST',headers:{'x-repin002-token':'repin002-final-synthetic'},body:JSON.stringify({mode:'complete'})});
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Re-read and replace')).closest('form').requestSubmit()");await delay(9000);
assert.equal((await p.query('select id from findings where id=$1',[f.finding])).rowCount,0);
assert.equal((await p.query('select processing_status from documents where id=$1',[f.document])).rows[0].processing_status,'ready');
await c.call('Page.reload');await delay(2000);const text=await c.eval('document.body.innerText');assert(!text.includes('Re-read and replace'));fs.writeFileSync(path.join(dir,'B6-recovered.txt'),text);await c.shot('B6-recovered');
fs.writeFileSync(path.join(dir,'pre-browser-results.json'),JSON.stringify({id:'B6',status:'passed',preMigration:'passed',postMigrationRecovery:'passed',finding:f.finding},null,2));
}catch(e){fs.writeFileSync(path.join(dir,'pre-recovery-error.txt'),e.stack);console.error(e.stack);process.exitCode=1}finally{c.close();await p.end()}})();
