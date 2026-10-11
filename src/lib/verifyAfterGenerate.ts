import { withTenant } from "./db";
import { detectDuplicateFindings } from "./dedupe";
import { refreshVerdicts } from "./verifyFindings";
import { refreshStatedInsightValidations } from "./validateStatedInsights";
import { refreshInsights } from "./insightGenerator";
import { regroundStatedFindings } from "./regroundFindings";
import { checkClaimsPending } from "./claimTableChecks";
import { addWideFindingsToCommitted } from "./crosstabs";

/**
 * Findings made by a button with no pipeline behind it (a committed set of
 * crosstabs, findings from statistical output, a wave comparison) used to sit
 * with no verdict until some other action happened to run verification. This is
 * the same chain the document buttons run, minus synthesis and recommendations:
 * duplicates, claim-versus-table checks, verdicts, stated-insight validation, insights.
 *
 * Meant to be called from next/server after(), so the click returns at once.
 * Never throws: a failure is traced and the findings simply wait for the next run.
 */
export async function verifyAfterGenerate(tenantId: string, runId: string): Promise<void> {
  try {
    // Tables committed before wide findings existed get their direct readings and no-difference results now.
    await addWideFindingsToCommitted(tenantId, runId).catch(() => 0);
    await detectDuplicateFindings(tenantId, runId);
    // Report claims extracted before these findings existed can now be linked to them.
    await regroundStatedFindings(tenantId, runId);
    // Check report claims against the tables first, so the verdicts below can weigh what the numbers said.
    // Bounded: 10 batches of 3 claims; the Report claims tab picks up the rest.
    try {
      for (let i = 0; i < 10; i++) {
        const r = await checkClaimsPending(tenantId, runId, 3);
        if (r.remaining === 0 || r.done === 0) break;
      }
    } catch {
      // not migrated yet, or a model hiccup: the verdicts simply go without table checks
    }
    // The verdict step has a per-pass cap; keep going until nothing is waiting (at most 5 passes).
    for (let pass = 0; pass < 5; pass++) {
      const waiting = await refreshVerdicts(tenantId, runId);
      if (waiting === 0) break;
    }
    await refreshStatedInsightValidations(tenantId, runId);
    await refreshInsights(tenantId, runId);
  } catch (error) {
    await withTenant(tenantId, async (client) => {
      await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'post_generate_verify_error', $3)`, [
        tenantId,
        runId,
        JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
      ]);
    }).catch(() => {});
  }
}
