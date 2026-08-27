/**
 * Bracketed stat-path requirement atoms ([proficiency:2],
 * [innate speed:climb:1]) resolve against the computed statistics in the
 * registration/eligibility context, not only inside the statistics
 * calculator. Unknown paths still evaluate to false.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { encodeBase64 } from "../platform.js";
import { CharacterService } from "../character/service.js";
import { createRegistrationContext, pendingSelectionRules } from "./selection.js";
import { evaluateRequirements } from "./expr.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


const APPENDS = `<elements>
  <append id="ID_WOTC_PHB_CLASS_BARBARIAN">
    <rules>
      <stat name="innate speed:climb" value="20" />
    </rules>
  </append>
</elements>`;

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
  await ingestContentFiles(library, [
    { path: "imports/stat-path-test.xml", base64: encodeBase64(new TextEncoder().encode(APPENDS)) },
  ]);
}, 120_000);

describe("stat-path requirement atoms", () => {
  it("resolves engine statistics like [proficiency:N]", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("SPR");
    const ctx = createRegistrationContext(service.getCharacter("SPR"), library);
    expect(evaluateRequirements("[proficiency:2]", ctx)).toBe(true);
    expect(evaluateRequirements("[proficiency:3]", ctx)).toBe(false);
  });

  it("resolves content-contributed stat groups like [innate speed:climb:1]", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("SPR");
    service.setAbilities("SPR", {
      strength: 14, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10,
    });
    const before = createRegistrationContext(service.getCharacter("SPR"), library);
    expect(evaluateRequirements("[innate speed:climb:1]", before)).toBe(false);

    const classRule = pendingSelectionRules(service.getCharacter("SPR")).find((rule) => rule.type === "Class")!;
    service.setSelection("SPR", classRule.identifier, "ID_WOTC_PHB_CLASS_BARBARIAN");
    const after = createRegistrationContext(service.getCharacter("SPR"), library);
    expect(evaluateRequirements("[innate speed:climb:1]", after)).toBe(true);
    expect(evaluateRequirements("[innate speed:climb:25]", after)).toBe(false);
  });

  it("keeps unknown stat paths false", () => {
    const service = new CharacterService(undefined, library);
    service.createCharacter("SPR");
    const ctx = createRegistrationContext(service.getCharacter("SPR"), library);
    expect(evaluateRequirements("[no such:path:1]", ctx)).toBe(false);
  });
});
