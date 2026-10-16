// Test helper for storyExportSupport.test.ts: a scripted database client for the two story export
// routes and the support loader they call. It answers each statement by what it selects, records
// every statement (so tests can assert nothing was written), and returns an empty result for any
// other read the routes make that this change does not touch. supportRows and insight are also
// reused by generatorSupport.test.ts so both tests describe the same four insights.
type State = {
  statements: string[];
  supportAvailable: boolean;
  /** storyExportDiscovery.test.ts: answer the discovery section's reads too (otherwise empty). */
  discovery?: boolean;
  /** Pillar insight ids for the stored narrative (default: all four). */
  pillarInsightIds?: string[];
};

const parts = (figures = "f1") => ({ wording: "w", figures, verdict: "robust", calculation: null });

export function supportRows(available: boolean) {
  const row = (
    insightId: string,
    linkId: string,
    findingId: string,
    findingText: string,
    over: { status?: string; recorded?: unknown; current?: unknown } = {},
  ) => ({
    insight_id: insightId,
    triangulation_count: 2,
    link_id: linkId,
    finding_id: findingId,
    finding_status: over.status ?? "accepted",
    finding_text: findingText,
    support_snapshot: available ? (over.recorded ?? parts()) : null,
    current_parts: available ? (over.current ?? parts()) : null,
    calculated_table_document_id: null,
    design_snapshot: null,
    overrides_snapshot: null,
  });
  return [
    row("si-cur", "pi-c1", "f-c1", "Region B leads"),
    row("si-cur", "pi-c2", "f-c2", "Region B grew"),
    row("si-stale", "pi-s1", "f-s1", "Brand A leads on trust by 12 points", { recorded: parts("f1"), current: parts("f2") }),
    row("si-stale", "pi-s2", "f-s2", "Brand A trust is rising"),
    row("si-inv", "pi-i1", "f-i1", "Older claim about region C", { status: "rejected" }),
    row("si-inv", "pi-i2", "f-i2", "Region C is flat"),
  ];
}

export const insight = (id: string, name: string) => ({
  id,
  headline: `${name} insight headline`,
  observation: `${name} insight observation`,
  tension: `${name} tension`,
  implication: `${name} implication`,
  confidence_tier: "moderate",
  quality_tier: null,
  caveat_tags: [],
});

const recommendation = (insightId: string, name: string, headline: string) => ({
  action_text: `Act on the ${name} insight`,
  owner_role: "Marketing lead",
  timeline: "Next quarter",
  metric: "Share of trust",
  priority: "high",
  synthesized_insight_id: insightId,
  synthesized_insight_headline: headline,
  caveat_tags: [],
});

