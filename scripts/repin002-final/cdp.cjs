
const fs=require('fs'),path=require('path');
const dir=path.resolve('scripts/repin002-final/runs/authorized');
async function connect(){const pages=await(await fetch('http://127.0.0.1:9226/json/list')).json(),target=pages.find(p=>p.type==='page');const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}));});
const network=[];ws.addEventListener('message',async e=>{const b=JSON.parse(e.data);if(b.id){const p=pending.get(b.id);if(!p)return;pending.delete(b.id);b.error?p.reject(Error(JSON.stringify(b.error))):p.resolve(b.result);return}
if(b.method==='Runtime.exceptionThrown'||b.method==='Runtime.consoleAPICalled'){fs.appendFileSync(path.join(dir,'browser-runtime-events.jsonl'),JSON.stringify(b)+'\n');}
if(b.method==='Fetch.requestPaused'){const p=b.params,u=new URL(p.request.url);if(u.hostname==='127.0.0.1'&&['3106','3107','55005'].includes(u.port)){call('Fetch.continueRequest',{requestId:p.requestId}).catch(()=>{});}else{network.push(p.request.url);fs.writeFileSync(path.join(dir,'blocked-browser-network.json'),JSON.stringify(network));call('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}}});
await call('Runtime.enable');await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
return{call,close:()=>ws.close(),eval:async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value},shot:async name=>{const s=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(s.data,'base64'));}};
}
module.exports={connect};
if(require.main===module)(async()=>{const c=await connect();try{
const ids=JSON.parse(fs.readFileSync(path.join(dir,'browser-run.json')));await c.call('Page.navigate',{url:'http://127.0.0.1:3106/runs/'+ids.run});
for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));const text=await c.eval('document.body?.innerText||""');if(i%10===0)console.log(text.slice(0,180));if(text.includes('Upload')||text.includes('Build Error')||text.includes('Application error')){fs.writeFileSync(path.join(dir,'initial-page.txt'),text);await c.shot('initial-page');console.log(text.slice(0,900));break;}}
}finally{c.close()}})().catch(e=>{console.error(e);process.exitCode=1});
