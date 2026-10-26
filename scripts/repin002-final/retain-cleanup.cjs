
const fs=require('fs'),path=require('path'),cp=require('child_process'),{Pool}=require('pg');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),storage=JSON.parse(fs.readFileSync(path.join(dir,'storage-setup.json')));
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
stop('browser-process.json','chrome');stop('app-start-process.json','3106');stop('app-pre-start-process.json','3107');
for(const id of [meta.pgId,storage.containerId]){const x=JSON.parse(docker(['inspect',id]))[0];if(x.Id!==id||x.Config.Labels['codex.repin002-final']!=='repin002-final-20261015')throw Error('Container ownership mismatch');record.retained.push({containerId:id,imageId:x.Image,bindings:x.HostConfig.PortBindings,mounts:x.Mounts.map(m=>({type:m.Type,name:m.Name,destination:m.Destination}))});}
for(const suffix of ['base','pre','post','storage']){
const db='repin002_final_20261015_'+suffix;
fs.writeFileSync(path.join(dir,'database-'+suffix+'.sql'),docker(['exec',meta.pgId,'pg_dump','-h','127.0.0.1','-U','postgres','-d',db]));
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/'+db});
const schemas=(await p.query("select schemaname,tablename,tableowner from pg_tables where schemaname in ('public','storage') order by 1,2")).rows;
fs.writeFileSync(path.join(dir,'owners-'+suffix+'.json'),JSON.stringify(schemas,null,2));await p.end();
}
fs.writeFileSync(path.join(dir,'postgres-final.log'),docker(['logs',meta.pgId]));
const log=docker(['logs',storage.containerId]);fs.writeFileSync(path.join(dir,'storage-final.log'),log.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[synthetic JWT redacted]'));
docker(['cp',storage.containerId+':/var/lib/storage',path.join(dir,'synthetic-storage-files')]);
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_storage'});
const objects=(await p.query('select bucket_id,name,metadata from storage.objects order by name')).rows;
fs.writeFileSync(path.join(dir,'storage-objects.json'),JSON.stringify(objects,null,2));await p.end();
save();
docker(['stop',storage.containerId]);docker(['rm',storage.containerId]);record.cleanup.push({resource:storage.containerId,status:'removed'});
docker(['stop',meta.pgId]);record.cleanup.push({resource:meta.pgId,status:'stopped and --rm removed tmpfs'});
const volume='repin002-final-20261015-storage';docker(['volume','rm',volume]);record.cleanup.push({resource:volume,status:'removed'});
const runtime=path.resolve(meta.runtime),expected=path.resolve(require('os').tmpdir(),'repin002-final-20261015-runtime');
if(runtime!==expected||runtime===path.resolve(process.cwd())||!runtime.endsWith('repin002-final-20261015-runtime'))throw Error('Unsafe runtime cleanup target');
const junction=path.join(runtime,'node_modules');if(fs.lstatSync(junction).isSymbolicLink())fs.unlinkSync(junction);else throw Error('Expected dependency junction');
fs.rmSync(runtime,{recursive:true});record.cleanup.push({resource:runtime,status:'dedicated extracted runtime/profile/build removed'});
fs.unlinkSync(path.join(dir,'local-keys.json'));record.cleanup.push({resource:'local-keys.json',status:'synthetic temporary key removed'});
record.finished=new Date().toISOString();save();console.log(JSON.stringify({retained:record.retained.length,cleanup:record.cleanup,status:'complete'}));
}catch(e){record.error=e.stack;save();console.error(e.stack);process.exitCode=1}})();
