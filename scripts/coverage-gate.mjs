#!/usr/bin/env node
// coverage-gate.mjs — corpus coverage gate.
//
// For every character under fixtures/coverage/characters/, verify that every
// referenced element id is resolvable in the vendored corpus. Engine-GENERATED ids (internal system
// elements and item/spell/feat proxies) are expected and excluded. Ids that are
// neither in the corpus nor generated must be allowlisted in
// fixtures/coverage/allowlist.json (documented exclusions — e.g. unrecoverable
// external homebrew). The gate FAILS when a new unresolvable id appears.
//
// These characters exist ONLY for this gate: real builds reference a far wider
// slice of the corpus than a synthetic one, which is the point of the gate.
// The unit tests do not read them — they build characters through the engine
// API instead. See CONTRIBUTING.md.
//
// Usage: node scripts/coverage-gate.mjs [--init] [--json]
//   --init  write the current unresolvable ids as the baseline allowlist
//   --json  machine-readable report on stdout

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "fixtures", "coverage", "characters");
const CORPUS = join(ROOT, "third-party", "elements");
const ALLOWLIST_PATH = join(ROOT, "fixtures", "coverage", "allowlist.json");

// Ids the engine GENERATES at runtime (never found in any content file):
//  - ID_INTERNAL_* system elements
//  - ID_*_INTERNAL_ITEM_* proxies (auto-created items for spells/feats/proficiencies)
const GENERATED_ID_RE = /^(ID_INTERNAL_|ID_[A-Z0-9_]+_INTERNAL_ITEM_)/i;

async function collectIds(dir, pattern) {
  const ids = new Set();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectIds(full, pattern);
      for (const id of nested) ids.add(id);
    } else if (pattern.test(entry.name)) {
      const text = await readFile(full, "utf8");
      for (const match of text.matchAll(/\bid="([^"]+)"/g)) ids.add(match[1]);
    }
  }
  return ids;
}

async function main() {
  const init = process.argv.includes("--init");
  const json = process.argv.includes("--json");

  const corpusRoot = join(CORPUS, "testdata");
  const corpusPresent = await readdir(corpusRoot).catch(() => []);
  if (corpusPresent.length === 0) {
    console.error(
      "[coverage:gate] corpus missing — run `npm run corpus:fetch` first (fetches + verifies the pinned public corpus).",
    );
    process.exit(2);
  }

  const corpusIds = new Set();
  // The corpus plus the engine's own system elements, which ship with the client.
  for (const root of [corpusRoot, join(ROOT, "apps", "client", "public", "content", "system")]) {
    for (const id of await collectIds(root, /\.xml$/i)) corpusIds.add(id);
  }

  const files = (await readdir(FIXTURES)).filter((name) => name.endsWith(".dnd5e"));
  const perFile = [];
  const missingAll = new Set();

  for (const file of files) {
    const text = await readFile(join(FIXTURES, file), "utf8");
    const referenced = new Set();
    for (const match of text.matchAll(/\bid="([^"]+)"/g)) referenced.add(match[1]);
    const missing = [...referenced].filter((id) => !corpusIds.has(id));
    for (const id of missing) missingAll.add(id);
    perFile.push({
      file,
      referenced: referenced.size,
      missing: missing.length,
      covered: referenced.size - missing.length,
      missingIds: missing.sort(),
    });
  }

  const generated = [...missingAll].filter((id) => GENERATED_ID_RE.test(id));
  const unresolved = [...missingAll].filter((id) => !GENERATED_ID_RE.test(id)).sort();

  let allowlist = [];
  try {
    allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, "utf8"));
  } catch {
    // no baseline yet
  }

  if (init) {
    await mkdir(dirname(ALLOWLIST_PATH), { recursive: true });
    await writeFile(ALLOWLIST_PATH, JSON.stringify(unresolved, null, 2) + "\n");
    allowlist = unresolved;
  }

  const newMissing = unresolved.filter((id) => !allowlist.includes(id));

  const report = {
    corpusElementIds: corpusIds.size,
    fixtureFiles: files.length,
    perFile,
    generatedCount: generated.length,
    unresolvedCount: unresolved.length,
    allowlistedCount: allowlist.length,
    newMissing,
    passed: newMissing.length === 0,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n[coverage:gate] corpus ids: ${corpusIds.size} | fixtures: ${files.length}`);
    for (const entry of perFile) {
      const pct = entry.referenced ? Math.round((entry.covered / entry.referenced) * 100) : 100;
      console.log(
        `  ${entry.file.padEnd(30)} ${String(entry.covered).padStart(3)}/${entry.referenced} (${pct}%)  missing=${entry.missing}`,
      );
    }
    console.log(`  generated (engine, expected): ${generated.length}`);
    console.log(`  unresolved: ${unresolved.length} (allowlisted: ${allowlist.length})`);
    if (newMissing.length) {
      console.log(`  NEW UNRESOLVED IDS (gate FAIL):\n    ${newMissing.join("\n    ")}`);
    }
    console.log(`[coverage:gate] ${report.passed ? "GATE PASS" : "GATE FAIL"}`);
  }

  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
