/**
 * A `<sheet usage="...">` line on an uploaded element (a file a user added,
 * not a book and not a builder form) is tracked on the Resources view, the
 * same as a book feature's. The content here is invented for the test.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { buildFighter3, sharedLibrary } from "../testing/character-factory.js";
import { buildCharacterSheetModel } from "../sheet/model.js";
import type { CharacterService } from "../character/service.js";
import type { ResourcesDto, TrackerDto } from "@forge-cb/api";

const SOURCE = "Glimmerfen Notes";
const FEAT = "ID_GLIMMERFEN_FEAT_MARSHLIGHT_BOON";
const TRAIT = "ID_GLIMMERFEN_TRAIT_REED_WHISPER";
const GIFT = "ID_GLIMMERFEN_ITEM_HERON_BLESSING";

// An uploaded pack written by hand: a feat with a usage line, which also grants a trait with its
// own usage line, and an item filed under an Additional features category with one more.
const PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="${SOURCE}" type="Source" source="${SOURCE}" id="ID_GLIMMERFEN_SOURCE">
    <description><p>Invented notes for a test.</p></description>
    <setters><set name="abbreviation">GLN</set></setters>
  </element>
  <element name="Marshlight Boon" type="Feat" source="${SOURCE}" id="${FEAT}">
    <description><p>Call a drifting light to guide you.</p></description>
    <sheet usage="2/Long Rest">
      <description>Call a drifting light to guide you.</description>
    </sheet>
    <rules>
      <grant type="Racial Trait" id="${TRAIT}" />
    </rules>
  </element>
  <element name="Reed Whisper" type="Racial Trait" source="${SOURCE}" id="${TRAIT}">
    <description><p>Ask the reeds what passed by.</p></description>
    <sheet usage="1/Short Rest">
      <description>Ask the reeds what passed by.</description>
    </sheet>
  </element>
  <element name="Heron Blessing" type="Magic Item" source="${SOURCE}" id="${GIFT}">
    <description><p>A heron's grace settles on you.</p></description>
    <sheet usage="3/Long Rest">
      <description>A heron's grace settles on you.</description>
    </sheet>
    <setters>
      <set name="category">Supernatural Gifts</set>
      <set name="type">Wondrous Item</set>
      <set name="rarity">Uncommon</set>
    </setters>
  </element>
</elements>`;

let library: ElementLibrary;
beforeAll(async () => {
  const base = await sharedLibrary();
  library = { ...base, fileContents: new Map<string, string>() } as ElementLibrary;
  replaceLibraryFiles(library, new Map([...(base.fileContents ?? []), ["imports/glimmerfen/notes.xml", PACK]]));
}, 120_000);

let counter = 0;
const fighter = () => buildFighter3(library, `UploadedUsage${counter++}`);
const tracker = (resources: ResourcesDto, label: string): TrackerDto | undefined =>
  resources.trackers.find((entry) => entry.label === label);

describe("usage lines on uploaded elements", () => {
  it("loads the uploaded elements as non-book content", () => {
    expect(library.byId.get(FEAT)?.declaredBy).toBe("imports/glimmerfen/notes.xml");
    expect(library.byId.get(TRAIT)?.declaredBy).toBe("imports/glimmerfen/notes.xml");
  });

  it("tracks the usage of an uploaded feat added to the character", () => {
    const { service, id } = fighter();
    expect(tracker(service.getResources(id), "Marshlight Boon")).toBeUndefined();
    service.addGrantedElement(id, { elementId: FEAT });
    expect(tracker(service.getResources(id), "Marshlight Boon")).toMatchObject({
      max: 2,
      unit: "uses",
      recharge: "longRest",
      sources: [{ name: "Marshlight Boon", elementId: FEAT }],
    });
  });

  it("tracks the usage of a feature the uploaded feat grants", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: FEAT });
    expect(tracker(service.getResources(id), "Reed Whisper")).toMatchObject({
      max: 1,
      recharge: "shortRest",
      sources: [{ name: "Reed Whisper", elementId: TRAIT }],
    });
  });

  it("spends and recovers the tracked uses on a rest", () => {
    const { service, id } = fighter();
    service.addGrantedElement(id, { elementId: FEAT });
    const key = tracker(service.getResources(id), "Reed Whisper")!.id;
    expect(tracker(service.setTrackerUsed(id, { trackerId: key, used: 1 }), "Reed Whisper")).toMatchObject({ used: 1, remaining: 0 });
    expect(tracker(service.restCharacter(id, { kind: "short" }), "Reed Whisper")).toMatchObject({ used: 0, remaining: 1 });
  });

  it("tracks the usage of an uploaded Additional features item once it is added", () => {
    const { service, id } = fighter();
    expect(tracker(service.getResources(id), "Heron Blessing")).toBeUndefined();
    service.setCharacterControl(id, { key: `item:${GIFT}`, enabled: true });
    expect(service.getCharacterAdjustments(id).find((entry) => entry.elementId === GIFT)?.enabled).toBe(true);
    expect(tracker(service.getResources(id), "Heron Blessing")).toMatchObject({
      id: `usage:${GIFT}`,
      max: 3,
      recharge: "longRest",
      sources: [{ name: "Heron Blessing", elementId: GIFT }],
    });
    // Switched off again, it is no longer a resource.
    service.setCharacterControl(id, { key: `item:${GIFT}`, enabled: false });
    expect(tracker(service.getResources(id), "Heron Blessing")).toBeUndefined();
  });

  it("tracks a gift carried as an equipment record, and counts it once when it is also switched on", () => {
    const { service, id } = fighter();
    service.addItem(id, { itemId: GIFT, amount: 1 });
    expect(trackersFor(service, id)).toHaveLength(1);
    service.setCharacterControl(id, { key: `item:${GIFT}`, enabled: true });
    expect(trackersFor(service, id)).toEqual([expect.objectContaining({ id: `usage:${GIFT}`, max: 3 })]);
  });

  it("prints the gift's uses once among the sheet's resources, and not as a feature", () => {
    const { service, id } = fighter();
    expect(sheetLines(service, id).filter((line) => line.includes("Heron Blessing"))).toEqual([]);
    service.setCharacterControl(id, { key: `item:${GIFT}`, enabled: true });
    const lines = sheetLines(service, id).filter((line) => line.includes("Heron Blessing"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Resources\. .*Heron Blessing \[ \] \[ \] \[ \] \(LR\)/);
    expect(lines[0]!.match(/Heron Blessing/g)).toHaveLength(1);
  });
});

const trackersFor = (service: CharacterService, id: string): TrackerDto[] =>
  service.getResources(id).trackers.filter((entry) => entry.label === "Heron Blessing");

/** Every printed line of the character's full sheet. */
const sheetLines = (service: CharacterService, id: string): string[] =>
  buildCharacterSheetModel(service.getCharacter(id), library, { mode: "full" }).pages
    .flatMap((page) => page.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === "lines" ? row.lines : []))));
