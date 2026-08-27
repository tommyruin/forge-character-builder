import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildLibrary, classifyRuleset, rulesetSourcesByName, type ElementLibrary } from "../content/library.js";
import { parseElementsFile } from "../content/parser.js";
import {
  serializeContentLibrary,
  hydrateContentLibrary,
  contentLibraryDigest,
  validateContentLibrary,
  type ContentLibraryPayload,
} from "./content-graph.js";
import { canonicalStringify, canonicalParse, sha256Hex, SnapshotCodecError } from "./codec.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CORPUS_ROOT = join(ROOT, "third-party", "elements");

let library: ElementLibrary;

beforeAll(async () => {
  library = await buildLibrary(CORPUS_ROOT);
}, 120_000);

function roundTripped(payload: ContentLibraryPayload): ElementLibrary {
  return hydrateContentLibrary(canonicalParse(canonicalStringify(payload)));
}

describe("content library graph codec (vendored corpus)", () => {
  it("serializes and hydrates the full corpus with pinned counts", async () => {
    const payload = serializeContentLibrary(library);
    const hydrated = roundTripped(payload);

    expect(hydrated.byId.size).toBe(25960);
    expect(hydrated.elementCount).toBe(25960);
    expect(payload.elementTable.length).toBe(26369);

    let total = 0;
    for (const [type, list] of library.byType) {
      const hydratedList = hydrated.byType.get(type);
      expect(hydratedList, type).toBeDefined();
      expect(hydratedList!.length, type).toBe(list.length);
      total += list.length;
    }
    expect(total).toBe(26369);
    expect(hydrated.typeCounts).toEqual(library.typeCounts);
    expect(hydrated.sources.size).toBe(136);
    expect(hydrated.fileOrder).toEqual(library.fileOrder);
    expect(hydrated.fileOrder.length).toBe(742);
    expect(hydrated.ruleset.size).toBe(25960);
    expect(hydrated.ruleset).toEqual(library.ruleset);
    expect(hydrated.rulesetCounts).toEqual(library.rulesetCounts);
  });

  it("preserves shared references between byId, byType, and sources", () => {
    const hydrated = roundTripped(serializeContentLibrary(library));
    for (const [type, list] of library.byType) {
      const hydratedList = hydrated.byType.get(type)!;
      for (let i = 0; i < list.length; i++) {
        const element = list[i]!;
        const winner = library.byId.get(element.identity.id);
        expect(hydratedList[i]!.identity).toEqual(element.identity);
        if (winner === element) {
          expect(hydratedList[i]).toBe(hydrated.byId.get(winner.identity.id));
        }
      }
    }
    for (const [id, element] of library.sources) {
      expect(hydrated.sources.get(id)).toBe(hydrated.byId.get(id));
      expect(hydrated.sources.get(id)!.identity).toEqual(element.identity);
    }
  });

  it("deep-equals every winning element against the raw library", () => {
    const hydrated = roundTripped(serializeContentLibrary(library));
    for (const [id, element] of library.byId) {
      expect(hydrated.byId.get(id), id).toStrictEqual(element);
    }
  });

  it("deep-equals representative elements across all block kinds", () => {
    const hydrated = roundTripped(serializeContentLibrary(library));
    const ids = [
      "ID_WOTC_PHB_CLASS_WARLOCK",
      "ID_WOTC_PHB24_CLASS_WARLOCK",
      "ID_PHB_SPELL_ACID_SPLASH",
      "ID_WOTC_PHB_ARCHETYPE_FEATURE_ELDRITCH_KNIGHT_SPELLCASTING",
      "ID_DMG_INTERNAL_ITEM_PROFICIENCY_PROXY_PROFICIENCY_WEAPON_MODERN_FIREARMS_SHOTGUN",
    ];
    for (const id of ids) {
      expect(hydrated.byId.get(id), id).toEqual(library.byId.get(id));
    }
    const warlock = hydrated.byId.get("ID_WOTC_PHB_CLASS_WARLOCK")!;
    expect(warlock.multiclass).toBeDefined();
    expect(warlock.rules[warlock.rules.length - 1]).toEqual(library.byId.get("ID_WOTC_PHB_CLASS_WARLOCK")!.rules.at(-1));
  });

  it("preserves duplicate-id overridden entries within a byType list", () => {
    const scrollId = "ID_INTERNAL_MAGIC_ITEM_SPELL_SCROLL_ACID_SPLASH";
    const rawList = library.byType.get("Magic Item")!.filter((e) => e.identity.id === scrollId);
    expect(rawList.length).toBe(2);
    expect(rawList[0]).not.toBe(rawList[1]);
    const hydrated = roundTripped(serializeContentLibrary(library));
    const hydratedList = hydrated.byType.get("Magic Item")!.filter((e) => e.identity.id === scrollId);
    expect(hydratedList.length).toBe(2);
    expect(hydratedList[1]).toBe(hydrated.byId.get(scrollId));
    expect(hydratedList[0]).not.toBe(hydrated.byId.get(scrollId));
    expect(hydratedList[0]).toEqual(rawList[0]);
    expect(hydrated.byId.get(scrollId)).toEqual(library.byId.get(scrollId));
  });

  it("serializes deterministically", () => {
    const a = serializeContentLibrary(library);
    const b = serializeContentLibrary(library);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("computes a stable library digest over the canonical payload", async () => {
    const payload = serializeContentLibrary(library);
    const digest = await contentLibraryDigest(payload);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(await sha256Hex(canonicalStringify(payload)));
    expect(await contentLibraryDigest(serializeContentLibrary(library))).toBe(digest);
  });
});

describe("content library graph codec validation", () => {
  function tampered(): ContentLibraryPayload {
    return canonicalParse(canonicalStringify(serializeContentLibrary(library))) as ContentLibraryPayload;
  }

  it("rejects indexes out of table range", () => {
    const payload = tampered();
    payload.byId[0]!.index = 1_000_000;
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects duplicate ids in byId records", () => {
    const payload = tampered();
    payload.byId.push({ ...payload.byId[0]! });
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects byId records whose element id does not match", () => {
    const payload = tampered();
    payload.byId[0]!.id = "ID_DOES_NOT_EXIST";
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects byType indexes pointing at elements of the wrong type", () => {
    const payload = tampered();
    const firstType = payload.byType[0]!.type;
    const wrongIndex = payload.elementTable.findIndex((e) => e.identity.type !== firstType);
    expect(wrongIndex).toBeGreaterThanOrEqual(0);
    payload.byType[0]!.indexes[0] = wrongIndex;
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects unknown payload keys and missing payload keys", () => {
    const payload = tampered();
    expect(() => hydrateContentLibrary({ ...payload, bogus: 1 })).toThrowError(
      expect.objectContaining({ reason: "invalid-structure" }),
    );
    const missing = { ...payload } as { byId?: unknown };
    delete missing.byId;
    expect(() => hydrateContentLibrary(missing)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects ruleset ids absent from byId and byId ids absent from ruleset", () => {
    const payload = tampered();
    payload.ruleset[0]!.id = "ID_DOES_NOT_EXIST";
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
    const payload2 = tampered();
    payload2.ruleset = payload2.ruleset.slice(1);
    expect(() => hydrateContentLibrary(payload2)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects typeCounts that do not match the byType lists", () => {
    const payload = tampered();
    payload.typeCounts["Class"] = 999;
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects rulesetCounts that do not match the ruleset distribution", () => {
    const payload = tampered();
    payload.rulesetCounts.sharedCount = 0;
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects structurally corrupt element table entries", () => {
    const payload = tampered();
    (payload.elementTable[0]!.identity as { type: unknown }).type = 42;
    expect(() => hydrateContentLibrary(payload)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects non-object payloads", () => {
    expect(() => hydrateContentLibrary(null)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
    expect(() => hydrateContentLibrary([1, 2, 3])).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("throws SnapshotCodecError with a message naming the offending field", () => {
    const payload = tampered();
    payload.byId[0]!.index = 1_000_000;
    expect(() => hydrateContentLibrary(payload)).toThrowError(SnapshotCodecError);
  });
});

describe("content graph presentation-flag compatibility", () => {
  function oneElementLibrary(): { library: ElementLibrary; elementId: string } {
    const [element] = parseElementsFile(
      `<elements>
        <element id="ID_TEST_SHEET" name="Sheet feature" type="Feature" source="Public">
          <rules><stat name="armor" value="10" alt="Unarmored Defense (Barbarian)" /></rules>
          <sheet display="false" action="Bonus Action" usage="1/Long Rest" alt="Rage" name="Rage">
            <description level="3" usage="1/Long Rest" action="Reaction"><i>Rage text</i></description>
          </sheet>
        </element>
      </elements>`,
      "sheet-test.xml",
    );
    if (element === undefined) throw new Error("test element did not parse");
    const elementId = element.identity.id;
    return {
      elementId,
      library: {
        byId: new Map([[elementId, element]]),
        byType: new Map([["Feature", [element]]]),
        typeCounts: { Feature: 1 },
        sources: new Map(),
        elementCount: 1,
        fileOrder: ["sheet-test.xml"],
        ruleset: new Map([[elementId, classifyRuleset(element)]]),
        rulesetCounts: { rules2014Count: 0, rules2024Count: 0, sharedCount: 1 },
      },
    };
  }

  it("strictly round-trips parser-owned undefined optionals and stat.alt", () => {
    const { library, elementId } = oneElementLibrary();
    const hydrated = hydrateContentLibrary(canonicalParse(canonicalStringify(serializeContentLibrary(library))));
    const raw = library.byId.get(elementId)!;
    const restored = hydrated.byId.get(elementId)!;

    // toStrictEqual catches an omitted own key even when its value is undefined.
    expect(restored).toStrictEqual(raw);
    expect(Object.prototype.hasOwnProperty.call(restored.rules[0], "alt")).toBe(true);
    expect((restored.rules[0] as { alt?: string }).alt).toBe("Unarmored Defense (Barbarian)");
    expect(Object.prototype.hasOwnProperty.call(restored.sheets[0], "display")).toBe(true);
    expect(restored.sheets[0]!.descriptions[0]).toStrictEqual(raw.sheets[0]!.descriptions[0]);
  });

  it("hydrates legacy element records without sheets as an empty array", () => {
    const { library, elementId } = oneElementLibrary();
    const payload = canonicalParse(canonicalStringify(serializeContentLibrary(library))) as ContentLibraryPayload;
    for (const record of payload.elementTable) delete (record as ParsedElementWithoutSheets).sheets;

    const hydrated = hydrateContentLibrary(payload);
    const restored = hydrated.byId.get(elementId)!;
    expect(restored.sheets).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(restored, "sheets")).toBe(true);
    expect(restored.rules[0]).toStrictEqual(library.byId.get(elementId)!.rules[0]);
  });
});

type ParsedElementWithoutSheets = { sheets?: unknown };

describe("validateContentLibrary", () => {
  it("accepts the raw library and a hydrated round trip", () => {
    const hydrated = roundTripped(serializeContentLibrary(library));
    expect(() => validateContentLibrary(library)).not.toThrow();
    expect(() => validateContentLibrary(hydrated)).not.toThrow();
  });

  it("rejects tampered typeCounts", () => {
    const tampered = { ...library, typeCounts: { ...library.typeCounts, Class: 1 } };
    expect(() => validateContentLibrary(tampered)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects a ruleset missing entries", () => {
    const tampered = { ...library, ruleset: new Map([...library.ruleset].slice(1)) };
    expect(() => validateContentLibrary(tampered)).toThrowError(expect.objectContaining({ reason: "invalid-structure" }));
  });

  it("rejects a ruleset tag inconsistent with classification", () => {
    const firstId = [...library.ruleset.keys()][0]!;
    const firstTag = library.ruleset.get(firstId)!;
    const otherTag = firstTag === "shared" ? "2014" : "shared";
    const ruleset = new Map(library.ruleset);
    ruleset.set(firstId, otherTag);
    expect(() => validateContentLibrary({ ...library, ruleset })).toThrowError(
      expect.objectContaining({ reason: "invalid-structure" }),
    );
    expect(classifyRuleset(library.byId.get(firstId)!, rulesetSourcesByName(library.byId.values()))).toBe(firstTag);
  });

  it("rejects byType entries whose type does not match their list", () => {
    const list = [...library.byType.get("Class")!];
    const first = list[0]!;
    list[0] = { ...first, identity: { ...first.identity, type: "Bogus" } };
    const byType = new Map(library.byType);
    byType.set("Class", list);
    expect(() => validateContentLibrary({ ...library, byType })).toThrowError(
      expect.objectContaining({ reason: "invalid-structure" }),
    );
  });

  it("rejects sources entries that are not identical to the byId element", () => {
    const firstSourceId = [...library.sources.keys()][0]!;
    const original = library.sources.get(firstSourceId)!;
    const sources = new Map(library.sources);
    sources.set(firstSourceId, { ...original });
    expect(() => validateContentLibrary({ ...library, sources })).toThrowError(
      expect.objectContaining({ reason: "invalid-structure" }),
    );
  });
});
