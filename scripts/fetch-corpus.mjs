#!/usr/bin/env node
// fetch-corpus.mjs — fetch + verify the public content corpus (provenance gate).
//
// The corpus (AuroraLegacy/elements @ pinned commit) is NOT committed to git:
// it is third-party data, fetched on demand and verified byte-for-byte against
// the pinned sha256 manifest (third-party/elements/testdata.manifest.sha256).
// Only files that verify are staged into third-party/elements/testdata/.
//
// Usage:
//   node scripts/fetch-corpus.mjs            fetch if missing (fails if present)
//   node scripts/fetch-corpus.mjs --force    re-fetch and replace
//   CORPUS_URL=<tarball-url|dir> node scripts/fetch-corpus.mjs
//                                            use a mirror tarball URL or a local
//                                            directory containing the repo files

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm, cp, stat, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ELEMENTS = join(ROOT, "third-party", "elements");
const TARGET = join(ELEMENTS, "testdata");
const MANIFEST = join(ELEMENTS, "testdata.manifest.sha256");
const PROVENANCE = join(ELEMENTS, "testdata.provenance.json");

const pinned = JSON.parse(await readFile(PROVENANCE, "utf8"));
const COMMIT = pinned.commit;
if (!/^[0-9a-f]{40}$/.test(COMMIT)) {
  throw new Error(`invalid pinned commit in ${PROVENANCE}`);
}
const DEFAULT_URL = `https://github.com/${pinned.repository.replace("https://github.com/", "")}/archive/${COMMIT}.tar.gz`;

async function targetPresent() {
  try {
    const entries = await readdir(TARGET);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function sha256File(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function parseManifest(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (match) entries.push({ hash: match[1], path: match[2] });
  }
  return entries;
}

async function stageFrom(sourceRoot, manifest) {
  const staged = [];
  const failed = [];
  for (const entry of manifest) {
    const source = join(sourceRoot, entry.path);
    const target = join(TARGET, entry.path);
    let actual;
    try {
      actual = await sha256File(source);
    } catch {
      failed.push(`${entry.path} (missing)`);
      continue;
    }
    if (actual !== entry.hash) {
      failed.push(`${entry.path} (hash mismatch: ${actual})`);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
    staged.push(entry.path);
  }
  return { staged, failed };
}

async function fetchTarball(url) {
  const tmp = join(tmpdir(), `fcb-corpus-${COMMIT}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const archive = join(tmp, "corpus.tar.gz");
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", archive, url], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "inherit" });
  const entries = await readdir(tmp, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory());
  if (!extracted) throw new Error("tarball contained no root directory");
  return join(tmp, extracted.name);
}

async function main() {
  const force = process.argv.includes("--force");
  if (await targetPresent()) {
    if (!force) {
      console.error(
        `[corpus] ${TARGET} already exists. Pass --force to re-fetch (this deletes the existing corpus).`,
      );
      process.exit(1);
    }
    await rm(TARGET, { recursive: true, force: true });
  }
  await mkdir(TARGET, { recursive: true });

  const manifest = parseManifest(await readFile(MANIFEST, "utf8"));
  const url = process.env.CORPUS_URL ?? DEFAULT_URL;
  console.log(`[corpus] fetching ${pinned.repository} @ ${COMMIT}`);
  let sourceRoot;
  try {
    await stat(url);
    sourceRoot = url; // local directory mirror
  } catch {
    console.log(`[corpus] downloading ${url}`);
    sourceRoot = await fetchTarball(url);
  }

  const { staged, failed } = await stageFrom(sourceRoot, manifest);
  for (const problem of failed) console.error(`[corpus] REJECTED ${problem}`);

  const provenanceRecord = { ...pinned, fetchedAt: new Date().toISOString() };
  await writeFile(join(TARGET, "AuroraLegacy.provenance.json"), JSON.stringify(provenanceRecord, null, 2));

  if (failed.length === 0 && staged.length === manifest.length) {
    console.log(
      `[corpus] GATE PASS — ${staged.length}/${manifest.length} files verified against the pinned manifest (${TARGET})`,
    );
    process.exit(0);
  }
  console.error(`[corpus] GATE FAIL — verified ${staged.length}/${manifest.length} files`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`[corpus] ERROR: ${error.message}`);
  process.exit(2);
});