function answer(state: State, sql: string): { rows: unknown[] } {
  const s = sql.replace(/\s+/g, " ");
  if (/to_regprocedure\('finding_support_parts/.test(s)) return { rows: [{ available: state.supportAvailable }] };
  if (/as link_id/.test(s)) return { rows: supportRows(state.supportAvailable) };
  if (/from runs where id/.test(s)) {
    return {
      rows: [
        {
          project_name: "Golden thread",
          decision_statement: "Where to invest next year",
          audience: "Leadership",
          business_problem: null,
          research_objective: "Understand regional performance",
          entry_point: "generate",
          methodology: null,
        },
      ],
    };
  }
  if (/from deck_narratives/.test(s)) {
    return {
      rows: [
        {
          executive_summary: "Executive summary text.",
          situation: "Situation text.",
          complication: "Complication text.",
          question: "Where should we invest?",
          governing_thought: "Invest where demand is growing.",
          pillars: [
            {
              theme: "Regions",
              headline: "Regional demand is shifting",
              so_what: "Budget should follow demand.",
              insight_ids: state.pillarInsightIds ?? ["si-cur", "si-stale", "si-inv", "si-gone"],
            },
          ],
          recommendations_intro: "",
          caveats: [],
          generated_at: "2026-10-15T10:00:00.000Z",
        },
      ],
    };
  }
  if (/where si\.id = any\(\$1::uuid\[\]\)/.test(s)) {
    // si-gone is no longer accepted, so the accepted-only query does not return it.
    return { rows: [insight("si-cur", "Current"), insight("si-stale", "Stale"), insight("si-inv", "Invalid")] };
  }
  if (/from recommendations r/.test(s)) {
    return {
      rows: [
        recommendation("si-cur", "current", "Current insight headline"),
        recommendation("si-inv", "invalid", "Invalid insight headline"),
      ],
    };
  }
  if (/from synthesized_insight_sources s/.test(s) && /src_doc/.test(s)) {
    // Source attribution (golden-thread repair): the current insight's evidence came from two files.
    return {
      rows: [
        { synthesized_insight_id: "si-cur", source_filename: "report.docx", source_page: 2, source_table_label: null },
        { synthesized_insight_id: "si-cur", source_filename: "survey.xlsx", source_page: null, source_table_label: null },
      ],
    };
  }
  if (/evidence_digest_degraded/.test(s) && /information_schema/.test(s)) return { rows: [{ exists: false }] };
  if (state.discovery) {
    if (/has_report/.test(s)) return { rows: [{ has_report: true, has_data: true }] };
    // The "new beyond the report" reads (discoveryReport.ts): every accepted synthesized insight...
    if (/as corroborating/.test(s)) {
      return {
        rows: ["si-cur", "si-stale", "si-inv"].map((id) => ({
          id,
          headline: insight(id, { "si-cur": "Current", "si-stale": "Stale", "si-inv": "Invalid" }[id]!).headline,
          implication: "An implication.",
          quality_tier: null,
          corroborating: [false, false],
          origins: ["generated", "generated"],
        })),
      };
    }
    // ...the net-new computed findings, with their sources...
    if (/grounded_by_finding_id = f\.id/.test(s) && /src_doc/.test(s)) {
      return {
        rows: [
          { finding_text: "Region B leads", theme: "Regions", verdict_tier: "robust", source_filename: "survey.xlsx", source_page: null, source_table_label: "Region by year" },
          { finding_text: "Region C is flat", theme: "Regions", verdict_tier: "use_with_caution", source_filename: "survey.xlsx", source_page: null, source_table_label: null },
        ],
      };
    }
    // ...and contradictions: one resting on the invalid insight, one on a computed finding, one on
    // a computed finding the researcher rejected.
    if (/from finding_contradictions/.test(s)) {
      return {
        rows: [
          { original_text: "Region C leads", rationale: "The synthesis says otherwise.", contradicting_text: null, contradicting_origin: null, contradicting_status: null, synth_headline: "Invalid insight headline", contradicting_insight_id: "si-inv", detected_at: "2026-10-01T00:00:00Z", provenance_tracked: false, contradicting_edited_at: null, contradicting_edited_fields: null },
          { original_text: "Region A grew fastest", rationale: "The table shows B grew faster.", contradicting_text: "Region B grew", contradicting_origin: "generated", contradicting_status: "accepted", synth_headline: null, contradicting_insight_id: null, detected_at: "2026-10-01T00:00:00Z", provenance_tracked: true, contradicting_edited_at: null, contradicting_edited_fields: null },
          // A contradiction whose contradicting finding the researcher rejected.
          { original_text: "Region D is flat", rationale: "A table shows D fell.", contradicting_text: "Region D fell 9 points", contradicting_origin: "generated", contradicting_status: "rejected", synth_headline: null, contradicting_insight_id: null, detected_at: "2026-10-01T00:00:00Z", provenance_tracked: true, contradicting_edited_at: null, contradicting_edited_fields: null },
          // One whose contradicting finding was re-worded after the contradiction was found.
          { original_text: "Region E grew", rationale: "A table shows E shrank.", contradicting_text: "Region E shrank 4 points", contradicting_origin: "generated", contradicting_status: "accepted", synth_headline: null, contradicting_insight_id: null, detected_at: "2026-10-01T00:00:00Z", provenance_tracked: true, contradicting_edited_at: "2026-10-05T00:00:00Z", contradicting_edited_fields: ["finding_text"] },
        ],
      };
    }
  }
  return { rows: [] };
}

export function dbModule(state: State) {
  const client = {
    query: async (sql: string) => {
      state.statements.push(sql);
      return answer(state, sql);
    },
  };
  const run = async (_tenant: string, cb: (c: typeof client) => unknown) => cb(client);
  return { withTenant: run, withTenantRead: run };
}
