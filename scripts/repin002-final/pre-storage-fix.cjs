
const fs=require('fs'),{Pool}=require('pg');
(async()=>{const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_pre'});try{const f=JSON.parse(fs.readFileSync('scripts/repin002-final/runs/authorized/pre-fixture.json')),d=JSON.parse(fs.readFileSync('scripts/repin002-final/runs/authorized/uploaded-document.json'));await p.query('update documents set storage_path=$2 where id=$1',[f.document,d.storage_path]);}finally{await p.end()}})();
