// Loopback budget gateway for an AUTHORISED real-model verification run on the disposable stack.
// local-stack.mjs points the app at it with E2E_MODEL_GATEWAY=http://127.0.0.1:55017; the app gets
// only a placeholder key, and this process adds the real one on the way out.
//
//   ANTHROPIC_KEY_FILE=<file holding only the key> GATEWAY_BUDGET_USD=5 node scripts/e2e/model-budget-gateway.mjs
//
// Guarantees (for this process's lifetime):
//   - listens on 127.0.0.1 only; forwards POST /v1/messages to api.anthropic.com, nothing else
//   - the key is read from ANTHROPIC_KEY_FILE once; it is never printed, logged or written
//   - budget: before forwarding, a request RESERVES its worst case (input estimated at 1 token per
//     3 characters plus max_tokens of output) at conservative prices; a request whose reservation
//     would take spend past GATEWAY_BUDGET_USD is refused with HTTP 402 and never sent. After the
//     answer, the reservation is replaced by the reported usage. So concurrent calls cannot overshoot.
//   - every call is logged to GATEWAY_LOG (default e2e-results/model-gateway-log.json): time, model,
//     tool, tokens, estimated cost, status. No prompt or answer text, no key.
// Prices are deliberately cautious (USD per million tokens) and are an estimate, not the invoice.
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PRICE = { input: Number(process.env.GATEWAY_INPUT_PER_MTOK ?? 3), output: Number(process.env.GATEWAY_OUTPUT_PER_MTOK ?? 15) };
const budget = Number(process.env.GATEWAY_BUDGET_USD ?? "0");
if (!(budget > 0)) throw new Error("GATEWAY_BUDGET_USD must be a positive number.");
const keyFile = process.env.ANTHROPIC_KEY_FILE;
if (!keyFile) throw new Error("ANTHROPIC_KEY_FILE must name a file holding only the API key.");
const key = readFileSync(keyFile, "utf8").trim();
if (!/^sk-ant-/.test(key)) throw new Error("ANTHROPIC_KEY_FILE does not hold an Anthropic key.");
const logPath = path.resolve(process.env.GATEWAY_LOG ?? "e2e-results/model-gateway-log.json");
const upstream = "https://api.anthropic.com";

let spent = 0;
let reserved = 0;
const log = [];
const cost = (input, output) => (input / 1e6) * PRICE.input + (output / 1e6) * PRICE.output;
const save = () => writeFileSync(logPath, JSON.stringify({ budgetUsd: budget, spentUsd: Number(spent.toFixed(6)), prices: PRICE, calls: log }, null, 1));

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/__budget") return reply(200, { budgetUsd: budget, spentUsd: spent, reservedUsd: reserved, calls: log.length });
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) return reply(404, { error: "only POST /v1/messages is forwarded" });
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return reply(400, { error: "invalid JSON" });
  }
  const worst = cost(Math.ceil(raw.length / 3), Number(body.max_tokens ?? 4096));
  const entry = { at: new Date().toISOString(), model: body.model, tool: body.tool_choice?.name ?? null, reservedUsd: Number(worst.toFixed(6)) };
  if (spent + reserved + worst > budget) {
    log.push({ ...entry, status: 402, refused: "budget" });
    save();
    return reply(402, { type: "error", error: { type: "budget_exceeded", message: `Verification budget of US$${budget} reached; call refused before sending.` } });
  }
  reserved += worst;
  try {
    const headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": req.headers["anthropic-version"] ?? "2023-06-01" };
    if (req.headers["anthropic-beta"]) headers["anthropic-beta"] = req.headers["anthropic-beta"];
    const r = await fetch(`${upstream}${req.url}`, { method: "POST", headers, body: raw });
    const text = await r.text();
    let usage = {};
    try {
      usage = JSON.parse(text).usage ?? {};
    } catch {
      /* non-JSON error body */
    }
    const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const output = usage.output_tokens ?? 0;
    const actual = r.ok ? cost(input, output) : 0;
    spent += actual;
    log.push({ ...entry, status: r.status, inputTokens: input, outputTokens: output, costUsd: Number(actual.toFixed(6)) });
    save();
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
    res.end(text);
  } catch (error) {
    log.push({ ...entry, status: 0, error: error instanceof Error ? error.message : String(error) });
    save();
    reply(502, { type: "error", error: { type: "gateway_upstream", message: "The model service could not be reached." } });
  } finally {
    reserved -= worst;
  }
});

server.listen(55017, "127.0.0.1", () => {
  save();
  console.log(`model budget gateway on 127.0.0.1:55017, budget US$${budget}, log ${logPath}`);
});
const stop = () => {
  save();
  console.log(`gateway stopped; estimated spend US$${spent.toFixed(4)} over ${log.length} calls`);
  server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
