// Actual named bodies, reused technique from retained OBJ-REV-009/support-union harnesses.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
export function functions(file,names,context={}){
 const sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf).replace(/^export /,'')).join('\n');
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(context),js+';return {'+names.join(',')+'}')(...Object.values(context));
}
export function moduleExports(file,mocks={}){
 const mod={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',js)(s=>{if(s in mocks)return mocks[s];throw Error('Unexpected external dependency '+s)},mod,mod.exports);
 return mod.exports;
}
export function application(pool){
 const provenance=moduleExports('src/lib/findingProvenance.ts');
 const archive=moduleExports('src/lib/findingArchive.ts',{'./findingProvenance':provenance});
 // Actual wrapper; Pool configuration cannot use ambient DATABASE_URL.
 const db=moduleExports('src/lib/db.ts',{pg:{Pool:class{connect(){return pool.connect()}}}});
 const publication=functions('src/lib/extractFindings.ts',
 ['normaliseQuote','normaliseClaim','claimIdentityKey','citedIds','planReplacement','publishReplacement'],
 {...provenance,...archive});
 const actions=moduleExports('src/lib/findingActions.ts',{'next/cache':{revalidatePath(){}},'./db':db,'./findingProvenance':provenance});
 return {...provenance,...archive,...db,...publication,...actions};
}
