
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),{Pool}=require('pg');
const dir=path.resolve('scripts/p2a-integration/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json')));
const docker=(a)=>cp.execFileSync('docker',a,{encoding:'utf8',maxBuffer:16e6});
(async()=>{const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55498/p2a_20261015_storage'});try{
for(const role of ['anon','authenticated','service_role']){const exists=await p.query('select 1 from pg_roles where rolname=$1',[role]);if(!exists.rowCount)await p.query('create role '+role+' nologin');}
await p.query("create role p2a_parser_storage_owner login nosuperuser nocreatedb nocreaterole noinherit");
await p.query('grant anon,authenticated,service_role to p2a_parser_storage_owner');
await p.query('alter database p2a_20261015_storage owner to p2a_parser_storage_owner');
await p.query('grant create on schema public to p2a_parser_storage_owner');
const pg=JSON.parse(docker(['inspect',meta.pgId]))[0],ip=pg.NetworkSettings.Networks.bridge.IPAddress;
if(!/^172\.\d+\.\d+\.\d+$/.test(ip))throw Error('Expected recorded private Docker bridge address');
const secret=crypto.randomBytes(32).toString('hex'),b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const payload=b64({role:'service_role',iss:'repin002-local',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400}),head=b64({alg:'HS256',typ:'JWT'});
const token=head+'.'+payload+'.'+crypto.createHmac('sha256',secret).update(head+'.'+payload).digest('base64url');
const vars={DATABASE_URL:'postgres://p2a_parser_storage_owner@'+ip+':5432/p2a_20261015_storage',AUTH_JWT_SECRET:secret,STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:'p2a-20261015-parser',REGION:'local',GLOBAL_S3_BUCKET:'documents',PGRST_JWT_SECRET:secret,ENABLE_IMAGE_TRANSFORMATION:'false',PG_QUEUE_ENABLE:'false',ANON_KEY:token,SERVICE_KEY:token};
const id=docker(['run','-d','--name','p2a-20261015-parser-storage','--label','codex.p2a-parser=p2a-20261015-parser','-p','127.0.0.1:55008:5000','--mount','type=volume,source=p2a-20261015-parser-storage,target=/var/lib/storage',...Object.entries(vars).flatMap(([k,v])=>['-e',k+'='+v]),'public.ecr.aws/supabase/storage-api:v1.79.28']).trim();
fs.writeFileSync(path.join(dir,'local-keys.json'),JSON.stringify({storageServiceToken:token})); // synthetic only, remove after execution
fs.writeFileSync(path.join(dir,'storage-setup.json'),JSON.stringify({containerId:id,bridgeTarget:ip,database:'p2a_20261015_storage',hostBinding:'127.0.0.1:55008',privateTransport:'Named disposable storage -> named disposable PostgreSQL via Docker private bridge; no external service'},null,2));
console.log('Disposable storage started '+id);
}catch(e){console.error(e.stack);process.exitCode=1}finally{await p.end()}})();
