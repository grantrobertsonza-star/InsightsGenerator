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
// record_recommendations, record_narrative, and for Research Quality Review record_documented_facts
// (each sentence of the passage, quoted verbatim) and record_quality_observations (one observation
// per criterion, citing the facts it was sent) and record_checklist_statuses (present when a fact of
// a matching topic was sent). Any other tool gets the smallest answer its own
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
  // Research Quality Review extraction: every sentence of the <document> passage as a fact, quoted
  // exactly, with a topic and phase read from plain keywords. Restates the input; judges nothing.
  record_documented_facts: (content) => {
    const doc = /<document>\n([\s\S]*)\n<\/document>/.exec(content)?.[1] ?? "";
    const facts = doc
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12 && s.length <= 400)
      .slice(0, 40)
      .map((s) => ({
        topic: /decision/i.test(s) ? "decision" : /recruit|panel|sample/i.test(s) ? "recruitment" : /customer|public|population/i.test(s) ? "population" : /question/i.test(s) ? "instrument_item" : "claim",
        phase: /\bwill\b/i.test(s) ? "planned" : "reported_executed",
        selection: /opt-in|convenience/i.test(s) ? "non_probability" : /random|probability/i.test(s) ? "probability" : "unstated",
        statement: s.slice(0, 120),
        exact_quote: s,
      }));
    return { nothing_found: facts.length === 0, facts };
  },
  // Research Quality Review assessment: one observation per criterion sent, citing up to two facts.
  record_quality_observations: (content) => {
    const p = jsonParts(content);
    return {
      observations: p.criteria.map((c, i) => {
        // A proposal-against-brief comparison (RQ-CMP-*) needs the words of both documents (Codex
        // RQ-F02), so it cites the first fact of each document; other criteria cite one fact.
        const perSource = [...new Map(p.facts.map((f) => [f.source, f.id])).values()];
        const cited = c.id.startsWith("RQ-CMP-") ? perSource : p.facts.slice(i % Math.max(1, p.facts.length), (i % Math.max(1, p.facts.length)) + 1).map((f) => f.id);
        return {
          criterion_id: c.id,
          fact_ids: cited,
          decision_refs: [],
          score: cited.length ? 3 : 0,
          score_reason: "Replay: restates whether anything was cited.",
          documentation: cited.length ? "documented" : "not_documented",
          methodology: cited.length ? "concern" : "cannot_assess",
          decision_fitness: p.context.decisions.map((d) => ({ decision_ref: d.ref, state: "qualified", reasoning: "Replay: restates the criterion." })),
          reasoning: `Replay observation for ${c.id}.`,
          implication: `Replay implication for ${c.id}.`,
          uncertainty: [],
          improvement: { current_action: `Replay: state ${c.id} explicitly.`, future_action: null, timing: "before_decision", rationale: "Replay." },
          reference_passages: [],
          clarification_questions: [`Replay question for ${c.id}?`],
        };
      }),
    };
  },
  // Research Quality Review checklist: an element is present when a fact of a matching topic was
  // sent (decision, population, sampling or recruitment), absent otherwise. Judges nothing.
  record_checklist_statuses: (content) => {
    const p = jsonParts(content);
    const topicFor = (id) => (/DECISION/.test(id) ? "decision" : /POPULATION/.test(id) ? "population" : /SAMPLING|FRAME|SIZE/.test(id) ? "recruitment" : null);
    return {
      elements: p.elements.map((e) => {
        const t = topicFor(e.element_id);
        const ids = t ? p.facts.filter((f) => f.topic === t).map((f) => f.id).slice(0, 2) : [];
        return { element_id: e.element_id, status: ids.length ? "present" : "absent", fact_ids: ids, reason: ids.length ? "Replay: a matching fact was sent." : "Replay: no matching fact was sent." };
      }),
    };
  },
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
      // CE-2: the first numbered decision, so replayed recommendations record a decision served.
      decision_indices: [0],
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

/**
 * The JSON payload of a structured request: a single JSON line, or the JSON lines of a cached shared
 * part and the rest (Research Quality's assessment and checklist calls), merged into one object.
 */
function jsonParts(content) {
  return Object.assign({}, ...content.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)));
}

export function createModelReplay(fixturePath) {
  const log = [];
  // A check rewrites the fixture file between its steps; a request that arrives mid-write reads an empty or
  // partial file. That once threw out of this handler and stopped the whole stack, so every later check
  // timed out (27 October 2026). The read is retried briefly, and any other unexpected error answers that
  // one request with a 500 (which the app reports as a failed model call) instead of ending the server.
  const readFixture = async () => {
    if (!fixturePath || !existsSync(fixturePath)) return null;
    for (let attempt = 0; ; attempt++) {
      try {
        return JSON.parse(readFileSync(fixturePath, "utf8"));
      } catch (error) {
        if (attempt >= 20) throw error;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  };
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log.push({ at: new Date().toISOString(), replayError: String(error?.message ?? error) });
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `Replay error: ${error?.message ?? error}` } }));
    });
  });
  async function handle(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const name = body.tool_choice?.name;
    // Text blocks (a cached prefix and the rest, promptCache.ts) are read as the text they carry.
    const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : JSON.stringify(b))).join("\n") : JSON.stringify(c));
    const content = (body.messages ?? []).map((m) => textOf(m.content)).join("\n");
    const system = textOf(body.system ?? "");
    const fixture = await readFixture();
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
      // A tool loop with no forced tool (the crosstab planner, for example) gets plain text unless
      // the run's fixture scripts a tool call for it: {"untargeted":[{"match","tool","input"}]},
      // matched against the request messages like the per-tool rules above.
      // A rule with `text` answers in words instead (the last step of a tool loop such as the
      // Research assistant's; rules are tried in order, so put the later steps' rules first).
      const call = fixture?.untargeted?.find((rule) => content.includes(rule.match));
      // A rule with `status` answers with that provider error instead (a failed model call).
      if (call?.status) {
        log.push({ at: new Date().toISOString(), tool: null, fromFixture: true, injectedStatus: call.status });
        res.writeHead(call.status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Synthetic model failure" } }));
      }
      blocks = call?.text
        ? [{ type: "text", text: call.text }]
        : call
          ? [{ type: "tool_use", id: `toolu_replay_${log.length}`, name: call.tool, input: call.input }]
          : [{ type: "text", text: "Replay: no change made." }];
    }
    log.push({ at: new Date().toISOString(), tool: name ?? (blocks[0].type === "tool_use" ? blocks[0].name : null), promptChars: content.length + system.length, scripted: Boolean(name && handlers[name]), ...(override || (!name && blocks[0].type === "tool_use") ? { fromFixture: true } : {}), answer: blocks[0] });
    res.writeHead(200, { "content-type": "application/json", "request-id": `replay-${log.length}` });
    res.end(
      JSON.stringify({
        id: `msg_replay_${log.length}`,
        type: "message",
        role: "assistant",
        model: body.model ?? "replay",
        content: blocks,
        stop_reason: blocks[0].type === "tool_use" ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
  }
  return { server, log };
}
