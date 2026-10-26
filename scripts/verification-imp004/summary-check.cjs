const fs=require("fs"),ts=require("typescript"),path=require("path"),cp=require("child_process"),crypto=require("crypto");
const files=["api/parse-stats-file.py","src/lib/csmMetrics.ts","src/lib/descriptiveFindings.ts","src/lib/__tests__/csmMetrics.test.ts"];
const hashes=()=>Object.fromEntries(files.map(p=>[p,crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")]));
const before=hashes(),cache={};
function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function("require","module","exports",js)(s=>s.startsWith(".")?load(path.resolve(path.dirname(file),s+".ts")):require(s),m,m.exports);return m.exports}
const {summarizeSeries}=load("src/lib/csmMetrics.ts");
const result=cp.spawnSync("python",["-B","scripts/verification-imp004/engine-fixtures.py"],{encoding:"utf8"});
if(result.status!==0)throw Error(result.stderr||result.stdout);
const fixtures=JSON.parse(result.stdout);
for(const f of fixtures.summaryFixtures){const series={name:f.name,n:100,bars:f.bars};for(const [metric,expected] of [["mean",f.expectedMean],["top2",f.expectedTop2]]){const got=summarizeSeries(series,metric);if(got.base!==100||got.value===null||Math.abs(got.value-expected)>0.051)throw Error(JSON.stringify({name:f.name,metric,got,expected}));}
const relabelled={...series,bars:[...series.bars].reverse().map((b,i)=>({...b,label:"Unrelated wording "+i}))};
if(JSON.stringify(summarizeSeries(series,"top2"))!==JSON.stringify(summarizeSeries(relabelled,"top2")))throw Error("raw-code relabelling/order invariant failed");}
const after=hashes();if(JSON.stringify(before)!==JSON.stringify(after))throw Error("SOURCE CHANGED: invalidate results");
console.log(JSON.stringify({engineCasesPassed:fixtures.engineCases,summaryFixturesPassed:fixtures.summaryFixtures.length,summaryChecksPassed:fixtures.summaryFixtures.length*3,hashes:after,limitations:["Controlled decoded-file boundary","No actual file metadata decoding, persistence, browser, or active mutation callers"]},null,2));
