// Authorized recorded-resource retention/cleanup only; never infer a target from ambient DB env.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),crypto=require('crypto');
const base=path.resolve('scripts/rule-b-integration'),dir=path.join(base,'runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json')));
const name='ruleb-20261015-origin';if(meta.environment!==name)throw Error('Wrong recorded environment');
const runtime=path.resolve(meta.runtime),expected=path.resolve(os.tmpdir(),name+'-runtime');
if(runtime!==expected||path.dirname(runtime)!==path.resolve(os.tmpdir()))throw Error('Unexpected cleanup runtime');
const docker=(args,options={})=>cp.execFileSync('docker',args,{maxBuffer:64e6,...options});
const id=meta.resources[0].id,inspect=JSON.parse(docker(['inspect',id],{encoding:'utf8'}))[0];
if(inspect.Id!==id||inspect.Config.Labels['codex.ruleb']!==name||inspect.Name!=='/'+name+'-pg')throw Error('Resource identity mismatch');
for(const binding of Object.values(inspect.HostConfig.PortBindings).flat())if(binding.HostIp!=='127.0.0.1'||binding.HostPort!=='55500')throw Error('Unexpected binding');
const output=(file,data)=>fs.writeFileSync(path.join(dir,file),data);
(async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'source-manifest.json'))),changes={};
 for(const [p,h]of Object.entries(manifest.files)){const current=crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime,p))).digest('hex');if(current!==h)changes[p]={before:h,after:current};}
 output('source-after.json',JSON.stringify({archiveSha256:manifest.archiveSha256,changes},null,2));
 if(Object.keys(changes).some(p=>p!=='next-env.d.ts'))throw Error('Application source changed; retain environment for investigation');
 const packages={};for(const p of ['next','react','react-dom','typescript','pg','vitest']){const f=path.resolve('node_modules',p,'package.json');packages[p]={version:JSON.parse(fs.readFileSync(f)).version,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')};}output('packages.json',JSON.stringify(packages,null,2));
 for(const suffix of ['base','core','pre','post']){
  const db='ruleb_20261015_'+suffix;
  output(db+'.dump',docker(['exec',id,'pg_dump','-h','127.0.0.1','-U','postgres','-Fc',db]));
  output(db+'.schema.sql',docker(['exec',id,'pg_dump','-h','127.0.0.1','-U','postgres','--schema-only',db]));
  output(db+'.grants.txt',docker(['exec',id,'psql','-X','-h','127.0.0.1','-U','postgres','-d',db,'-c',"select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants where grantee like 'ruleb_%' order by grantee,table_name,privilege_type; select tablename,tableowner from pg_tables where schemaname='public' order by tablename;"]));
 }
 function processInfo(pid){if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid process ID');const s=cp.execFileSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}).trim();return s?JSON.parse(s):null;}
 const records=[];
 const app=JSON.parse(fs.readFileSync(path.join(dir,'app-post-start-process.json'))),browser=JSON.parse(fs.readFileSync(path.join(dir,'browser-process.json')));
 for(const [kind,pid]of [['app',app.pid],['browser',browser.pid]]){
  const p=processInfo(pid);if(!p)continue;
  if(kind==='app'&&(!p.CommandLine.includes('--port 3109')||!p.CommandLine.includes('next')))throw Error('Unexpected app process');
  if(kind==='browser'&&(!p.CommandLine.includes(browser.profile)||!p.CommandLine.includes('9230')))throw Error('Unexpected browser process');
  records.push({kind,...p});
  cp.execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{encoding:'utf8'});
  if(kind==='browser'){
   const parent=processInfo(p.ParentProcessId);
   if(parent&&parent.CommandLine.includes('scripts/rule-b-integration/browser.cjs')){records.push({kind:'browser-launcher',...parent});cp.execFileSync('taskkill',['/PID',String(parent.ProcessId),'/T','/F'],{encoding:'utf8'});}
  }
 }
 output('stopped-processes.json',JSON.stringify(records,null,2));
 const logs=cp.spawnSync('docker',['logs',id],{encoding:'utf8',maxBuffer:64e6});output('postgres.stdout.log',logs.stdout||'');output('postgres.stderr.log',logs.stderr||'');
 output('container-final-inspect.json',JSON.stringify(inspect,null,2));
 docker(['stop',id]);
 if(docker(['ps','-a','--filter','id='+id,'--format','{{.ID}}'],{encoding:'utf8'}).trim())throw Error('Recorded container remains');
 const junction=path.join(runtime,'node_modules');if(fs.realpathSync(junction)!==fs.realpathSync(path.resolve('node_modules')))throw Error('Unexpected dependency junction');
 fs.unlinkSync(junction); // Remove only link; never traverse installed dependencies.
 await new Promise(r=>setTimeout(r,1000));
 fs.rmSync(runtime,{recursive:true,force:false,maxRetries:5,retryDelay:500});
 output('cleanup.json',JSON.stringify({environment:name,containerId:id,containerRemoved:true,runtimeRemoved:!fs.existsSync(runtime),sourceChanges:changes,retainedBeforeCleanup:true},null,2));
 console.log('Retained four DB dumps, schema/grants, both log streams, browser/source evidence. Exact recorded environment removed.');
})().catch(e=>{output('cleanup-error.json',JSON.stringify({error:e.stack}));console.error(e);process.exitCode=1;});
