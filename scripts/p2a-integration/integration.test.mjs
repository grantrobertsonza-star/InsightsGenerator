// PREPARATION ONLY: requires separately authorized disposable writes and full app schema.
// No .env loading. External model/report work is forbidden, not silently simulated.
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { targets } from './safety.mjs';
import { fixtures } from './fixtures.mjs';
const state = vi.hoisted(() => ({ pool: null, storage: null, cfg: null, armed: false }));
vi.mock('../../src/lib/db', () => ({
    withTenant: async (tenant, fn) => { const c = await state.pool.connect(); try {
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
    } },
    withTenantRead: async (tenant, fn) => { const c = await state.pool.connect(); try {
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
}));
vi.mock('../../src/lib/supabaseAdmin', () => ({ supabaseAdmin: { storage: { from: () => state.storage.storage.from(state.cfg.bucket) } } }));
vi.mock('../../src/lib/anthropic', () => ({ anthropic: { messages: { create() { throw Error('Model requests prohibited in P2a'); } } }, CLAUDE_MODEL: 'p2a-no-model' }));
vi.mock('../../src/lib/apiUsage', () => ({ logApiUsage() { throw Error('Unexpected model usage'); } }));
vi.mock('../../src/lib/extractFindings', () => ({ extractDocumentText() { throw Error('Report extraction excluded: Claude active boundary'); } }));
vi.mock('../../src/lib/generateFindingsFromTable', () => ({ generateFindingsFromTable() { throw Error('AI findings excluded'); } }));
// Import lazily AFTER targets and environment marker are verified.
let cross, preview, extract;
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
    it.skip('application upload action -> later reload: defer active upload/processing adapter until IMP-006 verification');
    it.skip('real override save/clear -> calculation: defer adapter freeze verification; no direct JSON update may substitute for save action');
    it.skip('caller persistence failure with real failing client and no saved table: add after active dependency freeze');
    afterAll(async () => {
        if (!state.armed) {
            await state.pool?.end();
            return;
        }
        if (state.pool) {
            await scoped(async (c) => { for (const id of ids) {
                await c.query('delete from document_tables where document_id=$1', [id]);
                await c.query('delete from documents where id=$1', [id]);
            } await c.query('delete from trace where run_id=$1', [run]); await c.query('delete from runs where id=$1', [run]); });
            await state.pool.query('delete from tenants where id=$1', [tenant]);
            await state.pool.end();
        }
        if (state.storage && paths.length) {
            const r = await state.storage.storage.from(state.cfg.bucket).remove(paths);
            if (r.error)
                throw r.error;
        }
    }, 30000);
});
