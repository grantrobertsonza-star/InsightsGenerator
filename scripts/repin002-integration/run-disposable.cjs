// Authorized synthetic disposable-only setup/run/cleanup. Never reads application env files.
const fs=require("fs"),path=require("path"),cp=require("child_process"),crypto=require("crypto"),net=require("net");
const {Pool}=require("pg");
const suffix=process.argv[2],port=Number(process.argv[3]);
if(!/^[ab][0-9]*$/.test(suffix||"")||!Number.isInteger(port)||![55494,55495,55496,55497].includes(port))throw Error("Explicit attempt suffix and assigned disposable port required");
const stamp=new Date().toISOString().replace(/[^0-9]/g,"").slice(0,14)+"_"+crypto.randomBytes(3).toString("hex");
const db="repin002_"+stamp+"_"+suffix,container="repin002-"+stamp.replaceAll("_","-")+"-"+suffix,marker=container;
const dir=path.resolve("scripts/repin002-integration/runs",container);fs.mkdirSync(dir,{recursive:true});
const image="public.ecr.aws/supabase/postgres:17.11.0.004";
const meta={database:db,host:"127.0.0.1",port,container,image,environmentId:marker,authorization:"User-authorized REP-IN-002 14-group synthetic disposable scope",startedAt:new Date().toISOString(),migrations:[],setupStatus:"started",cleanupStatus:"not created",harnessAdjustments:["Select legacy fixture by ID, not random UUID sorting","Republish preserves protected rows; untouched distinct claim may legitimately replace","Capture all14 statuses, real wait observations and role grants"]};
const save=()=>fs.writeFileSync(path.join(dir,"setup.json"),JSON.stringify(meta,null,2)+"\n");
function docker(args,input){return cp.execFileSync("docker",args,{encoding:"utf8",input,maxBuffer:16*1024*1024})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id,admin;
(async()=>{try{
save();
await new Promise((resolve,reject)=>{const server=net.createServer();server.once("error",reject);server.listen(port,"127.0.0.1",()=>server.close(resolve))});
if(docker(["ps","-a","--filter","name=^/"+container+"$","--format","{{.ID}}"]).trim())throw Error("Target name already exists; refusing reuse");
const command="initdb -D /tmp/repin002 -A trust -U postgres >/tmp/init.log && printf 'host all all 0.0.0.0/0 trust\\n' >> /tmp/repin002/pg_hba.conf && exec postgres -D /tmp/repin002 -h 0.0.0.0 -p 5432";
id=docker(["run","-d","--rm","--name",container,"--label","codex.repin002="+marker,"--user","postgres","-p","127.0.0.1:"+port+":5432","--tmpfs","/tmp:rw,mode=1777","--entrypoint","/bin/sh",image,"-c",command]).trim();
if(!/^[a-f0-9]{64}$/.test(id))throw Error("Invalid new container ID");
meta.containerId=id;meta.cleanupStatus="owned environment retained during run";save();
let ready=false;for(let i=0;i<80;i++){try{docker(["exec",id,"pg_isready","-h","127.0.0.1","-p","5432","-U","postgres"]);ready=true;break}catch{await sleep(250)}}if(!ready)throw Error("Postgres readiness timeout");
docker(["exec",id,"createdb","-h","127.0.0.1","-p","5432","-U","postgres",db]);
const adminUrl="postgres://postgres@127.0.0.1:"+port+"/"+db;
admin=new Pool({connectionString:adminUrl,max:2});
meta.server=(await admin.query("select version() as version")).rows[0];
await admin.query("create table public.repin002_migration_run_log(filename text primary key,sha256 text not null,applied_at timestamptz not null default now())");
const migrations=fs.readdirSync("supabase/migrations").filter(f=>/^\d{4}_.*\.sql$/.test(f)&&Number(f.slice(0,4))<=93).sort();
for(const name of migrations){const text=fs.readFileSync(path.join("supabase/migrations",name),"utf8"),hash=crypto.createHash("sha256").update(text).digest("hex");meta.currentMigration=name;save();await admin.query(text);await admin.query("insert into public.repin002_migration_run_log(filename,sha256) values($1,$2)",[name,hash]);meta.migrations.push({name,sha256:hash,status:"applied"});}
delete meta.currentMigration;
await admin.query("create role repin002_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
await admin.query("grant connect on database "+db+" to repin002_app");
await admin.query("grant usage on schema public to repin002_app");
const tables=["tenants","runs","documents","findings","finding_history","verdicts","verdict_history","insights","insight_history","recommendations","recommendation_history"];
await admin.query("grant select,insert,update,delete on "+tables.map(t=>"public."+t).join(",")+" to repin002_app");
docker(["exec","-i",id,"psql","-X","-h","127.0.0.1","-p","5432","-U","postgres","-d",db,"-v","ON_ERROR_STOP=1","-v","repin_environment_id="+marker],fs.readFileSync("scripts/repin002-integration/environment.sql"));
await admin.query("grant select on public.repin002_environment_guard to repin002_app");
meta.role=(await admin.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls from pg_roles where rolname='repin002_app'")).rows[0];
meta.grants=(await admin.query("select table_schema,table_name,privilege_type from information_schema.role_table_grants where grantee='repin002_app' order by table_name,privilege_type")).rows;
meta.owners=(await admin.query("select tablename,tableowner from pg_tables where schemaname='public' and tablename=any($1)",[tables])).rows;
meta.setupStatus="actual migrations through0093 applied unchanged";save();
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:"test",REPIN002_ALLOW_DISPOSABLE_WRITES:"YES",REPIN002_ENVIRONMENT_ID:marker,REPIN002_ADMIN_URL:adminUrl,REPIN002_APP_URL:"postgres://repin002_app@127.0.0.1:"+port+"/"+db,REPIN002_RESULTS_FILE:path.join(dir,"results.json")};
const run=cp.spawnSync(process.execPath,["scripts/repin002-integration/integration.mjs"],{env,encoding:"utf8",timeout:120000,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(dir,"stdout.log"),run.stdout||"");fs.writeFileSync(path.join(dir,"stderr.log"),run.stderr||"");
meta.matrixExit=run.status;meta.matrixError=run.error?.message;meta.matrixStatus=run.status===0?"passed":"failed or blocked";
console.log(run.stdout||"");if(run.stderr)console.error(run.stderr);
}catch(e){meta.setupStatus="failed or blocked";meta.error=e.message;process.exitCode=1;console.error(e.message)}
finally{
if(admin){try{meta.migrationLog=(await admin.query("select * from public.repin002_migration_run_log order by filename")).rows}catch{}await admin.end()}
if(id){try{fs.writeFileSync(path.join(dir,"schema-after.sql"),docker(["exec",id,"pg_dump","-h","127.0.0.1","-p","5432","-U","postgres","-d",db,"--schema-only"]));fs.writeFileSync(path.join(dir,"postgres.log"),docker(["logs",id]));const inspect=JSON.parse(docker(["inspect",id]))[0];if(inspect.Id!==id||inspect.Config.Labels["codex.repin002"]!==marker)throw Error("Cleanup ownership mismatch");
meta.binding=inspect.HostConfig.PortBindings;meta.imageId=inspect.Image;
docker(["stop",id]);meta.cleanupStatus="recorded container stopped; --rm removed tmpfs environment";
}catch(e){meta.cleanupStatus="cleanup blocked: "+e.message;process.exitCode=1}}
if(!fs.existsSync(path.join(dir,"results.json"))){const plan=JSON.parse(fs.readFileSync("scripts/repin002-integration/plan.json")).plannedCoreGroups;fs.writeFileSync(path.join(dir,"results.json"),JSON.stringify({results:plan.map(name=>({name,status:"blocked",reason:meta.error||"Matrix did not start"})),locks:[]},null,2)+"\n")}
meta.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({artifactDirectory:dir,setupStatus:meta.setupStatus,matrixStatus:meta.matrixStatus,exit:meta.matrixExit,cleanup:meta.cleanupStatus}));
if(meta.matrixExit!==0||meta.setupStatus==="failed or blocked")process.exitCode=1;
}
})().catch(e=>{console.error(e);process.exitCode=1});
