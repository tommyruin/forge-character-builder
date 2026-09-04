/**
 * Feature-granted spells reaching the spell pages.
 *
 * The 2024 corpus writes its always-prepared grants without the `prepared`
 * attribute the 2014 content used — `<grant type="Spell" spellcasting="X"/>`
 * on the class feature or subclass feature — so Divine Smite, Find Steed and
 * every subclass expanded list were invisible to the caster projection. The
 * grants count when the target actually registered under the granting node,
 * which is where the rule's `level=` and `<requirements>` gates were applied.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { seededRng, sharedLibrary } from "../testing/character-factory.js";

const PALADIN = "ID_WOTC_PHB24_CLASS_PALADIN";
const SORCERER = "ID_WOTC_PHB24_CLASS_SORCERER";
const DRACONIC = "ID_WOTC_PHB24_ARCHETYPE_SORCERER_DRACONIC_SORCERY";
const DEVOTION = "ID_WOTC_PHB24_ARCHETYPE_PALADIN_OATH_OF_DEVOTION";
const DIVINE_SMITE = "ID_WOTC_PHB24_SPELL_DIVINE_SMITE";
const CHROMATIC_ORB = "ID_WOTC_PHB24_SPELL_CHROMATIC_ORB";
const FEAR = "ID_WOTC_PHB24_SPELL_FEAR";
const SHIELD_OF_FAITH = "ID_WOTC_PHB24_SPELL_SHIELD_OF_FAITH";
const AID = "ID_WOTC_PHB24_SPELL_AID";
const ZONE_OF_TRUTH = "ID_WOTC_PHB24_SPELL_ZONE_OF_TRUTH";
const BEACON_OF_HOPE = "ID_WOTC_PHB24_SPELL_BEACON_OF_HOPE";

const ABILITIES = { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 };

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

/** A 2024-rules character at `levels`, with `archetype` picked at level 3. */
function build2024(
  label: string,
  classId: string,
  levels: number,
  archetype?: string,
): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  const id = service.createCharacter(label).id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, ABILITIES);
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find(
      (candidate) => candidate.type === type && !candidate.hasSelection,
    );
    if (!rule) throw new Error(`${label}: no pending ${type} rule`);
    service.setSelection(id, rule.identifier, elementId);
  };
  pick("Race", "ID_WOTC_PHB24_RACE_HUMAN");
  pick("Class", classId);
  pick("Background", "ID_WOTC_PHB24_BACKGROUND_SOLDIER");
  for (let level = 2; level <= levels; level++) {
    service.levelUp(id);
    if (level === 3 && archetype !== undefined) pick("Archetype", archetype);
  }
  return { service, id };
}

/** Every token of every spell-list section, joined. */
function spellListText(service: CharacterService, id: string): string {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  return model.pages
    .filter((page) => page.templateKind === "spell-list")
    .flatMap((page) => page.sections)
    .flatMap((section) => section.rows)
    .flatMap((row) => (row.kind === "tokens" ? [...row.tokens] : []))
    .join(" ");
}

/** The titles of the spell description cards. */
function spellCardTitles(service: CharacterService, id: string): string[] {
  const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
  return model.pages
    .filter((page) => page.templateKind === "spell-cards")
    .flatMap((page) => page.sections)
    .map((section) => (section.rows[0]?.kind === "tokens" ? section.rows[0].tokens.join(" ") : ""));
}

