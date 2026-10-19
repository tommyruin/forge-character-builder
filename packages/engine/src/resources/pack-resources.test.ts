/**
 * Limited uses and switches that an element of a homebrew pack carries.
 *
 * A pack element is compiled from a draft, and the library keeps only the
 * element. The tracker definitions travel in the compiled element itself, so a
 * character that has the element lists every tracker it declared (its own
 * label, pool, unit and switch link, and the item charges) wherever the
 * element came from, the same as when the draft sits in the character's file.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { parseElementsFile } from "../content/parser.js";
import { compileCustomElement, compileCustomPack } from "../custom/compile.js";
import { trackerFromSetter } from "../custom/tracker-setters.js";
import {
  createCustomDraft,
  createCustomItemDraft,
  createCustomSpeciesDraft,
  newCustomBlockId,
  type CustomDraft,
  type TrackerDef,
} from "../custom/schema.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import type { ResourcesDto, TrackerDto } from "@forge-cb/api";

const tracker = (extra: Partial<TrackerDef> & Pick<TrackerDef, "id" | "label">): TrackerDef => ({
  max: { kind: "number", value: 2 },
  unit: "uses",
  recharge: "longRest",
  ...extra,
});

const feature = (name: string, extra: Partial<CustomDraft> = {}): CustomDraft => ({
  ...createCustomDraft("boon", name),
  description: `${name} text.`,
  ...extra,
});

const gifts = feature("Tide Gifts", {
  trackers: [
    tracker({ id: "moonbeam", label: "Moonbeam", recharge: "shortRest" }),
    tracker({ id: "embers", label: "Embers", unit: "charges", max: { kind: "number", value: 7 }, recharge: "dawn" }),
    tracker({ id: "focus", label: "Focus", max: { kind: "reference", ref: "proficiency", min: 1 } }),
    tracker({ id: "surge", label: "Surge", max: { kind: "number", value: 1 }, recharge: "shortRest", spendOnSwitch: "Surging" }),
  ],
  blocks: [
    {
      kind: "modifier",
      id: newCustomBlockId(),
      target: "initiative",
      mode: "add",
      value: { kind: "number", value: 2 },
      gates: { switch: "Surging" },
    } as never,
  ],
});
const pooledA = feature("First Light", { trackers: [tracker({ id: "pa", label: "First Light", max: { kind: "number", value: 6 }, unit: "points", pool: "Moon points" })] });
const pooledB = feature("Second Light", { trackers: [tracker({ id: "pb", label: "Second Light", max: { kind: "number", value: 6 }, unit: "points", pool: "Moon points" })] });
const wand = {
  ...createCustomItemDraft("worn", "Ember Wand"),
  slot: "misc" as const,
  description: "A short wand.",
  trackers: [tracker({ id: "charges", label: "Charges", unit: "charges", max: { kind: "number", value: 7 }, recharge: "dawn" })],
};

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  const xml = compileCustomPack([gifts, pooledA, pooledB, wand], { source: "Moon Pack" });
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/moon-pack.xml", xml]]));
}, 120_000);

let counter = 0;
const fighter = () => buildFighter3(library, `PackResources${counter++}`);
const byLabel = (resources: ResourcesDto, label: string): TrackerDto => {
  const found = resources.trackers.find((entry) => entry.label === label);
  if (found === undefined) throw new Error(`no tracker '${label}' in ${resources.trackers.map((entry) => entry.label).join(", ")}`);
  return found;
};

describe("trackers carried by a compiled pack element", () => {
  it("round-trip through the setter the compiler writes", () => {
    const [element] = parseElementsFile(`<elements>${compileCustomElement(gifts, { source: "Moon Pack" })}</elements>`, "x.xml");
    const read = element!.setters.filter((entry) => entry.name === "tracker").map((entry) => trackerFromSetter(entry));
    expect(read).toHaveLength(4);
    expect(read[0]).toEqual({ def: { id: "moonbeam", label: "Moonbeam", max: { kind: "number", value: 2 }, unit: "uses", recharge: "shortRest" } });
    expect(read[2]!.def.max).toEqual({ kind: "stat", key: "uses:focus" });
    expect(read[3]!.def.spendOnSwitch).toBe("Surging");
  });

  it("are listed for a character that was granted the feature, each under its own name", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: gifts.id });
    const resources = service.getResources(id);
    expect(byLabel(resources, "Moonbeam")).toMatchObject({ max: 2, unit: "uses", recharge: "shortRest", sources: [{ name: "Tide Gifts", kind: "custom", elementId: gifts.id }] });
    expect(byLabel(resources, "Embers")).toMatchObject({ max: 7, unit: "charges", rechargeLabel: "regained at dawn" });
    expect(byLabel(resources, "Focus").max).toBe(2);
    expect(byLabel(resources, "Surge").spendOnSwitch).toBe("Surging");
    expect(resources.switches.map((entry) => entry.name)).toEqual(["Surging"]);
  });

  it("spend, rest and survive a reload", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: gifts.id });
    service.setTrackerUsed(id, { trackerId: "moonbeam", used: 2 });
    service.setTrackerUsed(id, { trackerId: "embers", used: 3 });
    expect(byLabel(service.restCharacter(id, { kind: "short" }), "Moonbeam").used).toBe(0);
    const reloaded = new CharacterService(undefined, library);
    reloaded.importCharacterXml("Reloaded", service.exportCharacterXml(id));
    expect(byLabel(reloaded.getResources("Reloaded"), "Embers").used).toBe(3);
  });

  it("turning the switch on spends the linked tracker", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: gifts.id });
    const after = service.setResourceSwitch(id, { name: "Surging", on: true });
    expect(byLabel(after, "Surge").used).toBe(1);
  });

  it("merge into one pool across two pack features", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: pooledA.id });
    service.addGrantedElement(id, { elementId: pooledB.id });
    const pool = service.getResources(id).trackers.filter((entry) => entry.pool === "Moon points");
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ max: 6, unit: "points", sources: [{ name: "First Light" }, { name: "Second Light" }] });
  });

  it("list the charges of a pack item while it is carried", () => {
    const { service, id } = fighter();
    service.addItem(id, { itemId: wand.id, amount: 1, baseElementId: null });
    expect(byLabel(service.getResources(id), "Charges")).toMatchObject({ max: 7, unit: "charges", sources: [{ name: "Ember Wand", kind: "custom" }] });
  });

  it("are listed once when the draft is also in the character's own pack", () => {
    const { service, id } = fighter();
    service.saveCustomDraft(id, { draft: pooledA });
    expect(service.getResources(id).trackers.filter((entry) => entry.label === "Moon points")).toHaveLength(1);
  });

  it("print on the sheet once", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: gifts.id });
    const model = buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" });
    const lines = model.pages.flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : []))));
    const resourceLines = lines.filter((line) => line.startsWith("Resources."));
    expect(resourceLines).toHaveLength(1);
    expect(resourceLines[0]).toContain("Moonbeam");
    expect(resourceLines[0]).toContain("Embers");
  });
});

describe("trackers of a feature written inside another element", () => {
  it("a species' feature carries them like any other", () => {
    const species = { ...createCustomSpeciesDraft("Tide Folk"), features: [{ level: 1, draft: { ...pooledA, showsUnder: "race" as const } }] };
    const xml = compileCustomElement(species, { source: "Moon Pack" });
    const elements = parseElementsFile(`<elements>${xml}</elements>`, "x.xml");
    const carrier = elements.find((element) => element.identity.id === pooledA.id)!;
    expect(carrier.setters.some((entry) => entry.name === "tracker")).toBe(true);
  });
});
