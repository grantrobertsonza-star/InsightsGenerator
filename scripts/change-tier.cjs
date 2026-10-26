// Which tier a change is in, from the files it touches (AGENTS.md, "Change tiers"). The tier decides
// how much process the change needs, so routine work moves fast and research-meaning work gets the
// full treatment:
//   A  research meaning or stored data: the statistics engine, readers, calculations, persistence,
//      migrations, AI prompts and grounding, findings/insights/recommendations, freshness, exports,
//      tenancy. Rule owner named, regression test shown failing without the fix, every gate, and
//      independent review before merge.
//   B  behaviour of screens: client components, server actions that only shape what a screen shows,
//      navigation. A mounted or browser test, every gate, independent review batched.
//   C  presentation and documentation: styles, copy, docs, tests and tooling only. Every gate and a
//      screenshot for visible changes; no independent review needed.
// The highest tier of any touched file is the change's tier. Unknown paths count as A, so a new area
// is reviewed until someone places it here deliberately.
//
//   node scripts/change-tier.cjs <file>...              prints the tier and what it requires
//   node scripts/change-tier.cjs --base origin/main      classifies the files changed since <base>
// In CI it writes the result to the job summary ($GITHUB_STEP_SUMMARY) when that is set.

const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");

const A = [
  /^api\//,
  /^scripts\/parse_stats_(worker|local)\.py$/,
  /^supabase\/migrations\//,
  /^src\/lib\/(?!__tests__\/).*\.(ts|tsx)$/,
  /^src\/app\/api\//,
  /^requirements\.txt$/,
  /^vercel\.json$/,
];
// Library files that only shape what a screen shows (no calculation, persistence or model call).
const B_LIB = [/^src\/lib\/(stageLinks|displayDate|rowCells|sectionStatus|stageStatus)\.ts$/];
const B = [/^src\/app\/(?!api\/).*\.(ts|tsx)$/, /^src\/components\//];
const C = [
  /^docs\//,
  /^claude\//,
  /\.md$/,
  /^src\/lib\/__tests__\//,
  /^e2e\//,
  /^fixtures\//,
  /^scripts\/(?!parse_stats_).*/,
  /^\.github\//,
  /\.css$/,
  /^public\//,
  /^(eslint|postcss|playwright|next)\.config\.(mjs|ts|js)$/,
  /^tsconfig\.json$/,
  /^package(-lock)?\.json$/,
];

function tierOf(file) {
  const f = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (B_LIB.some((r) => r.test(f))) return "B";
  if (A.some((r) => r.test(f))) return "A";
  if (B.some((r) => r.test(f))) return "B";
  if (C.some((r) => r.test(f))) return "C";
  return "A";
}

const REQUIRES = {
  A: [
    "Impact checklist answered (AGENTS.md)",
    "Rule owner named from claude/rules-registry.md; no second implementation of a rule",
    "Regression test shown failing without the fix and passing with it",
    "Every gate: typecheck, lint, full library, engine self-test, browser suite, smoke",
    "Independent review (Codex) before merge",
  ],
  B: [
    "Impact checklist answered (AGENTS.md)",
    "Mounted-component or browser test for the behaviour",
    "Every gate; screenshot of the changed screen",
    "Independent review, batched with other B changes",
  ],
  C: ["Every gate; screenshot for any visible change", "No independent review needed"],
};

function classify(files) {
  const order = { C: 0, B: 1, A: 2 };
  const per = files.filter(Boolean).map((f) => ({ file: f, tier: tierOf(f) }));
  const tier = per.reduce((t, x) => (order[x.tier] > order[t] ? x.tier : t), "C");
  return { tier, files: per, requires: REQUIRES[tier] };
}

function main(argv) {
  let files = argv;
  const b = argv.indexOf("--base");
  if (b >= 0) {
    const base = argv[b + 1];
    files = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMRD", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  }
  const result = classify(files);
  const lines = [
    `Change tier: ${result.tier} (${files.length} file${files.length === 1 ? "" : "s"})`,
    ...result.requires.map((r) => `- ${r}`),
    ...(result.tier === "C" ? [] : ["", "Files above tier C:", ...result.files.filter((x) => x.tier !== "C").map((x) => `  ${x.tier}  ${x.file}`)]),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${lines[0]}\n\n${lines.slice(1).join("\n")}\n`);
}

module.exports = { tierOf, classify };
if (require.main === module) main(process.argv.slice(2));
