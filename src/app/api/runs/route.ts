import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";

// NOTE: there is no login system yet, so for now the tenant is passed in
// directly by whoever calls this route. Once auth exists, this will come
// from the logged-in user's session instead of the request body/query.

export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const runs = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `select id, business_problem, research_objective, decision_statement, evidence_threshold, audience,
              status, created_at
       from runs order by created_at desc`
    );
    return result.rows;
  });

  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const body = await request.json();
  // decisionStatement is still accepted directly here for a caller that
  // already knows its decision going in, matching what the column has
  // always meant: the run's confirmed decision. businessProblem and
  // researchObjective are the normal upstream fields the actual UI now
  // captures at intake; the decision framer proposes candidate decisions
  // from those plus the evidence rather than one being supplied upfront.
  const { tenantId, businessProblem, researchObjective, decisionStatement, evidenceThreshold, audience } =
    body ?? {};

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const run = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `insert into runs (tenant_id, business_problem, research_objective, decision_statement, evidence_threshold, audience)
       values ($1, $2, $3, $4, $5, $6)
       returning id, business_problem, research_objective, decision_statement, evidence_threshold, audience, status, created_at`,
      [
        tenantId,
        businessProblem ?? null,
        researchObjective ?? null,
        decisionStatement ?? null,
        evidenceThreshold ?? null,
        audience ?? null,
      ]
    );
    return result.rows[0];
  });

  return NextResponse.json({ run }, { status: 201 });
}
