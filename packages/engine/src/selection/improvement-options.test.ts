/**
 * The level-4+ Improvement Option choice offers both generated variants: the
 * Ability Score Improvement clone and the Feat clone (gated on the feats
 * optional rule). The Feat clone is corpus content whose supports tags are
 * filled in by the library's improvement-option normalization.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectionOptions } from "./selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

function buildFighterAt4(): CharacterService {
  const service = new CharacterService(undefined, library);
  service.createCharacter("IMP");
  service.setAbilities("IMP", { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 });
  const state = service.getCharacter("IMP");
  const classRule = pendingSelectionRules(state).find((rule) => rule.type === "Class")!;
  service.setSelection("IMP", classRule.identifier, "ID_WOTC_PHB_CLASS_FIGHTER");
  service.levelUp("IMP");
  service.levelUp("IMP");
  service.levelUp("IMP");
  return service;
}

function improvementOptions(service: CharacterService): string[] {
  const state = service.getCharacter("IMP");
  const rule = pendingSelectionRules(state).find((candidate) => /^Improvement Option/.test(candidate.name ?? ""))!;
  return selectionOptions(state, library, rule).map((option) => option.name);
}

describe("improvement option feat clones", () => {
  it("gives every per-class feat clone the feat-select machinery", () => {
    const clone = library.byId.get("ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER")!;
    expect(clone.requirements).toBe("ID_INTERNAL_OPTION_ALLOW_FEATS");
    const featSelect = clone.rules.find((rule) => rule.kind === "select" && rule.type === "Feat");
    expect(featSelect).toBeDefined();
  });

  it("generates the feat clone when the content ships none (public profile)", async () => {
    const { createEmptyLibrary } = await import("../content/library.js");
    const { ingestContentFiles } = await import("../content/ingestion.js");
    const { encodeBase64 } = await import("../platform.js");
    const xml = `<elements>
      <element name="Ability Score Improvement" type="Class Feature" source="Homebrew" id="ID_HB_CLASS_FEATURE_TESTCLASS_ASI">
        <rules>
          <select type="Class Feature" name="Improvement Option (Testclass 4)" supports="Improvement Option,Testclass,4" level="4" />
        </rules>
      </element>
    </elements>`;
    const bare = createEmptyLibrary();
    await ingestContentFiles(bare, [
      { path: "imports/testclass.xml", base64: encodeBase64(new TextEncoder().encode(xml)) },
    ]);
    const clone = bare.byId.get("ID_INTERNAL_CLASS_FEATURE_FEAT_4_TESTCLASS");
    expect(clone).toBeDefined();
    expect(clone!.identity.name).toBe("Feat (4)");
    expect(clone!.supports).toEqual(expect.arrayContaining(["Improvement Option", "Testclass", "4"]));
    expect(clone!.requirements).toBe("ID_INTERNAL_OPTION_ALLOW_FEATS");
    expect(clone!.rules.some((rule) => rule.kind === "select" && rule.type === "Feat")).toBe(true);
  });
});

describe("improvement options", () => {
  it("offers both the ability score improvement and the feat variant", () => {
    const service = buildFighterAt4();
    const names = improvementOptions(service);
    expect(names).toContain("Ability Score Improvement (4)");
    expect(names).toContain("Feat (4)");
  });

  it("drops the feat variant when the feats optional rule is disabled", () => {
    const service = buildFighterAt4();
    service.setCharacterOption("IMP", { optionId: "ID_INTERNAL_OPTION_ALLOW_FEATS", enabled: false });
    const names = improvementOptions(service);
    expect(names).toContain("Ability Score Improvement (4)");
    expect(names).not.toContain("Feat (4)");
  });
});
