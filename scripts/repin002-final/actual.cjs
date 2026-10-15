
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('assert/strict'),{Pool}=require('pg');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),runtime=meta.runtime;
function mod(rel,mocks={}){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(runtime,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(s=>{if(s in mocks)return mocks[s];throw Error('Unlisted dependency '+s)},m,m.exports);return m.exports}
function functions(rel,names,ctx){const sf=ts.createSourceFile(rel,fs.readFileSync(path.join(runtime,rel),'utf8'),99,true,ts.ScriptKind.TSX);let text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf).replace(/^export /,'')).join('\n');return new Function(...Object.keys(ctx),ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+';return {'+names.join(',')+'}')(...Object.values(ctx))}

module.exports={mod,functions,runtime};
