/**
 * Advantage on initiative. Content marks it with a rule-less marker grant
 * (`ID_INTERNAL_GRANTS_INITIATIVE_ADVANTAGE`) on Feral Instinct, the 2024
 * Champion's Remarkable Athlete, the 2024 Assassin's Assassinate, the Scout's
 * Ambush Master, the Sentinel Shield and the Weapon of Warning; a few magic
 * items say it only in their description. The marker counts only while the
 * element granting it is active: an item while it conveys its benefits, a
 * class feature once its level is reached and while it is not replaced. The
 * printed sheet ticks its initiative advantage circle and the app marks its
 * initiative from the same answer.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { CharacterService } from "../character/service.js";
import type { CharacterState } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildCharacterDetail } from "../selection/detail.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { seededRng, sharedLibrary } from "../testing/character-factory.js";
import { initiativeAdvantageSources } from "./calculator.js";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/coverage/characters/", import.meta.url));
const SENTINEL_SHIELD = "ID_WOTC_DMG_MAGIC_ITEM_SENTINEL_SHIELD";
const WEAPON_OF_WARNING = "ID_WOTC_DMG_MAGIC_ITEM_WEAPON_OF_WARNING";
const PEREGRINE_MASK = "ID_WOTC_GGTR_MAGIC_ITEM_PEREGRINE_MASK";
const REMARKABLE_ATHLETE_REPLACED = "ID_INTERNAL_PHB24_FEATURE_REPLACEMENT_FIGHTER_CHAMPION_REMARKABLE_ATHLETE";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

const advantageValue = (state: CharacterState): string | undefined =>
  buildCharacterSheetModel(state, library, { mode: "lite" }).formValues?.["details_initiative_advantage"];

async function fixture(name: string): Promise<{ service: CharacterService; id: string }> {
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  const state = service.importCharacterXml(name, await readFile(join(FIXTURES, `${name}.dnd5e`), "utf8"));
  return { service, id: state.id };
}

function withItem(itemId: string, baseElementId?: string): { service: CharacterService; id: string; identifier: string } {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter("Initiative Item").id;
  service.addItem(id, { itemId, amount: 1, baseElementId: baseElementId ?? null });
  const identifier = service.getCharacter(id).items.at(-1)!.identifier;
  return { service, id, identifier };
}

/** A 2024 character of `className` at `level`, taking `subclass` when offered. */
function character2024(className: string, level: number, subclass?: string): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library, { rng: seededRng(7) });
  const id = service.createCharacter("Initiative 2024").id;
  service.setRulesetMode(id, "2024");
  service.setAbilities(id, { strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14 });
  const classRule = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, `ID_WOTC_PHB24_CLASS_${className}`);
  while (service.getCharacter(id).level < level) service.levelUp(id);
  if (subclass !== undefined) {
    const archetype = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Archetype")!;
    service.setSelection(id, archetype.identifier, subclass);
  }
  return { service, id };
}

