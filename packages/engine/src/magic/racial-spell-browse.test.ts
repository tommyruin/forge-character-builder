/**
 * Racial spell selects have no ancestor spellcasting feature and therefore no
 * caster block, yet they are legitimate Spell rules: their supports expression
 * (an explicit id list, or a "<list>,<level>" tag pair) already bounds the
 * browsable universe. The browse must serve them from the rule's own options
 * instead of demanding a caster.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { type CharacterService } from "../character/service.js";
import { buildCharacter, ID, ruleOfName } from "../testing/character-factory.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function spellRule(service: CharacterService, id: string, name: string): { identifier: string } {
  return ruleOfName(
    pendingSelectionRules(service.getCharacter(id)).filter((rule) => rule.type === "Spell"),
    name,
  );
}

describe("racial spell selects without a caster", () => {
  it("browses the High Elf wizard cantrip on a non-caster", () => {
    const { service, id } = buildCharacter(library, {
      id: "high-elf-fighter",
      raceId: ID.RACE_ELF,
      subRaceId: ID.SUB_RACE_HIGH_ELF,
      classId: ID.CLASS_FIGHTER,
    });
    const rule = spellRule(service, id, "Wizard Cantrip (High Elf)");

    const browse = service.getSpellBrowse(id, rule.identifier);
    expect(browse.spellcastingName).toBeNull();
    expect(browse.selectionCount).toBe(1);
    expect(browse.spells.length).toBeGreaterThan(0);
    expect(browse.spells.every((spell) => spell.level === 0)).toBe(true);
    expect(browse.maxSpellLevel).toBe(0);

    const firebolt = browse.spells.find((spell) => spell.id === "ID_PHB_SPELL_FIRE_BOLT");
    expect(firebolt?.status).toBe("learnable");
  });

  it("selects a browsed racial cantrip and reports it selected", () => {
    const { service, id } = buildCharacter(library, {
      id: "high-elf-fighter-pick",
      raceId: ID.RACE_ELF,
      subRaceId: ID.SUB_RACE_HIGH_ELF,
      classId: ID.CLASS_FIGHTER,
    });
    const rule = spellRule(service, id, "Wizard Cantrip (High Elf)");
    service.setSelection(id, rule.identifier, "ID_PHB_SPELL_FIRE_BOLT");

    const browse = service.getSpellBrowse(id, rule.identifier);
    expect(browse.selectedCount).toBe(1);
    expect(browse.slots[0]?.spellId).toBe("ID_PHB_SPELL_FIRE_BOLT");
    const firebolt = browse.spells.find((spell) => spell.id === "ID_PHB_SPELL_FIRE_BOLT");
    expect(firebolt?.status).toBe("selected");
    const other = browse.spells.find((spell) => spell.id !== "ID_PHB_SPELL_FIRE_BOLT");
    expect(other?.status).toBe("limit");
  });

  it("browses the Astral Elf Astral Fire cantrip from its explicit supports list", () => {
    const { service, id } = buildCharacter(library, {
      id: "astral-elf-fighter",
      raceId: "ID_WOTC_AAG_RACE_ASTRAL_ELF",
      subRaceId: "",
      classId: ID.CLASS_FIGHTER,
    });
    const rule = spellRule(service, id, "Cantrip (Astral Fire)");

    const browse = service.getSpellBrowse(id, rule.identifier);
    const ids = browse.spells.map((spell) => spell.id);
    expect(ids).toContain("ID_PHB_SPELL_SACRED_FLAME");
    expect(browse.spells.every((spell) => spell.level === 0)).toBe(true);
    // Only the trait's supported cantrips browse — not the full cantrip list.
    expect(ids).not.toContain("ID_PHB_SPELL_FIRE_BOLT");
  });
});
