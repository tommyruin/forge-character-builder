/**
 * A grant gated on a switch: the element it names registers only while the
 * switch is on, and leaves again when it is turned off. The gate is read the way
 * a modifier's is, so it applies to content made in the builder and never to a
 * book rule that only describes a circumstance.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { parseElementsFile } from "../content/parser.js";
import { CharacterService } from "../character/service.js";
import { buildFighter3, sharedLibrary, type BuiltCharacter } from "../testing/character-factory.js";
import { compileCustomElement } from "./compile.js";
import { customDraftIssues } from "./validate.js";
import { createCustomDraft, createCustomItemDraft, newCustomBlockId, type CustomBlock, type CustomDraft } from "./schema.js";

const SENSE = "ID_VISION_BLINDSIGHT";
const FIRE_RESISTANCE = "ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE";
const TIDECANT = "ID_TEST_LANGUAGE_SWITCH_TIDECANT";
const PACK_FEATURE = "ID_CUSTOM_SWITCHGRANTPACKFEATURE";
const BOOK_FEATURE = "ID_TEST_CFEAT_SWITCH_BOOK_ECHO";
const SPELL = "ID_TEST_SPELL_SWITCH_EMBER";

// Invented content: a language, a spell, a feature (not made by the builder) that carries
// a switch-gated grant, and a book-style feature whose grant has a `condition` of its own.
const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Tidecant" type="Language" source="Switch Grant Test" id="${TIDECANT}">
    <supports>Standard</supports>
    <description><p>The speech of the tides.</p></description>
  </element>
  <element name="Ember Spark" type="Spell" source="Switch Grant Test" id="${SPELL}">
    <supports>Wizard</supports>
    <description><p>A mote of fire.</p></description>
    <setters><set name="level">0</set><set name="school">Evocation</set><set name="time">Action</set><set name="range">60 feet</set><set name="duration">Instantaneous</set></setters>
  </element>
  <element name="Pack Form" type="Feat" source="Switch Grant Test" id="${PACK_FEATURE}">
    <description><p>A form a pack defines.</p></description>
    <rules><grant type="Vision" id="${SENSE}" condition="Pack form" /></rules>
  </element>
  <element name="Book Echo" type="Class Feature" source="Switch Grant Test" id="${BOOK_FEATURE}">
    <description><p>Describes a circumstance the engine does not model.</p></description>
    <rules><grant type="Language" id="${TIDECANT}" condition="while echoing" /></rules>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/switch-grants-test.xml", PACK]]));
}, 120_000);

let counter = 0;
const fighter = (): BuiltCharacter => buildFighter3(library, `SwitchGrantFighter${counter++}`);
const registered = (service: CharacterService, id: string): string[] =>
  service.getCharacter(id).sum.elements.map((entry) => entry.id);

const grant = (type: string, id: string, extra: Record<string, unknown> = {}): CustomBlock =>
  ({ kind: "grant", id: newCustomBlockId(), target: { by: "id", type, id }, ...extra }) as CustomBlock;

function form(blocks: CustomBlock[]): CustomDraft {
  return { ...createCustomDraft("feature", "Moonlit Form"), description: "A silver glow.", showsUnder: "other", blocks };
}

describe("compiling a switch-gated grant", () => {
  it("writes the switch as the grant's condition and reads it back", () => {
    const draft = form([grant("Vision", SENSE, { switch: "Moonlit form" })]);
    const xml = compileCustomElement(draft);
    expect(xml).toContain('<grant type="Vision" id="ID_VISION_BLINDSIGHT" condition="Moonlit form" />');
    const [element] = parseElementsFile(`<elements>${xml}</elements>`, "x.xml");
    expect(element!.rules[0]).toMatchObject({ kind: "grant", id: SENSE, condition: "Moonlit form" });
  });

  it("leaves an ungated grant exactly as it was", () => {
    const xml = compileCustomElement(form([grant("Vision", SENSE)]));
    expect(xml).not.toContain("condition");
    const [element] = parseElementsFile(`<elements>${xml}</elements>`, "x.xml");
    expect(element!.rules[0]).not.toHaveProperty("condition");
  });

  it("refuses a switch name the XML cannot carry", () => {
    const issues = customDraftIssues(form([grant("Vision", SENSE, { switch: 'bad "name"' })]));
    expect(issues).toContainEqual(expect.objectContaining({ path: "blocks[0].switch" }));
  });
});

describe("a switch-gated grant on a character's own feature", () => {
  const gated = (): CustomDraft =>
    form([
      grant("Vision", SENSE, { switch: "Moonlit form" }),
      grant("Condition", FIRE_RESISTANCE, { switch: "Moonlit form" }),
      grant("Language", TIDECANT),
    ]);

  it("registers the grants only while the switch is on", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: gated() });
    expect(registered(service, id)).toContain(TIDECANT);
    expect(registered(service, id)).not.toContain(SENSE);
    expect(registered(service, id)).not.toContain(FIRE_RESISTANCE);

    service.setResourceSwitch(id, { name: "Moonlit form", on: true });
    expect(registered(service, id)).toContain(SENSE);
    expect(registered(service, id)).toContain(FIRE_RESISTANCE);

    service.setResourceSwitch(id, { name: "Moonlit form", on: false });
    expect(registered(service, id)).not.toContain(SENSE);
    expect(registered(service, id)).not.toContain(FIRE_RESISTANCE);
    expect(registered(service, id)).toContain(TIDECANT);
  });

  it("lists the switch even when only a grant names it", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: gated() });
    expect(service.getResources(id).switches).toEqual([{ name: "Moonlit form", on: false, sources: ["Moonlit Form"] }]);
  });

  it("returns the file to its bytes when the switch goes back off", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: gated() });
    const off = service.exportCharacterXml(id);
    service.setResourceSwitch(id, { name: "Moonlit form", on: true });
    expect(service.exportCharacterXml(id)).not.toBe(off);
    service.setResourceSwitch(id, { name: "Moonlit form", on: false });
    expect(service.exportCharacterXml(id)).toBe(off);
  });

  it("keeps a switched-on grant through a save and reload", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: gated() });
    service.setResourceSwitch(id, { name: "Moonlit form", on: true });
    const reloaded = new CharacterService(undefined, library);
    reloaded.importCharacterXml("Reloaded", service.exportCharacterXml(id));
    expect(registered(reloaded, "Reloaded")).toContain(SENSE);
    reloaded.setResourceSwitch("Reloaded", { name: "Moonlit form", on: false });
    expect(registered(reloaded, "Reloaded")).not.toContain(SENSE);
  });

  it("registers a gated grant that is also gated on a requirement only when both hold", () => {
    const { service, id } = fighter();
    const draft = form([
      grant("Vision", SENSE, {
        switch: "Moonlit form",
        requirements: { kind: "level", min: 10 },
      }),
    ]);
    service.saveCustomDraft(id, { draft });
    service.setResourceSwitch(id, { name: "Moonlit form", on: true });
    expect(registered(service, id)).not.toContain(SENSE);
  });

  it("gives a spell only while the switch is on", () => {
    const { service, id } = fighter();
    const draft = form([
      grant("Spell", SPELL, { switch: "Moonlit form", spell: { castAbility: "wisdom" } }),
    ]);
    service.saveCustomDraft(id, { draft });
    expect(registered(service, id)).not.toContain(SPELL);
    service.setResourceSwitch(id, { name: "Moonlit form", on: true });
    expect(registered(service, id)).toContain(SPELL);
    service.setResourceSwitch(id, { name: "Moonlit form", on: false });
    expect(registered(service, id)).not.toContain(SPELL);
  });
});

describe("a switch-gated grant on a worn item", () => {
  it("registers while the item is in use and the switch is on", () => {
    const { service, id } = fighter();
    const item = {
      ...createCustomItemDraft("worn", "Moon Pendant"),
      slot: "neck" as const,
      blocks: [grant("Vision", SENSE, { switch: "Pendant glow" })],
    };
    const saved = service.saveCustomDraft(id, { draft: item });
    const record = service.getInventory(id) as unknown as { items: Array<{ identifier: string; itemId: string }> };
    const identifier = record.items.find((entry) => entry.itemId === saved.entry!.elementId)!.identifier;
    service.equipItem(id, identifier, "worn");
    expect(registered(service, id)).not.toContain(SENSE);
    service.setResourceSwitch(id, { name: "Pendant glow", on: true });
    expect(registered(service, id)).toContain(SENSE);
    service.setResourceSwitch(id, { name: "Pendant glow", on: false });
    expect(registered(service, id)).not.toContain(SENSE);
  });
});

describe("a switch-gated grant on content a pack defines", () => {
  it("is gated like the builder's own, and the switch is listed without any draft", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: PACK_FEATURE });
    expect(registered(service, id)).not.toContain(SENSE);
    expect(service.getResources(id).switches).toEqual([{ name: "Pack form", on: false, sources: ["Pack Form"] }]);
    service.setResourceSwitch(id, { name: "Pack form", on: true });
    expect(registered(service, id)).toContain(SENSE);
    service.setResourceSwitch(id, { name: "Pack form", on: false });
    expect(registered(service, id)).not.toContain(SENSE);
  });
});

describe("a book grant with a condition", () => {
  it("still registers: the condition only describes a circumstance", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: BOOK_FEATURE });
    expect(registered(service, id)).toContain(TIDECANT);
  });
});
