import { describe, expect, it } from "vitest";
import { buildLibrary } from "./library.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

describe("element library (vendored corpus)", () => {
  it("ingests the corpus with pinned counts", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    expect(lib.elementCount).toBe(25960); // includes ingest-generated proxies
    expect(Object.keys(lib.typeCounts)).toHaveLength(47);
    expect(lib.sources.size).toBe(136);
    expect(lib.fileOrder[0]).toBe("system/system-elements-extended.xml");
  });

  it("resolves system elements (levels, grants, options)", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    for (const id of ["ID_LEVEL_1", "ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE", "ID_INTERNAL_OPTION_ALLOW_FEATS"]) {
      expect(lib.byId.get(id), id).toBeDefined();
    }
    expect(lib.byId.get("ID_LEVEL_1")!.identity.name).toBe("1");
    expect(lib.byId.get("ID_INTERNAL_OPTION_ALLOW_FEATS")!.identity.type).toBe("Option");
  });

  it("resolves public corpus elements", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    const gnome = lib.byId.get("ID_RACE_GNOME");
    expect(gnome).toBeDefined();
    expect(gnome!.identity.source).toBeTruthy();
    const longsword = lib.byId.get("ID_WOTC_PHB_WEAPON_LONGSWORD");
    expect(longsword).toBeDefined();
  });

  it("collects select rules and grants from a race element", async () => {
    const lib = await buildLibrary(CORPUS_ROOT);
    const gnome = lib.byId.get("ID_RACE_GNOME")!;
    const selects = gnome.rules.filter((rule) => rule.kind === "select");
    expect(selects.length).toBeGreaterThan(0);
    expect(selects[0]!.kind).toBe("select");
  });
});
