/**
 * An empty choice is judged as of the level that granted it. A multi-level
 * level-up (Warlock 1->5 in one go) leaves the level-2 invocations open at
 * level 5; they still may not take a "5th level" invocation, while the
 * level-5 choice may. A filled choice is a swap and is judged as of now.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { freshService, ID, select, sharedLibrary, STANDARD_ARRAY } from "../testing/character-factory.js";
import { pendingSelectionRules, selectionOptions, selectionRuleFor } from "./selection.js";

const WARLOCK = "ID_WOTC_PHB_CLASS_WARLOCK";
const MIRE_THE_MIND = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_MIRE_THE_MIND";
const ARMOR_OF_SHADOWS = "ID_WOTC_PHB_CLASS_FEATURE_ELDRITCH_INVOCATION_ARMOR_OF_SHADOWS";

let library: ElementLibrary;

beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

function warlock5() {
  const service = freshService(library);
  const id = "Warlock5";
  service.createCharacter(id);
  service.setAbilities(id, { ...STANDARD_ARRAY, charisma: 16 });
  select(service, id, "Race", ID.RACE_DWARF);
  select(service, id, "Sub Race", ID.SUB_RACE_HILL_DWARF);
  select(service, id, "Class", WARLOCK);
  for (let level = 2; level <= 5; level++) service.levelUp(id);
  return { service, id };
}

function invocationRule(service: ReturnType<typeof warlock5>["service"], id: string, level: number) {
  const rule = pendingSelectionRules(service.getCharacter(id))
    .find((candidate) => candidate.name === `Eldritch Invocation (Level ${level})`);
  if (rule === undefined) throw new Error(`no open level-${level} invocation`);
  return rule;
}

describe("choices left open by a multi-level level-up", () => {
  it("offer what the granting level allows", () => {
    const { service, id } = warlock5();
    const options = (level: number) =>
      selectionOptions(service.getCharacter(id), library, invocationRule(service, id, level)).map((option) => option.id);
    expect(options(2)).toContain(ARMOR_OF_SHADOWS);
    expect(options(2)).not.toContain(MIRE_THE_MIND);
    expect(options(5)).toContain(MIRE_THE_MIND);
    expect(() => service.setSelection(id, invocationRule(service, id, 2).identifier, MIRE_THE_MIND)).toThrowError(/not eligible/);
  });

  it("let a filled choice be swapped for what the current level allows", () => {
    const { service, id } = warlock5();
    const ruleId = invocationRule(service, id, 2).identifier;
    service.setSelection(id, ruleId, ARMOR_OF_SHADOWS);
    const filled = selectionRuleFor(service.getCharacter(id), ruleId)!;
    expect(selectionOptions(service.getCharacter(id), library, filled).map((option) => option.id)).toContain(MIRE_THE_MIND);
    expect(() => service.setSelection(id, ruleId, MIRE_THE_MIND)).not.toThrow();
  });
});
