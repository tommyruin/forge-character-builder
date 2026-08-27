/**
 * A single source's "ac:shield" / "ac:misc" contributions merge as a group:
 * when the source's rules for the key sum to zero or less, the whole group is
 * dropped. A mixed group whose sum is positive still applies as its net total.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "../character/service.js";
import { computeStatistics } from "./calculator.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const APPENDS = `<elements>
  <append id="ID_WOTC_PHB_CLASS_DRUID">
    <rules>
      <stat name="ac:misc" value="-1" />
    </rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_WIZARD">
    <rules>
      <stat name="ac:misc" value="3" />
      <stat name="ac:misc" value="-1" />
    </rules>
  </append>
  <append id="ID_WOTC_PHB_CLASS_ROGUE">
    <rules>
      <stat name="ac:shield" value="-1" />
    </rules>
  </append>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
  await ingestContentFiles(library, [
    { path: "imports/ac-group-test.xml", base64: encodeBase64(new TextEncoder().encode(APPENDS)) },
  ]);
}, 120_000);

function acWithClass(classId: string): number {
  const service = new CharacterService(undefined, library);
  const id = "ac-test";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 10, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
  });
  const detail = service.getCharacterDetail(id);
  const classRule = detail.selectionRules.find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, classId);
  return computeStatistics(service.getCharacter(id), library).ac!;
}

describe("ac contribution group merging", () => {
  it("drops a source whose ac:misc rules sum to a negative total", () => {
    expect(acWithClass("ID_WOTC_PHB_CLASS_DRUID")).toBe(12);
  });

  it("applies a mixed ac:misc group as its positive net total", () => {
    expect(acWithClass("ID_WOTC_PHB_CLASS_WIZARD")).toBe(14);
  });

  it("drops a source whose ac:shield rules sum to a negative total", () => {
    expect(acWithClass("ID_WOTC_PHB_CLASS_ROGUE")).toBe(12);
  });
});
