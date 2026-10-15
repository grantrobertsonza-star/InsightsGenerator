// Local/CI gate: installed tools only; integration runners require their own explicit targets.
const cp=require('node:child_process'),path=require('node:path');
const mode=process.argv[2]||'all';
if(!['all','typecheck','tests'].includes(mode))throw Error('Expected all, typecheck or tests');
function run(file,args){const r=cp.spawnSync(process.execPath,[path.resolve(file),...args],{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
if(mode!=='tests'){
 run('node_modules/next/dist/bin/next',['typegen']);
 run('node_modules/typescript/bin/tsc',['--noEmit','--incremental','false','-p','.']);
}
if(mode!=='typecheck')run('node_modules/vitest/vitest.mjs',['run','src/lib/__tests__','--no-cache','--pool=forks','--maxWorkers=2','--minWorkers=1']);
