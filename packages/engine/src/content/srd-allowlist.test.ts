/**
 * The reviewed SRD 5.2.1 map is complete against both of its inputs: every
 * entry the document names is either mapped to corpus elements or explained,
 * and every named corpus element is either published, curated or excluded
 * with a reason. Silent drops and silent leaks are both impossible.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { EDITIONS, NAMED_TYPES, scanFile, type ScannedNode } from "../../../../scripts/build-srd-content.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SRD_DIR = join(ROOT, "third-party", "srd-5.2");
const CORPUS_DIR = join(ROOT, "third-party", "elements", "testdata", "core", "players-handbook-2024");

// Mirrors the generator's normalisation, including the PDF's soft hyphens.
const norm = (text: string): string =>
  text.replace(/[-­‐‑‒–—]+/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

async function corpusElements(root = CORPUS_DIR): Promise<Array<{ id: string; type: string; name: string; path: string }>> {
  const out: Array<{ id: string; type: string; name: string; path: string }> = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path);
      else if (entry.name.endsWith(".xml")) {
        const { nodes } = scanFile(await readFile(join(dir, entry.name), "utf8"), path);
        for (const node of nodes as ScannedNode[]) if (node.kind === "element") out.push({ id: node.id, type: node.type, name: node.name, path });
      }
    }
  };
  await walk(root, "");
  return out;
}

describe("SRD 5.2.1 allowlist", () => {
  it("was reviewed against the committed inventory", async () => {
    const inventory = await readFile(join(SRD_DIR, "srd-5.2.1.inventory.json"), "utf8");
    const map = JSON.parse(await readFile(join(SRD_DIR, "srd-5.2.1.map.json"), "utf8"));
    expect(map.inventoryDigest).toBe(createHash("sha256").update(inventory).digest("hex"));
    const provenance = JSON.parse(await readFile(join(SRD_DIR, "srd-5.2.1.provenance.json"), "utf8"));
    expect(JSON.parse(inventory).source.sha256).toBe(provenance.sha256);
  });

  it("maps or explains every inventory entry", async () => {
    type Chapter = Array<{ name: string }> | { names: string[] };
    const inventory = JSON.parse(await readFile(join(SRD_DIR, "srd-5.2.1.inventory.json"), "utf8")) as { chapters: Record<string, Chapter> };
    const map = JSON.parse(await readFile(join(SRD_DIR, "srd-5.2.1.map.json"), "utf8"));
    const missing: string[] = [];
    for (const [chapter, value] of Object.entries(inventory.chapters)) {
      if (map.unmappedChapters[chapter] && !["animals", "languages"].includes(chapter)) continue;
      const names: string[] = Array.isArray(value) ? value.map((entry) => entry.name) : value.names;
      for (const name of names) {
        const key = `${chapter}/${norm(name)}`;
        if (!map.entries[key] && !map.unmatchedInventory[key] && !map.unmappedChapters[chapter]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("classes/"))).toHaveLength(12);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("subclasses/"))).toHaveLength(12);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("backgrounds/"))).toHaveLength(4);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("species/"))).toHaveLength(9);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("feats/"))).toHaveLength(17);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("spells/"))).toHaveLength(339);
  });

  it("resolves every mapped id and accounts for every named corpus element", async () => {
    const map = JSON.parse(await readFile(join(SRD_DIR, "srd-5.2.1.map.json"), "utf8"));
    const elements = await corpusElements();
    const byId = new Map(elements.map((element) => [element.id, element]));
    const mapped = new Set<string>(Object.values<string[]>(map.entries).flat());
    for (const id of mapped) expect(byId.has(id), `mapped id ${id} is not in the corpus`).toBe(true);
    for (const id of Object.keys(map.curated)) expect(byId.has(id), `curated id ${id} is not in the corpus`).toBe(true);
    for (const id of Object.keys(map.excluded)) {
      expect(mapped.has(id) || map.curated[id] !== undefined, `${id} is both excluded and published`).toBe(false);
      expect(typeof map.excluded[id]).toBe("string");
    }
    const unaccounted = elements
      .filter((element) => (NAMED_TYPES as Set<string>).has(element.type) && element.type !== "Source")
      .filter((element) => !mapped.has(element.id) && !map.curated[element.id] && !map.excluded[element.id])
      .map((element) => `${element.path}: ${element.type} ${element.id}`);
    expect(unaccounted).toEqual([]);
  });

  it("renames every spell the document lists without its original proper noun", async () => {
    const map = JSON.parse(await readFile(join(SRD_DIR, "srd-5.2.1.map.json"), "utf8"));
    const denylist = JSON.parse(await readFile(join(SRD_DIR, "ip-denylist.json"), "utf8")).patterns.map((pattern: string) => new RegExp(pattern, "i"));
    expect(Object.keys(map.renames)).toHaveLength(17);
    for (const [from, to] of Object.entries<string>(map.renames)) {
      expect(denylist.some((pattern: RegExp) => pattern.test(from)), `${from} should be denylisted`).toBe(true);
      expect(denylist.some((pattern: RegExp) => pattern.test(to)), `${to} must not be denylisted`).toBe(false);
    }
  });
});

describe("SRD 5.1 allowlist", () => {
  const edition = EDITIONS["5.1"];

  it("was reviewed against the committed inventory and pins the document", async () => {
    const inventory = await readFile(join(edition.srdDir, edition.inventory), "utf8");
    const map = JSON.parse(await readFile(join(edition.srdDir, edition.map), "utf8"));
    expect(map.inventoryDigest).toBe(createHash("sha256").update(inventory).digest("hex"));
    const provenance = JSON.parse(await readFile(join(edition.srdDir, "srd-5.1.provenance.json"), "utf8"));
    expect(JSON.parse(inventory).source.sha256).toBe(provenance.sha256);
  });

  it("maps or explains every inventory entry and accounts for every named element of the corpus source", async () => {
    const inventory = JSON.parse(await readFile(join(edition.srdDir, edition.inventory), "utf8")) as { chapters: Record<string, Array<{ name: string }>> };
    const map = JSON.parse(await readFile(join(edition.srdDir, edition.map), "utf8"));
    const missing: string[] = [];
    for (const [chapter, entries] of Object.entries(inventory.chapters)) {
      if (map.unmappedChapters[chapter]) continue;
      for (const entry of entries) {
        const key = `${chapter}/${norm(entry.name)}`;
        if (!map.entries[key] && !map.unmatchedInventory[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("classes/"))).toHaveLength(12);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("subclasses/"))).toHaveLength(12);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("races/"))).toHaveLength(9);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("subraces/"))).toHaveLength(4);
    expect(Object.keys(map.entries).filter((key) => key.startsWith("spells/"))).toHaveLength(319);

    const elements = (await Promise.all(edition.sourceDirs.map(async ({ dir, prefix }) =>
      (await corpusElements(dir)).map((element) => ({ ...element, path: `${prefix}${element.path}` })),
    ))).flat();
    const byId = new Map(elements.map((element) => [element.id, element]));
    const mapped = new Set<string>(Object.values<string[]>(map.entries).flat());
    for (const id of mapped) expect(byId.has(id), `mapped id ${id} is not in the corpus source`).toBe(true);
    const unaccounted = elements
      .filter((element) => (NAMED_TYPES as Set<string>).has(element.type) && element.type !== "Source" && !edition.excludedFiles[element.path])
      .filter((element) => !mapped.has(element.id) && !map.curated[element.id] && !map.excluded[element.id])
      .map((element) => `${element.path}: ${element.type} ${element.id}`);
    expect(unaccounted).toEqual([]);
    // The handbook-only spells the corpus carries are excluded, not renamed away.
    expect(map.excluded.ID_PHB_SPELL_ARMOR_OF_AGATHYS).toBeDefined();
  });
});
