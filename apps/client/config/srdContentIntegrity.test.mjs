/**
 * The shipped content carries nothing the System Reference Documents do not:
 * the generated files are exactly the profile's lists, none of them holds an
 * element the review excluded, and no shipped file names a proper noun the
 * documents leave out.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_BASE_PATHS, SRD_2014_PATHS, SRD_2024_PATHS } from "./contentProfile.mjs";

const PUBLIC_ROOT = fileURLToPath(new URL("../public/content/", import.meta.url));
const THIRD_PARTY = fileURLToPath(new URL("../../../third-party/", import.meta.url));
const PREFIX = "srd-5.2.1/";
const SRD_2014_PREFIX = "srd-5.1/";
const AUTHORED = new Set([
  ...["skill-supports.xml", "skill-expertise.xml", "source.xml"].map((name) => `${PREFIX}${name}`),
  `${SRD_2014_PREFIX}ranger-favored-terrains.xml`,
]);
const EDITIONS = [
  { dir: "srd-5.2", map: "srd-5.2.1.map.json", prefix: PREFIX, paths: SRD_2024_PATHS },
  { dir: "srd-5.1", map: "srd-5.1.map.json", prefix: SRD_2014_PREFIX, paths: SRD_2014_PATHS },
];

async function shippedFiles(prefix) {
  const names = await readdir(join(PUBLIC_ROOT, prefix), { recursive: true, withFileTypes: true });
  return names
    .filter((entry) => entry.isFile() && entry.name.endsWith(".xml"))
    .map((entry) => `${prefix}${join(entry.parentPath ?? entry.path, entry.name).slice(join(PUBLIC_ROOT, prefix).length).replaceAll("\\", "/")}`)
    .sort();
}

async function denylist(dir) {
  return JSON.parse(await readFile(join(THIRD_PARTY, dir, "ip-denylist.json"), "utf8")).patterns;
}

describe("shipped SRD content integrity", () => {
  it("ships exactly the generated and authored files the profile lists", async () => {
    for (const edition of EDITIONS) {
      expect([...edition.paths].sort(), edition.dir).toEqual(await shippedFiles(edition.prefix));
      expect(edition.paths.length, edition.dir).toBeGreaterThan(30);
      for (const name of edition.paths) {
        expect(PUBLIC_BASE_PATHS.has(name)).toBe(true);
        const text = await readFile(join(PUBLIC_ROOT, name), "utf8");
        if (AUTHORED.has(name)) expect(text).toContain("Authored");
        else expect(text, `${name} is not generator output`).toContain("scripts/build-srd-content.mjs");
      }
    }
  });

  it("holds no element the review excluded", async () => {
    for (const edition of EDITIONS) {
      const map = JSON.parse(await readFile(join(THIRD_PARTY, edition.dir, edition.map), "utf8"));
      const excluded = Object.keys(map.excluded);
      for (const name of [...PUBLIC_BASE_PATHS].filter((path) => path.startsWith(edition.prefix))) {
        const ids = new Set([...(await readFile(join(PUBLIC_ROOT, name), "utf8")).matchAll(/<element\b[^>]*\sid="([^"]*)"/g)].map((match) => match[1]));
        const leaked = excluded.filter((id) => ids.has(id));
        expect(leaked, `${name} ships excluded elements`).toEqual([]);
      }
    }
  });

  it("names no proper noun the System Reference Documents leave out", async () => {
    const patterns2024 = (await denylist("srd-5.2")).map((pattern) => new RegExp(pattern, "gi"));
    const patterns2014 = (await denylist("srd-5.1")).map((pattern) => new RegExp(pattern, "gi"));
    // Files outside the two generated sets (the core baseline) carry the
    // spell-name family check only.
    const corePatterns = patterns2024.filter((pattern) => /\[’'\]s/.test(pattern.source) || /Jallarzi|Yolande/.test(pattern.source));
    const hits = [];
    for (const name of PUBLIC_BASE_PATHS) {
      const path = join(PUBLIC_ROOT, name);
      let text;
      try {
        text = await readFile(path, "utf8");
      } catch {
        continue;
      }
      const applicable = name.startsWith(PREFIX) ? patterns2024 : name.startsWith(SRD_2014_PREFIX) ? patterns2014 : corePatterns;
      for (const pattern of applicable) {
        for (const match of text.matchAll(pattern)) hits.push(`${name}: ${match[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
