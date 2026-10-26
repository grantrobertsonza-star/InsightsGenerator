// G5 only: real native load/render/selection/reload, never a generate/evaluate/edit submission.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{Pool}=require('pg'),{connect}=require('./cdp.cjs');
const mode=process.argv[2];if(!['post','pre','recovered'].includes(mode))throw Error('Explicit post/pre/recovered phase');
const phase=mode==='post'?'post':'pre',dir=path.resolve('scripts/rule-b-g5/runs/authorized'),port=phase==='post'?3111:3112;
const pool=new Pool({connectionString:'postgres://postgres@127.0.0.1:55501/rulebg5_20261015_'+phase});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function state(){return{evidence:(await pool.query('select * from objective_evidence order by id')).rows,documents:(await pool.query('select * from documents order by id')).rows,generations:(await pool.query('select * from objective_evidence_generations order by id')).rows};}
(async()=>{let c;const result={mode,status:'running',checks:[]};
try{
 const before=await state();fs.writeFileSync(path.join(dir,mode+'-before.json'),JSON.stringify(before,null,2));
 c=await connect();
 async function wait(fn,label){const end=Date.now()+30000;while(Date.now()<end){if(fs.existsSync(path.join(dir,'excluded-app-network.jsonl')))throw Error('Excluded app network attempt; stop affected check');if(await fn())return;await delay(250);}throw Error('Timed out: '+label);}
 async function capture(label){fs.writeFileSync(path.join(dir,label+'.txt'),await c.eval('document.body.innerText'));fs.writeFileSync(path.join(dir,label+'.html'),await c.eval('document.documentElement.outerHTML'));await c.shot(label);}
 async function assertGroups(label){
  const expected=mode==='post'?5:4;
  await wait(()=>c.eval(`document.querySelectorAll('[data-orphaned]').length===${expected} && !!document.querySelector('[data-testid="orphaned-evidence"]')`),'actual evidence panel');
  const view=await c.eval(`JSON.stringify({cards:[...document.querySelectorAll('[data-orphaned]')].map(e=>({orphan:e.dataset.orphaned,identity:e.dataset.identity,text:e.innerText,inside:!!e.closest('[data-testid="orphaned-evidence"]'),visible:!!e.getClientRects().length})),notice:document.querySelector('[data-testid="origin-migration-notice"]')?.innerText??null})`);
  const v=JSON.parse(view),current=v.cards.filter(x=>x.orphan==='false'),orphans=v.cards.filter(x=>x.orphan==='true');
  assert.equal(current.length,1);assert.match(current[0].text,/CURRENT LINKED question/);assert.equal(current[0].inside,false);
  assert.equal(orphans.length,expected-1);assert(orphans.every(x=>x.inside&&x.visible));assert(v.cards.every(x=>x.visible));
  for(const marker of ['UNKNOWN ONE','UNKNOWN TWO'])assert(orphans.some(x=>x.identity==='unknown'&&x.text.includes(marker)));
  assert(orphans.some(x=>x.identity==='linked'&&x.text.includes('REJECTED')));
  if(mode==='post')assert(orphans.some(x=>x.identity==='deleted'&&x.text.includes('DELETED SAME WORDING')));
  if(mode==='pre'){assert.match(v.notice,/0095_objective_evidence_origin/);assert.match(v.notice,/reload/i);}else assert.equal(v.notice,null);
  result.checks.push({label,...v});await capture(label);
 }
 await c.call('Page.navigate',{url:`http://127.0.0.1:${port}/runs/95000000-0000-4000-8000-000000000002`});
 await wait(()=>c.eval("document.body?.innerText.includes('Review Objectives')"),'native page');
 await c.eval("sessionStorage.setItem('run-section:'+location.pathname,'objectives')");await c.call('Page.reload');
 await assertGroups(mode+'-loaded');
 async function select(){
  const ok=await c.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.className.includes('border-l-4')&&b.innerText.includes('Brand awareness'));if(!b)return false;b.click();return true;})()`);assert(ok,'Actual objective selector');
  await wait(()=>c.eval(`!![...document.querySelectorAll('button')].find(b=>b.className.includes('border-l-4')&&b.className.includes('ring-2')&&b.innerText.includes('Brand awareness'))`),'selected objective state');
 }
 await select();await assertGroups(mode+'-selected');
 await c.call('Page.reload');await assertGroups(mode+'-reloaded');await select();await assertGroups(mode+'-reselected');
 const after=await state();assert.deepEqual(after,before,'Browser read/selection/reload must not mutate authoritative rows');
 fs.writeFileSync(path.join(dir,mode+'-after.json'),JSON.stringify(after,null,2));
 result.status='passed';
}catch(e){result.status='failed';result.error=e.stack;if(c){try{fs.writeFileSync(path.join(dir,mode+'-failure.txt'),await c.eval('document.body.innerText'));await c.shot(mode+'-failure');}catch{}}process.exitCode=1;}
finally{fs.writeFileSync(path.join(dir,mode+'-result.json'),JSON.stringify(result,null,2));if(c)c.close();await pool.end();console.log(mode+': '+result.status);if(result.error)console.error(result.error);}
})();
