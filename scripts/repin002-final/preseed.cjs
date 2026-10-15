
const fs=require('fs'),path=require('path'),{Pool}=require('pg');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json')));
(async()=>{const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_pre'});try{
await p.query("insert into tenants(id,name) values($1,'Synthetic pre-migration tenant')",[ids.tenant]);
await p.query("insert into runs(id,tenant_id,decision_statement) values($1,$2,'Synthetic pre-migration decision')",[ids.run,ids.tenant]);
const text=fs.readFileSync(path.join(dir,'synthetic-complete.txt'),'utf8');
const d=(await p.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text,processing_status) values($1,$2,'report','synthetic-pre.txt','synthetic-seeded-no-object',$3,'ready') returning id",[ids.tenant,ids.run,text])).rows[0].id;
const f=(await p.query("insert into findings(tenant_id,run_id,origin,source_document_id,finding_text,finding_kind,theme,status) values($1,$2,'stated',$3,'Unknown pre-migration work','fact','Synthetic','accepted') returning id",[ids.tenant,ids.run,d])).rows[0].id;
fs.writeFileSync(path.join(dir,'pre-fixture.json'),JSON.stringify({document:d,finding:f}));
}finally{await p.end()}})();
