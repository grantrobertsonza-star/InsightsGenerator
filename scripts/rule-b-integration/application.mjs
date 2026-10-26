// Prepared adapter: real frozen modules; unused engine/model boundaries refuse execution.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
export function application(runtime,pool){
 const cache=new Map();
 const forbidden=new Proxy({}, {get:(_,name)=>()=>{throw Error('Unexpected model/calculation/network boundary: '+String(name));}});
 const mocks={'pg':{Pool:class{connect(){return pool.connect();}}},
  './anthropic':{anthropic:forbidden,CLAUDE_MODEL:'disabled'},'./apiUsage':forbidden,
  './crosstabs':forbidden,'./surveyDesign':forbidden,'./dataSetup':forbidden,
  './crosstabAsk':forbidden,'./starterTables':forbidden};
 function load(name){
  if(cache.has(name))return cache.get(name);
  const mod={exports:{}};cache.set(name,mod.exports);
  const file=path.join(runtime,'src/lib',name+'.ts');
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',js)(id=>{
   if(id in mocks)return mocks[id];
   if(['./db','./text','./statsFileName','./evidenceStance'].includes(id))return load(id.slice(2));
   throw Error('Unexpected module '+id);
  },mod,mod.exports);
  cache.set(name,mod.exports);return mod.exports;
 }
 if(globalThis.pgPool)throw Error('Ambient pgPool exists; use a fresh dedicated child process');
 // db.ts receives the supplied pool through the explicit mock, never an ambient URL.
 return {...load('db'),...load('objectiveEvidence')};
}
