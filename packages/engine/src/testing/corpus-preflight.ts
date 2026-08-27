/**
 * Vitest global setup for the corpus-backed suites.
 *
 * The corpus under `third-party/elements/testdata/` is third-party data and
 * is not committed. When it is absent the corpus-backed test files are left
 * out of the run (see vitest.config.ts); this hook turns that into a hard
 * failure when the run is expected to cover them (FCB_REQUIRE_CORPUS=1).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const CORPUS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "third-party", "elements", "testdata",
);

export function corpusPresent(): boolean {
  return existsSync(CORPUS_DIR);
}

export default function setup(): void {
  if (corpusPresent()) return;
  if (process.env.FCB_REQUIRE_CORPUS === "1") {
    throw new Error(
      "content corpus is missing — run `npm run corpus:fetch` before the corpus-backed tests " +
        `(expected ${CORPUS_DIR})`,
    );
  }
  console.warn(
    `[corpus] ${CORPUS_DIR} is absent: the corpus-backed test files are skipped. ` +
      "Run `npm run corpus:fetch` once to include them.",
  );
}
