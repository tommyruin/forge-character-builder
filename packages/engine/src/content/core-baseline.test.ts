/**
 * The core rules baseline under apps/client/public/content/core is authored in
 * this repository. Every identifier the engine and the shipped content depend
 * on stays defined, and the files stay free of leftovers that would make them
 * read as anything other than authored data.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { childElements, parseXml } from "./xml.js";

const CORE_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/core/", import.meta.url));
const REQUIRED_IDS_PATH = fileURLToPath(new URL("./core-required-ids.json", import.meta.url));

async function coreFiles(dir = CORE_ROOT, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await coreFiles(full, out);
    else if (entry.name.endsWith(".xml")) out.push(full);
  }
  return out.sort();
}

describe("core rules baseline", () => {
  it("defines every required identifier exactly once", async () => {
    const seen = new Map<string, number>();
    for (const file of await coreFiles()) {
      const doc = parseXml(await readFile(file, "utf8"));
      const root = doc.name === "elements" ? doc : childElements(doc, "elements")[0]!;
      for (const element of childElements(root, "element")) {
        const id = element.attrs.id ?? "";
        expect(id, `${file}: element without id`).toMatch(/^ID_[A-Z0-9_()]+$/);
        expect(element.attrs.name, `${id} without name`).toBeTruthy();
        expect(element.attrs.type, `${id} without type`).toBeTruthy();
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    const requiredIds = JSON.parse(await readFile(REQUIRED_IDS_PATH, "utf8")) as string[];
    const missing = requiredIds.filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
    const duplicated = [...seen].filter(([, count]) => count > 1).map(([id]) => id);
    expect(duplicated).toEqual([]);
  });

  it("carries no comments, empty blocks or foreign resource names", async () => {
    for (const file of await coreFiles()) {
      const text = await readFile(file, "utf8");
      const label = file.slice(CORE_ROOT.length);
      if (label !== "companions/companions.xml") {
        expect(text, label).not.toContain("<!--");
        expect(text, label).not.toMatch(/<(supports|requirements|rules|setters|description)\s*\/>/);
        expect(text, label).not.toMatch(/<p>\s*<\/p>/);
      }
      expect(text, label).not.toMatch(/Builder\.Presentation|aurora/i);
    }
  });
});
