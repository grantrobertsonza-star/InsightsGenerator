const fs=require("fs"),ts=require("typescript"),crypto=require("crypto"),assert=require("assert/strict");
const file="src/lib/objectiveEvidenceActions.ts",hash=()=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),before=hash();let error=null;
async function boundary(){if(error!==null)throw error;return{questions:[],variablesTruncated:null,done:0,remaining:0,created:0,items:0,skippedInferred:0,datasets:0}}
const fakeClient={query:async()=>{if(error!==null)throw error;return {rows:[{id:"table"}]}}};
const db={withTenant:async(t,fn)=>fn(fakeClient),withTenantRead:async(t,fn)=>fn(fakeClient)};
const evidence={loadObjectiveEvidenceWithCoverage:boundary,generateEvidenceQuestions:boundary,evaluatePending:boundary,editEvidenceQuestion:boundary,retryEvidence:boundary,rollUp:()=>[]};
const mocks={"next/cache":{revalidatePath(){}},"./db":db,"./objectiveEvidence":evidence};
const m={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function("require","module","exports",js)(s=>{if(!(s in mocks))throw Error("Unexpected dependency "+s);return mocks[s]},m,m.exports);
const actions=[["loadObjectiveEvidenceAction",["r"]],["generateObjectiveEvidenceAction",["r"]],["evaluateObjectiveEvidenceAction",["r"]],["editObjectiveEvidenceAction",["r","id",{}]],["retryObjectiveEvidenceAction",["r","id"]],["promoteEvidenceTableAction",["r","table"]],["listEvidenceTablesAction",["r","doc"]]];
const cases=[
['relation "objective_evidence" does not exist',/migration 0066/],
['relation "objective_evidence_results" does not exist',/migration 0069/],
['relation "objective_evidence_generations" does not exist',/migration 0092/],
['permission denied for relation objective_evidence',null],
['permission denied for table objective_evidence_results',null],
['permission denied for relation objective_evidence_generations',null],
['connection terminated unexpectedly',null],
['new row violates check constraint "document_tables_crosstab_status_check"',/migration 0066/]];
(async()=>{let passed=0;for(const [name,args]of actions){for(const [message,expected]of cases){error=new Error(message);const r=await m.exports[name](...args);assert.equal(r.ok,false);if(expected)assert.match(r.error,expected);else assert.equal(r.error,message);passed++}
 error=null;assert.equal((await m.exports[name](...args)).ok,true);passed++}
 error='relation "objective_evidence_results" does not exist';assert.match((await m.exports.loadObjectiveEvidenceAction("r")).error,/migration 0069/);passed++;
 assert.equal(hash(),before,"Source changed; invalidate results");
 console.log(JSON.stringify({passed,actions:actions.map(a=>a[0]),cases:cases.map(c=>c[0]),hashes:{[file]:before},limitations:["Controlled upstream errors, not real PostgreSQL missing-schema/permission tests","No active evidence/publication module loaded; no browser"]},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
