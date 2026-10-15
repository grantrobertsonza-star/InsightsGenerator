// Retained body of the initial native submission executed through node stdin.
// Saved after execution for replay; this file itself was not rerun.
const fs=require('fs'),path=require('path'),{connect}=require('./cdp.cjs');
(async()=>{const c=await connect();try{
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText.startsWith('Reports and decks')).click()");
await new Promise(r=>setTimeout(r,1000));
await c.eval("[...document.querySelectorAll('button')].find(b=>b.innerText==='Extract findings').closest('form').requestSubmit()");
await new Promise(r=>setTimeout(r,10000));
const dir=path.resolve('scripts/repin002-final/runs/authorized');
fs.writeFileSync(path.join(dir,'after-complete-extraction.txt'),await c.eval('document.body.innerText'));
await c.shot('complete-extraction');
}finally{c.close()}})();
