// Explicit model REPLAY for the local smoke stack (scripts/e2e/local-stack.mjs): answers the
// app's Messages API calls deterministically so the workflow can run with no key and no cost.
//
// It is orchestration evidence only. It writes nothing of its own judgement: each answer restates
// the evidence the request carried (finding and insight wording, including its figures), so the
// app's own checks (numerical traceability, support freshness, exports) run on real code over
// predictable text. Every call is logged (tool, prompt length, answer) for the run's evidence.
//
// Tools with a scripted answer (clusters group pre-insights by subject, see record_clusters):
// record_insights, record_clusters, record_synthesized_insight,
// record_recommendations, record_narrative. Any other tool gets the smallest answer its own
// input_schema allows (empty arrays, first enum value, empty strings), which the app treats as
// "nothing usable came back"; a text-only request gets a one-line reply.
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";

const numbered = (text, marker) =>
  [...text.matchAll(new RegExp(`^(\\d+)\\. ${marker}(.*)$`, "gm"))].map((m) => ({ index: Number(m[1]), line: m[2].trim() }));

function minimal(schema) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      for (const key of schema.required ?? []) out[key] = minimal(schema.properties?.[key]);
      return out;
    }
    case "array":
      return [];
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

const handlers = {
  // "N. [theme · verdict: ...] <finding text>" per finding.
  record_insights: (content) => ({
    insights: numbered(content, "\\[[^\\]]*\\]\\s*").map(({ index, line }) => ({
      index,
      headline: line,
      observation: line,
      tension: "It confirms the expected picture.",
      implication: "Use it as stated, with its uncertainty.",
    })),
  }),
  // "N. [theme] ..." per pre-insight: one cluster per subject, the theme with any " by <banner>"
  // dropped ("Purchase" and "Purchase by Gender" are one subject), wherever two or more share it.
  // Deterministic and blind to which finding a test later rejects; a single-subject run still
  // gives exactly one cluster, as before.
  record_clusters: (content) => {
    const bySubject = new Map();
    for (const { index, line } of numbered(content, "")) {
      const subject = (/^\[([^\]]*)\]/.exec(line)?.[1] ?? "").split(/ by /i)[0].trim() || "Uncategorised";
      bySubject.set(subject, [...(bySubject.get(subject) ?? []), index]);
    }
    return {
      clusters: [...bySubject]
        .filter(([, members]) => members.length >= 2)
        .map(([label, members]) => ({ label, member_indices: members })),
    };
  },
  record_synthesized_insight: (content) => {
    const first = /Headline:\s*(.*)/.exec(content)?.[1]?.trim() ?? /^\d+\.\s*(.*)$/m.exec(content)?.[1]?.trim() ?? "Replay insight";
    return {
      headline: first,
      observation: first,
      tension: "It confirms the expected picture.",
      implication: "Use it as stated, with its uncertainty.",
      action_plan_status: "has_action",
      materiality_rationale: "Replay: restates the clustered evidence.",
      passes_validity_gate: true,
    };
  },
  record_recommendations: (content) => ({
    recommendations: numbered(content, "(?:\\[[^\\]]*\\]\\s*)?Headline:\\s*").map(({ index, line }) => ({
      index,
      action_text: `Act on: ${line}`,
      owner_role: "Research lead",
      owner_feasibility_note: "Within the lead's remit.",
      timeline: "Next quarter",
      metric: "Tracked against the same measure.",
      priority: "medium",
      assumptions_and_risks: "Assumes the evidence holds.",
      alternatives_considered: "Wait for more evidence.",
    })),
  }),
  record_narrative: (_content, system) => {
    const insights = numbered(system, "\\([^)]*\\)\\s*Headline:\\s*");
    const lead = insights[0]?.line ?? "The accepted evidence";
    return {
      executive_summary: lead,
      situation: "The project's accepted insights are summarised here.",
      complication: "They carry their stated uncertainty.",
      question: "What should be done next?",
      governing_thought: lead,
      pillars: [{ theme: "Evidence", headline: lead, so_what: "It bears on the decision.", insight_indices: insights.map((i) => i.index) }],
      recommendations_intro: "The recommended actions follow.",
      caveats: ["This report was produced with a scripted model replay for testing."],
    };
  },
};

export function createModelReplay(fixturePath) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const name = body.tool_choice?.name;
    const content = (body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
    const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
    const fixture = fixturePath && existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;
    const override = fixture?.tools?.[name]?.find(rule => content.includes(rule.match));
    if (override?.status) {
      log.push({ at: new Date().toISOString(), tool: name, scripted: true, injectedStatus: override.status });
      res.writeHead(override.status, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { type: "api_error", message: "Synthetic model chunk outage" } }));
    }
    let blocks;
    if (name) {
      const tool = (body.tools ?? []).find((t) => t.name === name);
      const input = override?.input ?? (handlers[name] ? handlers[name](content, system) : minimal(tool?.input_schema));
      blocks = [{ type: "tool_use", id: `toolu_replay_${log.length}`, name, input }];
    } else {
      blocks = [{ type: "text", text: "Replay: no change made." }];
    }
    log.push({ at: new Date().toISOString(), tool: name ?? null, promptChars: content.length + system.length, scripted: Boolean(name && handlers[name]), answer: blocks[0] });
    res.writeHead(200, { "content-type": "application/json", "request-id": `replay-${log.length}` });
    res.end(
      JSON.stringify({
        id: `msg_replay_${log.length}`,
        type: "message",
        role: "assistant",
        model: body.model ?? "replay",
        content: blocks,
        stop_reason: name ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
  });
  return { server, log };
}
