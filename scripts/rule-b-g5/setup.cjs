// PREPARED ONLY. Creates resources only after a separate explicit authorization and flag.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),crypto=require('crypto'),net=require('net');
if(process.env.RULEB_ALLOW_DISPOSABLE_WRITES!=='YES'){console.log('NOT RUN: setup disabled; no resources created.');process.exit(0);}
const name='ruleb-g5-20261015',base=path.resolve('scripts/rule-b-g5'),dir=path.join(base,'runs/authorized');
if(process.env.RULEB_ENVIRONMENT_ID!==name)throw Error('Wrong explicit environment');
if(fs.existsSync(dir))throw Error('Results directory already exists; refuse reuse');
const docker=(args,input)=>cp.execFileSync('docker',args,{input,encoding:'utf8',maxBuffer:32e6});
const manifest=JSON.parse(fs.readFileSync(path.join(base,'source-manifest.json')));
if(crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'source-snapshot.zip'))).digest('hex')!==manifest.archiveSha256)throw Error('Archive changed');
const meta={environment:name,status:'starting',resources:[],migrations:[],runtime:path.join(os.tmpdir(),name+'-runtime')};
const save=()=>fs.writeFileSync(path.join(dir,'setup.json'),JSON.stringify(meta,null,2));
(async()=>{
 for(const port of [55501,3111,3112,9231])await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
 if(docker(['ps','-a','--filter','name='+name,'--format','{{.ID}}']).trim())throw Error('Named resource exists');
 if(fs.existsSync(meta.runtime))throw Error('Runtime exists');
 fs.mkdirSync(dir,{recursive:true});save();
 fs.mkdirSync(meta.runtime);
 cp.execFileSync('tar',['-xf',path.join(base,'source-snapshot.zip'),'-C',meta.runtime]);
 for(const [p,h]of Object.entries(manifest.files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(meta.runtime,p))).digest('hex')!==h)throw Error('Extracted hash mismatch '+p);
 fs.symlinkSync(path.resolve('node_modules'),path.join(meta.runtime,'node_modules'),'junction');
 const image='public.ecr.aws/supabase/postgres:17.11.0.004';
 docker(['image','inspect',image]); // Cached only: never pull an image implicitly.
 const cmd="initdb -D /tmp/ruleb -A trust -U postgres >/tmp/init.log && printf 'host all all 0.0.0.0/0 trust\\n' >> /tmp/ruleb/pg_hba.conf && exec postgres -D /tmp/ruleb -h 0.0.0.0 -p 5432";
 const id=docker(['run','--pull=never','-d','--rm','--name',name+'-pg','--label','codex.ruleb='+name,'--user','postgres','-p','127.0.0.1:55501:5432','--tmpfs','/tmp:rw,mode=1777','--entrypoint','/bin/sh',image,'-c',cmd]).trim();
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid owned container ID');
 meta.resources.push({id,name:name+'-pg',image});save();
 let ready=false;for(let i=0;i<80;i++){try{docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}if(!ready)throw Error('PostgreSQL readiness timeout');
 const sql=(db,text)=>docker(['exec','-i',id,'psql','-X','-h','127.0.0.1','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],text);
 sql('postgres','create database rulebg5_20261015_base;');
 for(const [p,h]of Object.entries(manifest.files).filter(([p])=>/^supabase\/migrations\/\d{4}_.*\.sql$/.test(p)&&Number(path.basename(p).slice(0,4))<=94).sort()){
  sql('rulebg5_20261015_base',fs.readFileSync(path.join(meta.runtime,p),'utf8'));meta.migrations.push({file:p,sha256:h});save();
 }
 for(const suffix of ['pre','post']){
  const db='rulebg5_20261015_'+suffix,role='rulebg5_'+suffix+'_app';
  sql('postgres',`create database ${db} template rulebg5_20261015_base; create role ${role} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;`);
  sql(db,`grant connect on database ${db} to ${role}; grant usage on schema public to ${role}; grant select on all tables in schema public to ${role}; grant insert,update,delete on runs,objective_candidates,decision_candidates,objective_evidence,objective_evidence_generations,objective_evidence_results,trace to ${role}; create table ruleb_environment_guard(environment_id text primary key); insert into ruleb_environment_guard values('${name}'); grant select on ruleb_environment_guard to ${role};`);
 }
 // Core and pre remain pre0095 for their transition cases. Post is the browser current-schema clone.
 sql('rulebg5_20261015_post',fs.readFileSync(path.join(meta.runtime,'supabase/migrations/0095_objective_evidence_origin.sql'),'utf8'));
 meta.server=docker(['exec',id,'psql','-X','-h','127.0.0.1','-U','postgres','-Atc','select version()']);
 meta.grants={};for(const suffix of ['pre','post'])meta.grants[suffix]=sql('rulebg5_20261015_'+suffix,"select rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit from pg_roles where rolname like 'rulebg5_%'; select tablename,tableowner from pg_tables where schemaname='public' order by tablename; select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants where grantee like 'rulebg5_%' order by grantee,table_name,privilege_type;");
 meta.containerInspect=JSON.parse(docker(['inspect',id]));meta.status='prepared environment; core/browser checks NOT RUN';save();
 console.log('Setup retained. Run only the separately authorized Rule B checks; resources intentionally remain until explicit retention/cleanup.');
})().catch(e=>{meta.status='failed';meta.error=e.message;if(fs.existsSync(dir))save();console.error(e.message);process.exitCode=1;});
