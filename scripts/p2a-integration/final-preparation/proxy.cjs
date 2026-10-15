
const http=require('http'),fs=require('fs'),path=require('path');
const dir=path.resolve('scripts/p2a-integration/runs/authorized'),requests=[];
http.createServer((req,res)=>{
if(!req.url.startsWith('/storage/v1/')){requests.push({method:req.method,url:req.url,blocked:true});fs.writeFileSync(path.join(dir,'unexpected-service-requests.json'),JSON.stringify(requests,null,2));res.writeHead(403);return res.end('P2a permits only local storage; models/external parsers prohibited');}
requests.push({method:req.method,url:req.url});fs.writeFileSync(path.join(dir,'storage-requests.json'),JSON.stringify(requests,null,2));
const proxy=http.request('http://127.0.0.1:55008'+req.url.slice('/storage/v1'.length),{method:req.method,headers:{...req.headers,host:'127.0.0.1:55008'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});proxy.on('error',e=>{res.writeHead(502);res.end(e.message)});req.pipe(proxy);
}).listen(55009,'127.0.0.1',()=>console.log('P2a storage-only prefix router on loopback55009'));
