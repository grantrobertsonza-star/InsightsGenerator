
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=process.cwd(),dir=path.resolve('scripts/p2a-integration/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),key=JSON.parse(fs.readFileSync(path.join(dir,'local-keys.json'))).storageServiceToken;
const testdir=path.join(meta.runtime,'scripts/p2a-integration');fs.mkdirSync(testdir,{recursive:true});
for(const f of ['fixtures.mjs','safety.mjs'])fs.copyFileSync(path.join(root,'scripts/p2a-integration',f),path.join(testdir,f));
fs.copyFileSync(path.join(root,'scripts/p2a-integration/final-preparation/integration.final.test.mjs'),path.join(testdir,'integration.final.test.mjs'));
const tmp=path.join(meta.runtime,'p2a-temp');fs.mkdirSync(tmp,{recursive:true});
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:tmp,TMP:tmp,NODE_ENV:'test',PYTHONDONTWRITEBYTECODE:'1',P2A_ALLOW_DISPOSABLE_WRITES:'YES',P2A_DATABASE_URL:'postgres://p2a_parser_main_app@127.0.0.1:55498/p2a_20261015_main',P2A_ADMIN_URL:'postgres://postgres@127.0.0.1:55498/p2a_20261015_main',P2A_STORAGE_URL:'http://127.0.0.1:55009',P2A_STORAGE_TEST_KEY:key,P2A_STORAGE_BUCKET:'p2a-20261015-parser',P2A_ENVIRONMENT_ID:'p2a-20261015-parser',P2A_BROWSER_URL:'http://127.0.0.1:3108',P2A_CAPTURE_FILE:path.join(dir,'core-state.json'),ANTHROPIC_API_KEY:'p2a-synthetic',ANTHROPIC_BASE_URL:'http://127.0.0.1:55009'};
env.P2A_PRE_ADMIN_URL='postgres://postgres@127.0.0.1:55498/p2a_20261015_pre0093';env.P2A_PRE_APP_URL='postgres://p2a_parser_pre0093_app@127.0.0.1:55498/p2a_20261015_pre0093';
const attempt=process.argv[2];if(!/^[a-z0-9]+$/.test(attempt||''))throw Error('Explicit retained attempt name');
env.P2A_CAPTURE_FILE=path.join(dir,'core-state-'+attempt+'.json');
const args=[path.join(root,'node_modules/vitest/vitest.mjs'),'run','scripts/p2a-integration/integration.final.test.mjs','--no-cache','--pool=threads','--poolOptions.threads.singleThread','--reporter=json','--reporter=default','--outputFile='+path.join(dir,'vitest-'+attempt+'.json')];
if(process.argv[3])args.push('-t',process.argv[3]);
fs.writeFileSync(path.join(dir,'core-command-'+attempt+'.json'),JSON.stringify({cwd:meta.runtime,args},null,2));
const proc=cp.spawn(process.execPath,args,{cwd:meta.runtime,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const [stream,file]of [[proc.stdout,'stdout'],[proc.stderr,'stderr']])stream.on('data',b=>{fs.appendFileSync(path.join(dir,'core-'+attempt+'.'+file+'.log'),b);process[file==='stdout'?'stdout':'stderr'].write(b)});
proc.on('exit',c=>{console.log('Core exit',c);process.exitCode=c});
