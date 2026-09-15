/**
 * The sheet's Resistances box: the damage defences the character actually has.
 *
 * A character's resistances, immunities and vulnerabilities are registered
 * Condition elements — "Resistance (Fire)", "Immunity (Poison)" — put there by
 * a race, a class feature or an item whose benefits are active. The box prints
 * those, grouped so the types a character resists read as one list rather than
 * one line each, with an imported file's hand-written `<defenses><conditional>`
 * text kept after them.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "./model.js";
import { buildCorpusLibrary } from "../testing/corpus.js";
import { seededRng } from "../testing/character-factory.js";

const SCALE_MAIL = "ID_WOTC_ARMOR_MEDIUM_SCALE_MAIL";
const DRAGON_SCALE_MAIL_BLACK = "ID_WOTC_DMG_MAGIC_ITEM_DRAGON_SCALE_MAIL_BLACK";
const RING_OF_RESISTANCE_FIRE = "ID_WOTC_DMG_MAGIC_ITEM_RING_OF_RESISTANCE_FIRE";
const PERIAPT_OF_PROOF_AGAINST_POISON = "ID_WOTC_DMG_MAGIC_ITEM_PERIAPT_OF_PROOF_AGAINST_POISON";

const HOMEBREW_ITEM = "ID_TEST_MAGIC_ITEM_EMBER_CLOAK";
const HOMEBREW_WARD = "ID_TEST_CONDITION_EMBER_WARD";
const HOMEBREW_ADVANTAGE = "ID_TEST_CONDITION_EMBER_ADVANTAGE";

/**
 * A cloak carrying one of each shape the box has to handle: a grouped
 * resistance, a grouped vulnerability, a Condition whose own sheet text is
 * what it has to say, and a parenthesised Condition that is none of the three
 * groups.
 */
