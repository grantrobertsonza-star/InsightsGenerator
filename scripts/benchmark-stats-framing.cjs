// Paired framing control using the original listener loop and the actual current reader.
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript"), assert = require("node:assert/strict"), Module = require("node:module");
const size = Number(process.argv[2] ?? 16);
if (!Number.isInteger(size) || size < 1 || size > 64) throw new Error("Choose a payload from 1 to 64 MB.");
const file = path.resolve("src/lib/jsonLineReader.ts");
const owner = new Module(file, module); owner.filename = file; owner.paths = module.paths;
owner._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const expected = { id: 1, result: "source".repeat(Math.ceil(size * 1024 * 1024 / 6)) };
const bytes = Buffer.from(JSON.stringify(expected) + "\n"), chunks = [];
for (let i = 0; i < bytes.length; i += 8192) chunks.push(bytes.subarray(i, i + 8192));
let buffer = "", original = null, beforeMessages = 0;
const start = performance.now();
for (const chunk of chunks) {
  buffer += chunk.toString("utf8"); let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
    if (line) { original = JSON.parse(line); beforeMessages++; }
  }
}
const beforeSeconds = (performance.now() - start) / 1000;
let current = null, afterMessages = 0;
const reader = owner.exports.createJsonLineReader(line => { current = JSON.parse(line); afterMessages++; });
const afterStart = performance.now(); for (const chunk of chunks) reader(chunk);
const afterSeconds = (performance.now() - afterStart) / 1000;
assert.deepEqual(current, expected); assert.deepEqual(original, expected); assert.equal(beforeMessages, 1); assert.equal(afterMessages, 1);
const receipt = { bytes: bytes.length, chunkBytes: 8192, beforeSeconds, afterSeconds, messages: { before: beforeMessages, after: afterMessages }, exactlyEquivalent: true, scope: "Framing and JSON parsing only, same 16 MB synthetic reply; excludes computation, storage and browser time." };
fs.mkdirSync("work/ua", { recursive: true }); fs.writeFileSync("work/ua/framing-performance.json", JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt, null, 2));
