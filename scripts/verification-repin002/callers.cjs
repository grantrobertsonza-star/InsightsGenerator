const fs=require("fs"),ts=require("typescript"),path=require("path"),assert=require("assert/strict");
function load(file){const m={exports:{}};new Function("require","module","exports",ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(s=>s.startsWith(".")?load(path.resolve(path.dirname(file),s+".ts")):require(s),m,m.exports);return m.exports}
function extract(file,names,ctx={}){const sf=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),99,true,ts.ScriptKind.TSX);const text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf).replace(/^export /,"")).join("\n");const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(ctx),js+";return {"+names.join(",")+"}")( ...Object.values(ctx));}
const prov=load("src/lib/findingProvenance.ts");const checks=[],defects=[];
const dashboard=[
["src/lib/chartActions.ts","addChartFindingAction",["r","d",{variable:"q",label:"Q",series:[]},null]],
["src/lib/npsActions.ts","addNpsFindingAction",["r","d",{variable:"q",label:"Q",segments:[],designQualifications:[]}]],
["src/lib/brandHealthActions.ts","addBrandHealthFindingAction",["r","d",{conversions:[]},"awareness"]],
["src/lib/csmActions.ts","addCsmFindingAction",["r","d",{segmentVar:null},"overall"]],
["src/lib/waveTrackingActions.ts","addWaveNpsFindingAction",["r",{variable:"q",label:"Q",segments:[{label:"Wave1",nps:10,n:100}]}]],
["src/lib/waveTrackingActions.ts","addWaveChartFindingAction",["r",{variable:"q",label:"Q",series:[]}]],
["src/lib/waveTrackingActions.ts","addWaveDriverFindingAction",["r",{outcome:"q",outcomeLabel:"Q",rows:[]}]],
["src/lib/drivers.ts","addDriverFindings",["t","r","a"]]];
(async()=>{
for(const [file,name,args]of dashboard){for(const branch of ["insert","revive"]){const queries=[],reviews=[];const client={query:async(sql,params=[])=>{const q=sql.replace(/\s+/g," ").trim();queries.push({q,params});
if(q.includes("information_schema.columns"))return {rows:[{n:10}]};
if(q.startsWith("select report"))return {rows:[{report:{}}]};
if(q.startsWith("select count"))return {rows:[{n:0}]};
if(q.includes("human_reviewed_at = now()")){reviews.push(params);return {rows:[],rowCount:1}};
if(q.startsWith("update findings set status"))return {rows:branch==="revive"?[{id:"kept"}]:[],rowCount:branch==="revive"?1:0};
if(q.startsWith("insert into findings"))return {rows:[{id:"new"}],rowCount:1};
throw Error("Unexpected SQL "+q)}};
const ctx={TENANT_ID:"t",withTenant:async(t,fn)=>fn(client),recordHumanReview:prov.recordHumanReview,findingProvenanceAvailable:prov.findingProvenanceAvailable,revalidatePath(){},
describeChart:()=>"Claim",describeBrandHealthSection:()=>({text:"Claim",theme:"Auto"}),describeCsmSection:()=>({text:"Claim",theme:"Auto"}),brandHealthFindingKey:()=>"q",csmFindingKey:()=>"q",describeWaveNps:()=>"Claim",describeWaveChart:()=>"Claim",describeWaveDriverTable:()=>"Claim",
require:s=>{if(s==="./driverFindings")return {driverFindings:()=>[{text:"Claim",theme:"Auto",stats:{}}]};throw Error("Unexpected dependency "+s)}};
const result=await extract(file,[name],ctx)[name](...args);assert.notEqual(result?.ok,false,JSON.stringify(result));assert(reviews.some(p=>p[1]==="tool_add"&&p[0].includes(branch==="revive"?"kept":"new")),name+" "+branch+" missed provenance");checks.push(name+":"+branch);
}}
for(const [file,name,args] of dashboard.filter(d=>["addBrandHealthFindingAction","addCsmFindingAction"].includes(d[1]))){
 let update;const client={query:async(sql,p=[])=>{const q=sql.replace(/\s+/g," ").trim();if(q.startsWith("select count"))return {rows:[{n:1}]};if(q.includes("information_schema"))return {rows:[{n:10}]};if(q.startsWith("update findings set finding_text")){update=q;return {rows:[{id:"kept"}]}};if(q.includes("human_reviewed_at"))return {rows:[]};throw Error(q)}};
 const ctx={TENANT_ID:"t",withTenant:async(t,fn)=>fn(client),findingProvenanceAvailable:prov.findingProvenanceAvailable,recordHumanReview:prov.recordHumanReview,revalidatePath(){},brandHealthFindingKey:()=>"q",csmFindingKey:()=>"q",describeBrandHealthSection:()=>({text:"Claim",theme:"Auto"}),describeCsmSection:()=>({text:"Claim",theme:"Auto"})};
 assert.notEqual((await extract(file,[name],ctx)[name](...args)).ok,false);assert.match(update,/case when human_edited_fields @> array\['theme'\] then theme else/);checks.push(name+":theme-guard-SQL");
}
{
let captured;const client={query:async(sql,p)=>{captured=sql;return {rows:[]}}};
await extract("src/lib/codingMeta.ts",["syncFindingThemes"],{withTenant:async(t,fn)=>fn(client),metaAvailable:async()=>true,findingProvenanceAvailable:prov.findingProvenanceAvailable}).syncFindingThemes("t","d");
assert.match(captured,/and not \(f.human_edited_fields @> array\['theme'\]\)/);checks.push("syncFindingThemes:theme-guard-SQL");
}
{
const source=fs.readFileSync("src/app/runs/[id]/page.tsx","utf8");const sf=ts.createSourceFile("page.tsx",source,99,true,ts.ScriptKind.TSX);
const names=["confirmLegacyReplacementAction","runReportExtraction"];
const text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf)).join("\n");
const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const calls=[],status=[],errors=[];const known={TENANT_ID:"t",extractFindingsFromDocument:async(...a)=>{calls.push(a);return{published:false,failedParts:0,notPublishedReason:"Prior work retained; retry."}},setDocumentProcessingStatus:async(d,s)=>{status.push(s);return true},recordSingleDocumentError:async(r,d,e)=>errors.push(e.message)};
const ctx=new Proxy(known,{has:(t,k)=>k in t||!(k in globalThis),get:(t,k)=>k===Symbol.unscopables?undefined:k in t?t[k]:async()=>{}});
const fn=new Function("ctx","with(ctx){"+js+";return confirmLegacyReplacementAction}")(ctx);
await fn("r","d",{getAll:()=>["id1","",{}, "id2"]});assert.deepEqual(calls[0].slice(1),["r","d",{confirmLegacyReplacement:{findingIds:["id1","id2"]}}]);assert.deepEqual(status,["incomplete"]);assert.match(errors[0],/retained/);checks.push("page confirmation:IDs/options/status/error");
await fn("r","d",{getAll:()=>[]});assert.equal(calls.length,1);checks.push("page confirmation:empty no-op");
}
const {createFakeFindingsDb}=load("src/lib/__tests__/helpers/fakeFindingsDb.ts");
const archive=load("src/lib/findingArchive.ts");
const impl=extract("src/lib/extractFindings.ts",["normaliseQuote","normaliseClaim","claimIdentityKey","citedIds","planReplacement","publishReplacement"],{archiveAndReplaceFindings:archive.archiveAndReplaceFindings,findingProvenanceAvailable:prov.findingProvenanceAvailable});
{
const base={source_document_id:"d",run_id:"r",status:"accepted",source_page:null,source_quote:"Shared insight passage",researcher_note:null,human_reviewed_at:"2026-10-15",human_edited_fields:[],provenance_tracked:true,cited_support_finding_ids:[]};
const db=createFakeFindingsDb({documents:[{id:"d",run_id:"r"}],findings:[{...base,id:"insight",finding_text:"Both findings matter.",cited_support_finding_ids:["supportOld"]},{...base,id:"supportOld",finding_text:"Old support.",source_quote:"Old."},{...base,id:"supportA",finding_text:"New support A.",source_quote:"A."},{...base,id:"supportB",finding_text:"New support B.",source_quote:"B."}]});
const f=(text,quote,i,support=[])=>({finding_text:text,source_quote:quote,pageNumber:null,finding_kind:"stated_insight",theme:"T",data_type:null,quoteVerified:true,groundedByFindingId:null,extractionCaveats:[],rawIndex:i,supportRawIndices:support});
const client=db.connect();await client.query("begin");
await impl.publishReplacement(client,{tenantId:"t",runId:"r",documentId:"d",partial:false,onlyReplacePending:false,archiveReason:"manual_reextract",confirmedLegacyIds:new Set(),stagedChunks:[
{chunkIndex:0,findings:[f("New support A.","A.",0),f("Both findings matter.","Shared insight passage",1,[0])]},
{chunkIndex:1,findings:[f("New support B.","B.",0),f("Both findings matter.","Shared insight passage",1,[0])]}]});
await client.query("commit");const links=db.state.findings.find(f=>f.id==="insight").cited_support_finding_ids;
if(!["supportOld","supportA","supportB"].every(id=>links.includes(id)))defects.push({case:"duplicate insight repeated across chunks loses added support",expected:["supportOld","supportA","supportB"],actual:links});else checks.push("duplicate support union across chunks");
}

