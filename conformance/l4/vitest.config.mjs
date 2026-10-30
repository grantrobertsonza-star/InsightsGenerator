// L4 conformance runner config. Collects only conformance/l4 tests, one fork at a time.
// The project's PostCSS config is bypassed (no CSS is loaded by these tests) and the Vite cache is
// kept inside conformance/l4 so nothing outside this folder is written.
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export default {
  root: ROOT,
  css: { postcss: { plugins: [] } },
  resolve: { alias: [{ find: /^@\/(.*)$/, replacement: path.join(ROOT, "src/$1") }] },
  cacheDir: path.join(import.meta.dirname, ".cache"),
  test: {
    cache: false,
    include: ["conformance/l4/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { maxForks: 1, minForks: 1 } },
    testTimeout: 180000,
    hookTimeout: 300000,
  },
};
