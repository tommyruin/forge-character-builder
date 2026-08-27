/**
 * Content can author a base hit point pool via the "hp:starting" statistic
 * (a homebrew-facing key; the bundled corpus does not use it). The character's
 * hit point total must include it alongside the per-level "hp" pool.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { CharacterService } from "../character/service.js";
import { encodeBase64 } from "../platform.js";
import { computeStatistics } from "./calculator.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const RACE_XML = `<elements>
  <element name="Sturdy Folk" type="Race" source="Homebrew" id="ID_TEST_RACE_STURDY_FOLK">
    <description><p>Test race.</p></description>
    <setters><set name="names">Sturdy</set></setters>
    <rules>
      <stat name="hp:starting" value="7" />
      <stat name="hp" value="2" />
    </rules>
  </element>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
  await ingestContentFiles(library, [
    { path: "imports/hp-starting-test.xml", base64: encodeBase64(new TextEncoder().encode(RACE_XML)) },
  ]);
}, 120_000);

describe("hp:starting", () => {
  it("adds hp:starting to the hit point total", () => {
    const service = new CharacterService(undefined, library);
    const id = "sturdy";
    service.createCharacter(id);
    service.setAbilities(id, {
      strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
    });
    const before = computeStatistics(service.getCharacter(id), library);

    const detail = service.getCharacterDetail(id);
    const raceRule = detail.selectionRules.find((rule) => rule.type === "Race")!;
    service.setSelection(id, raceRule.identifier, "ID_TEST_RACE_STURDY_FOLK");
    const after = computeStatistics(service.getCharacter(id), library);

    expect(after["hp:starting"]).toBe(7);
    expect((after.hp ?? 0) - (before.hp ?? 0)).toBe(9);
  });
});
