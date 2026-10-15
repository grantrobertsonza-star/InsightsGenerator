// Local-only browser extraction fixture. Never forwards requests or reads a live API key.
import http from 'node:http';
if(process.env.REPIN002_ALLOW_DISPOSABLE_WRITES!=='YES')throw Error('Fixture server disabled; authorize disposable browser run first');
const port=Number(process.env.REPIN002_MODEL_PORT),token=process.env.REPIN002_MODEL_TOKEN;
if(!Number.isInteger(port)||port<1024||port>65535||!token||!token.startsWith('repin002-'))throw Error('Explicit fixture port and synthetic repin002 token required');
let mode='complete';
http.createServer(async(req,res)=>{
 const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data))};
 try{
 if(req.method==='GET'&&req.url==='/health')return send(200,{fixture:'repin002',mode});
 if(req.headers['x-api-key']!==token&&req.headers['x-repin002-token']!==token)return send(403,{error:{type:'authentication_error',message:'Synthetic local token required'}});
 let raw='';for await(const data of req){raw+=data;if(raw.length>2_000_000)throw Error('Fixture request too large')}
 const body=JSON.parse(raw||'{}');
 if(req.method==='POST'&&req.url==='/__fixture'){if(!['complete','partial','fail'].includes(body.mode))return send(400,{error:'Bad mode'});mode=body.mode;return send(200,{mode})}
 if(req.method!=='POST'||req.url!=='/v1/messages')return send(404,{error:'Unknown fixture route'});
 const chosen=body.tool_choice?.name;
 if(chosen!=='record_findings'){console.error('BLOCKED unexpected model tool:',chosen||'none');return send(422,{error:{type:'invalid_request_error',message:'Unrelated model tool outside REP-IN-002 fixture contract'}})}
 const second=raw.includes('part 2 of 2');
 if(mode==='fail'||(mode==='partial'&&second))return send(400,{error:{type:'invalid_request_error',message:'Controlled synthetic extraction failure'}});
 const quote='The synthetic report states that satisfaction is 80% and loyalty is 40%.';
 send(200,{id:'msg_repin002_fixture',type:'message',role:'assistant',model:body.model,content:[{type:'tool_use',id:'tool_repin002',name:'record_findings',input:{findings:[{finding_text:second?'Loyalty is 40%.':'Satisfaction is 80%.',finding_kind:'fact',theme:'Synthetic',data_type:'quantitative',source_quote:quote}]}}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:100,output_tokens:100}});
 }catch(e){send(400,{error:{type:'invalid_request_error',message:e.message}})}
}).listen(port,'127.0.0.1',()=>console.log('REP-IN-002 model fixture listening only on loopback port',port));
