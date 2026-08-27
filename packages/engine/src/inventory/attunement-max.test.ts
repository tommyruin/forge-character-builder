/**
 * The attunement ceiling is a computed statistic ("attunement:max", base 3),
 * raised by content stat rules (e.g. a race or class granting more attuned
 * item slots). The inventory DTO's maxAttunedItemCount, and the attune
 * endpoint's enforcement, must both track that computed value instead of a
 * hard-coded 3.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { CharacterService } from "../character/service.js";
import { encodeBase64 } from "../platform.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const RACE_XML = `<elements>
  <element name="Attuned Folk" type="Race" source="Homebrew" id="ID_TEST_RACE_ATTUNED_FOLK">
    <description><p>Test race.</p></description>
    <setters><set name="names">Attuned</set></setters>
    <rules>
      <stat name="attunement:max" value="4" bonus="base" />
    </rules>
  </element>
</elements>`;

const RING = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_SPELL_STORING";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
  await ingestContentFiles(library, [
    { path: "imports/attunement-max-test.xml", base64: encodeBase64(new TextEncoder().encode(RACE_XML)) },
  ]);
}, 120_000);

function withRace(service: CharacterService, id: string): void {
  service.createCharacter(id);
  const detail = service.getCharacterDetail(id);
  const raceRule = detail.selectionRules.find((rule) => rule.type === "Race")!;
  service.setSelection(id, raceRule.identifier, "ID_TEST_RACE_ATTUNED_FOLK");
}

describe("attunement maximum from statistics", () => {
  it("keeps the default max of 3 for a character with no attunement:max rule", () => {
    const service = new CharacterService(undefined, library);
    const id = "attune-max-default";
    service.createCharacter(id);
    expect(service.getInventory(id).maxAttunedItemCount).toBe(3);
  });

  it("reports a content-raised attunement:max in the inventory DTO", () => {
    const service = new CharacterService(undefined, library);
    const id = "attune-max-dto";
    withRace(service, id);
    expect(service.getInventory(id).maxAttunedItemCount).toBe(4);
  });

  it("allows attuning a fourth item once the raised max permits it", () => {
    const service = new CharacterService(undefined, library);
    const id = "attune-max-enforce";
    withRace(service, id);
    const rings: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dto = service.addItem(id, { itemId: RING, amount: 1, baseElementId: null });
      rings.push(dto.items.at(-1)!.identifier);
    }
    for (const identifier of rings.slice(0, 3)) {
      service.attuneItem(id, identifier, true);
    }
    const dto = service.attuneItem(id, rings[3]!, true);
    expect(dto.attunedItemCount).toBe(4);
    expect(dto.maxAttunedItemCount).toBe(4);
  });
});
