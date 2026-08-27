/**
 * DM grants: our design surface (there is no grants endpoint).
 * Element registration follows the planItemEdits raw-edit pattern
 * (character/options.ts); spell grants reuse the service's addGrantedSpell.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import {
  planGrantedFeatEdits,
  planGrantedAbilityScoreEdits,
  buildDmGrantsDto,
  type DmGrantsDto,
} from "./grants.js";
import { planAddAdditionalSpell, planRemoveAdditionalSpell } from "../magic/planners.js";
import { ID, buildCharacter, ruleOfName } from "../testing/character-factory.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

let lib: ElementLibrary;
beforeAll(async () => {
  lib = await buildCorpusLibrary();
}, 120_000);

async function freshService(): Promise<CharacterService> {
  return new CharacterService(undefined, lib);
}

const FEAT_ALERT = "ID_PHB_FEAT_ALERT";
const ASI_STRENGTH = "ID_INTERNAL_ASI_STRENGTH";
const ASI_CONSTITUTION = "ID_INTERNAL_ASI_CONSTITUTION";

describe("granted feats", () => {
  it("registers a granted feat into the elements tree, sum and registered count", async () => {
    const service = await freshService();
    service.createCharacter("G1");
    const before = service.getCharacter("G1");
    const edits = planGrantedFeatEdits(service.documentOf("G1"), before, lib, FEAT_ALERT, "add");
    service.applyRegionEdits("G1", edits);
    const after = service.getCharacter("G1");
    const node = after.elements.find((n) => n.id === FEAT_ALERT);
    expect(node).toBeDefined();
    expect(node!.type).toBe("Feat");
    expect(node!.name).toBe("Alert");
    expect(after.sum.elements.some((e) => e.id === FEAT_ALERT)).toBe(true);
    expect(after.registeredCount).toBe(before.registeredCount + 1);
    expect(after.sum.elementCount).toBe(before.sum.elementCount + 1);
  });

  it("rejects a duplicate grant with a conflict error", async () => {
    const service = await freshService();
    service.createCharacter("G2");
    const state = service.getCharacter("G2");
    const edits = planGrantedFeatEdits(service.documentOf("G2"), state, lib, FEAT_ALERT, "add");
    service.applyRegionEdits("G2", edits);
    const after = service.getCharacter("G2");
    expect(() => planGrantedFeatEdits(service.documentOf("G2"), after, lib, FEAT_ALERT, "add")).toThrow(/already granted/i);
  });

  it("removes a granted feat, its sum entry and decrements the counts", async () => {
    const service = await freshService();
    service.createCharacter("G3");
    const state = service.getCharacter("G3");
    service.applyRegionEdits("G3", planGrantedFeatEdits(service.documentOf("G3"), state, lib, FEAT_ALERT, "add"));
    const granted = service.getCharacter("G3");
    service.applyRegionEdits("G3", planGrantedFeatEdits(service.documentOf("G3"), granted, lib, FEAT_ALERT, "remove"));
    const after = service.getCharacter("G3");
    expect(after.elements.some((n) => n.id === FEAT_ALERT)).toBe(false);
    expect(after.sum.elements.some((e) => e.id === FEAT_ALERT)).toBe(false);
    expect(after.registeredCount).toBe(state.registeredCount);
    expect(after.sum.elementCount).toBe(state.sum.elementCount);
  });

  it("rejects removing a feat that was never granted", async () => {
    const service = await freshService();
    service.createCharacter("G4");
    const state = service.getCharacter("G4");
    expect(() => planGrantedFeatEdits(service.documentOf("G4"), state, lib, FEAT_ALERT, "remove")).toThrow(/not granted/i);
  });

  it("rejects unknown or non-feat ids", async () => {
    const service = await freshService();
    service.createCharacter("G5");
    const state = service.getCharacter("G5");
    expect(() => planGrantedFeatEdits(service.documentOf("G5"), state, lib, "ID_NOPE", "add")).toThrow(/not found/i);
    expect(() => planGrantedFeatEdits(service.documentOf("G5"), state, lib, ASI_STRENGTH, "add")).toThrow(/not found/i);
  });
});

describe("granted ability scores", () => {
  it("registers the same allow-duplicate ASI twice in one request for a +2", async () => {
    const service = await freshService();
    service.createCharacter("A5");
    const before = service.getCharacter("A5");
    const edits = planGrantedAbilityScoreEdits(service.documentOf("A5"), before, lib, [ASI_STRENGTH, ASI_STRENGTH], "add");
    service.applyRegionEdits("A5", edits);
    const after = service.getCharacter("A5");
    expect(after.sum.elements.filter((e) => e.id === ASI_STRENGTH)).toHaveLength(2);
    expect(after.registeredCount).toBe(before.registeredCount + 2);
    expect(after.sum.elementCount).toBe(before.sum.elementCount + 2);
  });

  it("grants another instance of an already-registered allow-duplicate ASI", async () => {
    const service = await freshService();
    service.createCharacter("A6");
    const before = service.getCharacter("A6");
    service.applyRegionEdits("A6", planGrantedAbilityScoreEdits(service.documentOf("A6"), before, lib, [ASI_STRENGTH], "add"));
    const between = service.getCharacter("A6");
    service.applyRegionEdits("A6", planGrantedAbilityScoreEdits(service.documentOf("A6"), between, lib, [ASI_STRENGTH], "add"));
    const after = service.getCharacter("A6");
    expect(after.sum.elements.filter((e) => e.id === ASI_STRENGTH)).toHaveLength(2);
  });

  it("registers a single granted ASI element", async () => {
    const service = await freshService();
    service.createCharacter("A1");
    const before = service.getCharacter("A1");
    service.applyRegionEdits("A1", planGrantedAbilityScoreEdits(service.documentOf("A1"), before, lib, [ASI_STRENGTH], "add"));
    const after = service.getCharacter("A1");
    const node = after.elements.find((n) => n.id === ASI_STRENGTH);
    expect(node).toBeDefined();
    expect(node!.type).toBe("Ability Score Improvement");
    expect(after.sum.elements.some((e) => e.id === ASI_STRENGTH)).toBe(true);
    expect(after.registeredCount).toBe(before.registeredCount + 1);
  });

  it("registers multiple ASI ids in one all-or-nothing operation", async () => {
    const service = await freshService();
    service.createCharacter("A2");
    const before = service.getCharacter("A2");
    const edits = planGrantedAbilityScoreEdits(service.documentOf("A2"), before, lib, [ASI_STRENGTH, ASI_CONSTITUTION], "add");
    service.applyRegionEdits("A2", edits);
    const after = service.getCharacter("A2");
    expect(after.sum.elements.some((e) => e.id === ASI_STRENGTH)).toBe(true);
    expect(after.sum.elements.some((e) => e.id === ASI_CONSTITUTION)).toBe(true);
    expect(after.registeredCount).toBe(before.registeredCount + 2);
    expect(after.sum.elementCount).toBe(before.sum.elementCount + 2);
  });

  it("leaves nothing registered when any id in the batch is invalid", async () => {
    const service = await freshService();
    service.createCharacter("A3");
    const before = service.getCharacter("A3");
    expect(() =>
      planGrantedAbilityScoreEdits(service.documentOf("A3"), before, lib, [ASI_STRENGTH, "ID_NOPE"], "add"),
    ).toThrow(/not found/i);
    const after = service.getCharacter("A3");
    expect(after.sum.elements.some((e) => e.id === ASI_STRENGTH)).toBe(false);
    expect(after.registeredCount).toBe(before.registeredCount);
  });

  it("removes one instance of a duplicated ASI at a time", async () => {
    const service = await freshService();
    service.createCharacter("A7");
    const before = service.getCharacter("A7");
    service.applyRegionEdits("A7", planGrantedAbilityScoreEdits(service.documentOf("A7"), before, lib, [ASI_STRENGTH, ASI_STRENGTH], "add"));
    const doubled = service.getCharacter("A7");
    service.applyRegionEdits("A7", planGrantedAbilityScoreEdits(service.documentOf("A7"), doubled, lib, [ASI_STRENGTH], "remove"));
    const single = service.getCharacter("A7");
    expect(single.sum.elements.filter((e) => e.id === ASI_STRENGTH)).toHaveLength(1);
    expect(single.registeredCount).toBe(before.registeredCount + 1);
    service.applyRegionEdits("A7", planGrantedAbilityScoreEdits(service.documentOf("A7"), single, lib, [ASI_STRENGTH], "remove"));
    const cleared = service.getCharacter("A7");
    expect(cleared.sum.elements.some((e) => e.id === ASI_STRENGTH)).toBe(false);
    expect(cleared.registeredCount).toBe(before.registeredCount);
  });

  it("removes granted ASIs and rejects un-granted ones", async () => {
    const service = await freshService();
    service.createCharacter("A4");
    const state = service.getCharacter("A4");
    service.applyRegionEdits("A4", planGrantedAbilityScoreEdits(service.documentOf("A4"), state, lib, [ASI_STRENGTH], "add"));
    const granted = service.getCharacter("A4");
    service.applyRegionEdits("A4", planGrantedAbilityScoreEdits(service.documentOf("A4"), granted, lib, [ASI_STRENGTH], "remove"));
    const after = service.getCharacter("A4");
    expect(after.sum.elements.some((e) => e.id === ASI_STRENGTH)).toBe(false);
    expect(after.registeredCount).toBe(state.registeredCount);
    expect(() => planGrantedAbilityScoreEdits(service.documentOf("A4"), after, lib, [ASI_STRENGTH], "remove")).toThrow(/not granted/i);
  });
});

describe("dm grants DTO", () => {
  it("excludes normal selection feats and ASIs from the dm-grant surface", async () => {
    // A feat taken through the level-4 improvement option is a nested
    // selection result inside the class's Feat wrapper — a registration,
    // not a DM grant.
    const { service, id } = buildCharacter(lib, { id: "D3", classId: ID.CLASS_FIGHTER, levels: 4 });
    service.setCharacterOption(id, { optionId: ID.OPTION_FEATS, enabled: true });

    const improvement = pendingSelectionRules(service.getCharacter(id))
      .find((rule) => /^Improvement Option/.test(rule.name ?? ""))!;
    service.setSelection(id, improvement.identifier, "ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER");
    const featRule = ruleOfName(pendingSelectionRules(service.getCharacter(id)), "Feat (FIGHTER 4)");
    service.setSelection(id, featRule.identifier, FEAT_ALERT);

    const state = service.getCharacter(id);
    expect(state.sum.elements.some((e) => e.id === FEAT_ALERT)).toBe(true);

    const dto: DmGrantsDto = buildDmGrantsDto(state, lib);
    expect(dto.some((entry) => entry.kind === "feat" && entry.id === FEAT_ALERT)).toBe(false);
    expect(() => planGrantedFeatEdits(service.documentOf(id), state, lib, FEAT_ALERT, "remove")).toThrow(/not granted/i);
  });

  it("limits spell grants to the Additional Spell source convention", async () => {
    // An <additional> spell carrying a granting feature's own name as its
    // source is a feature grant, not a DM grant, so it is neither listed
    // nor removable through the DM-grant surface.
    const { service, id } = buildCharacter(lib, { id: "D4", classId: ID.CLASS_FIGHTER });
    service.applyRegionEdits(id, planAddAdditionalSpell(
      service.documentOf(id), service.getCharacter(id), lib,
      "ID_PHB_SPELL_FOG_CLOUD", "Control Air and Water",
    ).edits);

    const state = service.getCharacter(id);
    const dto: DmGrantsDto = buildDmGrantsDto(state, lib);
    expect(dto.filter((entry) => entry.kind === "spell")).toEqual([]);
    expect(() => planRemoveAdditionalSpell(service.documentOf(id), state, "ID_PHB_SPELL_FOG_CLOUD")).toThrow(/is not granted/i);
  });

  it("removes a granted feat with its full subtree and restores the counts", async () => {
    const service = await freshService();
    service.createCharacter("D5");
    const state = service.getCharacter("D5");
    service.applyRegionEdits("D5", planGrantedFeatEdits(service.documentOf("D5"), state, lib, "ID_WOTC_DSDQ_FEAT_DIVINELY_FAVORED", "add"));
    const granted = service.getCharacter("D5");
    expect(granted.sum.elements.some((e) => e.id === "ID_PHB_SPELL_AUGURY")).toBe(true);
    const dto: DmGrantsDto = buildDmGrantsDto(granted, lib);
    expect(dto.some((entry) => entry.kind === "feat" && entry.id === "ID_WOTC_DSDQ_FEAT_DIVINELY_FAVORED")).toBe(true);
    service.applyRegionEdits("D5", planGrantedFeatEdits(service.documentOf("D5"), granted, lib, "ID_WOTC_DSDQ_FEAT_DIVINELY_FAVORED", "remove"));
    const after = service.getCharacter("D5");
    expect(after.sum.elements.some((e) => e.id === "ID_WOTC_DSDQ_FEAT_DIVINELY_FAVORED")).toBe(false);
    expect(after.sum.elements.some((e) => e.id === "ID_PHB_SPELL_AUGURY")).toBe(false);
    expect(after.registeredCount).toBe(state.registeredCount);
    expect(after.sum.elementCount).toBe(state.sum.elementCount);
  });

  it("lists granted feats, ability scores and spells", async () => {
    const { service, id: characterId } = buildCharacter(lib, { id: "D1", classId: ID.CLASS_FIGHTER });
    for (const spellId of ["ID_PHB_SPELL_FOG_CLOUD", "ID_PHB_SPELL_INVISIBILITY", "ID_PHB_SPELL_PASS_WITHOUT_TRACE"]) {
      service.addGrantedSpell(characterId, { spellId });
    }
    let state = service.getCharacter("D1");
    service.applyRegionEdits("D1", planGrantedFeatEdits(service.documentOf("D1"), state, lib, FEAT_ALERT, "add"));
    state = service.getCharacter("D1");
    service.applyRegionEdits("D1", planGrantedAbilityScoreEdits(service.documentOf("D1"), state, lib, [ASI_STRENGTH], "add"));
    const dto: DmGrantsDto = buildDmGrantsDto(service.getCharacter("D1"), lib);
    const spells = dto.filter((entry) => entry.kind === "spell");
    expect(spells).toEqual([
      { kind: "spell", id: "ID_PHB_SPELL_FOG_CLOUD", name: "Fog Cloud", source: "Additional Spell, Fog Cloud" },
      { kind: "spell", id: "ID_PHB_SPELL_INVISIBILITY", name: "Invisibility", source: "Additional Spell, Invisibility" },
      { kind: "spell", id: "ID_PHB_SPELL_PASS_WITHOUT_TRACE", name: "Pass without Trace", source: "Additional Spell, Pass without Trace" },
    ]);
    expect(dto).toContainEqual({ kind: "feat", id: FEAT_ALERT, name: "Alert", source: "Player’s Handbook" });
    expect(dto).toContainEqual({ kind: "ability", id: ASI_STRENGTH, name: "Strength", source: "Player’s Handbook" });
  });

  it("returns an empty list on a fresh character", async () => {
    const service = await freshService();
    service.createCharacter("D2");
    expect(buildDmGrantsDto(service.getCharacter("D2"), lib)).toEqual([]);
  });
});
