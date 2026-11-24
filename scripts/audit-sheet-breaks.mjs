#!/usr/bin/env node
// audit-sheet-breaks.mjs — lists features whose sheet text may break mid-paragraph.
//
// The sheet prints every line break in a feature's sheet text as a new,
// indented paragraph, and the content marks an accidental break the same way
// as a deliberate one. This runs the heuristic in
// packages/engine/src/testing/sheet-breaks.ts over the corpus and prints the
// flagged elements that packages/engine/src/sheet/text-joins.ts has not yet
// reviewed. Review each in the corpus and add its id to JOIN_SHEET_TEXT_IDS
// (one paragraph) or KEEP_SHEET_TEXT_IDS (breaks deliberate). Read-only.
//
// Run `npm run build` first: this imports the compiled engine, not the source.
//
//   node scripts/audit-sheet-breaks.mjs           # list unreviewed candidates
//   node scripts/audit-sheet-breaks.mjs --all     # list every candidate with its verdict
//   node scripts/audit-sheet-breaks.mjs --check   # non-zero exit when any are unreviewed

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "packages", "engine", "dist");
const CORPUS = join(ROOT, "third-party", "elements", "testdata");

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check");
const ALL = args.has("--all");

const modules = {
  corpus: join(DIST, "testing", "corpus.js"),
  breaks: join(DIST, "testing", "sheet-breaks.js"),
  joins: join(DIST, "sheet", "text-joins.js"),
};
const missing = Object.values(modules).filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`[audit:sheet-breaks] compiled engine missing (${missing.join(", ")}) — run \`npm run build\` first`);
  process.exit(2);
}
if (!existsSync(CORPUS)) {
  console.error(`[audit:sheet-breaks] corpus missing (${CORPUS}) — run \`npm run corpus:fetch\` first`);
  process.exit(2);
}

const { buildCorpusLibrary } = await import(pathToFileURL(modules.corpus).href);
const { findSheetBreakCandidates } = await import(pathToFileURL(modules.breaks).href);
const { JOIN_SHEET_TEXT_IDS, KEEP_SHEET_TEXT_IDS } = await import(pathToFileURL(modules.joins).href);

const library = await buildCorpusLibrary();
const candidates = findSheetBreakCandidates(library);
const verdict = (id) => (JOIN_SHEET_TEXT_IDS.has(id) ? "join" : KEEP_SHEET_TEXT_IDS.has(id) ? "keep" : "unreviewed");
const unreviewed = candidates.filter((candidate) => verdict(candidate.id) === "unreviewed");

for (const candidate of ALL ? candidates : unreviewed) {
  const tier = candidate.level === undefined ? "" : ` (level ${candidate.level} tier)`;
  console.log(`${verdict(candidate.id).padEnd(10)} ${candidate.id}  [${candidate.type}] ${candidate.name}${tier}`);
}
console.log(
  `[audit:sheet-breaks] ${candidates.length} candidate(s): ${unreviewed.length} unreviewed, ` +
    `${candidates.length - unreviewed.length} reviewed (${JOIN_SHEET_TEXT_IDS.size} joined, ${KEEP_SHEET_TEXT_IDS.size} kept in all)`,
);
if (CHECK && unreviewed.length > 0) process.exit(1);
