// Local/CI gate: installed tools only; integration runners require their own explicit targets.
const cp=require('node:child_process'),path=require('node:path');
const mode=process.argv[2]||'all';
if(!['all','typecheck','tests'].includes(mode))throw Error('Expected all, typecheck or tests');
function run(file,args){const r=cp.spawnSync(process.execPath,[path.resolve(file),...args],{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
if(mode!=='tests'){
 run('node_modules/next/dist/bin/next',['typegen']);
 run('node_modules/typescript/bin/tsc',['--noEmit','--incremental','false','-p','.']);
}
// VALIDATE_REQUIRE_INTEGRATION=1 (set in CI): the real-database and Python-engine suites must
// actually run. Each of them, when its prerequisite is missing, runs a visible "NOT RUN"
// placeholder instead of passing silently; in this mode a file whose only result is such a
// placeholder fails the gate.
if(mode!=='typecheck'){
 const strict=process.env.VALIDATE_REQUIRE_INTEGRATION==='1';
 const report=path.join(require('node:os').tmpdir(),'validate-vitest-'+process.pid+'.json');
 // Limit discovery itself: a substring filter also collects archived verification copies below scripts/.
 run('node_modules/vitest/vitest.mjs',['run','--dir','src/lib/__tests__','--no-cache','--pool=forks','--maxWorkers=2','--minWorkers=1',...(strict?['--reporter=default','--reporter=json','--outputFile='+report]:[])]);
 if(strict){
  const fs=require('node:fs');
  const results=JSON.parse(fs.readFileSync(report,'utf8')).testResults;
  // A placeholder is always reported as skipped, also when its real suite ran (it is the inactive
  // branch then). By convention the placeholder sits in a describe block with the SAME title as the
  // real suite, so the real suite ran when a test under that same describe path passed.
  const key=a=>JSON.stringify(a.ancestorTitles);
  const notRun=results.flatMap(f=>f.assertionResults.filter(a=>/NOT RUN/.test(a.title)&&!f.assertionResults.some(b=>b.status==='passed'&&key(b)===key(a))).map(a=>path.relative(process.cwd(),f.name)+' > '+a.ancestorTitles.join(' > ')));
  fs.rmSync(report,{force:true});
  if(notRun.length){console.error('Integration suites did not run:\n'+notRun.join('\n'));process.exit(1);}
  console.log('All real-database and Python-engine suites ran (no NOT RUN placeholders).');
 }
}