const HOMEBREW_PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Ember Cloak" type="Magic Item" source="Sheet Defences Test" id="${HOMEBREW_ITEM}">
\t\t<description><p>A test cloak.</p></description>
\t\t<setters>
\t\t\t<set name="category">Wondrous Items</set>
\t\t\t<set name="type">Wondrous Item</set>
\t\t\t<set name="slot">back</set>
\t\t\t<set name="rarity">Rare</set>
\t\t\t<set name="attunement">true</set>
\t\t</setters>
\t\t<rules>
\t\t\t<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_FIRE" />
\t\t\t<grant type="Condition" id="ID_INTERNAL_CONDITION_DAMAGE_VULNERABILITY_COLD" />
\t\t\t<grant type="Condition" id="${HOMEBREW_WARD}" />
\t\t\t<grant type="Condition" id="${HOMEBREW_ADVANTAGE}" />
\t\t</rules>
\t</element>
\t<element name="Ember Ward" type="Condition" source="Sheet Defences Test" id="${HOMEBREW_WARD}">
\t\t<sheet><description>Fire damage you take is reduced by {{proficiency}}.</description></sheet>
\t</element>
\t<element name="Advantage (Poison Saves)" type="Condition" source="Sheet Defences Test" id="${HOMEBREW_ADVANTAGE}" />
</elements>
`;

let corpusPromise: Promise<ElementLibrary> | null = null;
const corpusLibrary = (): Promise<ElementLibrary> => {
  corpusPromise ??= buildCorpusLibrary();
  return corpusPromise;
};

let homebrewPromise: Promise<ElementLibrary> | null = null;
const homebrewLibrary = async (): Promise<ElementLibrary> => {
  homebrewPromise ??= (async () => {
    const base = await corpusLibrary();
    const files = new Map(base.fileContents);
    files.set("imports/sheet-defences-test.xml", HOMEBREW_PACK);
    const library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
    replaceLibraryFiles(library, files);
    return library;
  })();
  return homebrewPromise;
};

/** The value the writer draws in the Resistances box. */
function defences(service: CharacterService, id: string, library: ElementLibrary): string {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  return model.formValues?.["details_resistances"] ?? "";
}

/** The canonical "conditions" section's tokens, in order. */
function conditionTokens(service: CharacterService, id: string, library: ElementLibrary): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  const tokens: string[] = [];
  for (const page of model.pages) {
    for (const section of page.sections) {
      if (section.title !== "conditions") continue;
      for (const row of section.rows) {
        if (row.kind === "tokens") tokens.push(...row.tokens);
      }
    }
  }
  return tokens;
}

describe.each(["2014", "2024"])("sheet damage defences (%s rules)", (mode) => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await corpusLibrary();
  }, 120_000);

  /** A fresh, classless character in the ruleset under test. */
  function character(name: string): { service: CharacterService; id: string } {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter(`${name} ${mode}`).id;
    service.setRulesetMode(id, mode);
    return { service, id };
  }

  /** Black dragon scale mail (acid) worn and attuned, plus an attuned fire ring. */
  function resistantCharacter(name: string): {
    service: CharacterService;
    id: string;
    armor: string;
    ring: string;
  } {
    const { service, id } = character(name);
    const withArmor = service.addItem(id, {
      itemId: DRAGON_SCALE_MAIL_BLACK,
      amount: 1,
      baseElementId: SCALE_MAIL,
    });
    const armor = withArmor.items.find((item) => item.itemId === SCALE_MAIL)!.identifier;
    service.attuneItem(id, armor, true);
    const withRing = service.addItem(id, {
      itemId: RING_OF_RESISTANCE_FIRE,
      amount: 1,
      baseElementId: null,
    });
    const ring = withRing.items.at(-1)!.identifier;
    service.attuneItem(id, ring, true);
    return { service, id, armor, ring };
  }

  it("groups every registered resistance onto one alphabetical line", () => {
    const { service, id } = resistantCharacter("Resistant");
    expect(defences(service, id, library)).toBe("Resistances: Acid, Fire");
    // The canonical section and the printed box say the same thing.
    expect(conditionTokens(service, id, library).join(" ")).toContain("Acid");
    expect(conditionTokens(service, id, library).join(" ")).toContain("Fire");
  });

  it("prints immunities on their own line beneath the resistances", () => {
    const { service, id } = resistantCharacter("Immune");
    const dto = service.addItem(id, {
      itemId: PERIAPT_OF_PROOF_AGAINST_POISON,
      amount: 1,
      baseElementId: null,
    });
    // The periapt needs no attunement: wearing it is what conveys the immunity.
    service.equipItem(id, dto.items.at(-1)!.identifier, "worn");
    expect(defences(service, id, library)).toBe("Resistances: Acid, Fire\nImmunities: Poison");
    expect(conditionTokens(service, id, library).join(" ")).toContain("Poison");
  });

  it("drops a type as soon as its source stops conveying it", () => {
    const { service, id, armor, ring } = resistantCharacter("Fading");
    service.attuneItem(id, ring, false);
    expect(defences(service, id, library)).toBe("Resistances: Acid");

    service.removeItem(id, ring);
    service.removeItem(id, armor);
    expect(defences(service, id, library)).toBe("");
    expect(conditionTokens(service, id, library)).toEqual([]);
  });

  it("lists a type once when two items grant it", () => {
    const { service, id } = character("Two Rings");
    let dto = service.addItem(id, { itemId: RING_OF_RESISTANCE_FIRE, amount: 1, baseElementId: null });
    const first = dto.items.at(-1)!.identifier;
    dto = service.addItem(id, { itemId: RING_OF_RESISTANCE_FIRE, amount: 1, baseElementId: null });
    const second = dto.items.at(-1)!.identifier;
    service.attuneItem(id, first, true);
    service.attuneItem(id, second, true);

    expect(defences(service, id, library)).toBe("Resistances: Fire");
  });

  it("keeps an imported file's hand-written defences after the computed ones", () => {
    const { service, id } = character("Imported");
    const dto = service.addItem(id, { itemId: RING_OF_RESISTANCE_FIRE, amount: 1, baseElementId: null });
    service.attuneItem(id, dto.items.at(-1)!.identifier, true);
    // The free text an Aurora file carries lives in <defenses><conditional>;
    // nothing in this app writes it, so it can only arrive by import.
    const xml = service
      .exportCharacterXml(id)
      .replace("<conditional>\r\n", "<conditional>\r\n\t\t\t\tResistance (Necrotic)\r\n");
    expect(xml).toContain("Resistance (Necrotic)");

    const imported = new CharacterService(undefined, library, { rng: seededRng(7) });
    imported.importCharacterXml("Imported file", xml);
    expect(defences(imported, "Imported file", library)).toBe("Resistances: Fire\nResistance (Necrotic)");
    expect(conditionTokens(imported, "Imported file", library).join(" ")).toContain("Necrotic");
  });
});

describe("sheet defences beyond the grouped lines", () => {
  let library: ElementLibrary;

  beforeAll(async () => {
    library = await homebrewLibrary();
  }, 120_000);

  it("orders the groups and gives a Condition with sheet text its own line", () => {
    const service = new CharacterService(undefined, library, { rng: seededRng(7) });
    const id = service.createCharacter("Ember").id;
    const dto = service.addItem(id, { itemId: HOMEBREW_ITEM, amount: 1, baseElementId: null });
    service.attuneItem(id, dto.items.at(-1)!.identifier, true);

    // Resistances, then immunities, then vulnerabilities, then the Conditions
    // that speak for themselves; a group with nothing in it is left out.
    expect(defences(service, id, library)).toBe(
      [
        "Resistances: Fire",
        "Vulnerabilities: Cold",
        "Fire damage you take is reduced by 2.",
        "Advantages. Poison Saves",
      ].join("\n"),
    );
  });
});
