const fs=require('fs'),path=require('path'),cp=require('child_process');
const dir=path.resolve('scripts/rule-b-g5/runs/authorized'),m=JSON.parse(fs.readFileSync(path.join(dir,'last-app-process.json')));
if(!['pre','post'].includes(m.phase)||!Number.isInteger(m.pid)||m.pid<=0)throw Error('Unexpected recorded process');
const info=JSON.parse(cp.execFileSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${m.pid}" | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`],{encoding:'utf8'}));
const port=m.phase==='post'?'3111':'3112';if(!info.CommandLine.includes('--port '+port)||!info.CommandLine.includes('next'))throw Error('Process identity mismatch');
fs.appendFileSync(path.join(dir,'app-stop-history.jsonl'),JSON.stringify({...m,...info})+'\n');
console.log(cp.execFileSync('taskkill',['/PID',String(m.pid),'/T','/F'],{encoding:'utf8'}));
