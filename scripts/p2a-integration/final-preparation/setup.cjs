
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process'),net=require('net');
const {Pool}=require('pg');
const root=process.cwd(),base=path.join(root,'scripts/p2a-integration/final-preparation'),run=path.join(root,'scripts/p2a-integration/runs/authorized');
if(fs.existsSync(run))throw Error('Run directory exists; refuse overwrite');
fs.mkdirSync(run,{recursive:true});
const meta={environment:'p2a-20261015-parser',status:'preflight',resources:[],migrations:[],started:new Date().toISOString()};
const save=()=>fs.writeFileSync(path.join(run,'setup.json'),JSON.stringify(meta,null,2));
const docker=(a,input)=>cp.execFileSync('docker',a,{input,encoding:'utf8',maxBuffer:32e6});
(async()=>{
let admin;
try{
const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts/repin002-final/source-manifest.json')));
if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'scripts/repin002-final/source-snapshot.zip'))).digest('hex')!==manifest.archive_sha256)throw Error('Archive changed');
for(const port of [55498,55008,55009,3108,3109,9228,9229])await new Promise((res,rej)=>{const s=net.createServer();s.once('error',rej);s.listen(port,'127.0.0.1',()=>s.close(res))});
if(docker(['ps','-a','--filter','name=p2a-20261015-parser','--format','{{.ID}}']).trim())throw Error('Reserved container exists');
meta.runtime=path.join(os.tmpdir(),'p2a-20261015-parser-runtime');
if(fs.existsSync(meta.runtime))throw Error('Runtime exists');
fs.mkdirSync(meta.runtime);
cp.execFileSync('tar',['-xf',path.join(root,'scripts/repin002-final/source-snapshot.zip'),'-C',meta.runtime]);
fs.symlinkSync(path.join(root,'node_modules'),path.join(meta.runtime,'node_modules'),'junction');
const pinned=JSON.parse(fs.readFileSync(path.join(base,'sources.json')));
const companion=path.join(base,'parser-companions.zip');
if(crypto.createHash('sha256').update(fs.readFileSync(companion)).digest('hex')!==pinned.companion_archive_sha256)throw Error('Companion archive changed');
cp.execFileSync('tar',['-xf',companion,'-C',meta.runtime]);
for(const [n,h]of Object.entries(pinned.companion_files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(meta.runtime,n))).digest('hex')!==h)throw Error('Companion hash mismatch');

for(const [n,h] of Object.entries(manifest.files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(meta.runtime,n))).digest('hex')!==h)throw Error('Extracted hash mismatch '+n);
const command="initdb -D /tmp/p2a-parser -A trust -U postgres >/tmp/init.log && printf 'host all all 0.0.0.0/0 trust\\n' >> /tmp/p2a-parser/pg_hba.conf && exec postgres -D /tmp/p2a-parser -h 0.0.0.0 -p 5432";
meta.pgId=docker(['run','-d','--rm','--name','p2a-20261015-parser-pg','--label','codex.p2a-parser=p2a-20261015-parser','--user','postgres','-p','127.0.0.1:55498:5432','--tmpfs','/tmp:rw,mode=1777','--entrypoint','/bin/sh','public.ecr.aws/supabase/postgres:17.11.0.004','-c',command]).trim();save();
for(let i=0;i<80;i++){try{docker(['exec',meta.pgId,'pg_isready','-h','127.0.0.1','-U','postgres']);break}catch{await new Promise(r=>setTimeout(r,250))}}
docker(['exec',meta.pgId,'createdb','-h','127.0.0.1','-U','postgres','p2a_20261015_base']);
admin=new Pool({connectionString:'postgres://postgres@127.0.0.1:55498/p2a_20261015_base'});
for(const n of fs.readdirSync(path.join(meta.runtime,'supabase/migrations')).filter(n=>/^\d{4}.*\.sql$/.test(n)&&+n.slice(0,4)<=92).sort()){
const bytes=fs.readFileSync(path.join(meta.runtime,'supabase/migrations',n));await admin.query(bytes.toString());meta.migrations.push({name:n,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});save();}
await admin.end();admin=null;
for(const tail of ['pre0093','main'])docker(['exec',meta.pgId,'createdb','-h','127.0.0.1','-U','postgres','-T','p2a_20261015_base','p2a_20261015_'+tail]);
docker(['exec',meta.pgId,'createdb','-h','127.0.0.1','-U','postgres','p2a_20261015_storage']);
for(const tail of ['pre0093','main']){
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55498/p2a_20261015_'+tail});
if(tail==='main')for(const n of ['0093_documents_selected_sheet.sql','0094_finding_review_provenance.sql'])await p.query(fs.readFileSync(path.join(meta.runtime,'supabase/migrations',n),'utf8'));
const role='p2a_parser_'+tail+'_app';
await p.query('create role '+role+' login nosuperuser nocreatedb nocreaterole noinherit nobypassrls');
await p.query('grant connect on database p2a_20261015_'+tail+' to '+role);
await p.query('grant usage on schema public to '+role);
await p.query('grant select on all tables in schema public to '+role);
const tables=['tenants','runs','documents','document_tables','trace'];
await p.query('grant insert,update,delete on '+tables.map(t=>'public.'+t).join(',')+' to '+role);
await p.query('grant usage on all sequences in schema public to '+role);
await p.query("create table p2a_environment_guard(environment_id text primary key,synthetic_only boolean not null)");
await p.query("insert into p2a_environment_guard values('p2a-20261015-parser',true)");
await p.query('grant select on p2a_environment_guard to '+role);

fs.writeFileSync(path.join(run,'grants-'+tail+'.json'),JSON.stringify({roles:(await p.query('select rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname=$1',[role])).rows,grants:(await p.query('select table_name,privilege_type from information_schema.role_table_grants where grantee=$1 order by 1,2',[role])).rows},null,2));
await p.end();
}
meta.inspect=JSON.parse(docker(['inspect',meta.pgId]))[0];
meta.status='ready';save();
console.log(JSON.stringify({status:meta.status,runtime:meta.runtime,container:meta.pgId,migrations:meta.migrations.length}));
}catch(e){meta.status='blocked';meta.error=e.stack;save();console.error(e.stack);process.exitCode=1}
finally{if(admin)await admin.end()}
})();


