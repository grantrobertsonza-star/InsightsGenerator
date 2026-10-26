
const fs=require('fs'),path=require('path'),http=require('http'),cp=require('child_process'),{Pool}=require('pg');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json'))),ids=JSON.parse(fs.readFileSync(path.join(dir,'fixture-ids.json'))),keys=JSON.parse(fs.readFileSync(path.join(dir,'local-keys.json')));
let mode='complete';const events=[];const save=()=>fs.writeFileSync(path.join(dir,'model-events.json'),JSON.stringify(events,null,2));
const quote='The synthetic report states that satisfaction is 80% and loyalty is 40%.';
const allowed=new Set(['record_findings','record_verdicts','record_chain_verdict','record_insights','record_evidence_synthesis','record_decision_candidates','record_clusters','record_synthesized_insight','record_scores','record_recommendations','record_contradictions']);
function sample(s){if(s.enum)return s.enum.includes(3)?3:s.enum[0];if(s.type==='object')return Object.fromEntries(Object.entries(s.properties||{}).map(([k,v])=>[k,k==='index'?0:sample(v)]));if(s.type==='array')return [sample(s.items)];if(s.type==='integer'||s.type==='number')return 0;if(s.type==='boolean')return true;return 'Synthetic local fixture';}
http.createServer(async(req,res)=>{
const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data))};
if(req.url.startsWith('/storage/v1/')){const u='http://127.0.0.1:55004'+req.url.slice('/storage/v1'.length);const headers={...req.headers,host:'127.0.0.1:55004'};const proxy=http.request(u,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});proxy.on('error',e=>send(502,{error:e.message}));return req.pipe(proxy);}
let raw='';for await(const b of req)raw+=b;
if(req.url==='/__fixture'&&req.headers['x-repin002-token']==='repin002-final-synthetic'){mode=JSON.parse(raw).mode;return send(200,{mode})}
if(req.url==='/health')return send(200,{mode});
if(req.url!=='/v1/messages'||req.headers['x-api-key']!=='repin002-final-synthetic')return send(403,{error:{type:'authentication_error',message:'Local synthetic token required'}});
try{const b=JSON.parse(raw),name=b.tool_choice?.name;events.push({name:name||'plain',mode,input:b.messages,system:b.system,schema:b.tools?.find(t=>t.name===name)?.input_schema});save();
if(!allowed.has(name))return send(422,{error:{type:'invalid_request_error',message:'Unknown model request; affected downstream check blocked'}});
if(mode==='prompt-isolated'&&name!=='record_findings')return send(400,{error:{type:'invalid_request_error',message:'Controlled prompt-preparation failure'}});
if((name==='record_findings'&&(mode==='fail'||(mode==='partial'&&raw.includes('part 2 of 2'))))||(mode==='downstream-fail'&&name==='record_evidence_synthesis'))return send(400,{error:{type:'invalid_request_error',message:'Controlled synthetic failure'}});
const schema=b.tools.find(t=>t.name===name).input_schema;let input=sample(schema);
if(name==='record_findings')input={findings:[{finding_text:raw.includes('part 2 of 2')?'Loyalty is 40%.':'Satisfaction is 80%.',finding_kind:'fact',theme:'Synthetic',data_type:'quantitative',source_quote:quote}]};
if(name==='record_clusters')input={clusters:[{label:'Synthetic cluster',member_indices:[0,1,2]}]};
if(name==='record_contradictions')input={contradicted_indices:[],detail:''};
if(name==='record_verdicts')input={verdicts:[0,1,2,3,4,5,6,7,8,9].map(index=>({index,verdict_tier:mode==='confirmation-prompt'?'insufficient_information':'robust',rationale:'Synthetic local fixture verdict'}))};
if(name==='record_insights')input={insights:[0,1,2,3].map(index=>({index,headline:'Synthetic headline '+index,observation:'Synthetic observation',tension:'Synthetic tension',implication:'Synthetic implication'}))};
return send(200,{id:'msg_synthetic',type:'message',role:'assistant',model:b.model,content:[{type:'tool_use',id:'tool_synthetic',name,input}],stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:100}});
}catch(e){send(400,{error:{type:'invalid_request_error',message:e.message}})}
}).listen(55005,'127.0.0.1',async()=>{
try{
if(process.argv[2]==='model-only'){console.log('Local model and storage routing restarted');return;}
const bucket=await fetch('http://127.0.0.1:55004/bucket',{method:'POST',headers:{authorization:'Bearer '+keys.storageServiceToken,'content-type':'application/json'},body:JSON.stringify({id:'documents',name:'documents',public:false})});fs.writeFileSync(path.join(dir,'bucket-create.json'),JSON.stringify({status:bucket.status,body:await bucket.text()}));
const p=new Pool({connectionString:'postgres://postgres@127.0.0.1:55496/repin002_final_20261015_post'});
const run=(await p.query("insert into runs(tenant_id,decision_statement,research_objective) values($1,'Synthetic commercial decision','1. Measure synthetic satisfaction') returning id",[ids.tenant])).rows[0].id;await p.end();
fs.writeFileSync(path.join(dir,'browser-run.json'),JSON.stringify({tenant:ids.tenant,run}));
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL:'postgres://repin002_final_post_app@127.0.0.1:55496/repin002_final_20261015_post',DEFAULT_TENANT_ID:ids.tenant,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55005',SUPABASE_SECRET_KEY:keys.storageServiceToken,ANTHROPIC_API_KEY:'repin002-final-synthetic',ANTHROPIC_BASE_URL:'http://127.0.0.1:55005'};
const next=cp.spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3106'],{cwd:meta.runtime,env,stdio:['ignore',fs.openSync(path.join(dir,'app.stdout.log'),'a'),fs.openSync(path.join(dir,'app.stderr.log'),'a')],windowsHide:true});
fs.writeFileSync(path.join(dir,'processes.json'),JSON.stringify({services:process.pid,next:next.pid}));console.log('Services and isolated app started',next.pid);
}catch(e){fs.writeFileSync(path.join(dir,'service-error.txt'),e.stack);console.error(e.stack)}
});
