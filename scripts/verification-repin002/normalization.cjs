const fs=require("fs"),ts=require("typescript"),crypto=require("crypto"),assert=require("assert/strict");
const files=["src/lib/objectiveLines.ts","src/lib/objectiveCandidateActions.ts","src/lib/runContextActions.ts","src/lib/runSync.ts"];
const hash=()=>Object.fromEntries(files.map(p=>[p,crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")]));
const before=hash();
function extract(file,names,ctx={}){const sf=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),99,true);const text=sf.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(sf).replace(/^export /,"")).join("\n");const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(ctx),js+";return {"+names.join(",")+"}")(...Object.values(ctx))}
const norm=extract(files[0],["normalizeObjectiveLine","parseObjectiveLines"]);
const sync=extract(files[3],["syncResearchObjective"]).syncResearchObjective;
const markers=["1. ","2) ","- ","* ","\u2022 ",""];
(async()=>{let cases=0;
for(const a of markers)for(const b of markers){
const state={text:a+"Alpha\nOther",brief:"Immutable original brief",rows:[{id:"same-id",candidate_text:a+"Alpha",source:"researcher_authored",status:"accepted",edited:false},{id:"other",candidate_text:"Other",source:"researcher_authored",status:"accepted",edited:false}]};
const client={query:async(sql,p=[])=>{const q=sql.replace(/\s+/g," ").trim();
if(q.startsWith("select stated_objectives_text"))return {rows:[{stated_objectives_text:state.text}]};
if(q.startsWith("update runs set stated_objectives_text")){if(p.length===3&&state.text!==p[2])return {rowCount:0};state.text=p[0];return {rowCount:1}};
if(q.startsWith("select id, candidate_text from objective_candidates"))return {rows:state.rows};
if(q.startsWith("select candidate_text, source"))return {rows:structuredClone(state.rows.filter(r=>r.id===p[0]))};
if(q.startsWith("update objective_candidates set candidate_text")){for(const r of state.rows.filter(r=>p[1].includes(r.id))){r.candidate_text=p[0];r.edited=true}return {rowCount:1}};
if(q.startsWith("update objective_candidates set status")){const r=state.rows.find(r=>r.id===p[2]);r.candidate_text=p[0];r.edited=r.edited||p[1];r.status="accepted";return{rowCount:1}};
if(q.startsWith("delete from objective_candidates")){state.rows=state.rows.filter(r=>!p[0].includes(r.id));return {rowCount:1}};
if(q.startsWith("select candidate_text from objective_candidates"))return {rows:state.rows.filter(r=>r.status==="accepted")};
if(q.startsWith("update runs set research_objective")){state.summary=p[0];return{rowCount:1}};
throw Error("Unexpected SQL/duplicate insert "+q);
}};
const ctx={...norm,TENANT_ID:"t",withTenant:async(t,fn)=>fn(client),syncResearchObjective:sync,revalidatePath(){},refreshObjectiveQuality:async()=>{},refreshObjectiveValidationQuietly:async()=>{}};
const setup=extract(files[2],["editStatedObjective"],ctx).editStatedObjective;
const review=extract(files[1],["acceptObjectiveCandidate"],ctx).acceptObjectiveCandidate;
await setup("r",a+"Alpha",b+"Beta");
assert.equal(state.rows[0].candidate_text,"Beta");assert.equal(state.text,"Beta\nOther");
await review("r","same-id",a+"Gamma");
assert.equal(state.rows[0].candidate_text,"Gamma");assert.equal(state.text,"Gamma\nOther");
await setup("r",b+"Gamma",a+"Delta");
assert.equal(state.rows.length,2);assert.equal(state.rows[0].id,"same-id");assert.equal(state.rows[0].candidate_text,"Delta");assert.equal(state.text,"Delta\nOther");
await setup("r",a+"Delta",null);
assert.deepEqual(state.rows.map(r=>r.id),["other"]);assert.equal(state.text,"Other");assert.equal(state.summary,"Other");assert.equal(state.brief,"Immutable original brief");cases++;
}
assert.deepEqual(norm.parseObjectiveLines("Secondary objectives:\n1. Alpha\n- Beta\n\u2022 Gamma\n\n"),["Alpha","Beta","Gamma"]);
for(const marker of markers){assert.equal(norm.normalizeObjectiveLine(marker+"Alpha"),"Alpha");assert.deepEqual(norm.parseObjectiveLines(marker+"Alpha"),["Alpha"])}
assert.deepEqual(hash(),before,"Source changed; invalidate M02 evidence");
console.log(JSON.stringify({actionRoundtripCasesPassed:cases,parserCasesPassed:7,hashes:before,limitations:["Actual extracted Setup/Review actions and synchronizer with controlled SQL","No page/browser or real persistence; broad OBJ-SET-M02 stays awaiting integration verification"]},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
