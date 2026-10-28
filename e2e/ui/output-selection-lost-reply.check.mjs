// Batch 65, the rest of B52-F01 (Codex, 28 October 2026): the actual Add files dialog with A, B and C chosen as
// Statistical output. The small-body seam (File.size reported as 60 MB for these names, as in
// independent-upload-controls.check.mjs) makes the dialog send one file per request. A's request reaches the server
// and its write commits; only its reply is dropped. The dialog keeps B and C and offers Upload; the enabled retry
// is used without reloading. Expected: one output set holding A, B and C, each stored once.
import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {openAddFiles} from './helpers/addFiles.mjs';
const target=JSON.parse(readFileSync(process.env.GOLDEN_SMOKE_TARGET_MANIFEST,'utf8'));
if(!target.disposable||!target.syntheticOnly)throw Error('Disposable synthetic target required');
const evidence=path.dirname(process.env.GOLDEN_SMOKE_TARGET_MANIFEST);
test.use({viewport:{width:1600,height:1000}});
test.setTimeout(8*60_000);
const PREFIX='batch65-large-';
async function setup(page,testInfo,name){
 await page.addInitScript((prefix)=>{
  const size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get;
  Object.defineProperty(File.prototype,'size',{configurable:true,get(){return this.name.startsWith(prefix)?60_000_000:size.call(this);}});
 },PREFIX);
 const {bind}=await import(pathToFileURL(path.resolve('e2e/adapter/golden-thread-adapter.mjs')).href);
 const ui=await bind({page,target,testInfo});const run=await ui.createRun({name:name+'-'+Date.now()});
 await page.goto(run.url+'?section=upload',{waitUntil:'networkidle',timeout:180000});
 return run;
}
const csv=(name,seed)=>({name,mimeType:'text/csv',buffer:Buffer.from('term,estimate\n'+name+','+seed+'.5\n')});
async function dbFor(){const db=new pg.Client({connectionString:target.databaseUrlWithoutCredentials.replace('postgres://','postgres://postgres@')});await db.connect();return db;}
test('output selection: a lost first reply after A is stored; the retry adds B and C to the same set',async({page},testInfo)=>{
 const run=await setup(page,testInfo,'output-selection-lost');const db=await dbFor();const requests=[];
 try{
  await page.route('**/runs/**',async route=>{
   const req=route.request(),body=req.postDataBuffer();
   if(req.method()!=='POST'||!req.headers()['next-action']||!body?.includes(Buffer.from(PREFIX)))return route.continue();
   const names=['a','b','c'].filter(n=>body.includes(Buffer.from(PREFIX+'model-'+n+'.csv')));requests.push(names);
   // A's request reaches the server and is answered (its write committed); the browser never gets the answer.
   if(names.includes('a')&&requests.filter(r=>r.includes('a')).length===1){await route.fetch({timeout:180000});return route.abort('failed');}
   return route.continue();
  });
  const panel=await openAddFiles(page);
  const files=[csv(PREFIX+'model-a.csv',1),csv(PREFIX+'model-b.csv',2),csv(PREFIX+'model-c.csv',3)];
  await panel.getByTestId('add-files-input').setInputFiles(files);
  const rows=panel.getByTestId('add-files-row');await expect(rows).toHaveCount(3);
  for(let i=0;i<3;i++)await rows.nth(i).getByRole('combobox').selectOption({label:'Statistical output'});
  await panel.getByPlaceholder('optional, for example Wave 1').fill('Lost reply 65');
  await panel.getByRole('button',{name:/^Upload/}).click();
  await expect(page.getByTestId('add-files-error')).toContainText('did not get an answer from the server',{timeout:60000});
  await expect(rows).toHaveCount(2);
  const afterLoss=(await db.query('select count(*)::int as n from output_sets where run_id=$1',[run.id])).rows[0].n;
  expect(afterLoss).toBe(1);
  // The retry the dialog offers, without reloading.
  const upload=panel.getByRole('button',{name:/^Upload/});await expect(upload).toBeEnabled();await upload.click();
  await expect(panel).toBeHidden({timeout:120000});
  const sets=(await db.query('select s.id,s.wave_label,array_agg(d.source_filename order by d.source_filename) as files from output_sets s join documents d on d.output_set_id=s.id where s.run_id=$1 group by s.id,s.wave_label',[run.id])).rows;
  const docs=(await db.query("select source_filename,count(*)::int as n from documents where run_id=$1 and kind='output' group by source_filename order by source_filename",[run.id])).rows;
  writeFileSync(path.join(evidence,'output-selection-lost-reply-observed.json'),JSON.stringify({requests,sets,docs},null,2));
  expect(requests).toEqual([['a'],['b'],['c']]);
  expect(sets).toHaveLength(1);
  expect(sets[0].files).toEqual([PREFIX+'model-a.csv',PREFIX+'model-b.csv',PREFIX+'model-c.csv']);
  expect(docs.every(d=>d.n===1)).toBe(true);
 }finally{await db.end();}
});
