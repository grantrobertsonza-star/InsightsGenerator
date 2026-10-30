// Reproducible wide-import parity and timing control. Writes only synthetic test artifacts in work/ua.
// Run with PYTHON_EXECUTABLE set where python3 is unavailable: node --expose-gc scripts/benchmark-import-routing.cjs.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const ts = require("typescript");
const base = process.argv[2] ?? "acd572122dd03f0133f76acbafb6f985f8083648";
if (!/^[0-9a-f]{7,40}$/i.test(base)) throw new Error("Pass a commit hash for the unchanged baseline.");
const out = path.resolve("work/ua"); fs.mkdirSync(out, { recursive: true });
const inputFile = path.join(out, "routing-benchmark-input.json");
const python = process.env.PYTHON_EXECUTABLE ?? "python3";
const read = `import importlib.util,json,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('e','api/parse-stats-file.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)\np=Path('fixtures/ua-soft-drinks/UA_Soft_Drinks_Wave_1_5000.csv');r=e.read_table(p.read_bytes(),p.name)\nPath(sys.argv[1]).write_text(json.dumps({'headers':r['headers'],'rows':r['rows']},ensure_ascii=True),encoding='utf-8')`;
execFileSync(python, ["-c", read, inputFile], { windowsHide: true, stdio: "pipe", timeout: 300_000 });
require.extensions[".ts"] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const original = execFileSync("git", ["show", `${base}:src/lib/dataQuality.ts`], { encoding: "utf8" });
const compiled = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText.replace('require("./routingParse")', `require(${JSON.stringify(path.resolve("src/lib/routingParse.ts"))})`);
const baseline = new Module(path.join(out, "routing-baseline.cjs"), module);
baseline.paths = module.paths; baseline.filename = path.join(out, "routing-baseline.cjs"); baseline._compile(compiled, baseline.filename);
const current = require(path.resolve("src/lib/dataQuality.ts"));
const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const results = {}, timings = {};
for (const [name, owner] of [["before", baseline.exports], ["after", current]]) {
  global.gc?.();
  const start = performance.now();
  results[name] = owner.computeTableQuality(input.headers, input.rows, "raw");
  timings[name] = (performance.now() - start) / 1000;
}
assert.deepEqual(results.after, results.before);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const receipt = { baseline: base, cases: input.rows.length, variables: input.headers.length, seconds: timings, exactlyEquivalent: true, resultSha256: { before: hash(results.before), after: hash(results.after) }, scope: "One process, same actual-reader input and complete quality output; excludes database, browser and import I/O." };
fs.writeFileSync(path.join(out, "routing-performance.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
