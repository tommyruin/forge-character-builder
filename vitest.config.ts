import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const src = (pkg: string) => join(root, "packages", pkg, "src", "index.ts");

/**
 * The content corpus is third-party data that is fetched, not committed. Test
 * files that build a library from it are left out of a run when it is absent
 * (unless FCB_REQUIRE_CORPUS=1 demands them), so a fresh clone runs the rest
 * of the suite. A corpus-backed file is recognised by what it imports.
 */
const CORPUS_DIR = join(root, "third-party", "elements", "testdata");
const CORPUS_MARKERS = /sharedLibrary\(|buildLibrary\(|buildCorpusLibrary\(|buildReviewedLibrary\(|testing\/corpus\.js|libraryPromise|third-party\/elements\/testdata|["']testdata["']|corpus-coverage|fixtures\/coverage/;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") testFiles(full, out);
    } else if (entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function corpusBackedTests(): string[] {
  return testFiles(join(root, "packages"))
    .filter((file) => CORPUS_MARKERS.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
}

const corpusAbsent = !existsSync(CORPUS_DIR) && process.env.FCB_REQUIRE_CORPUS !== "1";

export default defineConfig({
  resolve: {
    alias: {
      "@forge-cb/api": src("api"),
      "@forge-cb/engine": src("engine"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...(corpusAbsent ? corpusBackedTests() : [])],
    environment: "node",
    globalSetup: ["packages/engine/src/testing/corpus-preflight.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/*.test-support.ts", "**/src/testing/**"],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 92,
        lines: 70,
      },
    },
  },
});
