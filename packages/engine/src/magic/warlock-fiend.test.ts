/**
 * Warlock + Fiend patron spellcasting behavior:
 * - the patron's `<spellcasting name="Warlock" extend="true">` block is a
 *   spell-list extension, not a second caster;
 * - the expanded-list spells (Burning Hands, Command) are selectable by the
 *   level-1 "Spellcasting (Warlock)" rule and browse as learnable;
 * - spell attack/DC project proficiency + Charisma modifier;
 * - replacing the class prunes the Warlock caster block (and its spells)
 *   from the magic region.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { selectionOptions, selectionRuleFor } from "../selection/selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const WARLOCK = "ID_WOTC_PHB_CLASS_WARLOCK";
const FIEND = "ID_WOTC_PHB_ARCHETYPE_OTHERWORLDLY_PATRON_FIEND";
const WIZARD = "ID_WOTC_PHB_CLASS_WIZARD";
const BURNING_HANDS = "ID_PHB_SPELL_BURNING_HANDS";
const COMMAND = "ID_PHB_SPELL_COMMAND";
const SCORCHING_RAY = "ID_PHB_SPELL_SCORCHING_RAY";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

/** A fresh level-1 Warlock with the Fiend patron registered. */
function fiendWarlock(): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library);
  const id = "warlock-fiend";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 8, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 16,
  });
  const detail = service.getCharacterDetail(id);
  const classRule = detail.selectionRules.find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, WARLOCK, 1);
  const afterClass = service.getCharacterDetail(id);
  const patronRule = afterClass.selectionRules.find((rule) => rule.type === "Archetype")!;
  service.setSelection(id, patronRule.identifier, FIEND, 1);
  return { service, id };
}

function spellRule(service: CharacterService, id: string): { identifier: string } {
  const detail = service.getCharacterDetail(id);
  return detail.selectionRules.find(
    (rule) => rule.type === "Spell" && rule.name.startsWith("Spellcasting (Warlock)"),
  )!;
}

describe("warlock with the Fiend patron", () => {
  it("registers exactly one Warlock caster block", () => {
    const { service, id } = fiendWarlock();
    const state = service.getCharacter(id);
    const warlockBlocks = state.magic!.casters.filter((block) => block.name === "Warlock");
    expect(state.magic!.casters).toHaveLength(1);
    expect(warlockBlocks).toHaveLength(1);
    expect(warlockBlocks[0]!.ability).toBe("Charisma");

    const casters = service.getSpellcasting(id);
    expect(casters).toHaveLength(1);
    expect(casters[0]!.name).toBe("Warlock");
  });

  it("projects attack = proficiency + cha mod and dc = 8 + proficiency + cha mod", () => {
    const { service, id } = fiendWarlock();
    const casters = service.getSpellcasting(id);
    expect(casters[0]!.attackModifier).toBe(2 + 3);
    expect(casters[0]!.saveDc).toBe(8 + 2 + 3);
  });

  it("offers the expanded-list spells to the level-1 spell rule", () => {
    const { service, id } = fiendWarlock();
    const rule = spellRule(service, id);
    const state = service.getCharacter(id);
    const options = selectionOptions(state, library, selectionRuleFor(state, rule.identifier)!)
      .map((option) => option.id);
    expect(options).toContain(BURNING_HANDS);
    expect(options).toContain(COMMAND);
    // The level-2 expanded spells stay out of a level-1 picker.
    expect(options).not.toContain(SCORCHING_RAY);
  });

  it("browses the expanded-list spells as learnable and higher levels as level-gated", () => {
    const { service, id } = fiendWarlock();
    const rule = spellRule(service, id);
    const browse = service.getSpellBrowse(id, rule.identifier);
    const byId = new Map(browse.spells.map((spell) => [spell.id, spell]));
    expect(byId.get(BURNING_HANDS)?.status).toBe("learnable");
    expect(byId.get(COMMAND)?.status).toBe("learnable");
    expect(byId.get(SCORCHING_RAY)?.status).toBe("level");
    expect(browse.activeSpellLevels).toEqual([1]);
    expect(browse.maxSpellLevel).toBe(1);
  });

  it("selects an expanded-list spell and prunes it when the class changes", () => {
    const { service, id } = fiendWarlock();
    const rule = spellRule(service, id);
    service.setSelection(id, rule.identifier, COMMAND, 1);

    const withSpell = service.getCharacter(id);
    const warlock = withSpell.magic!.casters.find((block) => block.name === "Warlock")!;
    expect(warlock.spells.map((spell) => spell.id)).toContain(COMMAND);

    const detail = service.getCharacterDetail(id);
    const classRule = detail.selectionRules.find((r) => r.type === "Class")!;
    service.setSelection(id, classRule.identifier, WIZARD, 1);

    const after = service.getCharacter(id);
    const names = (after.magic?.casters ?? []).map((block) => block.name);
    expect(names).not.toContain("Warlock");
    for (const block of after.magic?.casters ?? []) {
      expect(block.spells.map((spell) => spell.id)).not.toContain(COMMAND);
    }
  });
});
