
import fs from 'node:fs';import path from 'node:path';import pg from 'pg';import {fixtures} from '../fixtures.mjs';
const dir=path.resolve('scripts/p2a-integration/runs/authorized'),p=new pg.Pool({connectionString:'postgres://postgres@127.0.0.1:55498/p2a_20261015_main'});
try{
const tenant=(await p.query("insert into tenants(name) values('P2a browser synthetic') returning id")).rows[0].id;
const run=(await p.query("insert into runs(tenant_id,decision_statement) values($1,'P2a synthetic decision') returning id",[tenant])).rows[0].id;
fs.writeFileSync(path.join(dir,'browser-run.json'),JSON.stringify({tenant,run}));
const fx=fixtures();for(const k of ['csv','workbook','unsupported'])fs.writeFileSync(path.join(dir,fx[k].name),fx[k].bytes);
console.log(JSON.stringify({tenant,run}));
}finally{await p.end()}
