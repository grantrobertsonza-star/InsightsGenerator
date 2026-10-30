// Retained from Codex's independent Batch 52 review (28 October 2026, work/review-b52-f9b8f7e7-20261028), unchanged
// below this header: B52-F01 (one statistical-output selection stays one output set across transport batches),
// B52-F02 (a queued file removed before its request starts is not uploaded), and the lost-reply recovery control.
import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {openAddFiles,addFiles} from './helpers/addFiles.mjs';
const target=JSON.parse(readFileSync(process.env.GOLDEN_SMOKE_TARGET_MANIFEST,'utf8'));
if(!target.disposable||!target.syntheticOnly)throw Error('Disposable synthetic target required');
const evidence=path.dirname(process.env.GOLDEN_SMOKE_TARGET_MANIFEST);
test.use({viewport:{width:1600,height:1000}});
test.setTimeout(8*60_000);
async function setup(page,testInfo,name){
 // Control client batching with small transport bodies. The supplied native check proves real 120 MB transport.
 await page.addInitScript(()=>{
  const size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get;
  Object.defineProperty(File.prototype,'size',{configurable:true,get(){return this.name.startsWith('batch52-large-')?60_000_000:size.call(this);}});
 });
 const {bind}=await import(pathToFileURL(path.resolve('e2e/adapter/golden-thread-adapter.mjs')).href);
 const ui=await bind({page,target,testInfo});const run=await ui.createRun({name:name+'-'+Date.now()});
 await page.goto(run.url+'?section=upload',{waitUntil:'networkidle',timeout:180000});
 return run;
}
const csv=(name,seed)=>({name,mimeType:'text/csv',buffer:Buffer.from('id,score\n1,'+seed+'\n2,'+(seed+1)+'\n')});
async function dbFor(){const db=new pg.Client({connectionString:target.databaseUrlWithoutCredentials.replace('postgres://','postgres://postgres@')});await db.connect();return db;}
async function choose(page,files,type='Raw data'){
 const panel=await openAddFiles(page);await panel.getByTestId('add-files-input').setInputFiles(files);
 const rows=panel.getByTestId('add-files-row');await expect(rows).toHaveCount(files.length);
 for(let i=0;i<files.length;i++)await rows.nth(i).getByRole('combobox').selectOption({label:type});
 return panel;
}
test('independent: lost first response preserves unsent and newly selected files; retry does not resend the unknown batch',async({page},testInfo)=>{
 const run=await setup(page,testInfo,'upload-unknown');const db=await dbFor();
 let release;const gate=new Promise(r=>release=r);let arrived;const held=new Promise(r=>arrived=r);const requests=[];
 try{
  await page.route('**/runs/**',async route=>{
   const req=route.request(),body=req.postDataBuffer();
   if(req.method()!=='POST'||!req.headers()['next-action']||!body?.includes(Buffer.from('batch52-large-')))return route.continue();
   const names=['a','b','c','d'].filter(n=>body.includes(Buffer.from('batch52-large-'+n+'.csv')));requests.push(names);
   if(names.includes('a')){await route.fetch({timeout:180000});arrived();await gate;return route.abort('failed');}
   return route.continue();
  });
  const panel=await choose(page,[csv('batch52-large-a.csv',11),csv('batch52-large-b.csv',21),csv('batch52-large-c.csv',31)]);
  await panel.getByRole('button',{name:/^Upload/}).click();await held;
  await panel.getByTestId('add-files-input').setInputFiles(csv('batch52-large-d.csv',41));
  await expect(panel.getByTestId('add-files-row')).toHaveCount(4);release();
  await expect(page.getByTestId('add-files-error')).toContainText('did not get an answer from the server',{timeout:60000});
  await expect(page.getByTestId('add-files-error')).toContainText('Reload the page');
  await expect(panel.getByTestId('add-files-row')).toHaveCount(3);
  expect(requests).toEqual([['a']]);
  await panel.getByRole('button',{name:/^Upload/}).click();
  await expect(page.getByTestId('add-files-message')).toContainText('Added 3 files',{timeout:120000});
  await expect(panel).toBeHidden();
  const rows=(await db.query('select source_filename,count(*)::int as n from documents where run_id=$1 group by source_filename order by source_filename',[run.id])).rows;
  writeFileSync(path.join(evidence,'unknown-response-observed.json'),JSON.stringify({requests,rows},null,2));
  expect(rows).toHaveLength(4);expect(rows.every(r=>r.n===1)).toBe(true);expect(requests.flat()).toEqual(['a','b','c','d']);
 }finally{release?.();await db.end();}
});
test('independent: removing a queued file before its request starts prevents its upload',async({page},testInfo)=>{
 const run=await setup(page,testInfo,'upload-remove');const db=await dbFor();let release;const gate=new Promise(r=>release=r);let arrived;const held=new Promise(r=>arrived=r);const requests=[];
 try{
  await page.route('**/runs/**',async route=>{
   const req=route.request(),body=req.postDataBuffer();
   if(req.method()!=='POST'||!req.headers()['next-action']||!body?.includes(Buffer.from('batch52-large-')))return route.continue();
   const names=['remove-a','remove-b'].filter(n=>body.includes(Buffer.from('batch52-large-'+n+'.csv')));requests.push(names);
   if(names.includes('remove-a')){const response=await route.fetch({timeout:180000});arrived();await gate;return route.fulfill({response});}
   return route.continue();
  });
  const panel=await choose(page,[csv('batch52-large-remove-a.csv',51),csv('batch52-large-remove-b.csv',61)]);
  await panel.getByRole('button',{name:/^Upload/}).click();await held;
  await panel.getByRole('button',{name:'Remove batch52-large-remove-b.csv',exact:true}).click();
  await expect(panel.getByTestId('add-files-row')).toHaveCount(1);release();
  await expect(panel).toBeHidden({timeout:120000});
  const rows=(await db.query('select source_filename from documents where run_id=$1 order by source_filename',[run.id])).rows;
  writeFileSync(path.join(evidence,'removed-queued-file-observed.json'),JSON.stringify({requests,rows},null,2));
  expect(rows.map(r=>r.source_filename)).toEqual(['batch52-large-remove-a.csv']);
 }finally{release?.();await db.end();}
});
test('independent: one statistical-output selection retains one output set across transport batches',async({page},testInfo)=>{
 const run=await setup(page,testInfo,'upload-output-set');const db=await dbFor();
 try{
  const control=[csv('control-model-coefficients.csv',71),csv('control-model-fit.csv',81)];
  await addFiles(page,control,'Statistical output');
  const before=(await db.query('select id,wave_label from output_sets where run_id=$1',[run.id])).rows;expect(before).toHaveLength(1);
  const files=[csv('batch52-large-model-coefficients.csv',91),csv('batch52-large-model-fit.csv',101)];
  const panel=await choose(page,files,'Statistical output');await panel.getByPlaceholder('optional, for example Wave 1').fill('One study 52');
  await panel.getByRole('button',{name:/^Upload/}).click();await expect(panel).toBeHidden({timeout:120000});
  const sets=(await db.query('select s.id,s.wave_label,array_agg(d.source_filename order by d.source_filename) as files from output_sets s join documents d on d.output_set_id=s.id where s.run_id=$1 group by s.id,s.wave_label order by s.wave_label nulls first',[run.id])).rows;
  writeFileSync(path.join(evidence,'output-set-observed.json'),JSON.stringify({before,sets},null,2));
  expect(sets.filter(s=>s.wave_label==='One study 52')).toHaveLength(1);
  expect(sets.find(s=>s.wave_label==='One study 52').files).toHaveLength(2);
 }finally{await db.end();}
});
