
const fs=require('fs'),path=require('path'),cp=require('child_process'),{Pool}=require('pg');
const dir=path.resolve('scripts/p2a-repair-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),storage=JSON.parse(fs.readFileSync(path.join(dir,'storage-setup.json')));
const docker=(a)=>cp.execFileSync('docker',a,{encoding:'utf8',maxBuffer:64e6});
const record={started:new Date().toISOString(),processes:[],retained:[],cleanup:[]},save=()=>fs.writeFileSync(path.join(dir,'cleanup.json'),JSON.stringify(record,null,2));
function stop(file,kind){
const x=JSON.parse(fs.readFileSync(path.join(dir,file))),pid=x.pid;
const command=cp.execFileSync('powershell',['-NoProfile','-Command','$p=Get-CimInstance Win32_Process -Filter "ProcessId = '+pid+'";if($p){$p.CommandLine}'],{encoding:'utf8'}).trim();
if(!command){record.processes.push({pid,status:'already stopped'});return}
if(kind==='chrome'?!command.includes(x.profile):!command.includes('next')||!command.includes(kind))throw Error('Process ownership check failed '+pid);
cp.execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{encoding:'utf8'});record.processes.push({pid,status:'recorded owned process tree stopped'});save();
}
(async()=>{try{
const crypto=require('crypto'),manifest=JSON.parse(fs.readFileSync('scripts/p2a-repair-final/source-manifest.json')),changes={};
for(const [name,hash]of Object.entries(manifest.files)){const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(meta.runtime,name))).digest('hex');if(actual!==hash)changes[name]={before:hash,after:actual};}
fs.writeFileSync(path.join(dir,'source-after.json'),JSON.stringify({archive:manifest.archive_sha256,changes},null,2));
if(Object.keys(changes).some(n=>n!=='next-env.d.ts'))throw Error('Application source changed; retain environment');

stop('browser-process.json','chrome');stop('app-start-process.json','3113');
for(const id of [meta.pgId,storage.containerId]){const x=JSON.parse(docker(['inspect',id]))[0];if(x.Id!==id||x.Config.Labels['codex.p2a-parser']!=='p2a-repair-20261015')throw Error('Container ownership mismatch');record.retained.push({containerId:id,imageId:x.Image,bindings:x.HostConfig.PortBindings,mounts:x.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination}))});}
for(const suffix of ['base','pre0093','main','storage']){
const db='p2ar_20261015_'+suffix;
fs.writeFileSync(path.join(dir,'database-'+suffix+'.sql'),docker(['exec',meta.pgId,'pg_dump','-h','127.0.0.1','-U','postgres','-d',db]));
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55502/'+db});
const schemas=(await p.query("select schemaname,tablename,tableowner from pg_tables where schemaname in ('public','storage') order by 1,2")).rows;
fs.writeFileSync(path.join(dir,'owners-'+suffix+'.json'),JSON.stringify(schemas,null,2));await p.end();
}
const pglogs=cp.spawnSync('docker',['logs',meta.pgId],{encoding:'utf8',maxBuffer:64e6});fs.writeFileSync(path.join(dir,'postgres-final.stdout.log'),pglogs.stdout||'');fs.writeFileSync(path.join(dir,'postgres-final.stderr.log'),pglogs.stderr||'');
const storageLogs=cp.spawnSync('docker',['logs',storage.containerId],{encoding:'utf8',maxBuffer:64e6});const log=(storageLogs.stdout||'')+'\nSTDERR:\n'+(storageLogs.stderr||'');fs.writeFileSync(path.join(dir,'storage-final.log'),log.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[synthetic JWT redacted]'));
docker(['cp',storage.containerId+':/var/lib/storage',path.join(dir,'synthetic-storage-files')]);
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55502/p2ar_20261015_storage'});
const objects=(await p.query('select bucket_id,name,metadata from storage.objects order by name')).rows;
fs.writeFileSync(path.join(dir,'storage-objects.json'),JSON.stringify(objects,null,2));await p.end();
save();
docker(['stop',storage.containerId]);docker(['rm',storage.containerId]);record.cleanup.push({resource:storage.containerId,status:'removed'});
docker(['stop',meta.pgId]);record.cleanup.push({resource:meta.pgId,status:'stopped and --rm removed tmpfs'});
const volume='p2a-repair-20261015-storage';docker(['volume','rm',volume]);record.cleanup.push({resource:volume,status:'removed'});
const runtime=path.resolve(meta.runtime),expected=path.resolve(require('os').tmpdir(),'p2a-repair-20261015-runtime');
if(runtime!==expected||runtime===path.resolve(process.cwd())||!runtime.endsWith('p2a-repair-20261015-runtime'))throw Error('Unsafe runtime cleanup target');
const junction=path.join(runtime,'node_modules');if(fs.lstatSync(junction).isSymbolicLink())fs.unlinkSync(junction);else throw Error('Expected dependency junction');
fs.rmSync(runtime,{recursive:true});record.cleanup.push({resource:runtime,status:'dedicated extracted runtime/profile/build removed'});
fs.unlinkSync(path.join(dir,'local-keys.json'));record.cleanup.push({resource:'local-keys.json',status:'synthetic temporary key removed'});
const extra=JSON.parse(cp.execFileSync('powershell',['-NoProfile','-Command',"Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|python|python3)\\.exe$' -and ($_.CommandLine -like '*scripts/p2a-repair-final/proxy.cjs*' -or $_.CommandLine -like '*scripts/p2a-repair-final/browser.cjs*' -or $_.CommandLine -like '*p2a-repair-20261015-runtime*') } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],{encoding:'utf8'})||'null');
for(const proc of (extra?Array.isArray(extra)?extra:[extra]:[])){if(!Number.isInteger(proc.ProcessId)||!(/scripts[\\/]p2a-repair-final[\\/](proxy|browser)\.cjs/.test(proc.CommandLine)||proc.CommandLine.includes('p2a-repair-20261015-runtime')))throw Error('Unexpected helper process');cp.execFileSync('taskkill',['/PID',String(proc.ProcessId),'/T','/F'],{encoding:'utf8'});record.processes.push({pid:proc.ProcessId,command:proc.CommandLine,status:'owned helper stopped'});}
record.finished=new Date().toISOString();save();console.log(JSON.stringify({retained:record.retained.length,cleanup:record.cleanup,status:'complete'}));
}catch(e){record.error=e.stack;save();console.error(e.stack);process.exitCode=1}})();