{
const legacy={id:"legacy",source_document_id:"d",run_id:"r",finding_text:"Legacy",status:"accepted",source_page:null,source_quote:"Legacy quote",researcher_note:null,human_reviewed_at:null,human_edited_fields:[],provenance_tracked:false,cited_support_finding_ids:[]};
const publish=async(db)=>{const c=db.connect();await c.query("begin");const out=await impl.publishReplacement(c,{tenantId:"t",runId:"r",documentId:"d",stagedChunks:[],partial:false,onlyReplacePending:false,archiveReason:"manual_reextract",confirmedLegacyIds:new Set(["legacy","foreign"])});await c.query("commit");return out};
const db=createFakeFindingsDb({documents:[{id:"d",run_id:"r"}],findings:[{...legacy,human_reviewed_at:"review happened after prompt"},{...legacy,id:"foreign",source_document_id:"other"}]});
const out=await publish(db);assert.equal(out.published,true);assert(db.state.findings.some(f=>f.id==="legacy"));assert(db.state.findings.some(f=>f.id==="foreign"));checks.push("publication rechecks post-prompt review and document scope");
const db2=createFakeFindingsDb({documents:[{id:"d",run_id:"r"}],findings:[legacy,{...legacy,id:"notListed"}]});
const out2=await publish(db2);assert.equal(out2.published,false);assert.deepEqual(out2.legacyFindingIds,["notListed"]);assert.equal(db2.state.findings.length,2);checks.push("unlisted unknown row prevents whole confirmed publication");
}
{
const calls=[];const client={query:async(sql,params=[])=>{calls.push({sql,params});if(sql.includes("select distinct on"))return {rows:[{event:"extract_findings_replacement_withheld",detail:{documentId:"d",reason:"legacy_unconfirmed",legacyFindingIds:["legacy"]}}]};return{rows:[{id:"legacy",finding_text:"Named legacy finding",source_filename:"Synthetic.txt"}]}}};
const implPage=extract("src/app/runs/[id]/page.tsx",["getPendingLegacyConfirmations"],{TENANT_ID:"t",withTenantRead:async(t,fn)=>fn(client),findingProvenanceAvailable:prov.findingProvenanceAvailable});
const prompts=await implPage.getPendingLegacyConfirmations("r");assert.equal(prompts[0].documentId,"d");assert.equal(prompts[0].findings[0].text,"Named legacy finding");
assert.deepEqual(calls[1].params,["r","d",["legacy"]]);assert.match(calls[1].sql,/human_reviewed_at is null/);assert.match(calls[1].sql,/cardinality\(f.human_edited_fields\) = 0/);checks.push("actual confirmation loader:run/document/ID/provenance SQL and named prompt mapping");
}
console.log(JSON.stringify({passed:checks.length,checks,defects,limits:["AST-extracted actual callers","Controlled SQL/model boundaries; theme guard SQL captured, not executed by PostgreSQL"]},null,2));if(defects.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
