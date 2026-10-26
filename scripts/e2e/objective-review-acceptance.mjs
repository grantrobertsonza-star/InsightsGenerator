// Native OBJ-REV-004 detail/overview, human wording and exclusion regression. Run after e2e:stack.
import { chromium, expect } from '@playwright/test';
import { openSection } from "../../e2e/ui/helpers/nav.mjs";
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
const out = path.resolve(process.env.E2E_OUT_DIR ?? 'e2e-results');
const target = JSON.parse(fs.readFileSync(process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? path.join(out, 'target-manifest.json')));
const runtime = path.resolve(process.env.E2E_SOURCE_ROOT ?? process.cwd());
const { bind } = await import(pathToFileURL(path.join(runtime, 'e2e/adapter/golden-thread-adapter.mjs')));
const databaseUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || target.syntheticOnly !== true || !['127.0.0.1', 'localhost', '::1'].includes(databaseUrl.hostname) || !/^\/ie_e2e_[a-f0-9]{10}$/.test(databaseUrl.pathname))
    throw new Error('Refusing a non-disposable objective acceptance target');
fs.mkdirSync(out, { recursive: true });
const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace('postgres://', 'postgres://postgres@') });
await db.connect();
const browser = await chromium.launch();
// G6: start signed in as the stack's synthetic primary user.
const page = await browser.newPage(target.authStateFile ? { storageState: target.authStateFile } : {});
page.setDefaultTimeout(30000);
const result = { checks: [], boundary: 'Native objective detail and overview transitions/regeneration/reload. One synthetic evidence/rejected-candidate fixture; model replay only.' };
const post = async (locator) => { await expect(locator).toBeEnabled({ timeout: 60000 }); await page.waitForTimeout(350); await locator.click(); await page.waitForTimeout(350); };
try {
    const ui = await bind({ page, target, testInfo: { annotations: [] } });
    const run = await ui.createRun({ name: 'review-transitions-' + Date.now() });
    result.run = run;
    await openSection(page, "Set Objectives");
    const form = page.locator('form', { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill('Preserve this original research objective');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Preserve this original research objective', { exact: true }).first()).toBeVisible();
    const id = (await db.query('select id from objective_candidates where run_id=$1', [run.id])).rows[0].id;
    const status = async (wanted) => expect.poll(async () => (await db.query('select status from objective_candidates where id=$1', [id])).rows[0].status, { timeout: 60000 }).toBe(wanted);
    await openSection(page, "Review Objectives");
    await page.getByRole('button').filter({ hasText: 'Preserve this original research objective' }).first().click();
    const middle = page.getByRole('heading', { name: 'Objective detail', exact: true }).locator('xpath=ancestor::section[1]');
    await middle.getByRole('button', { name: 'Edit', exact: true }).click();
    await middle.locator('textarea').fill('Researcher wording preserved in both presentations');
    await post(middle.getByRole('button', { name: 'Save', exact: true }));
    await status('accepted');
    await post(middle.getByRole('button', { name: 'Unaccept', exact: true }));
    await status('pending');
    await post(middle.getByRole('button', { name: 'Accept', exact: true }));
    await status('accepted');
    await post(middle.getByRole('button', { name: 'Unaccept', exact: true }));
    await status('pending');
    await post(middle.getByRole('button', { name: 'Reject', exact: true }));
    await status('rejected');
    await page.getByRole('button', { name: /^Rejected \(/ }).click();
    let row = page.locator('tbody[data-objective-row]').filter({ hasText: 'Researcher wording preserved in both presentations' }).last();
    await post(row.getByRole('button', { name: 'Restore', exact: true }));
    await status('accepted');
    result.checks.push({ case: 'detail edit/accept/unaccept/reaccept/reject and overview restore preserve human wording', status: 'passed' });
    await page.reload({ waitUntil: 'networkidle' });
    await openSection(page, "Review Objectives");
    row = page.locator('tbody[data-objective-row]').filter({ hasText: 'Researcher wording preserved in both presentations' }).last();
    await post(row.getByRole('button', { name: 'Unaccept', exact: true }));
    await status('pending');
    await post(row.getByRole('button', { name: 'Reject', exact: true }));
    await status('rejected');
    await page.getByRole('button', { name: /^Rejected \(/ }).click();
    await post(row.getByRole('button', { name: 'Restore', exact: true }));
    await status('accepted');
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await row.locator('textarea').fill('Final human objective wording');
    await post(page.locator('tbody[data-objective-row]').filter({ has: page.locator('textarea') }).getByRole('button', { name: 'Save', exact: true }));
    await expect.poll(async () => (await db.query('select candidate_text from objective_candidates where id=$1', [id])).rows[0].candidate_text).toBe('Final human objective wording');
    result.checks.push({ case: 'overview transitions and edit preserve same candidate identity', status: 'passed' });
    await db.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Synthetic bounded evidence for regeneration')", [target.tenantId, run.id]);
    const ai = (await db.query("insert into objective_candidates(tenant_id,run_id,source,status,candidate_text,rationale) values($1,$2,'ai_suggested','pending','Exclude this suggested objective','Synthetic exclusion fixture') returning id", [target.tenantId, run.id])).rows[0].id;
    await page.reload({ waitUntil: 'networkidle' });
    await openSection(page, "Review Objectives");
    await page.locator('tbody[data-objective-row]').filter({ hasText: 'Exclude this suggested objective' }).getByRole('button', { name: 'Reject', exact: true }).click();
    await expect.poll(async () => (await db.query('select status from objective_candidates where id=$1', [ai])).rows[0].status).toBe('rejected');
    await page.getByRole('button', { name: 'Regenerate suggestions', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Regenerate suggestions', exact: true })).toBeEnabled({ timeout: 60000 });
    await page.reload({ waitUntil: 'networkidle' });
    await openSection(page, "Review Objectives");
    const rows = (await db.query('select id,candidate_text,status,edited from objective_candidates where run_id=$1', [run.id])).rows;
    expect(rows.find(r => r.id === id)).toMatchObject({ candidate_text: 'Final human objective wording', status: 'accepted', edited: true });
    expect(rows.find(r => r.id === ai)).toMatchObject({ status: 'rejected' });
    expect((await db.query('select initial_research_objective from runs where id=$1', [run.id])).rows[0].initial_research_objective).toBe('Preserve this original research objective');
    // The overview table shows each objective rolled up by default (2026-10-20): roll it down to read it.
    const finalRow = middle.locator('tbody[data-objective-row]').filter({ hasText: 'Final human objective wording' });
    await finalRow.getByTestId('objective-roll').click();
    await expect(middle.getByText('Final human objective wording', { exact: true })).toBeVisible();
    result.checks.push({ case: 'native regenerate/reload preserves human wording, rejected exclusion and original brief', status: 'passed' });
    result.status = 'passed';
}
catch (error) {
    result.status = 'failed';
    result.error = error.stack;
    fs.writeFileSync(path.join(out, 'objective-review-error.txt'), await page.locator('body').innerText());
    process.exitCode = 1;
}
finally {
    await browser.close();
    await db.end();
    fs.writeFileSync(path.join(out, 'objective-review-native.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
}
