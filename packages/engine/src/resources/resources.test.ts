/**
 * Trackers, switches and scale values on a character, end to end: a draft made
 * through the service declares them, the character file stores what is spent
 * and which switches are on, rests refill them, and a switch changes the totals.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { computeInlineValues, computeStatistics } from "../statistics/calculator.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import { buildCharacter, buildFighter3, ID, sharedLibrary, type BuiltCharacter } from "../testing/character-factory.js";
import { SAMPLE_CASTER, SAMPLE_CHARACTER } from "../testing/dnd5e-samples.js";
import {
  createCustomDraft,
  createCustomItemDraft,
  type CustomBlock,
  type CustomDraft,
  type ScaleValue,
  type TrackerDef,
} from "../custom/schema.js";
import type { ResourcesDto, TrackerDto } from "@forge-cb/api";

let library: ElementLibrary;
beforeAll(async () => {
  library = await sharedLibrary();
}, 120_000);

let counter = 0;
const fighter = (): BuiltCharacter => buildFighter3(library, `ResourceFighter${counter++}`);

const tracker = (extra: Partial<TrackerDef> & Pick<TrackerDef, "id" | "label">): TrackerDef => ({
  max: { kind: "number", value: 2 },
  unit: "uses",
  recharge: "longRest",
  ...extra,
});

function feature(name: string, extra: Partial<CustomDraft> = {}): CustomDraft {
  return { ...createCustomDraft("boon", name), description: `${name} text.`, ...extra };
}

const byLabel = (resources: ResourcesDto, label: string): TrackerDto => {
  const found = resources.trackers.find((entry) => entry.label === label);
  if (found === undefined) throw new Error(`no tracker '${label}' in ${resources.trackers.map((entry) => entry.label).join(", ")}`);
  return found;
};

describe("a character file written elsewhere that never used a tracker", () => {
  it.each([["minimal", SAMPLE_CHARACTER], ["caster", SAMPLE_CASTER]])("round-trips the %s sample byte for byte after resources are read and a rest is taken", (_name, sample) => {
    const service = new CharacterService(undefined, library);
    service.importCharacterXml("Sample", sample);
    const original = service.exportCharacterXml("Sample");
    expect(original).toBe(sample);
    service.getResources("Sample");
    service.restCharacter("Sample", { kind: "short" });
    service.restCharacter("Sample", { kind: "long" });
    expect(service.exportCharacterXml("Sample")).toBe(original);
    expect(original).not.toContain("<forge-builder");
  });
});

describe("a character that never used a tracker", () => {
  it("has the same file after looking at its resources, spending nothing and resting", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    service.getResources(id);
    service.restCharacter(id, { kind: "long" });
    expect(service.exportCharacterXml(id)).toBe(original);
  });

  it("has no resources block again once everything is back to full", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    service.saveCustomDraft(id, { draft: feature("Gift", { trackers: [tracker({ id: "gift", label: "Gift" })] }) });
    const withGift = service.exportCharacterXml(id);
    service.setTrackerUsed(id, { trackerId: "gift", used: 1 });
    expect(service.exportCharacterXml(id)).toContain("<resources");
    service.restCharacter(id, { kind: "long" });
    expect(service.exportCharacterXml(id)).toBe(withGift);
    service.deleteCustomDraft(id, { draftId: service.getCustomContent(id).entries[0]!.elementId });
    expect(service.exportCharacterXml(id)).toBe(original);
  });
});

describe("deleting a custom entry", () => {
  it("forgets what it had spent and the switches it named, leaving a pool another feature shares", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    const gift = feature("Gift", {
      trackers: [tracker({ id: "gift", label: "Gift", pool: "Shared", max: { kind: "number", value: 4 } }), tracker({ id: "solo", label: "Solo" })],
      blocks: [{ kind: "modifier", id: "m", target: "ac:misc", mode: "add", value: { kind: "number", value: 1 }, gates: { switch: "Gift form" } }] as CustomBlock[],
    });
    const twin = feature("Twin", { trackers: [tracker({ id: "twin", label: "Twin", pool: "Shared", max: { kind: "number", value: 4 } })] });
    service.saveCustomDraft(id, { draft: gift });
    service.saveCustomDraft(id, { draft: twin });
    service.setTrackerUsed(id, { trackerId: "solo", used: 1 });
    service.setTrackerUsed(id, { trackerId: "pool:shared", used: 2 });
    service.setResourceSwitch(id, { name: "Gift form", on: true });

    service.deleteCustomDraft(id, { draftId: gift.id });
    const after = service.getResources(id);
    expect(byLabel(after, "Shared").used).toBe(2);
    expect(after.switches).toEqual([]);
    service.deleteCustomDraft(id, { draftId: twin.id });
    expect(service.exportCharacterXml(id)).toBe(original);
  });
});

describe("custom trackers and rests", () => {
  const built = (): { service: CharacterService; id: string } => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, {
      draft: feature("Moonwell Gift", {
        trackers: [
          tracker({ id: "moonbeam", label: "Moonbeam", max: { kind: "number", value: 2 }, recharge: "shortRest" }),
          tracker({ id: "ward", label: "Ward", max: { kind: "number", value: 1 }, recharge: "longRest" }),
          tracker({ id: "embers", label: "Embers", unit: "charges", max: { kind: "number", value: 7 }, recharge: "dawn" }),
          tracker({ id: "once", label: "Once", max: { kind: "number", value: 1 }, recharge: "never" }),
          tracker({ id: "wand", label: "Wand", unit: "charges", max: { kind: "number", value: 7 }, recharge: "diceRoll", regain: "1d6+1 at dawn" }),
        ],
      }),
    });
    return { service, id };
  };

  it("lists each tracker with its source, unit, recharge and a full count", () => {
    const { service, id } = built();
    const resources = service.getResources(id);
    expect(byLabel(resources, "Moonbeam")).toMatchObject({
      id: "moonbeam", max: 2, used: 0, remaining: 2, unit: "uses", recharge: "shortRest", rechargeLabel: "per Short Rest", isCustom: true, manual: false,
      sources: [{ name: "Moonwell Gift", kind: "custom" }],
    });
    expect(byLabel(resources, "Embers")).toMatchObject({ unit: "charges", max: 7, rechargeLabel: "regained at dawn" });
    expect(byLabel(resources, "Wand").rechargeLabel).toBe("regains 1d6+1 at dawn");
  });

  it("spends, clamps to the maximum, and stores the count in the character file", () => {
    const { service, id } = built();
    expect(byLabel(service.setTrackerUsed(id, { trackerId: "moonbeam", used: 1 }), "Moonbeam")).toMatchObject({ used: 1, remaining: 1 });
    expect(byLabel(service.setTrackerUsed(id, { trackerId: "moonbeam", used: 9 }), "Moonbeam")).toMatchObject({ used: 2, remaining: 0 });
    expect(byLabel(service.setTrackerUsed(id, { trackerId: "moonbeam", used: -3 }), "Moonbeam").used).toBe(0);
    service.setTrackerUsed(id, { trackerId: "embers", used: 3 });

    const reloaded = new CharacterService(undefined, library);
    reloaded.importCharacterXml("Reloaded", service.exportCharacterXml(id));
    expect(byLabel(reloaded.getResources("Reloaded"), "Embers").used).toBe(3);
    expect(reloaded.exportCharacterXml("Reloaded")).toBe(service.exportCharacterXml(id));
  });

  it("refuses a tracker that does not exist", () => {
    const { service, id } = built();
    expect(() => service.setTrackerUsed(id, { trackerId: "nope", used: 1 })).toThrow(/tracker/);
  });

  it("a short rest refills only what recharges on a short rest", () => {
    const { service, id } = built();
    for (const trackerId of ["moonbeam", "ward", "embers", "once", "wand"]) service.setTrackerUsed(id, { trackerId, used: 1 });
    const after = service.restCharacter(id, { kind: "short" });
    expect(byLabel(after, "Moonbeam").used).toBe(0);
    for (const label of ["Ward", "Embers", "Once", "Wand"]) expect(byLabel(after, label).used).toBe(1);
  });

  it("a long rest also refills long rest, dawn and day trackers, and leaves never and dice-roll ones alone", () => {
    const { service, id } = built();
    for (const trackerId of ["moonbeam", "ward", "embers", "once", "wand"]) service.setTrackerUsed(id, { trackerId, used: 1 });
    const after = service.restCharacter(id, { kind: "long" });
    for (const label of ["Moonbeam", "Ward", "Embers"]) expect(byLabel(after, label).used).toBe(0);
    expect(byLabel(after, "Once").used).toBe(1);
    expect(byLabel(after, "Wand").used).toBe(1);
  });

  it("the sheet usage line is written from the tracker", () => {
    const { service, id } = built();
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const lines = model.pages.flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : []))));
    expect(lines.some((line) => line.startsWith("Moonwell Gift (2/Short Rest; 1/Long Rest; 7 charges/Dawn; 1 (no recharge); 7 charges (regains 1d6+1 at dawn))."))).toBe(true);
  });
});

describe("a shared pool", () => {
  it("is one resource fed by two features, spent once", () => {
    const { service, id } = fighter();
    const pool = { max: { kind: "number", value: 6 }, unit: "points", recharge: "longRest", pool: "Moon points" } as const;
    service.saveCustomDraft(id, { draft: feature("First Light", { trackers: [tracker({ id: "a", label: "First Light", ...pool })] }) });
    service.saveCustomDraft(id, { draft: feature("Second Light", { trackers: [tracker({ id: "b", label: "Second Light", ...pool })] }) });
    const resources = service.getResources(id);
    const shared = resources.trackers.filter((entry) => entry.pool === "Moon points");
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({
      label: "Moon points", id: "pool:moon points", max: 6, unit: "points",
      sources: [{ name: "First Light", kind: "custom" }, { name: "Second Light", kind: "custom" }],
    });
    expect(byLabel(service.setTrackerUsed(id, { trackerId: "pool:moon points", used: 4 }), "Moon points")).toMatchObject({ used: 4, remaining: 2 });
    expect(byLabel(service.restCharacter(id, { kind: "long" }), "Moon points").used).toBe(0);
  });
});

describe("switches", () => {
  const curse = (): CustomDraft =>
    feature("Moonlit Form", {
      template: "curse",
      blocks: [
        { kind: "modifier", id: "ac", target: "ac:misc", mode: "add", value: { kind: "number", value: 2 }, gates: { switch: "Moonlit Form" } },
        { kind: "modifier", id: "str", target: "strength", mode: "add", value: { kind: "number", value: -1 }, gates: { switch: "Moonlit Form" } },
      ] as CustomBlock[],
    });

  it("lists the switch a draft's modifiers name, off", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: curse() });
    expect(service.getResources(id).switches).toEqual([{ name: "Moonlit Form", on: false, sources: ["Moonlit Form"] }]);
  });

  it("turns a modifier on and off", () => {
    const { service, id } = fighter();
    const before = computeStatistics(service.getCharacter(id), library);
    service.saveCustomDraft(id, { draft: curse() });
    const off = computeStatistics(service.getCharacter(id), library);
    expect(off.ac).toBe(before.ac);
    expect(off["strength:score"]).toBe(before["strength:score"]);

    service.setResourceSwitch(id, { name: "Moonlit Form", on: true });
    const on = computeStatistics(service.getCharacter(id), library);
    expect(on.ac).toBe(before.ac! + 2);
    expect(on["strength:score"]).toBe(before["strength:score"]! - 1);

    service.setResourceSwitch(id, { name: "Moonlit Form", on: false });
    expect(computeStatistics(service.getCharacter(id), library).ac).toBe(before.ac);
  });

  it("turns an armor class formula on only while the switch is on", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, {
      draft: feature("Moon Skin", {
        blocks: [{
          kind: "modifier", id: "calc", target: "ac:calculation", mode: "setBase", value: { kind: "number", value: 20 },
          addAbilities: ["dexterity"], gates: { switch: "Moon skin" },
        }] as CustomBlock[],
      }),
    });
    const off = computeStatistics(service.getCharacter(id), library).ac!;
    service.setResourceSwitch(id, { name: "Moon skin", on: true });
    const on = computeStatistics(service.getCharacter(id), library).ac!;
    expect(on).toBeGreaterThan(off);
    service.setResourceSwitch(id, { name: "Moon skin", on: false });
    expect(computeStatistics(service.getCharacter(id), library).ac).toBe(off);
  });

  it("keeps the switch on through a save and reload, and a file with every switch off is as it was", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: curse() });
    const resting = service.exportCharacterXml(id);
    service.setResourceSwitch(id, { name: "Moonlit Form", on: true });
    const reloaded = new CharacterService(undefined, library);
    reloaded.importCharacterXml("Reloaded", service.exportCharacterXml(id));
    expect(reloaded.getResources("Reloaded").switches[0]).toMatchObject({ name: "Moonlit Form", on: true });
    service.setResourceSwitch(id, { name: "Moonlit Form", on: false });
    expect(service.exportCharacterXml(id)).toBe(resting);
  });

  it("does not apply a book rule just because a switch shares its words", () => {
    const { service, id } = buildCharacter(library, { id: `Raging${counter++}`, classId: ID.CLASS_BARBARIAN, levels: 3 });
    const before = computeStatistics(service.getCharacter(id), library);
    service.saveCustomDraft(id, {
      draft: feature("Rage Echo", {
        blocks: [{ kind: "modifier", id: "echo", target: "ac:misc", mode: "add", value: { kind: "number", value: 1 }, gates: { switch: "while raging" } }] as CustomBlock[],
      }),
    });
    service.setResourceSwitch(id, { name: "while raging", on: true });
    const on = computeStatistics(service.getCharacter(id), library);
    // The custom rule applies; the book's own rage rules carry the same words and still do not.
    expect(on.ac).toBe(before.ac! + 1);
    expect(on["melee:damage, strength"]).toBeUndefined();
    expect(on["resistance:bludgeoning"]).toBeUndefined();
  });

  it("refuses a switch nothing declares", () => {
    const { service, id } = fighter();
    expect(() => service.setResourceSwitch(id, { name: "Nothing here", on: true })).toThrow(/switch/);
  });

  it("spends one use of its linked tracker when turned on, and refuses when none is left", () => {
    const { service, id } = fighter();
    const draft = curse();
    draft.trackers = [tracker({ id: "form", label: "Moonlit Form uses", max: { kind: "number", value: 1 }, spendOnSwitch: "Moonlit Form" })];
    service.saveCustomDraft(id, { draft });
    expect(service.getResources(id).switches[0]).toMatchObject({ spends: "Moonlit Form uses" });

    expect(byLabel(service.setResourceSwitch(id, { name: "Moonlit Form", on: true }), "Moonlit Form uses").used).toBe(1);
    // Turning it off does not give the use back.
    expect(byLabel(service.setResourceSwitch(id, { name: "Moonlit Form", on: false }), "Moonlit Form uses").used).toBe(1);
    expect(() => service.setResourceSwitch(id, { name: "Moonlit Form", on: true })).toThrow(/Moonlit Form uses/);
    expect(service.getResources(id).switches[0]!.on).toBe(false);
    service.restCharacter(id, { kind: "long" });
    expect(service.setResourceSwitch(id, { name: "Moonlit Form", on: true }).switches[0]!.on).toBe(true);
  });
});

describe("scale values", () => {
  const die: ScaleValue = { id: "die", name: "Moonlight die", kind: "dice", steps: [{ level: 1, value: "1d6" }, { level: 3, value: "1d8" }, { level: 6, value: "2d8" }] };
  const count: ScaleValue = { id: "count", name: "Gaze count", kind: "number", steps: [{ level: 1, value: 1 }, { level: 3, value: 3 }] };
  const draft = (): CustomDraft =>
    feature("Moonlight", {
      scales: [die, count],
      sheet: { text: "Roll {{scale:moonlight die}} radiant, {{scale:gaze count}} times." },
      trackers: [tracker({ id: "gaze", label: "Gaze", max: { kind: "scale", scale: "count" } })],
      blocks: [{ kind: "modifier", id: "ward", target: "ac:misc", mode: "add", value: { kind: "scale", scale: "count" } }] as CustomBlock[],
    });

  it("drives a die in the sheet text and a use count, and follows the character's level", () => {
    const low = buildCharacter(library, { id: `ScaleLow${counter++}`, classId: ID.CLASS_FIGHTER, levels: 2 });
    low.service.saveCustomDraft(low.id, { draft: draft() });
    expect(computeInlineValues(low.service.getCharacter(low.id), library)["scale:moonlight die"]).toBe("1d6");
    expect(byLabel(low.service.getResources(low.id), "Gaze").max).toBe(1);

    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: draft() });
    const state = service.getCharacter(id);
    expect(computeInlineValues(state, library)["scale:moonlight die"]).toBe("1d8");
    expect(computeStatistics(state, library)["scale:gaze count"]).toBe(3);
    expect(byLabel(service.getResources(id), "Gaze").max).toBe(3);

    const model = buildCharacterSheetModel(state, library, { mode: "full" });
    const lines = model.pages.flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : []))));
    expect(lines.some((line) => line.includes("Roll 1d8 radiant, 3 times."))).toBe(true);
  });

  it("a modifier reads the table too", () => {
    const { service, id } = fighter();
    const before = computeStatistics(service.getCharacter(id), library);
    service.saveCustomDraft(id, { draft: draft() });
    expect(computeStatistics(service.getCharacter(id), library).ac).toBe(before.ac! + 3);
  });
});

describe("a maximum that follows the character", () => {
  it("is the proficiency bonus, or a modifier with a floor", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, {
      draft: feature("Studied", {
        trackers: [
          tracker({ id: "prof", label: "Proficient", max: { kind: "reference", ref: "proficiency" } }),
          tracker({ id: "int", label: "Clever", max: { kind: "reference", ref: "intelligence:modifier", min: 1 } }),
          tracker({ id: "lvl", label: "Leveled", max: { kind: "classLevel", className: "Fighter" } }),
        ],
      }),
    });
    const values = computeStatistics(service.getCharacter(id), library);
    const resources = service.getResources(id);
    expect(byLabel(resources, "Proficient").max).toBe(values.proficiency);
    expect(byLabel(resources, "Clever").max).toBe(Math.max(1, values["intelligence:modifier"]!));
    expect(byLabel(resources, "Leveled").max).toBe(3);
  });
});

describe("spell grants with a free cast", () => {
  it("track each spell by itself", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, {
      draft: feature("Blessing", {
        blocks: [
          { kind: "grant", id: "g1", target: { by: "id", type: "Spell", id: "ID_PHB_SPELL_BLESS", label: "Bless" }, spell: { castAbility: "wisdom", usage: "1/Long Rest" } },
          { kind: "grant", id: "g2", target: { by: "id", type: "Spell", id: "ID_PHB_SPELL_BANE", label: "Bane" }, spell: { castAbility: "wisdom", usage: "1/Long Rest" } },
        ] as CustomBlock[],
      }),
    });
    const resources = service.getResources(id);
    expect(resources.trackers.filter((entry) => entry.isCustom).map((entry) => entry.label).sort()).toEqual(["Bane", "Bless"]);
    expect(byLabel(resources, "Bless")).toMatchObject({ max: 1, recharge: "longRest", isCustom: true, sources: [{ name: "Blessing", kind: "custom" }] });
    service.setTrackerUsed(id, { trackerId: byLabel(resources, "Bless").id, used: 1 });
    expect(byLabel(service.getResources(id), "Bane").used).toBe(0);
  });
});

describe("item charges", () => {
  it("are a tracker while the item is carried", () => {
    const { service, id } = fighter();
    const wand = {
      ...createCustomItemDraft("worn", "Wand of Embers"),
      slot: "misc" as const,
      description: "A short wand.",
      trackers: [tracker({ id: "charges", label: "Charges", unit: "charges", max: { kind: "number", value: 7 }, recharge: "dawn" })],
    };
    service.saveCustomDraft(id, { draft: wand });
    const resources = service.getResources(id);
    expect(byLabel(resources, "Charges")).toMatchObject({ max: 7, unit: "charges", sources: [{ name: "Wand of Embers", kind: "custom" }] });
    service.setTrackerUsed(id, { trackerId: "charges", used: 2 });
    expect(byLabel(service.restCharacter(id, { kind: "long" }), "Charges").used).toBe(0);

    const identifier = service.getCharacter(id).items.find((item) => item.itemId === wand.id)!.identifier;
    service.removeItem(id, identifier);
    expect(service.getResources(id).trackers.some((entry) => entry.label === "Charges")).toBe(false);
  });
});

describe("a tracker kept by hand", () => {
  it("is added, spent, edited and removed on the Resources page alone", () => {
    const { service, id } = fighter();
    const original = service.exportCharacterXml(id);
    const saved = service.saveManualTracker(id, {
      tracker: tracker({ id: "boots", label: "Winged Boots", unit: "minutes", max: { kind: "number", value: 30 }, recharge: "day" }),
    });
    expect(byLabel(saved, "Winged Boots")).toMatchObject({ manual: true, isCustom: true, max: 30, unit: "minutes", sources: [{ name: "Winged Boots", kind: "manual" }] });
    expect(byLabel(saved, "Winged Boots").def).toMatchObject({ id: "boots", recharge: "day" });

    service.setTrackerUsed(id, { trackerId: "boots", used: 10 });
    const reloaded = new CharacterService(undefined, library);
    reloaded.importCharacterXml("Reloaded", service.exportCharacterXml(id));
    expect(byLabel(reloaded.getResources("Reloaded"), "Winged Boots")).toMatchObject({ used: 10, max: 30 });

    const edited = service.saveManualTracker(id, { tracker: tracker({ id: "boots", label: "Winged Boots", unit: "minutes", max: { kind: "number", value: 20 }, recharge: "day" }) });
    expect(byLabel(edited, "Winged Boots")).toMatchObject({ max: 20, used: 10 });

    expect(service.deleteManualTracker(id, { trackerId: "boots" }).trackers.some((entry) => entry.label === "Winged Boots")).toBe(false);
    expect(service.exportCharacterXml(id)).toBe(original);
  });

  it("refuses a tracker that does not name itself or follow the character", () => {
    const { service, id } = fighter();
    expect(() => service.saveManualTracker(id, { tracker: tracker({ id: "x", label: "" }) })).toThrow(/label/);
    expect(() => service.saveManualTracker(id, { tracker: tracker({ id: "x", label: "X", max: { kind: "reference", ref: "proficiency" } }) })).toThrow(/max/);
  });
});

describe("limited uses printed in the book content", () => {
  it("are read from the sheet usage lines and tracked, each feature once", () => {
    const { service, id } = fighter();
    const resources = service.getResources(id);
    const book = resources.trackers.filter((entry) => !entry.isCustom);
    expect(book.length).toBeGreaterThan(0);
    for (const entry of book) {
      expect(entry.sources[0]!.kind).toBe("book");
      expect(entry.max).toBeGreaterThan(0);
      expect(["shortRest", "longRest"]).toContain(entry.recharge);
    }
    expect(new Set(book.map((entry) => entry.id)).size).toBe(book.length);
    const first = book[0]!;
    service.setTrackerUsed(id, { trackerId: first.id, used: 1 });
    expect(service.getResources(id).trackers.find((entry) => entry.id === first.id)!.used).toBe(1);
    expect(service.restCharacter(id, { kind: "short" }).trackers.find((entry) => entry.id === first.id)!.used).toBe(0);
  });

  it("follow the counts the engine already computes: rage, bardic inspiration, wild shape", () => {
    const barbarian = buildCharacter(library, { id: `TrackBarb${counter++}`, classId: ID.CLASS_BARBARIAN, levels: 5 });
    const rage = byLabel(barbarian.service.getResources(barbarian.id), "Rage");
    expect(rage).toMatchObject({ max: computeStatistics(barbarian.service.getCharacter(barbarian.id), library)["barbarian rage:count"], recharge: "longRest" });

    const bard = buildCharacter(library, {
      id: `TrackBard${counter++}`, classId: "ID_WOTC_PHB_CLASS_BARD", levels: 5,
      abilities: { strength: 8, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 16 },
    });
    const values = computeStatistics(bard.service.getCharacter(bard.id), library);
    expect(byLabel(bard.service.getResources(bard.id), "Bardic Inspiration").max).toBe(values["bardic-inspiration:count"]);

    const druid = buildCharacter(library, { id: `TrackDruid${counter++}`, classId: ID.CLASS_DRUID, levels: 5 });
    expect(byLabel(druid.service.getResources(druid.id), "Wild Shape")).toMatchObject({ max: 2, recharge: "shortRest" });
  });

  it("leave a feature with no count in its usage line alone", () => {
    const { service, id } = buildCharacter(library, { id: `TrackRogue${counter++}`, classId: ID.CLASS_ROGUE, levels: 5 });
    expect(service.getResources(id).trackers).toEqual([]);
  });
});

describe("the sheet", () => {
  const resourceLines = (service: CharacterService, id: string): string[] => {
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    return model.pages
      .flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : []))))
      .filter((line) => line.startsWith("Resources."));
  };

  it("prints every resource in one paragraph: boxes for a few uses, a blank for many", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, {
      draft: feature("Moonwell Gift", {
        trackers: [
          tracker({ id: "a", label: "Moonbeam", max: { kind: "number", value: 2 }, recharge: "shortRest" }),
          tracker({ id: "b", label: "Embers", unit: "charges", max: { kind: "number", value: 12 }, recharge: "dawn" }),
          tracker({ id: "c", label: "Wand", unit: "charges", max: { kind: "number", value: 7 }, recharge: "diceRoll", regain: "1d6+1 at dawn" }),
        ],
      }),
    });
    service.setTrackerUsed(id, { trackerId: "a", used: 1 });
    const [line] = resourceLines(service, id);
    expect(line).toContain("Moonbeam [ ] [ ] (SR)");
    expect(line).toContain("Embers ____ / 12 charges (dawn)");
    expect(line).toContain("Wand ____ / 7 charges (1d6+1 at dawn)");
  });

  it("prints nothing for a character with no limited uses", () => {
    const { service, id } = buildCharacter(library, { id: `SheetRogue${counter++}`, classId: ID.CLASS_ROGUE, levels: 5 });
    expect(resourceLines(service, id)).toEqual([]);
  });
});
