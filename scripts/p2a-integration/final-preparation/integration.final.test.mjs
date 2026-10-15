// PREPARATION ONLY: requires separately authorized disposable writes and full app schema.
// No .env loading. External model/report work is forbidden, not silently simulated.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { targets } from './safety.mjs';
import { fixtures } from './fixtures.mjs';
vi.mock('next/cache',()=>({revalidatePath(){}}));
const state = vi.hoisted(() => ({ pool: null, storage: null, cfg: null, armed: false }));
vi.mock('../../src/lib/supabaseAdmin', () => ({ supabaseAdmin: { storage: { from: () => state.storage.storage.from(state.cfg.bucket) } } }));
vi.mock('../../src/lib/anthropic', () => ({ anthropic: { messages: { create() { throw Error('Model requests prohibited in P2a'); } } }, CLAUDE_MODEL: 'p2a-no-model' }));
vi.mock('../../src/lib/apiUsage', () => ({ logApiUsage() { throw Error('Unexpected model usage'); } }));
vi.mock('../../src/lib/extractFindings', () => ({ extractDocumentText() { throw Error('Report extraction excluded: Claude active boundary'); } }));
vi.mock('../../src/lib/generateFindingsFromTable', () => ({ generateFindingsFromTable() { throw Error('AI findings excluded'); } }));
// Import lazily AFTER targets and environment marker are verified.
let cross, preview, extract, db, uploadAction, correctionAction;
const enabled = process.env.P2A_ALLOW_DISPOSABLE_WRITES === 'YES';
describe.skipIf(!enabled)('P2a real database/storage, synthetic only', () => {
    const tenant = randomUUID(), run = randomUUID(), ids = [], paths = [];
    const fx = fixtures();
    beforeAll(async () => {
        state.cfg = targets();
        // Test process only: prevent inherited app engine endpoints/credentials from being used.
        delete process.env.PARSE_STATS_FILE_URL;
        delete process.env.PARSE_STATS_SHARED_SECRET;
        state.pool = new Pool({ connectionString: state.cfg.databaseUrl, max: 8 });
        const marker = await state.pool.query('select environment_id from public.p2a_environment_guard where environment_id=$1 and synthetic_only=true', [state.cfg.environmentId]);
        if (marker.rowCount !== 1)
            throw Error('Disposable marker mismatch; no fixture writes permitted');
        const role = await state.pool.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user');
        if (role.rows[0].rolsuper || role.rows[0].rolbypassrls)
            throw Error('Test role must not bypass RLS');
        const owners = await state.pool.query("select 1 from pg_tables where schemaname='public' and tablename in ('documents','document_tables','runs') and tableowner=current_user");
        if (owners.rowCount)
            throw Error('Test role must not own application tables');
        state.armed = true;
        state.storage = createClient(state.cfg.storageUrl, state.cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
        process.env.DEFAULT_TENANT_ID = tenant;
        process.env.DATABASE_URL=state.cfg.databaseUrl;
        db=await import('../../src/lib/db');
        cross = await import('../../src/lib/crosstabs');
        preview = await import('../../src/lib/previewActions');
        extract = await import('../../src/lib/documentTables');
        await state.pool.query('insert into tenants(id,name) values($1,$2)', [tenant, 'P2a synthetic']);
        await scoped(async (c) => { await c.query('insert into runs(id,tenant_id,status) values($1,$2,$3)', [run, tenant, 'draft']); });
    }, 30000);
    async function scoped(fn) { const c = await state.pool.connect(); try {
        await c.query('begin');
        await c.query("select set_config('app.current_tenant_id',$1,true)", [tenant]);
        const r = await fn(c);
        await c.query('commit');
        return r;
    }
    catch (e) {
        await c.query('rollback');
        throw e;
    }
    finally {
        c.release();
    } }
    async function seed(f) {
        const id = randomUUID(), key = `${tenant}/${run}/${id}-${f.name}`;
        paths.push(key);
        const up = await state.storage.storage.from(state.cfg.bucket).upload(key, f.bytes, { contentType: f.name.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false });
        if (up.error)
            throw up.error;
        // INFRASTRUCTURE SEED, not the application upload action. That action is deferred below.
        await scoped(c => c.query("insert into documents(id,tenant_id,run_id,kind,source_filename,storage_path,ingestion_type,data_setup) values($1,$2,$3,'table',$4,$5,'raw',$6)", [id, tenant, run, f.name, key, JSON.stringify({ unit: 'respondents', layout: 'rows_are_cases', method: 'survey', accepted: false, wave: null, design: { mode: 'none', psu: null, strata: null } })]));
        ids.push(id);
        return id;
    }
    for (const name of ['csv', 'workbook'])
        it(`${name}: storage -> actual extraction/preview/dictionary/calculation -> saved reload`, async () => {
            const id = await seed(fx[name]);
            await extract.extractAndStoreDocumentTables(tenant, run, id);
            const p = await preview.getDocumentPreviewUrl(run, { sourceDocumentId: id, sourceTableId: null });
            expect(p.kind).toBe('table');
            expect(p.table.headers).toEqual(fx.expected.headers);
            expect(p.table.rows).toHaveLength(40);
            expect(p.table.rows[0].RespondentID).toBe('001');
            const dict = await cross.loadVariableDictionaryWithStatus(tenant, run, id);
            expect(dict.ok).toBe(true);
            expect(dict.dictionary.variables.map((v) => v.name)).toEqual(fx.expected.headers);
            const built = await cross.buildCrosstab(tenant, run, id, { columnVars: [], rowItems: [{ key: 'Q1', vars: ['Q1'] }, { key: 'Q1 (3)', vars: ['Q1 (3)'] }], weightVar: null, design: null });
            const saved = await scoped(c => c.query('select crosstab from document_tables where id=$1 and document_id=$2', [built.tableId, id]));
            const selected = await scoped(c => c.query('select selected_sheet from documents where id=$1', [id]));
            expect(saved.rows[0].crosstab.provenance.selectedSheet).toBe(selected.rows[0].selected_sheet);
            if (name === 'workbook')
                expect(selected.rows[0].selected_sheet).toBe('Dense');
            const reloaded = await cross.loadCrosstab(tenant, run, built.tableId);
            expect(reloaded.result.provenance.selectedSheet).toBe(saved.rows[0].crosstab.provenance.selectedSheet);
            for (const q of reloaded.result.questions)
                for (const row of q.rows.filter((r) => !r.isBase))
                    expect(row.total.pct).toBe(50);
        }, 60000);
    it('real competing publishers observe lock wait and adopt winner', async () => {
        const id = await seed(fx.workbook);
        const a = await state.pool.connect();
        let pending;
        try {
            await a.query('begin');
            await a.query("select set_config('app.current_tenant_id',$1,true)", [tenant]);
            await a.query('update documents set selected_sheet=$1 where id=$2', ['Dense', id]);
            pending = cross.resolveAuthoritativeSheet(tenant, id, null, 'Sparse');
            let waiting = false;
            for (let i = 0; i < 200; i++) {
                const q = await state.pool.query("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like 'update documents set selected_sheet%'");
                if (q.rowCount) {
                    waiting = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 10));
            }
            expect(waiting).toBe(true);
            await a.query('commit');
            expect(await pending).toBe('Dense');
        }
        finally {
            await a.query('rollback');
            a.release();
            if (pending)
                await pending;
        }
    }, 15000);
    it('real selected-sheet persistence error fails before saving an unconfirmed result', async () => {
        const id = await seed(fx.workbook);
        // Independent failure boundary: use read-only transaction for a real failing UPDATE.
        const c = await state.pool.connect();
        try {
            await c.query('begin read only');
            await c.query("select set_config('app.current_tenant_id',$1,true)", [tenant]);
            await expect(c.query('update documents set selected_sheet=$1 where id=$2', ['Dense', id])).rejects.toThrow();
        }
        finally {
            await c.query('rollback');
            c.release();
        }
        const row = await scoped(c => c.query('select selected_sheet from documents where id=$1', [id]));
        expect(row.rows[0].selected_sheet).toBeNull();
        // Caller-level propagation/reparse is retained in sheetSelectionConsistency.test.ts.
    });
    it('unsupported identifiers are blanked in persisted extraction with a recovery trace', async () => {
        const id = await seed(fx.unsupported);
        await extract.extractAndStoreDocumentTables(tenant, run, id);
        const tables = await scoped(c => c.query('select rows from document_tables where document_id=$1 and table_index=0', [id]));
        expect(tables.rows[0].rows[0].AccountID).toBeNull();
        const traces = await scoped(c => c.query("select detail from trace where run_id=$1 and event='unsupported_identifier_format'", [run]));
        expect(traces.rows.some((r) => JSON.stringify(r.detail).includes('AccountID'))).toBe(true);
    });
    it('missing selected sheet returns recovery error without a replacement dataset', async () => {
        const id = await seed(fx.workbook);
        await scoped(c => c.query('update documents set selected_sheet=$1 where id=$2', ['Removed', id]));
        const p = await preview.getDocumentPreviewUrl(run, { sourceDocumentId: id, sourceTableId: null });
        expect(p.error).toContain('Removed');
        expect(p.kind).toBeUndefined();
    });

    it('native upload action -> actual preview/dictionary/calculation and reload', async () => {
        uploadAction=await import('../../src/lib/documentUploadActions');
        for(const key of ['csv','workbook']){
            const f=fx[key], form=new FormData();
            const name='native-'+f.name;form.append('rawTableFiles',new File([f.bytes],name,{type:name.endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
            const result=await uploadAction.uploadDocumentsAction(run,form);
            expect(result.ok,JSON.stringify(result)).toBe(true);
            const docs=await scoped(c=>c.query('select id,storage_path from documents where run_id=$1 and source_filename=$2',[run,name]));
            expect(docs.rowCount).toBe(1);const id=docs.rows[0].id;ids.push(id);paths.push(docs.rows[0].storage_path);
            await extract.extractAndStoreDocumentTables(tenant,run,id);
            const p=await preview.getDocumentPreviewUrl(run,{sourceDocumentId:id,sourceTableId:null});
            expect(p.table.headers).toEqual(fx.expected.headers);expect(p.table.rows.length).toBe(40);
            const dict=await cross.loadVariableDictionaryWithStatus(tenant,run,id);expect(dict.ok).toBe(true);expect(dict.dictionary.nCases).toBe(40);
            const built=await cross.buildCrosstab(tenant,run,id,{columnVars:[],rowItems:[{key:'Q1',vars:['Q1']}],weightVar:null,design:null});
            const saved=await cross.loadCrosstab(tenant,run,built.tableId);
            const selected=(await scoped(c=>c.query('select selected_sheet from documents where id=$1',[id]))).rows[0].selected_sheet;
            expect(saved.result.provenance.selectedSheet).toBe(selected);
            if(key==='workbook')expect(selected).toBe('Dense');
        }
    },90000);
    it('real correction save/clear and persisted canonical calculation targeting', async()=>{
        correctionAction=await import('../../src/lib/variableOverrideActions');
        const id=await seed(fx.workbook);
        expect((await correctionAction.saveVariableOverrideAction(run,id,'Q1 (2)',{type:'continuous'})).ok).toBe(true);
        let overrides=(await scoped(c=>c.query('select variable_overrides from documents where id=$1',[id]))).rows[0].variable_overrides;
        expect(Object.keys(overrides)).toEqual(['Q1 (2)']);expect(overrides['Q1 (2)'].type).toBe('continuous');
        const built=await cross.buildCrosstab(tenant,run,id,{columnVars:[],rowItems:[{key:'Q1',vars:['Q1']},{key:'Q1 (3)',vars:['Q1 (3)']},{key:'Q1 (2)',vars:['Q1 (2)']}],weightVar:null,design:null});
        const saved=(await scoped(c=>c.query('select crosstab,overrides_snapshot from document_tables where id=$1',[built.tableId]))).rows[0];
        expect(saved.overrides_snapshot).toEqual(overrides);
        expect(saved.crosstab.provenance.selectedSheet).toBe('Dense');
        expect((await cross.loadCrosstab(tenant,run,built.tableId)).result.provenance.selectedSheet).toBe('Dense');
        expect((await correctionAction.saveVariableOverrideAction(run,id,'Q1 (2)',{type:null})).ok).toBe(true);
        overrides=(await scoped(c=>c.query('select variable_overrides from documents where id=$1',[id]))).rows[0].variable_overrides;
        expect(overrides).toEqual({});
    },60000);
    it('actual caller selection failure prevents cache/table publication, then retry succeeds',async()=>{
        const id=await seed(fx.workbook);
        const admin=new Pool({connectionString:process.env.P2A_ADMIN_URL});
        try{
            await admin.query("create function p2a_parser_selection_fault() returns trigger language plpgsql as $$begin if new.id='"+id+"'::uuid then raise exception 'Synthetic selected-sheet persistence failure'; end if; return new; end$$");
            await admin.query('create trigger p2a_parser_selection_fault before update of selected_sheet on documents for each row execute function p2a_parser_selection_fault()');
            await expect(cross.loadVariableDictionary(tenant,run,id)).rejects.toThrow(/Synthetic selected-sheet/);
            const row=(await scoped(c=>c.query('select selected_sheet,variable_dictionary from documents where id=$1',[id]))).rows[0];
            expect(row.selected_sheet).toBeNull();expect(row.variable_dictionary).toBeNull();
            expect((await scoped(c=>c.query('select id from document_tables where document_id=$1',[id]))).rowCount).toBe(0);
        }finally{
            await admin.query('drop trigger if exists p2a_parser_selection_fault on documents');
            await admin.query('drop function if exists p2a_parser_selection_fault()');await admin.end();
        }
        const dict=await cross.loadVariableDictionary(tenant,run,id);expect(dict.sheets.data).toBe('Dense');expect(dict.nCases).toBe(40);
    },60000);


    it('actual losing dictionary caller reparses committed winner after observed blocking',async()=>{
        const id=await seed(fx.workbook),holder=await state.pool.connect(),observer=new Pool({connectionString:process.env.P2A_ADMIN_URL});
        let pending;
        try{
            await holder.query('begin');await holder.query("select set_config('app.current_tenant_id',$1,true)",[tenant]);
            const holderPid=(await holder.query('select pg_backend_pid() pid')).rows[0].pid;
            await holder.query("update documents set selected_sheet='Sparse' where id=$1",[id]);
            pending=cross.loadVariableDictionary(tenant,run,id);
            let lock;
            for(let i=0;i<300;i++){
                const rows=(await observer.query("select pid,wait_event_type,pg_blocking_pids(pid) blockers,query from pg_stat_activity where datname=current_database() and usename=current_user::text is not true and wait_event_type='Lock'")).rows;
                lock=rows.find(r=>r.blockers.includes(holderPid)&&r.query.toLowerCase().includes('update documents set selected_sheet'));
                if(lock)break;await new Promise(r=>setTimeout(r,10));
            }
            expect(lock).toBeTruthy();
            const fs=await import('node:fs');fs.writeFileSync(process.env.P2A_CAPTURE_FILE+'.lock.json',JSON.stringify({document:id,holderPid,waiter:lock},null,2));
            await holder.query('commit');
            const dictionary=await pending;expect(dictionary.sheets.data).toBe('Sparse');expect(dictionary.nCases).toBe(1);
            const row=(await scoped(c=>c.query('select selected_sheet,variable_dictionary from documents where id=$1',[id]))).rows[0];
            expect(row.selected_sheet).toBe('Sparse');expect(row.variable_dictionary.nCases).toBe(1);expect(row.variable_dictionary.sheets.data).toBe('Sparse');
            const previewResult=await preview.getDocumentPreviewUrl(run,{sourceDocumentId:id,sourceTableId:null});
            expect(previewResult.table.rows.length).toBe(1);
            // The retained Sparse sheet has one answer category: the actual engine must refuse
            // it rather than silently tabulating Dense's two categories/40 rows.
            await expect(cross.buildCrosstab(tenant,run,id,{columnVars:[],rowItems:[{key:'Q1',vars:['Q1']}],weightVar:null,design:null})).rejects.toThrow(/Fewer than two answer categories/);
            expect((await scoped(c=>c.query('select id from document_tables where document_id=$1 and crosstab is not null',[id]))).rowCount).toBe(0);
        }finally{await holder.query('rollback');holder.release();if(pending)await pending.catch(()=>{});await observer.end()}
    },30000);
    it('pre0093 actual dictionary caller returns actionable migration failure without cache/table writes',async()=>{
        const pre=new Pool({connectionString:process.env.P2A_PRE_ADMIN_URL});
        let preApp;
        try{
            const t=randomUUID(),r=randomUUID(),d=randomUUID();
            await pre.query("insert into tenants(id,name) values($1,'P2a pre0093 synthetic')",[t]);
            await pre.query('insert into runs(id,tenant_id) values($1,$2)',[r,t]);
            await pre.query("insert into documents(id,tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,$3,'table','pre.xlsx','synthetic-unused','raw')",[d,t,r]);
            const priorPool=globalThis.pgPool;preApp=new Pool({connectionString:process.env.P2A_PRE_APP_URL});globalThis.pgPool=preApp;
            vi.resetModules();
            try{
                const preCross=await import('../../src/lib/crosstabs');
                await expect(preCross.loadVariableDictionary(t,r,d)).rejects.toThrow(/0093|selected_sheet/);
                expect((await pre.query('select variable_dictionary from documents where id=$1',[d])).rows[0].variable_dictionary).toBeNull();
                expect((await pre.query('select id from document_tables where document_id=$1',[d])).rowCount).toBe(0);
            }finally{globalThis.pgPool=priorPool}
        }finally{await preApp?.end();await pre.end()}
    },30000);

    it('actual raw preview must agree with a competing authoritative selection before later calculation',async()=>{
        const id=await seed(fx.workbook),holder=await state.pool.connect();
        try{
            await holder.query('begin');await holder.query("select set_config('app.current_tenant_id',$1,true)",[tenant]);await holder.query("update documents set selected_sheet='Sparse' where id=$1",[id]);
            const pending=preview.getDocumentPreviewUrl(run,{sourceDocumentId:id,sourceTableId:null});
            await new Promise(r=>setTimeout(r,500));await holder.query('commit');
            const result=await pending,dict=await cross.loadVariableDictionary(tenant,run,id);
            const fs=await import('node:fs');fs.writeFileSync(process.env.P2A_CAPTURE_FILE+'.preview-race.json',JSON.stringify({document:id,preview:result,dictionary:{sheet:dict.sheets?.data,nCases:dict.nCases}},null,2));
            expect(result.table.sheetName).toBe(dict.sheets.data);expect(result.table.rows.length).toBe(dict.nCases);
        }finally{await holder.query('rollback');holder.release()}
    },30000);
    it('unsupported actual Python dictionary/calculation is blank and confirmed cache reuses authoritative selection',async()=>{
        const id=await seed(fx.unsupported);
        const dictionary=await cross.loadVariableDictionary(tenant,run,id);
        const fs=await import('node:fs');fs.writeFileSync(process.env.P2A_CAPTURE_FILE+'.unsupported-dictionary.json',JSON.stringify(dictionary,null,2));
        expect(dictionary.unsupportedIdentifierColumns).toContain('AccountID');
        expect(dictionary.nCases).toBe(2);
        await expect(cross.buildCrosstab(tenant,run,id,{columnVars:[],rowItems:[{key:'AccountID',vars:['AccountID']}],weightVar:null,design:null})).rejects.toThrow();
        const before=(await scoped(c=>c.query('select selected_sheet,variable_dictionary from documents where id=$1',[id]))).rows[0];
        const cached=await cross.loadVariableDictionary(tenant,run,id);expect(cached).toEqual(dictionary);
        const after=(await scoped(c=>c.query('select selected_sheet,variable_dictionary from documents where id=$1',[id]))).rows[0];expect(after).toEqual(before);
    },30000);
    afterAll(async()=>{
        if(state.armed){
            const fs=await import('node:fs');
            const captured=await scoped(async c=>({
                tenant,run,ids,paths,
                documents:(await c.query('select * from documents where run_id=$1',[run])).rows,
                tables:(await c.query('select * from document_tables where run_id=$1',[run])).rows,
                trace:(await c.query('select * from trace where run_id=$1',[run])).rows
            }));
            fs.writeFileSync(process.env.P2A_CAPTURE_FILE,JSON.stringify(captured,null,2));
        }
        await state.pool?.end();await db?.pool?.end();
    },30000);
});
