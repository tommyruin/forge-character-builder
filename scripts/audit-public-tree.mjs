#!/usr/bin/env node
/**
 * Audits the tracked tree before it is published: denylisted terms outside
 * the allowlisted interoperability tokens, file names that should never ship,
 * secret-looking strings, and (with --require-single-commit) a history of
 * exactly one commit pointing only at the public remote.
 *
 *   node scripts/audit-public-tree.mjs [--strict] [--require-single-commit]
 *
 * `scripts/audit/denied-blobs.sha256`, when present, lists SHA-256 digests of
 * files that must never reappear; every tracked file is hashed against it.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");

const denylist = JSON.parse(readFileSync(join(ROOT, "scripts", "audit", "denylist-terms.json"), "utf8"));
const allowlist = JSON.parse(readFileSync(join(ROOT, "scripts", "audit", "allowlist.json"), "utf8"));
const termPatterns = denylist.patterns.map((pattern) => new RegExp(pattern, "gi"));
const namePatterns = denylist.fileNamePatterns.map((pattern) => new RegExp(pattern, "i"));
const allow = allowlist.entries.map((entry) => ({ ...entry, regex: new RegExp(entry.pattern, "i") }));
const deniedBlobsPath = join(ROOT, "scripts", "audit", "denied-blobs.sha256");
const deniedBlobs = new Set(
  existsSync(deniedBlobsPath)
    ? readFileSync(deniedBlobsPath, "utf8").split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter((line) => /^[0-9a-f]{64}$/.test(line))
    : [],
);

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/,
  /GOCSPX-[0-9A-Za-z_-]{20,}/,
  /\bgh[pousr]_[0-9A-Za-z]{30,}/,
  /github_pat_[0-9A-Za-z_]{40,}/,
  /\bsk-[0-9A-Za-z]{32,}/,
  /AZURE_STATIC_WEB_APPS_API_TOKEN/,
  /[0-9]{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/,
];
const TEXT_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|json|md|yml|yaml|css|html|xml|txt|svg|sh|dnd5e|index|sha256|gitignore|gitattributes|editorconfig|nvmrc)$/i;
const DATA_EXTENSIONS = /\.(?:xml|dnd5e|index|sha256)$/i;

function tracked() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}

function allowed(path, snippet) {
  return allow.some((entry) => entry.path === path && entry.regex.test(snippet));
}

const findings = [];
for (const path of tracked()) {
  if (namePatterns.some((pattern) => pattern.test(path))) findings.push(`${path}: file name is denylisted`);
  const full = join(ROOT, path);
  if (!existsSync(full)) continue;
  const bytes = readFileSync(full);
  if (deniedBlobs.size > 0) {
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (deniedBlobs.has(digest)) findings.push(`${path}: content matches a denied blob`);
  }
  if (!TEXT_EXTENSIONS.test(path) && !/^[^.]+$/.test(path.split("/").pop() ?? "")) continue;
  const text = bytes.toString("utf8");
  // Content data carries element ids and source names from the corpus; only
  // the secret scan applies to it.
  if (!DATA_EXTENSIONS.test(path)) {
    for (const pattern of termPatterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        const snippet = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40).replace(/\s+/g, " ");
        if (allowed(path, snippet)) continue;
        findings.push(`${path}:${line}: "${match[0]}" — ${JSON.stringify(snippet)}`);
      }
    }
  }
  if (path === "scripts/audit-public-tree.mjs") continue;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) findings.push(`${path}: matches secret pattern ${pattern}`);
  }
}

if (args.has("--require-single-commit")) {
  const count = Number(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim());
  if (count !== 1) findings.push(`history has ${count} commits; the public repository must start from one`);
  const remotes = execFileSync("git", ["remote", "-v"], { cwd: ROOT, encoding: "utf8" });
  if (/(?!forge-character-builder)dmforge|ttrpgimagegen/i.test(remotes)) findings.push("a private remote is configured");
}

if (findings.length > 0) {
  console.error(`[audit] FAIL ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(strict ? 1 : 2);
}
console.log("[audit] PASS no denylisted terms, file names, denied blobs or secrets in the tracked tree");
