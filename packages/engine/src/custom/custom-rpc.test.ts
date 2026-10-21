/**
 * The custom-content RPCs through the wire dispatcher, choice identity safety,
 * promotion to a homebrew collection, and what the library overlay does to
 * rebuilds and snapshots.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createEngineDispatcher, type EngineMethodName } from "@forge-cb/api";
import { CharacterService } from "../character/service.js";
import { characterPackIds, isCharacterPackElement } from "../content/character-packs.js";
import { ingestContentFiles } from "../content/ingestion.js";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { computeStatistics } from "../statistics/calculator.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { encodeBase64 } from "../platform.js";
import { createCharacterSnapshotController } from "../snapshot/character-snapshot.js";
import { contentLibraryDigest, serializeContentLibrary } from "../snapshot/content-graph.js";
import { CHARACTER_LOAD_MANIFEST } from "../snapshot/identities.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { createEngineMethodHandlers } from "../worker-handlers.js";
import { diffChoiceIdentity } from "./identity.js";
import { createCustomDraft, type ChoiceBlock, type CustomDraft } from "./schema.js";

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map(base.fileContents));
}, 120_000);

const choice = (extra: Partial<ChoiceBlock> = {}): ChoiceBlock => ({
  kind: "choice",
  id: "pick",
  type: "Language",
  name: "Borrowed tongue",
  count: 2,
  level: 1,
  supports: { kind: "tag", value: "Standard" },
  ...extra,
});

function gift(blocks: CustomDraft["blocks"], extra: Partial<CustomDraft> = {}): CustomDraft {
  return { ...createCustomDraft("boon", "Tide Gift"), id: "ID_CUSTOM_RPCTEST0001", description: "The tide answers.", blocks, ...extra };
}

let counter = 0;
const fighter = () => buildFighter3(library, `RpcFighter${counter++}`);

function rpc(service: CharacterService) {
  const dispatcher = createEngineDispatcher(createEngineMethodHandlers(service, library));
  let next = 1;
  return async (method: EngineMethodName, args: unknown[]) => dispatcher.dispatch({ id: next++, method, args });
}

describe("the custom-content RPCs", () => {
  it("save, list, grant, impact, promote and delete round trip over the wire", async () => {
    const { service, id } = fighter();
    const call = rpc(service);
    const draft = gift([
      { kind: "modifier", id: "m", target: "initiative", mode: "add", value: { kind: "number", value: 2 } },
      choice(),
    ]);

    const saved = await call("saveCustomDraft", [id, { draft }]);
    expect(saved).toMatchObject({
      ok: true,
      result: {
        entry: { elementId: draft.id, type: "Custom Feature", section: "other", granted: true, installed: true },
        diagnostics: [],
        content: { entries: [{ elementId: draft.id }], problems: [] },
        character: { registeredElements: expect.arrayContaining([expect.objectContaining({ id: draft.id, isCustom: true, origin: "character" })]) },
      },
    });

    expect(await call("getCustomContent", [id])).toMatchObject({ ok: true, result: { entries: [{ draft, granted: true }] } });
    expect(await call("getDmGrants", [id])).toMatchObject({
      ok: true,
      result: expect.arrayContaining([expect.objectContaining({ id: draft.id, kind: "feature", isCustom: true, section: "other" })]),
    });

    const impact = await call("getChoiceIdentityImpact", [id, { draft: gift([choice({ name: "Other tongue" })]) }]);
    expect(impact).toMatchObject({ ok: true, result: { changes: [{ blockId: "pick", fields: ["name"] }], hasPicks: false } });

    const promoted = await call("promoteCustomDraft", [id, { draftId: draft.id, source: "Tide Campaign" }]);
    expect(promoted).toMatchObject({ ok: true, result: { id: draft.id, element: { id: draft.id, idLocked: true } } });

    const deleted = await call("deleteCustomDraft", [id, { draftId: draft.id }]);
    expect(deleted).toMatchObject({ ok: true, result: { entry: null, content: { entries: [] } } });
    expect(await call("getDmGrants", [id])).toMatchObject({ ok: true, result: [] });
  });

  it("grants and removes any feature through addGrantedElement and removeGrantedElement", async () => {
    const { service, id } = fighter();
    const call = rpc(service);
    const draft = gift([], { sheet: { show: false } });
    await call("saveCustomDraft", [id, { draft, grant: false }]);
    expect(await call("getDmGrants", [id])).toMatchObject({ result: [] });
    expect(await call("addGrantedElement", [id, { elementId: draft.id }])).toMatchObject({ ok: true });
    expect(await call("getDmGrants", [id])).toMatchObject({ result: [expect.objectContaining({ id: draft.id })] });
    expect(await call("removeGrantedElement", [id, { elementId: draft.id }])).toMatchObject({ ok: true });
    expect(await call("addGrantedElement", [id, { elementId: "ID_NOT_AN_ELEMENT" }])).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("answers errors with the code and the field", async () => {
    const { service, id } = fighter();
    const call = rpc(service);
    expect(await call("saveCustomDraft", [id, { draft: gift([]), grant: true }])).toMatchObject({ ok: true });
    expect(await call("saveCustomDraft", [id, { draft: { ...gift([]), showsUnder: "elsewhere" } }])).toMatchObject({
      ok: false,
      error: { code: "invalid-argument", message: expect.stringContaining("showsUnder") },
    });
    expect(await call("deleteCustomDraft", [id, { draftId: "ID_CUSTOM_NEVER_MADE" }])).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await call("promoteCustomDraft", [id, { draftId: "ID_CUSTOM_RPCTEST0001", source: " " }])).toMatchObject({ ok: false, error: { code: "invalid-argument" } });
    expect(await call("getCustomContent", ["missing"])).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("reports a grant to content that does not exist, naming it", async () => {
    const { service, id } = fighter();
    const draft = gift([{ kind: "grant", id: "g", target: { by: "id", type: "Spell", id: "ID_TEST_SPELL_NOT_THERE" } }]);
    const saved = service.saveCustomDraft(id, { draft });
    expect(saved.diagnostics).toEqual([
      expect.objectContaining({ kind: "missing-grant", elementId: draft.id, missingId: "ID_TEST_SPELL_NOT_THERE" }),
    ]);
  });
});

describe("choice identity", () => {
  const before = gift([choice()]);
  const change = (after: ChoiceBlock | null) => diffChoiceIdentity(before, gift(after === null ? [] : [after]));

  it("reports nothing for an edit that leaves the identity alone", () => {
    expect(change(choice({ requirements: { kind: "level", min: 1 }, optional: true, supports: { kind: "tag", value: "Exotic" } }))).toEqual([]);
    expect(diffChoiceIdentity(before, { ...before, name: "Renamed boon", description: "New text." })).toEqual([]);
  });

  it("reports a renamed, retyped or re-levelled choice and orphans every slot", () => {
    for (const [edit, field] of [
      [{ name: "Other tongue" }, "name"],
      [{ type: "Proficiency" }, "type"],
      [{ level: 3 }, "level"],
    ] as const) {
      const [report] = change(choice(edit));
      expect(report).toMatchObject({ blockId: "pick", change: "changed", fields: [field], orphanedSlots: [1, 2] });
      expect(report!.orphanedChecksums).toHaveLength(2);
    }
  });

  it("orphans only the dropped slots when the count falls, and nothing when it rises", () => {
    expect(change(choice({ count: 1 }))).toEqual([expect.objectContaining({ fields: ["count"], orphanedSlots: [2] })]);
    expect(change(choice({ count: 3 }))).toEqual([expect.objectContaining({ fields: ["count"], orphanedSlots: [] })]);
  });

  it("counts a changed filter as identity for a spell choice only", () => {
    const spells = gift([choice({ type: "Spell", name: "Ward spell", supports: { kind: "tag", value: "Wizard" } })]);
    const retagged = gift([choice({ type: "Spell", name: "Ward spell", supports: { kind: "tag", value: "Cleric" } })]);
    expect(diffChoiceIdentity(spells, retagged)).toEqual([expect.objectContaining({ fields: ["supports"], orphanedSlots: [1, 2] })]);
  });

  it("reports a removed choice", () => {
    expect(change(null)).toEqual([expect.objectContaining({ change: "removed", orphanedSlots: [1, 2] })]);
  });

  it("finds the picks under the orphaned slots on every loaded character", () => {
    const built = fighter();
    const draft = gift([choice()]);
    built.service.saveCustomDraft(built.id, { draft });
    const rules = pendingSelectionRules(built.service.getCharacter(built.id)).filter((rule) => rule.name === "Borrowed tongue");
    built.service.setSelection(built.id, rules[0]!.identifier, "ID_LANGUAGE_ELVISH");

    // One engine holds every loaded character; a second one carries the same entry (an imported copy).
    const service = new CharacterService(undefined, library);
    service.importCharacterXml("Original", built.service.exportCharacterXml(built.id));
    service.importCharacterXml("Copy", built.service.exportCharacterXml(built.id));

    const report = service.getChoiceIdentityImpact("Copy", { draft: gift([choice({ name: "Other tongue" })]) });
    expect(report.hasPicks).toBe(true);
    expect(report.changes).toHaveLength(1);
    const picks = report.changes[0]!.picks;
    expect(picks.map((pick) => [pick.characterId, pick.slot, pick.elementId]).sort()).toEqual([
      ["Copy", 1, "ID_LANGUAGE_ELVISH"],
      ["Original", 1, "ID_LANGUAGE_ELVISH"],
    ]);
    expect(picks[0]!.elementName).toBe("Elvish");

    // Raising the count orphans nothing, so no pick is at risk.
    const raised = service.getChoiceIdentityImpact("Copy", { draft: gift([choice({ count: 3 })]) });
    expect(raised.changes[0]!.picks).toEqual([]);
    expect(raised.hasPicks).toBe(false);
  });

  it("reports the picks under a pack element's choice from the two versions of its draft, with no character open", () => {
    const built = fighter();
    const draft = gift([choice()]);
    built.service.saveCustomDraft(built.id, { draft });
    const rules = pendingSelectionRules(built.service.getCharacter(built.id)).filter((rule) => rule.name === "Borrowed tongue");
    built.service.setSelection(built.id, rules[0]!.identifier, "ID_LANGUAGE_ELVISH");

    const renamed = built.service.getPackChoiceImpact({ before: draft, after: gift([choice({ name: "Other tongue" })]) });
    expect(renamed.hasPicks).toBe(true);
    expect(renamed.changes[0]!.picks.map((pick) => [pick.characterId, pick.slot, pick.elementId])).toEqual([[built.id, 1, "ID_LANGUAGE_ELVISH"]]);

    expect(built.service.getPackChoiceImpact({ before: draft, after: draft })).toEqual({ changes: [], hasPicks: false });
    // A brand-new element has no earlier version to lose picks from.
    expect(built.service.getPackChoiceImpact({ before: null, after: draft })).toEqual({ changes: [], hasPicks: false });
  });

  it("a draft the character has never stored has no identity to lose", () => {
    const { service, id } = fighter();
    expect(service.getChoiceIdentityImpact(id, { draft: gift([choice()]) })).toEqual({ changes: [], hasPicks: false });
  });
});

describe("promotion", () => {
  it("keeps the id: the collection's element is the same element the character already carries", async () => {
    const { service, id } = fighter();
    const draft = gift([{ kind: "modifier", id: "m", target: "initiative", mode: "add", value: { kind: "number", value: 3 } }]);
    service.saveCustomDraft(id, { draft });
    const before = computeStatistics(service.getCharacter(id), library).initiative!;

    const promoted = service.promoteCustomDraft(id, { draftId: draft.id, source: "Tide Campaign" });
    expect(promoted.id).toBe(draft.id);
    expect(promoted.xml).toContain(`id="${draft.id}"`);
    expect(promoted.xml).toContain('source="Tide Campaign"');
    expect(promoted.element).toMatchObject({ rawXml: promoted.xml, id: draft.id, idLocked: true, type: "Custom Feature", customDraft: draft });

    // The client stores the element in a collection file; ingesting that file keeps the grant working.
    const file = `<elements>${promoted.xml}</elements>`;
    await ingestContentFiles(library, [{ path: "imports/tide-campaign.xml", base64: encodeBase64(new TextEncoder().encode(file)) }]);
    expect(library.byId.get(draft.id)?.identity.source).toBe("Tide Campaign");
    expect(computeStatistics(service.getCharacter(id), library).initiative).toBe(before);
    expect(service.getDmGrants(id).find((grant) => grant.id === draft.id)).toMatchObject({ isCustom: true, origin: "homebrew" });
    expect(service.getCustomContent(id).entries[0]).toMatchObject({ installed: false, granted: true });
  });
});

describe("the library overlay", () => {
  it("survives a library rebuild", async () => {
    const { service, id } = fighter();
    const draft = gift([]);
    draft.id = "ID_CUSTOM_RPCTEST0002";
    service.saveCustomDraft(id, { draft });
    await ingestContentFiles(library, [{ path: "imports/unrelated.xml", base64: encodeBase64(new TextEncoder().encode("<elements><element name='Unrelated' type='Feat' source='X' id='ID_TEST_UNRELATED' /></elements>")) }]);
    expect(library.byId.get(draft.id)).toBeDefined();
    expect(characterPackIds(library, id)).toEqual([draft.id]);
    expect(library.typeCounts["Custom Feature"]).toBe(library.byType.get("Custom Feature")!.length);
  });

  // Serialising and digesting the whole library takes seconds under coverage instrumentation.
  it("is not part of any snapshot: the library digest does not move, and a character restores from its snapshot", async () => {
    const { service, id } = fighter();
    const digest = () => contentLibraryDigest(serializeContentLibrary(library));
    const draft = gift([{ kind: "modifier", id: "m", target: "initiative", mode: "add", value: { kind: "number", value: 1 } }]);
    draft.id = "ID_CUSTOM_RPCTEST0003";
    const empty = await digest();
    service.saveCustomDraft(id, { draft });
    expect(isCharacterPackElement(library, draft.id)).toBe(true);
    expect(await digest()).toBe(empty);
    expect(isCharacterPackElement(library, draft.id)).toBe(true);

    const controller = createCharacterSnapshotController(service, library);
    await controller.prepare(id, CHARACTER_LOAD_MANIFEST);
    const body = controller.takeBuffer();
    const xml = service.exportCharacterXml(id);

    // A device whose library has not met the pack restores from the snapshot, then installs it.
    const otherLibrary = { ...library, fileContents: new Map(library.fileContents) } as ElementLibrary;
    replaceLibraryFiles(otherLibrary, new Map(library.fileContents));
    const device = new CharacterService(undefined, otherLibrary);
    const restore = createCharacterSnapshotController(device, otherLibrary);
    await restore.importWithSnapshot(id, encodeBase64(new TextEncoder().encode(xml)), CHARACTER_LOAD_MANIFEST, body);
    expect(restore.diagnostics()).toMatchObject({ restoreMode: "snapshot", snapshotAccepted: true });
    expect(isCharacterPackElement(otherLibrary, draft.id)).toBe(true);
    expect(computeStatistics(device.getCharacter(id), otherLibrary).initiative).toBe(
      computeStatistics(service.getCharacter(id), library).initiative,
    );
  }, 60_000);
});
