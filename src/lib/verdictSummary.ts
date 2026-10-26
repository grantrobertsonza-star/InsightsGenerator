// The run page's verification summary ("n of m passed") and, when nothing passed, a few failed
// rationales. Moved out of page.tsx (golden-thread follow-up, 2026-10-17) so the latest-verdict rule
// (latestVerdict.ts) is tested on the functions the page calls: one count per finding by its latest
// verdict, and a "failed" sample only for findings whose latest verdict refuses them.
import { withTenantRead } from "./db";
import { latestVerdictLateral } from "./latestVerdict";

export type VerdictSummary = {
  verdictedCount: number;
  passedCount: number;
};

export async function getVerdictSummary(tenantId: string, runId: string): Promise<VerdictSummary> {
  return withTenantRead(tenantId, async (client) => {
    const result = await client.query<{ tier: string; count: string }>(
      // One count per finding, by its latest verdict (latestVerdict.ts), not one per verdict row.
      `select v.verdict_tier as tier, count(*) as count
       from findings f
       join ${latestVerdictLateral("f.id", ["verdict_tier"])} v on true
       where f.run_id = $1
       group by v.verdict_tier`,
      [runId],
    );
    let verdictedCount = 0;
    let passedCount = 0;
    for (const row of result.rows) {
      const count = Number(row.count);
      verdictedCount += count;
      if (row.tier === "robust" || row.tier === "use_with_caution") {
        passedCount += count;
      }
    }
    return { verdictedCount, passedCount };
  });
}

export type FailedVerdictSample = {
  finding_text: string;
  verdict_tier: string;
  rationale: string;
};

// A count alone ("0 of 58 passed") says something is off but not what,
// verification is a model judgment call, not a fixed rule, so seeing a
// couple of its actual rationales is the fastest way to tell "this
// evidence genuinely is that weak" apart from "the verifier is being
// unreasonably strict here". Only worth fetching when nothing passed at
// all; once some findings are passing, the ones that didn't are a much
// less urgent question.
export async function getSampleFailedVerdicts(
  tenantId: string,
  runId: string,
): Promise<FailedVerdictSample[]> {
  return withTenantRead(tenantId, async (client) => {
    const result = await client.query<FailedVerdictSample>(
      // Findings whose latest verdict refuses them (latestVerdict.ts); an older refusal that a later
      // verification overturned is history, not a current failure.
      `select f.finding_text, v.verdict_tier, v.rationale
       from findings f
       join ${latestVerdictLateral("f.id", ["verdict_tier", "rationale"])} v on true
       where f.run_id = $1 and v.verdict_tier in ('not_supported', 'insufficient_information')
       order by f.created_at, f.id
       limit 3`,
      [runId],
    );
    return result.rows;
  });
}
