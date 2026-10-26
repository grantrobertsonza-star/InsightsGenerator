
const fs=require('fs'),path=require('path'),{Pool}=require('pg');
(async()=>{const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55502/p2ar_20261015_storage'});try{
await p.query('alter role service_role bypassrls');await p.query('grant usage on schema storage to service_role');await p.query('grant all on all tables in schema storage to service_role');await p.query('grant usage on all sequences in schema storage to service_role');await p.query('grant execute on all functions in schema storage to service_role');
const dir=path.resolve('scripts/p2a-repair-final/runs/authorized'),key=JSON.parse(fs.readFileSync(path.join(dir,'local-keys.json'))).storageServiceToken;
for(const bucket of ['documents','p2a-repair-20261015']){
const r=await fetch('http://127.0.0.1:55012/bucket',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false})});
fs.writeFileSync(path.join(dir,'bucket-'+bucket+'.json'),JSON.stringify({status:r.status,body:await r.text(),grants:(await p.query("select table_name,privilege_type from information_schema.role_table_grants where grantee='service_role'")).rows},null,2));
console.log('Bucket ready',bucket,r.status);
if(r.status!==200)throw Error('Bucket creation failed');}
}finally{await p.end()}})();
