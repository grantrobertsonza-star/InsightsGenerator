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
// Screen paths are also read, because a path alone cannot say whether a file only shows things
// (Codex B32-M01: src/app/runs/[id]/page.tsx is a server page whose inline server actions extract
// findings and write processing status, and was rated B). A file under src/app or src/components is A
// when it defines server actions ("use server"), when it is under src/app and is not a client
// component (a server page or layout can read and write data directly), or when it imports the
// database or storage clients. When its content cannot be read (a deleted file not found at the
// base, or no content given), it is A.
//
//   node scripts/change-tier.cjs <file>...              prints the tier and what it requires
//   node scripts/change-tier.cjs --base origin/main      classifies the files changed since <base>
// In CI it writes the result to the job summary ($GITHUB_STEP_SUMMARY) when that is set.

const { execFileSync } = require("node:child_process");
const { appendFileSync, existsSync, readFileSync } = require("node:fs");

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

/** A leading "use client" directive (after comments and blank lines) makes the file a client component. */
function isClientComponent(content) {
  const body = content.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(body);
}
const DATA_IMPORT = /from\s+["'](@\/lib\/(db|supabaseAdmin|supabaseServer)|pg)["']/;

/** Whether a screen file's content shows it can change stored data or research meaning. */
function screenFileWrites(f, content) {
  if (typeof content !== "string") return true;
  if (/["']use server["']/.test(content)) return true;
  if (/^src\/app\//.test(f) && !isClientComponent(content)) return true;
  return DATA_IMPORT.test(content);
}

/**
 * The tier of one file. `content` is the file's text, needed for screen paths (src/app, src/components);
 * without it such a file is A, because a path cannot tell a display-only screen from a server page.
 */
function tierOf(file, content) {
  const f = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (B_LIB.some((r) => r.test(f))) return "B";
  if (A.some((r) => r.test(f))) return "A";
  if (B.some((r) => r.test(f))) return screenFileWrites(f, content) ? "A" : "B";
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

const ORDER = { C: 0, B: 1, A: 2 };
const highest = (tiers) => tiers.reduce((t, x) => (ORDER[x] > ORDER[t] ? x : t), "C");

/**
 * `contentOf(file)` returns the file's text, null when it cannot be read, or a list of its versions
 * (as changed and as it was before). M-B35-01 (Codex): a file is classified by every version and takes
 * the highest tier, so removing server or data behaviour (a server page turned client-only, a database
 * write taken out of a component) is reviewed as seriously as adding it. An empty list is unreadable.
 */
function classify(files, contentOf = () => null) {
  const tierOfVersions = (f) => {
    const c = contentOf(f);
    const versions = Array.isArray(c) ? c : [c];
    return versions.length === 0 ? tierOf(f, null) : highest(versions.map((v) => tierOf(f, v)));
  };
  const per = files.filter(Boolean).map((f) => ({ file: f, tier: tierOfVersions(f) }));
  const tier = highest(per.map((x) => x.tier));
  return { tier, files: per, requires: REQUIRES[tier] };
}

function main(argv) {
  let files = argv;
  const b = argv.indexOf("--base");
  const base = b >= 0 ? argv[b + 1] : null;
  if (base) {
    // --no-renames lists a rename as its old and its new path, so both are classified.
    files = execFileSync("git", ["diff", "--name-only", "--no-renames", "--diff-filter=ACMRD", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  }
  // The "before" side is the merge base, the same point `base...HEAD` lists the changes from.
  const mergeBase = base ? execFileSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" }).trim() : null;
  const fromGit = (ref, f) => {
    try {
      // cat-file, not show: `git show REF:path` for a path deleted at REF can print nothing and exit 0,
      // which read a deleted file as empty instead of absent (found with M-B35-01's repro).
      return execFileSync("git", ["cat-file", "blob", `${ref}:${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null;
    }
  };
  // Both sides of the change: with a base, the file at HEAD (what the pull request merges) and at the
  // base; without one, the working copy and the file at HEAD. A side where the file does not exist
  // (added, or deleted) is left out; neither side readable is unreadable, so A.
  const contentOf = (f) => {
    const after = base ? fromGit("HEAD", f) : existsSync(f) ? readFileSync(f, "utf8") : null;
    const before = fromGit(base ? mergeBase : "HEAD", f);
    return [after, before].filter((v) => v !== null);
  };
  const result = classify(files, contentOf);
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
