/**
 * Spell browse ruleset/source exclusion: spells outside the character's
 * ruleset mode (and spells from restricted sources) are pruned from the
 * browse universe entirely — they never appear as "unavailable" rows.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, rulesetOf, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "third-party", "elements");

const WARLOCK = "ID_WOTC_PHB_CLASS_WARLOCK";

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

/** A fresh level-1 Warlock locked to the 2014 ruleset. */
function warlock2014(): { service: CharacterService; id: string } {
  const service = new CharacterService(undefined, library);
  const id = "warlock-2014";
  service.createCharacter(id);
  service.setAbilities(id, {
    strength: 8, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 16,
  });
  service.setRulesetMode(id, "2014");
  const detail = service.getCharacterDetail(id);
  const classRule = detail.selectionRules.find((rule) => rule.type === "Class")!;
  service.setSelection(id, classRule.identifier, WARLOCK, 1);
  return { service, id };
}

function ruleNamed(service: CharacterService, id: string, prefix: string): { identifier: string } {
  const detail = service.getCharacterDetail(id);
  return detail.selectionRules.find(
    (rule) => rule.type === "Spell" && rule.name.startsWith(prefix),
  )!;
}

describe("spell browse under the 2014 ruleset", () => {
  it("prunes 2024 spells from the spell browse instead of listing them unavailable", () => {
    const { service, id } = warlock2014();
    const rule = ruleNamed(service, id, "Spellcasting (Warlock)");
    const browse = service.getSpellBrowse(id, rule.identifier);
    expect(browse.spells.length).toBeGreaterThan(0);
    const offRuleset = browse.spells.filter((spell) => rulesetOf(library, spell.id) === "2024");
    expect(offRuleset.map((spell) => spell.id)).toEqual([]);
  });

  it("prunes 2024 cantrips from the cantrip browse", () => {
    const { service, id } = warlock2014();
    const rule = ruleNamed(service, id, "Cantrip");
    const browse = service.getSpellBrowse(id, rule.identifier);
    expect(browse.spells.length).toBeGreaterThan(0);
    const offRuleset = browse.spells.filter((spell) => rulesetOf(library, spell.id) === "2024");
    expect(offRuleset.map((spell) => spell.id)).toEqual([]);
  });
});