describe("initiative advantage on the printed sheet", () => {
  it("ticks for a barbarian's Feral Instinct and an attuned Weapon of Warning, not for a paladin", async () => {
    const barbarian = await fixture("barbarian-8");
    expect(advantageValue(barbarian.service.getCharacter(barbarian.id))).toBe("true");
    const rangerRogue = await fixture("ranger-rogue-8");
    expect(advantageValue(rangerRogue.service.getCharacter(rangerRogue.id))).toBe("true");
    const paladin = await fixture("paladin-7");
    expect(advantageValue(paladin.service.getCharacter(paladin.id))).toBe("");
  }, 120_000);

  it("names the granting feature or item as the source", async () => {
    const barbarian = await fixture("barbarian-8");
    expect(initiativeAdvantageSources(barbarian.service.getCharacter(barbarian.id), library)).toEqual([
      { id: "ID_WOTC_PHB_CLASS_FEATURE_BARBARIAN_FERAL_INSTINCT", name: "Feral Instinct" },
    ]);
    const rangerRogue = await fixture("ranger-rogue-8");
    expect(initiativeAdvantageSources(rangerRogue.service.getCharacter(rangerRogue.id), library)).toEqual([
      { id: WEAPON_OF_WARNING, name: "Weapon of Warning" },
    ]);
  }, 120_000);

  it("counts a Weapon of Warning only while it is attuned", async () => {
    const { service, id } = await fixture("ranger-rogue-8");
    const warning = service.getCharacter(id).items.find((item) => item.adorners.includes(WEAPON_OF_WARNING))!;
    expect(warning.equipped).toBe(true);
    expect(warning.attuned).toBe(true);
    service.attuneItem(id, warning.identifier, false);
    const unattuned = service.getCharacter(id);
    expect(unattuned.items.find((item) => item.identifier === warning.identifier)!.equipped).toBe(true);
    expect(advantageValue(unattuned)).toBe("");
    service.attuneItem(id, warning.identifier, true);
    expect(advantageValue(service.getCharacter(id))).toBe("true");
  }, 120_000);

  it("counts a Sentinel Shield while it is equipped, not once it is unequipped or stowed", () => {
    // The app adds the shield over the base shield it offers, which equips it.
    const { service, id, identifier } = withItem(SENTINEL_SHIELD, "ID_WOTC_GEAR_SHIELD");
    const shield = () => service.getCharacter(id).items.find((item) => item.identifier === identifier)!;
    expect(shield()).toMatchObject({ itemId: "ID_WOTC_GEAR_SHIELD", adorners: [SENTINEL_SHIELD], equipped: true });
    expect(advantageValue(service.getCharacter(id))).toBe("true");
    expect(initiativeAdvantageSources(service.getCharacter(id), library)).toEqual([
      { id: SENTINEL_SHIELD, name: "Sentinel Shield" },
    ]);
    service.equipItem(id, identifier, "none");
    expect(advantageValue(service.getCharacter(id))).toBe("");
    service.equipItem(id, identifier, "secondary");
    expect(advantageValue(service.getCharacter(id))).toBe("true");
    service.setItemStorage(id, identifier, "#1");
    expect(shield().storage).toBe("#1");
    expect(advantageValue(service.getCharacter(id))).toBe("");
  }, 120_000);

  it("counts an item whose advantage is only in its description once it is attuned", () => {
    // A wondrous item has no hand or armour slot, so attunement is its gate.
    const { service, id, identifier } = withItem(PEREGRINE_MASK);
    expect(advantageValue(service.getCharacter(id))).toBe("");
    service.attuneItem(id, identifier, true);
    expect(advantageValue(service.getCharacter(id))).toBe("true");
    expect(initiativeAdvantageSources(service.getCharacter(id), library)).toEqual([
      { id: PEREGRINE_MASK, name: "Peregrine Mask" },
    ]);
    // Stowed, an attuned item conveys nothing.
    service.setItemStorage(id, identifier, "#1");
    expect(service.getCharacter(id).items.find((item) => item.identifier === identifier)!.attuned).toBe(true);
    expect(advantageValue(service.getCharacter(id))).toBe("");
  }, 120_000);

  it("ticks for the 2024 Champion's Remarkable Athlete from level 3", () => {
    const { service, id } = character2024("FIGHTER", 3, "ID_WOTC_PHB24_ARCHETYPE_FIGHTER_CHAMPION");
    expect(advantageValue(service.getCharacter(id))).toBe("true");
    expect(initiativeAdvantageSources(service.getCharacter(id), library).map((source) => source.name)).toEqual(["Remarkable Athlete"]);
    service.delevel(id, { mode: "last" });
    expect(service.getCharacter(id).level).toBe(2);
    expect(advantageValue(service.getCharacter(id))).toBe("");
  }, 120_000);

  it("does not tick for a replaced Remarkable Athlete", () => {
    const { service, id } = character2024("FIGHTER", 3, "ID_WOTC_PHB24_ARCHETYPE_FIGHTER_CHAMPION");
    const state = service.getCharacter(id);
    state.elements.push({ type: "Grants", name: "Remarkable Athlete Feature Replacement", id: REMARKABLE_ATHLETE_REPLACED, children: [] });
    state.sum.elements.push({ type: "Grants", id: REMARKABLE_ATHLETE_REPLACED });
    expect(advantageValue(state)).toBe("");
  }, 120_000);

  it("ticks for the 2024 Assassin's Assassinate at level 3", () => {
    const { service, id } = character2024("ROGUE", 3, "ID_WOTC_PHB24_ARCHETYPE_ROGUE_ASSASSIN");
    expect(advantageValue(service.getCharacter(id))).toBe("true");
    expect(initiativeAdvantageSources(service.getCharacter(id), library).map((source) => source.name)).toEqual(["Assassinate"]);
  }, 120_000);

  it("ticks for the 2024 Barbarian's Feral Instinct from level 7", () => {
    const { service, id } = character2024("BARBARIAN", 6);
    expect(advantageValue(service.getCharacter(id))).toBe("");
    service.levelUp(id);
    expect(service.getCharacter(id).level).toBe(7);
    expect(advantageValue(service.getCharacter(id))).toBe("true");
    expect(initiativeAdvantageSources(service.getCharacter(id), library).map((source) => source.name)).toEqual(["Feral Instinct"]);
  }, 120_000);
});

describe("initiative advantage in the character detail", () => {
  it("reports advantage and its sources, or none", async () => {
    const barbarian = await fixture("barbarian-8");
    expect(buildCharacterDetail(barbarian.service.getCharacter(barbarian.id), library)).toMatchObject({
      initiativeAdvantage: true,
      initiativeAdvantageSources: ["Feral Instinct"],
    });
    const paladin = await fixture("paladin-7");
    expect(buildCharacterDetail(paladin.service.getCharacter(paladin.id), library)).toMatchObject({
      initiativeAdvantage: false,
      initiativeAdvantageSources: [],
    });
  }, 120_000);

  it("reports no advantage without a library", () => {
    const service = new CharacterService(undefined, library);
    const state = service.createCharacter("No Library");
    expect(buildCharacterDetail(state)).toMatchObject({ initiativeAdvantage: false, initiativeAdvantageSources: [] });
  });
});