describe("2024 spell grants without prepared=\"true\"", () => {
  it("leaves Divine Smite off a level-1 Paladin", () => {
    const { service, id } = build2024("Paladin1", PALADIN, 1);
    const caster = service.getSpellcasting(id)[0]!;
    expect(caster.knownSpells.map((spell) => spell.id)).not.toContain(DIVINE_SMITE);
  });

  it("projects Divine Smite as always prepared from level 2 without spending a preparation", () => {
    const { service, id } = build2024("Paladin2", PALADIN, 2);
    const caster = service.getSpellcasting(id)[0]!;
    const smite = caster.knownSpells.find((spell) => spell.id === DIVINE_SMITE);

    expect(smite).toBeDefined();
    expect(smite!.isAlwaysPrepared).toBe(true);
    expect(smite!.isPrepared).toBe(false);
    expect(smite!.isChosen).toBe(true);
    // Always-prepared grants are free: they never count against the limit.
    expect(caster.currentPreparedCount).toBe(0);
  });

  it("prints Divine Smite on the spell list and gives it a card", () => {
    const { service, id } = build2024("Paladin2Sheet", PALADIN, 2);
    const tokens = spellListText(service, id);
    expect(tokens).toContain("Divine");
    expect(tokens).toContain("(Always");
    expect(spellCardTitles(service, id)).toContain("Divine Smite");
  });

  it("unions the subclass list into a known caster's spells", () => {
    const { service, id } = build2024("Draconic3", SORCERER, 3, DRACONIC);
    const caster = service.getSpellcasting(id)[0]!;
    const granted = caster.knownSpells.filter((spell) => spell.isAlwaysPrepared).map((spell) => spell.name);

    // The level-3 rows of the Draconic Spells table, in DTO order.
    expect(granted).toEqual(["Chromatic Orb", "Command", "Alter Self", "Dragon's Breath"]);
    expect(caster.knownSpells.find((spell) => spell.id === CHROMATIC_ORB)!.isAlwaysPrepared).toBe(true);
  });

  it("holds a level-gated grant back until its level", () => {
    // Fear is granted `level="5"`, so it is not registered at level 3 and must
    // not project; reading the registration back is what keeps the projection
    // honest, without re-implementing the level gate here.
    const { service, id } = build2024("Draconic3Fear", SORCERER, 3, DRACONIC);
    const caster = service.getSpellcasting(id)[0]!;
    expect(caster.knownSpells.map((spell) => spell.id)).toContain(CHROMATIC_ORB);
    expect(caster.knownSpells.map((spell) => spell.id)).not.toContain(FEAR);
  });

  it("projects the level-gated grant once its level registers it", () => {
    const { service, id } = build2024("Draconic5", SORCERER, 5, DRACONIC);
    const caster = service.getSpellcasting(id)[0]!;
    const fear = caster.knownSpells.find((spell) => spell.id === FEAR);

    expect(fear).toBeDefined();
    expect(fear!.isAlwaysPrepared).toBe(true);
    expect(caster.knownSpells.map((spell) => spell.id)).toContain(CHROMATIC_ORB);
    // Projection follows registration: level 5 really registered the spell
    // under the feature that grants it.
    expect(service.getCharacterDetail(id).registeredElements.map((entry) => entry.id)).toContain(FEAR);
    expect(caster.currentPreparedCount).toBe(0);
    expect(spellListText(service, id)).toContain("Fear");
  });

  it("gives an Oath of Devotion paladin its 5th-level oath spells", () => {
    const { service, id } = build2024("Devotion5", PALADIN, 5, DEVOTION);
    const granted = service
      .getSpellcasting(id)[0]!
      .knownSpells.filter((spell) => spell.isAlwaysPrepared)
      .map((spell) => spell.id);

    // The 3rd- and 5th-level rows of the Oath Spells table; the 9th-level row
    // stays out until level 9.
    expect(granted).toContain(SHIELD_OF_FAITH);
    expect(granted).toContain(AID);
    expect(granted).toContain(ZONE_OF_TRUTH);
    expect(granted).not.toContain(BEACON_OF_HOPE);
    expect(service.getSpellcasting(id)[0]!.currentPreparedCount).toBe(0);
  });

  it("takes the level-gated grant back on delevel and restores it on undo", () => {
    const { service, id } = build2024("Draconic5Down", SORCERER, 5, DRACONIC);

    service.levelDown(id);
    expect(service.getCharacter(id).level).toBe(4);
    expect(service.getSpellcasting(id)[0]!.knownSpells.map((spell) => spell.id)).not.toContain(FEAR);
    expect(service.getCharacterDetail(id).registeredElements.map((entry) => entry.id)).not.toContain(FEAR);
    expect(() => service.exportCharacterXml(id)).not.toThrow();

    service.undoDelevel(id);
    expect(service.getCharacter(id).level).toBe(5);
    expect(service.getSpellcasting(id)[0]!.knownSpells.map((spell) => spell.id)).toContain(FEAR);
  });

  it("leaves the exported document untouched", () => {
    const { service, id } = build2024("PaladinExport", PALADIN, 2);
    const before = service.exportCharacterXml(id);
    service.getSpellcasting(id);
    expect(service.exportCharacterXml(id)).toBe(before);
  });
});
