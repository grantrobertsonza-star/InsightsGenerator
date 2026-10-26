// Prepared frozen Next launcher. No existing .env files are copied/read by this adapter.
const fs=require('fs'),path=require('path'),cp=require('child_process');
if(process.env.RULEB_ALLOW_DISPOSABLE_WRITES!=='YES'||process.env.RULEB_ENVIRONMENT_ID!=='ruleb-20261015-origin')throw Error('Explicit authorization flag/target required');
const phase=process.argv[2],mode=process.argv[3];
if(!['pre','post'].includes(phase)||!['build','start'].includes(mode))throw Error('Usage: node app.cjs pre|post build|start');
const dir=path.resolve('scripts/rule-b-integration/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json')));
// One disposable runtime, with sequential clone-specific builds; application source stays frozen.
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',
 DATABASE_URL:'postgres://ruleb_'+phase+'_app@127.0.0.1:55500/ruleb_20261015_'+phase,
 DEFAULT_TENANT_ID:'95000000-0000-4000-8000-000000000001',
 NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_SECRET_KEY:'ruleb-synthetic-unused',ANTHROPIC_API_KEY:'ruleb-synthetic-unused',ANTHROPIC_BASE_URL:'http://127.0.0.1:9'};
// Build/start one phase at a time; stop its recorded process before switching or rebuilding.
const child=cp.spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),mode,...(mode==='build'?['--webpack']:['--hostname','127.0.0.1','--port',phase==='post'?'3109':'3110'])],{cwd:meta.runtime,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
fs.writeFileSync(path.join(dir,'app-'+phase+'-'+mode+'-process.json'),JSON.stringify({pid:child.pid,runtime:meta.runtime,phase,mode}));
for(const stream of ['stdout','stderr'])child[stream].on('data',b=>{fs.appendFileSync(path.join(dir,'app-'+phase+'-'+mode+'.'+stream+'.log'),b);process[stream].write(b);});
child.on('exit',code=>process.exitCode=code);
