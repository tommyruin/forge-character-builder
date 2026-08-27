#!/usr/bin/env node
/**
 * Compression + startup-size gate over the built client (apps/client/dist).
 *
 * Fails when:
 * - a large compressible asset (js/css/xml/json/svg) lacks a .br sibling;
 * - a sampled .br sibling does not decompress byte-identical to its source;
 * - the entry chunk or the engine worker chunk exceeds its gzip budget.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliDecompressSync, gzipSync } from "node:zlib";

const DIST = resolve(process.cwd(), "apps/client/dist");
const SIBLING_MIN_BYTES = 10 * 1024;
const ENTRY_GZIP_BUDGET = 100 * 1024;
const ENGINE_WORKER_GZIP_BUDGET = 320 * 1024;
const COMPRESSIBLE = /\.(?:js|mjs|css|xml|json|svg)$/i;

const failures = [];
const pass = (message) => console.log(`[verify:compression] PASS ${message}`);
const fail = (message) => {
  failures.push(message);
  console.error(`[verify:compression] FAIL ${message}`);
};

if (!existsSync(DIST)) {
  console.error(`[verify:compression] FAIL dist not found at ${DIST} — run npm run client:build first`);
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const files = walk(DIST);
let missing = 0;
let verified = 0;
for (const file of files) {
  if (file.endsWith(".br") || file.endsWith(".gz")) continue;
  if (!COMPRESSIBLE.test(file)) continue;
  if (statSync(file).size < SIBLING_MIN_BYTES) continue;
  const sibling = `${file}.br`;
  if (!existsSync(sibling)) {
    missing += 1;
    fail(`missing .br sibling for ${file.slice(DIST.length + 1)}`);
    continue;
  }
  const decompressed = brotliDecompressSync(readFileSync(sibling));
  if (!decompressed.equals(readFileSync(file))) {
    fail(`corrupt .br sibling for ${file.slice(DIST.length + 1)}`);
  } else {
    verified += 1;
  }
}
if (missing === 0) pass(`${verified} large compressible assets carry verified .br siblings`);

const budget = (pattern, limit, label) => {
  const candidates = files.filter((file) => pattern.test(file) && !file.endsWith(".br") && !file.endsWith(".gz"));
  if (candidates.length === 0) {
    fail(`no ${label} chunk found`);
    return;
  }
  for (const file of candidates) {
    const gzipped = gzipSync(readFileSync(file), { level: 9 }).byteLength;
    if (gzipped > limit) {
      fail(`${label} ${file.slice(DIST.length + 1)} is ${gzipped} B gzip (budget ${limit} B)`);
    } else {
      pass(`${label} ${file.slice(DIST.length + 1)} is ${gzipped} B gzip (budget ${limit} B)`);
    }
  }
};

budget(/assets\/index-[^/]+\.js$/, ENTRY_GZIP_BUDGET, "entry chunk");
budget(/assets\/engineWorker-[^/]+\.js$/, ENGINE_WORKER_GZIP_BUDGET, "engine worker chunk");

if (failures.length > 0) {
  console.error(`[verify:compression] ${failures.length} failure(s)`);
  process.exit(1);
}
console.log("[verify:compression] PASS all gates");
