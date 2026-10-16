// Independent smoke specification; execution results are recorded separately.
// Requires Playwright and the application-owned workflow adapter. A replay is orchestration evidence, never AI-quality proof.
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing prerequisite: ${name}`);
  return value;
};
const local = raw => {
  const u = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Disposable loopback target required');
  return u;
};
async function officeText(download) {
  const file = await download.path();
  if (!file) throw new Error('Download has no retained local file');
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const xml = await Promise.all(Object.values(zip.files).filter(f => !f.dir && f.name.endsWith('.xml')).map(f => f.async('string')));
  // Text/XML inspection only; this does not certify rendered Office layout.
  return xml.join(' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

test('retained raw-data-to-export smoke, qualification and reload', async ({ page }, testInfo) => {
  const target = JSON.parse(await fs.readFile(required('GOLDEN_SMOKE_TARGET_MANIFEST'), 'utf8'));
  local(target.appUrl);
  local(target.databaseUrlWithoutCredentials);
  expect(target.disposable).toBe(true);
  expect(target.syntheticOnly).toBe(true);
  expect(target.applicationRole).toMatchObject({ owner: false, superuser: false, bypassRls: false });
  expect(target.grantsArtifact).toBeTruthy();
  expect(['real-model', 'explicit-replay']).toContain(target.modelMode);
  testInfo.annotations.push({ type: 'evidence-level', description: target.modelMode === 'real-model' ? 'Native smoke; inspect outputs against references' : 'Replay orchestration only; no AI-quality claim' });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    return u.protocol === 'data:' || u.origin === new URL(target.appUrl).origin ? route.continue() : route.abort('blockedbyclient');
  });
  // Claude supplies accessible-control implementations for these operations; no application hook
  // or permanent workflow implementation is duplicated by this independent assertion layer.
  const adapterPath = path.resolve(required('GOLDEN_SMOKE_ADAPTER'));
  const adapter = await import(pathToFileURL(adapterPath).href);
  const ui = await adapter.bind({ page, target, testInfo });
  const fixture = path.resolve('fixtures/golden-thread-1');
  const reference = JSON.parse(await fs.readFile(path.join(fixture, 'expected.json'), 'utf8'));
  const purchase = reference.assertions.find(a => a.id === 'purchase-None');
  const run = await ui.createRun({ name: `synthetic-smoke-${Date.now()}` });
  await ui.upload(run, path.join(fixture, 'golden-survey-documented.xlsx'), 'table');
  await ui.upload(run, path.join(fixture, 'report.docx'), 'report');
  await ui.expectReadyOrActionableRecovery(run);
  await expect(ui.importQuality()).toBeVisible();
  const table = await ui.buildPurchaseCrosstab(run);
  expect(await ui.readStatistic(table, { variable: 'Purchase', rawCode: 'Yes', statistic: 'selection_percentage' })).toBeCloseTo(purchase.expectedValue, 1);
  const finding = await ui.postAndAcceptFinding(table);
  const humanText = 'Researcher wording: retain this sample-level finding with its uncertainty.';
  await ui.saveResearcherNote(finding, humanText);
  // Separate subject from the same dataset: eligible after the target rejection, not independent corroboration.
  await ui.addIndependentEvidence(run);
  const insight = await ui.generateOrLoadInsight(run, finding);
  const humanAction = "Researcher action: brief the advocacy programme owner on the difference between groups.";
  const recommendation = await ui.addEligibleHumanRecommendation(run, { independentOf: finding, text: humanAction });
  await ui.prepareAcceptedNarrative(run, insight);
  await ui.rejectFinding(finding);
  await expect(ui.insightSupportWarning(insight)).toContainText(/no longer valid|rejected/i);
  await expect(ui.narrativeSupportBanner()).toContainText(/no longer valid/i);
  await ui.assertBannerStatusCountsTruthful(run);
  for (const kind of ['findings-xlsx', 'narrative-docx', 'narrative-pptx']) {
    const [download] = await Promise.all([page.waitForEvent('download'), ui.export(run, kind)]);
    await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
    const text = await officeText(download);
    expect(text).toMatch(/golden-survey-documented\.xlsx|report\.docx/i);
    await ui.assertInvalidSupportExcludedAndDisclosed({ run, finding, kind, text });
    await ui.assertEligibleHumanTextPreserved({ run, kind, text });
    if (kind !== "findings-xlsx") expect(text).toContain(humanAction);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ui.openRun(run);
  await expect(ui.findingResearcherNote(finding)).toContainText(humanText);
  await ui.expectFindingReviewState(finding, 'rejected');
  await expect(ui.recommendationText(recommendation)).toContainText(humanAction);
  await expect(ui.insightSupportWarning(insight)).toContainText(/no longer valid|rejected/i);
});
