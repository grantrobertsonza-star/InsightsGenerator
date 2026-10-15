
const fs=require('fs'),path=require('path'),cp=require('child_process');
const dir=path.resolve('scripts/repin002-final/runs/authorized'),meta=JSON.parse(fs.readFileSync(path.join(dir,'setup.json')));
const profile=path.join(meta.runtime,'browser-profile');
const browser=cp.spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9226','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore',fs.openSync(path.join(dir,'browser.stdout.log'),'a'),fs.openSync(path.join(dir,'browser.stderr.log'),'a')]});
fs.writeFileSync(path.join(dir,'browser-process.json'),JSON.stringify({pid:browser.pid,profile}));
console.log('Browser PID',browser.pid);
setInterval(() => {}, 1000);
