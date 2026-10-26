const fs=require("fs"),ts=require("typescript"),path=require("path"),assert=require("assert/strict");
function load(file){const m={exports:{}};new Function("require","module","exports",ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(s=>s.startsWith(".")?load(path.resolve(path.dirname(file),s+".ts")):require(s),m,m.exports);return m.exports}
function extract(file,names,ctx={}){const sf=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),99,true,ts.ScriptKind.TSX);const text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf).replace(/^export /,"")).join("\n");const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(ctx),js+";return {"+names.join(",")+"}")( ...Object.values(ctx));}

const crypto=require("crypto");
const files=["src/lib/extractFindings.ts","src/lib/__tests__/reportImportCompletion.test.ts"];
const hashes=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")]));
const before=hashes();
assert.equal(before[files[0]],"824d82913103e69457bcf78c7c42f89237acac5b596ff815b5a5154e1acdff88");
assert.equal(before[files[1]],"f94a32a6b30ef203c3283bc05422aa502d78600ca1aa7fcde57d0ffaf15d9d40");
const prov=load("src/lib/findingProvenance.ts"),archive=load("src/lib/findingArchive.ts");
const {createFakeFindingsDb}=load("src/lib/__tests__/helpers/fakeFindingsDb.ts");
const impl=extract("src/lib/extractFindings.ts",["normaliseQuote","normaliseClaim","claimIdentityKey","citedIds","planReplacement","publishReplacement"],{archiveAndReplaceFindings:archive.archiveAndReplaceFindings,findingProvenanceAvailable:prov.findingProvenanceAvailable});
const base={source_document_id:"d",run_id:"r",status:"accepted",source_page:null,source_quote:"Shared insight passage",researcher_note:null,human_reviewed_at:"2026-10-15",human_edited_fields:[],provenance_tracked:true,cited_support_finding_ids:[]};
const db=createFakeFindingsDb({documents:[{id:"d",run_id:"r"}],findings:[
{...base,id:"insight",finding_kind:"stated_insight",finding_text:"Both findings matter.",cited_support_finding_ids:["supportOld"]},
{...base,id:"supportOld",finding_kind:"fact",finding_text:"Old support.",source_quote:"Old."},
{...base,id:"supportA",finding_kind:"fact",finding_text:"New support A.",source_quote:"A."},
{...base,id:"supportB",finding_kind:"fact",finding_text:"New support B.",source_quote:"B."}]});
const f=(text,quote,i,support=[])=>({finding_text:text,source_quote:quote,pageNumber:null,finding_kind:"stated_insight",theme:"T",data_type:null,quoteVerified:true,groundedByFindingId:null,extractionCaveats:[],rawIndex:i,supportRawIndices:support});
const params={tenantId:"t",runId:"r",documentId:"d",partial:false,onlyReplacePending:false,archiveReason:"manual_reextract",confirmedLegacyIds:new Set(),stagedChunks:[
{chunkIndex:0,findings:[f("New support A.","A.",0),f("Both findings matter.","Shared insight passage",1,[0]),f("Both findings matter.","Shared insight passage",2,[0,0,1,99])]},
{chunkIndex:1,findings:[f("New support B.","B.",0),f("Both findings matter.","Shared insight passage",1,[0,0,1])]}]};
const events=[];let failUnion=false;
const pool={async connect(){const c=db.connect();let active=false;return {release(){events.push("release");return c.release()},async query(sql,p){if(sql==="begin")active=true;
if(sql.startsWith("update findings set cited_support_finding_ids")){assert(active,"union outside transaction");events.push({update:p});if(failUnion)throw Error("injected final-union failure")}
const result=await c.query(sql,p);if(sql==="commit"||sql==="rollback"){events.push(sql);active=false}return result}}}};
const {withTenant}=extract("src/lib/db.ts",["withTenant"],{pool,UUID:/^[0-9a-f-]{36}$/i});
const publish=()=>withTenant("t",c=>impl.publishReplacement(c,params));
(async()=>{
assert.equal((await publish()).published,true);
const links=db.state.findings.find(f=>f.id==="insight").cited_support_finding_ids;
assert.deepEqual(links,["supportOld","supportA","supportB"]);
assert.deepEqual(db.state.findings.filter(f=>f.finding_kind==="stated_insight").map(f=>f.id),["insight"]);
assert.equal(events.filter(e=>typeof e==="object").length,1,"one final union write");
assert.deepEqual(events.slice(-2),["commit","release"]);
const snapshot=structuredClone(db.state);
await publish();assert.deepEqual(db.state,snapshot,"republish changed authoritative state");
assert.equal(events.filter(e=>typeof e==="object").length,1,"unchanged republish rewrote union");
// Final union UPDATE fails: actual withTenant rolls the controlled transaction back and releases.
db.state.findings.find(f=>f.id==="insight").cited_support_finding_ids=["supportOld"];
const failureBefore=structuredClone(db.state);failUnion=true;
await assert.rejects(publish,/final-union/);assert.deepEqual(db.state,failureBefore);
assert.deepEqual(events.slice(-2),["rollback","release"]);
assert.deepEqual(hashes(),before,"Source changed; invalidate");
console.log(JSON.stringify({checksPassed:8,checks:["Old+A+B across and within chunks","Repeated/self/invalid raw refs excluded","One retained insight ID","One final union write on supplied active client","Commit precedes release","Republish preserves all authoritative state without union rewrite","Final union failure rolls back and releases through actual withTenant","Hashes unchanged"],hashes:before,limits:["Controlled pg transaction model","No real PostgreSQL, migration or browser"]},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
