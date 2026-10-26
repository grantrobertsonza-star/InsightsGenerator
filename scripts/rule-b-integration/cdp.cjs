
const fs=require('fs'),path=require('path');
const dir=path.resolve('scripts/rule-b-integration/runs/authorized');
async function connect(){const pages=await(await fetch('http://127.0.0.1:9230/json/list')).json(),target=pages.find(p=>p.type==='page');const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}));});
const network=[];const posts=new Set();ws.addEventListener('message',async e=>{const b=JSON.parse(e.data);if(b.id){const p=pending.get(b.id);if(!p)return;pending.delete(b.id);b.error?p.reject(Error(JSON.stringify(b.error))):p.resolve(b.result);return}
if(b.method==='Network.requestWillBeSent'&&b.params.request.method==='POST')posts.add(b.params.requestId);
if(b.method==='Network.loadingFinished'&&posts.has(b.params.requestId)){try{const body=await call('Network.getResponseBody',{requestId:b.params.requestId});fs.appendFileSync(path.join(dir,'native-action-responses.jsonl'),JSON.stringify(body)+'\n');}catch{}}
if(b.method==='Runtime.exceptionThrown'||b.method==='Runtime.consoleAPICalled'){fs.appendFileSync(path.join(dir,'browser-runtime-events.jsonl'),JSON.stringify(b)+'\n');}
if(b.method==='Fetch.requestPaused'){const p=b.params,u=new URL(p.request.url);if(u.hostname==='127.0.0.1'&&['3109','3110'].includes(u.port)){call('Fetch.continueRequest',{requestId:p.requestId}).catch(()=>{});}else{network.push(p.request.url);fs.writeFileSync(path.join(dir,'blocked-browser-network.json'),JSON.stringify(network));call('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}}});
await call('Network.enable');await call('Runtime.enable');await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
return{call,close:()=>ws.close(),eval:async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value},shot:async name=>{const s=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(s.data,'base64'));}};
}
module.exports={connect};
