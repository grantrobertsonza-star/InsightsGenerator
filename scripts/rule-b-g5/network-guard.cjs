// Test-process isolation only; frozen application bytes are untouched.
// Native page loaders may contact only their own local app or the dedicated PostgreSQL port.
const fs=require('fs'),net=require('net');
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const a=args[0];let host,port;
 if(a&&typeof a==='object'){host=a.host||'localhost';port=Number(a.port);}
 else{port=Number(a);host=typeof args[1]==='string'?args[1]:'localhost';}
 const permitted=['127.0.0.1','localhost','::1'].includes(host)&&[55501,3111,3112].includes(port);
 if(!permitted){
  fs.appendFileSync(process.env.RULEB_NETWORK_LOG,JSON.stringify({host,port,stack:new Error().stack})+'\n');
  throw Error('Rule B excluded connection blocked: '+host+':'+port);
 }
 return original.apply(this,args);
};
