#!/usr/bin/env node
/**
 * Cuts a release: bumps every workspace manifest and the lockfile to the next
 * version, stamps the changelog's [Unreleased] section with that version and
 * today's date, and (unless --dry-run) commits and tags the result.
 *
 *   node scripts/release.mjs patch|minor|major [--dry-run] [--release-date YYYY-MM-DD]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFESTS = ["package.json", "apps/client/package.json", "packages/api/package.json", "packages/engine/package.json"];
export const VERSION_MODULE = "packages/api/src/version.ts";
export const LOCKFILE = "package-lock.json";
export const CHANGELOG = "CHANGELOG.md";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function bumpVersion(version, bumpType) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`not a MAJOR.MINOR.PATCH version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bumpType === "major") return `${major + 1}.0.0`;
  if (bumpType === "minor") return `${major}.${minor + 1}.0`;
  if (bumpType === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump type: ${bumpType}`);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function updateManifestVersion(source, version) {
  const manifest = JSON.parse(source);
  manifest.version = version;
  return serialize(manifest);
}

/** Workspace packages are keyed by their path; everything under node_modules is a dependency. */
export function updateLockVersion(source, version) {
  const lock = JSON.parse(source);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if (location.includes("node_modules")) continue;
    if (entry?.name && entry?.version) entry.version = version;
  }
  return serialize(lock);
}

/** Turns the [Unreleased] section into a dated release and opens a fresh one above it. */
export function stampChangelog(source, { version, date }) {
  const heading = "## [Unreleased]";
  const at = source.indexOf(heading);
  if (at === -1) throw new Error(`${CHANGELOG} has no [Unreleased] section`);
  const bodyStart = at + heading.length;
  const nextHeading = source.indexOf("\n## ", bodyStart);
  const body = source.slice(bodyStart, nextHeading === -1 ? source.length : nextHeading);
  if (body.trim() === "") throw new Error(`${CHANGELOG} has nothing under [Unreleased] to release`);
  return `${source.slice(0, at)}${heading}\n\n## [${version}] - ${date}${body}${nextHeading === -1 ? "\n" : source.slice(nextHeading)}`;
}

export function prepareRelease({ root = ROOT, bumpType = "patch", date = new Date().toISOString().slice(0, 10), dryRun = false } = {}) {
  const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const version = bumpVersion(current, bumpType);
  const changelog = stampChangelog(readFileSync(join(root, CHANGELOG), "utf8"), { version, date });
  if (!dryRun) {
    writeFileSync(join(root, CHANGELOG), changelog);
    for (const relative of MANIFESTS) {
      writeFileSync(join(root, relative), updateManifestVersion(readFileSync(join(root, relative), "utf8"), version));
    }
    if (existsSync(join(root, LOCKFILE))) {
      writeFileSync(join(root, LOCKFILE), updateLockVersion(readFileSync(join(root, LOCKFILE), "utf8"), version));
    }
    writeFileSync(join(root, VERSION_MODULE), `/** The engine version, kept in step with the package manifests by the release script. */\nexport const ENGINE_VERSION = "${version}";\n`);
  }
  return { version, tag: `v${version}`, date };
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const bumpType = args.find((argument) => ["patch", "minor", "major"].includes(argument)) ?? "patch";
  const dryRun = args.includes("--dry-run");
  const dateIndex = args.indexOf("--release-date");
  const date = dateIndex === -1 ? undefined : args[dateIndex + 1];
  const result = prepareRelease({ bumpType, dryRun, ...(date ? { date } : {}) });
  if (dryRun) {
    console.log(`would release ${result.tag} (${result.date})`);
  } else {
    git(["add", CHANGELOG, LOCKFILE, VERSION_MODULE, ...MANIFESTS]);
    git(["commit", "-m", `release: ${result.tag}`]);
    git(["tag", result.tag]);
    console.log(`released ${result.tag}; push with: git push origin HEAD refs/tags/${result.tag}`);
  }
}
