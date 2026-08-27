/**
 * Preparing spells on a full-list caster.
 *
 * A full-list caster (cleric, druid, paladin) can prepare any spell on its
 * class list, whether or not that spell is already an entry in the character's
 * `<spells>` section. A freshly built character has an empty `<spells />`, so
 * the first preparation has to create the entry rather than update one.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { buildPaladin3, sharedLibrary } from "../testing/character-factory.js";

const BLESS = "ID_PHB_SPELL_BLESS";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

describe("preparing spells on a full-list caster", () => {
  it("starts from an empty spells section", () => {
    const { service, id } = buildPaladin3(library, "EmptySpells");
    expect(service.getCharacter(id).magic?.casters[0]?.spells).toEqual([]);
    expect(service.getSpellcasting(id)[0]!.currentPreparedCount).toBe(0);
  });

  it("prepares a class-list spell that is not yet an entry", () => {
    const { service, id } = buildPaladin3(library, "PrepareNew");
    const caster = service.getSpellcasting(id)[0]!;

    const after = service.setPrepared(id, caster.identifier, { spellId: BLESS, prepared: true });

    expect(after[0]!.currentPreparedCount).toBe(1);
    const bless = after[0]!.knownSpells.find((spell) => spell.id === BLESS)!;
    expect(bless.isPrepared).toBe(true);
  });

  it("survives a re-read and writes a complete entry to the document", () => {
    const { service, id } = buildPaladin3(library, "PrepareWrite");
    const caster = service.getSpellcasting(id)[0]!;
    service.setPrepared(id, caster.identifier, { spellId: BLESS, prepared: true });

    expect(service.getSpellcasting(id)[0]!.currentPreparedCount).toBe(1);

    // The serialized entry carries its name and level, not empty attributes.
    const xml = service.exportCharacterXml(id);
    expect(xml).toContain(`<spell name="Bless" level="1" id="${BLESS}" prepared="true" />`);
  });

  it("round-trips the prepared spell through export and import", () => {
    const { service, id } = buildPaladin3(library, "PrepareRoundTrip");
    const caster = service.getSpellcasting(id)[0]!;
    service.setPrepared(id, caster.identifier, { spellId: BLESS, prepared: true });
    const exported = service.exportCharacterXml(id);

    const reader = buildPaladin3(library, "PrepareReader").service;
    reader.importCharacterXml(id, exported);
    expect(reader.exportCharacterXml(id)).toBe(exported);
    expect(reader.getSpellcasting(id)[0]!.currentPreparedCount).toBe(1);
  });

  it("unprepares the spell again", () => {
    const { service, id } = buildPaladin3(library, "Unprepare");
    const caster = service.getSpellcasting(id)[0]!;
    service.setPrepared(id, caster.identifier, { spellId: BLESS, prepared: true });

    const after = service.setPrepared(id, caster.identifier, { spellId: BLESS, prepared: false });
    expect(after[0]!.currentPreparedCount).toBe(0);
    expect(after[0]!.knownSpells.find((spell) => spell.id === BLESS)?.isPrepared).toBe(false);
  });

  it("still rejects a spell that is not on the class list", () => {
    const { service, id } = buildPaladin3(library, "RejectUnknown");
    const caster = service.getSpellcasting(id)[0]!;
    expect(() =>
      service.setPrepared(id, caster.identifier, { spellId: "ID_PHB_SPELL_FIREBALL", prepared: true }),
    ).toThrowError(expect.objectContaining({ code: "not-found" }));
  });
});
