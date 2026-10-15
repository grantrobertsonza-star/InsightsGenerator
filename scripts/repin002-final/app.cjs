
const fs=require('fs'),path=require('path'),cp=require('child_process');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),keys=JSON.parse(fs.readFileSync(path.join(dir,'local-keys.json')));
const pre=process.argv[3]==='pre';const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL:'postgres://'+(pre?'repin002_final_pre_app':'repin002_final_post_app')+'@127.0.0.1:55496/repin002_final_20261015_'+(pre?'pre':'post'),DEFAULT_TENANT_ID:ids.tenant,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55005',SUPABASE_SECRET_KEY:keys.storageServiceToken,ANTHROPIC_API_KEY:'repin002-final-synthetic',ANTHROPIC_BASE_URL:'http://127.0.0.1:55005'};
const mode=process.argv[2];if(!['build','start'].includes(mode))throw Error('Explicit mode');
const child=cp.spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),mode,...(mode==='build'?['--webpack']:['--hostname','127.0.0.1','--port',pre?'3107':'3106'])],{cwd:meta.runtime,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
fs.writeFileSync(path.join(dir,'app-'+(pre?'pre-':'')+mode+'-process.json'),JSON.stringify({pid:child.pid}));
child.stdout.on('data',b=>{fs.appendFileSync(path.join(dir,'app-'+(pre?'pre-':'')+mode+'.stdout.log'),b);process.stdout.write(b)});
child.stderr.on('data',b=>{fs.appendFileSync(path.join(dir,'app-'+(pre?'pre-':'')+mode+'.stderr.log'),b);process.stderr.write(b)});
child.on('exit',code=>{console.log('app '+mode+' exit '+code);process.exitCode=code});
