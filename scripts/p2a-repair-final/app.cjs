
const fs=require('fs'),path=require('path'),cp=require('child_process');
const dir=path.resolve('scripts/p2a-repair-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json'))),keys=JSON.parse(fs.readFileSync(path.join(dir,'local-keys.json')));
const pre=false;const tmp=path.join(meta.runtime,'p2a-browser-temp');fs.mkdirSync(tmp,{recursive:true});const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:tmp,TMP:tmp,PYTHONDONTWRITEBYTECODE:'1',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL:'postgres://p2ar_parser_main_app@127.0.0.1:55502/p2ar_20261015_main',DEFAULT_TENANT_ID:ids.tenant,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55013',SUPABASE_SECRET_KEY:keys.storageServiceToken,ANTHROPIC_API_KEY:'p2a-synthetic',ANTHROPIC_BASE_URL:'http://127.0.0.1:55013'};
const mode=process.argv[2];if(!['build','start'].includes(mode))throw Error('Explicit mode');
const child=cp.spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),mode,...(mode==='build'?['--webpack']:['--hostname','127.0.0.1','--port',pre?'3114':'3113'])],{cwd:meta.runtime,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
fs.writeFileSync(path.join(dir,'app-'+(pre?'pre-':'')+mode+'-process.json'),JSON.stringify({pid:child.pid}));
child.stdout.on('data',b=>{fs.appendFileSync(path.join(dir,'app-'+(pre?'pre-':'')+mode+'.stdout.log'),b);process.stdout.write(b)});
child.stderr.on('data',b=>{fs.appendFileSync(path.join(dir,'app-'+(pre?'pre-':'')+mode+'.stderr.log'),b);process.stderr.write(b)});
child.on('exit',code=>{console.log('app '+mode+' exit '+code);process.exitCode=code});
