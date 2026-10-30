// Builds src/lib/helpIndex.generated.json: the text of every Knowledge base article and Manual page,
// split into sections, for the Research assistant's search_help and read_help tools (Grant,
// 2026-10-22: the assistant "must have access to our knowledge base on how the system works").
//
// The pages are React components, so the text is taken from what they render: each page is bundled
// with esbuild (installed with vitest), rendered with react-dom/server, and read back with linkedom.
// Rendering, rather than reading the source, means the index says exactly what a reader sees.
//
//   node scripts/build-help-index.mjs          write the index
//   node scripts/build-help-index.mjs --check  exit 1 if the committed index is out of date
//
// The --check form runs in the retained tests (helpIndex.test.ts), so an article edited without
// rebuilding the index fails validation rather than leaving the assistant reading old text.
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const out = path.join(root, "src/lib/helpIndex.generated.json");
const cacheDir = path.join(root, "node_modules/.cache/help-index");

const manualDir = path.join(root, "src/app/manual");
const manualPages = [
  ["", "page.tsx"],
  ...readdirSync(manualDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(manualDir, d.name, "page.tsx")))
    .map((d) => [d.name, `${d.name}/page.tsx`]),
];

// One entry module importing every page; bundled so the "@/..." alias, TSX and the pages' own
// imports resolve the way Next resolves them.
const entry = [
  'import { createElement } from "react";',
  'import { renderToStaticMarkup } from "react-dom/server";',
  'import { articles } from "@/app/knowledge/articles";',
  'import { articleComponents } from "@/app/knowledge/registry";',
  'import { manualSections } from "@/app/manual/sections";',
  ...manualPages.map(([, file], i) => `import Manual${i} from "@/app/manual/${file}";`),
  `const manual = { ${manualPages.map(([slug], i) => `${JSON.stringify(slug)}: Manual${i}`).join(", ")} };`,
  "export function render() {",
  "  return {",
  "    knowledge: articles.map((a) => ({ slug: a.slug, title: a.title, blurb: a.blurb, html: articleComponents[a.slug] ? renderToStaticMarkup(createElement(articleComponents[a.slug])) : null })),",
  "    manual: manualSections.map((s) => ({ slug: s.slug, title: s.title, blurb: s.blurb, html: manual[s.slug] ? renderToStaticMarkup(createElement(manual[s.slug])) : null })),",
  "  };",
  "}",
].join("\n");

// next/link outside Next: a plain anchor is all the text needs.
const nextLinkStub = {
  name: "next-link-stub",
  setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: 'import { createElement } from "react"; export default function Link({ href, children, prefetch, ...rest }) { void prefetch; return createElement("a", { href: String(href), ...rest }, children); }',
      loader: "js",
      resolveDir: root,
    }));
  },
};

mkdirSync(cacheDir, { recursive: true });
const entryFile = path.join(cacheDir, "entry.tsx");
const bundleFile = path.join(cacheDir, `bundle-${process.pid}.mjs`);
writeFileSync(entryFile, entry);
let rendered;
try {
  await build({
    entryPoints: [entryFile],
    outfile: bundleFile,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    packages: "external",
    plugins: [nextLinkStub],
    logLevel: "error",
  });
  rendered = (await import(pathToFileURL(bundleFile).href)).render();
} finally {
  rmSync(bundleFile, { force: true });
}

const BLOCKS = new Set(["P", "LI", "H1", "H3", "H4", "DIV", "TR", "CAPTION", "BLOCKQUOTE", "UL", "OL", "TABLE", "SECTION", "ARTICLE"]);

const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A page's rendered HTML as sections of plain text, split at each second-level heading. */
function sections(html) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const body = document.body;
  // Navigation, not content: the contents list and the previous/next links.
  for (const el of [...body.querySelectorAll("nav")]) el.remove();
  for (const el of [...body.querySelectorAll("div")]) {
    const cls = el.getAttribute("class") ?? "";
    if (cls.includes("mt-12") && cls.includes("border-t") && cls.includes("justify-between")) el.remove();
  }
  for (const el of [...body.querySelectorAll("td, th")]) {
    if (el.nextElementSibling) el.after(document.createTextNode(" | "));
  }
  for (const el of [...body.querySelectorAll("li")]) el.prepend(document.createTextNode("- "));
  for (const el of [...body.querySelectorAll("*")]) {
    if (BLOCKS.has(el.tagName)) el.after(document.createTextNode("\n"));
  }
  for (const el of [...body.querySelectorAll("h2")]) {
    const heading = el.textContent.trim();
    el.replaceWith(document.createTextNode(`\n\u0000${el.getAttribute("id") ?? ""}\u0001${heading}\n`));
  }
  const text = body.textContent;
  const parts = text.split("\u0000");
  const clean = (t) =>
    t
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  const result = [];
  const intro = clean(parts[0]);
  if (intro) result.push({ id: "", heading: "Introduction", text: intro });
  for (const part of parts.slice(1)) {
    const [head, ...rest] = part.split("\n");
    const [id, heading] = head.split("\u0001");
    result.push({ id: id || slugify(heading), anchored: Boolean(id), heading, text: clean(rest.join("\n")) });
  }
  return result;
}

const pages = [];
for (const kind of ["knowledge", "manual"]) {
  for (const p of rendered[kind]) {
    if (!p.html) throw new Error(`${kind} page "${p.slug}" has no component to render.`);
    const href = kind === "knowledge" ? `/knowledge${p.slug ? `/${p.slug}` : ""}` : `/manual${p.slug ? `/${p.slug}` : ""}`;
    pages.push({
      ref: `${kind}/${p.slug || "start"}`,
      kind,
      title: p.title,
      blurb: p.blurb,
      href,
      sections: sections(p.html).map((s) => ({
        id: s.id,
        heading: s.heading,
        // Knowledge base headings carry ids, so a link can open the section; the Manual's do not.
        href: s.anchored ? `${href}#${s.id}` : href,
        text: s.text,
      })),
    });
  }
}

const json = `${JSON.stringify({ pages }, null, 1)}\n`;
if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current.replace(/\r\n/g, "\n") !== json) {
    console.error("src/lib/helpIndex.generated.json is out of date: run node scripts/build-help-index.mjs");
    process.exit(1);
  }
  console.log(`Help index is current (${pages.length} pages).`);
} else {
  writeFileSync(out, json);
  console.log(`Wrote ${path.relative(root, out)}: ${pages.length} pages, ${pages.reduce((n, p) => n + p.sections.length, 0)} sections, ${json.length} bytes.`);
}
