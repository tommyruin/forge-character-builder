/**
 * The Equipment tab's "Mounts & Vehicles" shop category, run against the
 * bundled SRD content (what the deployed client ships), not the third-party
 * corpus. Pins that the animals list and that each one has a description once
 * its stat block reference resolves. Asserts names and non-emptiness only.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "./library.js";
import { createEngineMethodHandlers } from "../worker-handlers.js";

const bundled = (edition: string, file: string): URL =>
  new URL(`../../../../apps/client/public/content/${edition}/${file}`, import.meta.url);

async function loadLibrary(edition: string, file: string): Promise<ElementLibrary> {
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, new Map([[`testdata/${edition}/${file}`, await readFile(fileURLToPath(bundled(edition, file)), "utf8")]]), false);
  return library;
}

interface Row {
  name: string;
  type: string;
  description: string | null;
}

function mountRows(library: ElementLibrary): Row[] {
  const service = new CharacterService(undefined, library);
  const handlers = createEngineMethodHandlers(service, library);
  const result = handlers.contentElements!({ itemCategory: "Mounts & Vehicles", limit: 500 }) as { items: Row[] };
  return result.items;
}

const ANIMALS_2024 = ["Elephant", "Horse, Draft", "Horse, Riding", "Mastiff", "Mule", "Pony", "Warhorse"];
const ANIMALS_2014 = ["Camel", "Donkey", "Elephant", "Horse, Draft", "Horse, Riding", "Mastiff", "Pony", "Warhorse"];

describe("bundled Mounts & Vehicles list", () => {
  describe("SRD 5.2.1", () => {
    let rows: Row[];
    let hiddenItemNames: string[];
    beforeAll(async () => {
      const library = await loadLibrary("srd-5.2.1", "items/items-mounts-vehicles.xml");
      rows = mountRows(library);
      hiddenItemNames = [...library.byId.values()]
        .filter((element) => element.identity.type === "Item" && element.setters.some((s) => s.name === "inventory-hidden"))
        .map((element) => element.identity.name);
    });

    it("lists the animals", () => {
      const names = rows.map((row) => row.name);
      for (const animal of ANIMALS_2024) expect(names, animal).toContain(animal);
    });

    it("gives every animal a description from its stat block", () => {
      for (const animal of ANIMALS_2024) {
        const row = rows.find((candidate) => candidate.name === animal);
        expect(row?.description, animal).toBeTruthy();
        expect(row!.description!.replace(/<[^>]*>/g, "").trim().length, animal).toBeGreaterThan(0);
      }
    });

    it("leaves out only the inventory-hidden Camel, which the corpus marks hidden", () => {
      const names = new Set(rows.map((row) => row.name));
      expect(hiddenItemNames).toEqual(["Camel"]);
      expect(names.has("Camel")).toBe(false);
    });
  });

  describe("SRD 5.1", () => {
    it("lists the animals with descriptions", async () => {
      const library = await loadLibrary("srd-5.1", "items/items-mounts.xml");
      const rows = mountRows(library);
      for (const animal of ANIMALS_2014) {
        const row = rows.find((candidate) => candidate.name === animal);
        expect(row, animal).toBeDefined();
        expect(row?.description, animal).toBeTruthy();
      }
    });
  });
});
