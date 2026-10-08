/**
 * Automatic monk unarmed strike row: gaining Martial Arts (the
 * `martial arts:dice` statistic going from absent to present) appends one
 * unarmed attack row in the same mutation. These expectations are the
 * specification for that behaviour; changing one is a deliberate behaviour
 * change, not a rebaseline.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { type AttackDto } from "./attacks.js";
import { pendingSelectionRules, selectionOptions } from "../selection/selection.js";
import { buildCorpusLibrary } from "../testing/corpus.js";

let library: ElementLibrary;
beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

const MONK_2014 = "ID_WOTC_PHB_CLASS_MONK";
const MONK_2024 = "ID_WOTC_PHB24_CLASS_MONK";
const FIGHTER_2014 = "ID_WOTC_PHB_CLASS_FIGHTER";
const FIGHTER_2024 = "ID_WOTC_PHB24_CLASS_FIGHTER";
const MC_MONK = "ID_WOTC_PHB_MULTICLASS_MONK";
const OPTION_MULTICLASS = "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING";

const DEX_SCORES = {
  strength: 10, dexterity: 18, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8,
};

const newCharacter = (name: string, ruleset?: "2024"): { service: CharacterService; id: string } => {
  const service = new CharacterService(undefined, library);
  const id = service.createCharacter(name).id;
  if (ruleset !== undefined) service.setRulesetMode(id, ruleset);
  service.setAbilities(id, DEX_SCORES);
  return { service, id };
};

const pickClass = (service: CharacterService, id: string, classId: string): void => {
  const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
  const chosen = selectionOptions(service.getCharacter(id), library, rule).find((o) => o.id === classId);
  if (chosen === undefined) throw new Error(`class '${classId}' is not selectable`);
  service.setSelection(id, rule.identifier, chosen.id);
};

const levelTo = (service: CharacterService, id: string, target: number): void => {
  while (service.getCharacter(id).level < target) service.levelUpMode(id, { mode: "main" });
};

const unarmedRows = (rows: AttackDto[]): AttackDto[] => rows.filter((row) => row.kind === "unarmed");

describe("automatic monk unarmed strike row", () => {
  it("gives a 2024 monk exactly one unarmed row whose die follows level-ups", () => {
    const { service, id } = newCharacter("Auto Monk 2024", "2024");
    pickClass(service, id, MONK_2024);
    const rows = unarmedRows(service.getAttacks(id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Unarmed Strike");
    expect(rows[0]!.unarmed).toEqual({ dice: "" });
    expect(rows[0]!.damage).toBe("1d6+4 bludgeoning");
    levelTo(service, id, 5);
    expect(unarmedRows(service.getAttacks(id))).toHaveLength(1);
    expect(unarmedRows(service.getAttacks(id))[0]!.damage).toBe("1d8+4 bludgeoning");
    // The exported file carries the current die too, not the level-1 value.
    const xml = service.exportCharacterXml(id);
    expect(xml.match(/<attack [^>]*kind="unarmed"/g)).toHaveLength(1);
    expect(xml).toContain('damage="1d8+4 bludgeoning"');
  });

  it("gives a 2014 monk exactly one unarmed row whose die follows level-ups", () => {
    const { service, id } = newCharacter("Auto Monk 2014");
    pickClass(service, id, MONK_2014);
    const rows = unarmedRows(service.getAttacks(id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.damage).toBe("1d4+4 bludgeoning");
    levelTo(service, id, 5);
    expect(unarmedRows(service.getAttacks(id))).toHaveLength(1);
    expect(unarmedRows(service.getAttacks(id))[0]!.damage).toBe("1d6+4 bludgeoning");
  });

  it("appends the row after the rows the character already has", () => {
    const { service, id } = newCharacter("Monk With Notes");
    service.createAttack(id, { mode: "manual", name: "Thrown Rock", range: "20 ft", bonus: "+0", damage: "1", description: "" });
    pickClass(service, id, MONK_2014);
    const rows = service.getAttacks(id);
    expect(rows.map((row) => row.kind)).toEqual(["manual", "unarmed"]);
  });

  it("does not duplicate an unarmed row the player added before choosing Monk", () => {
    const { service, id } = newCharacter("Prepared Monk");
    service.createAttack(id, { mode: "unarmed" });
    pickClass(service, id, MONK_2014);
    expect(unarmedRows(service.getAttacks(id))).toHaveLength(1);
  });

  it("does not add a row when a manual row is already named Unarmed Strike", () => {
    const { service, id } = newCharacter("Named Fists");
    service.createAttack(id, { mode: "manual", name: "unarmed strike", range: "5 ft", bonus: "+4", damage: "1d4", description: "" });
    pickClass(service, id, MONK_2014);
    const rows = service.getAttacks(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("manual");
  });

  it("does not bring a deleted row back on later edits", () => {
    const { service, id } = newCharacter("Pacifist Monk");
    pickClass(service, id, MONK_2014);
    const row = unarmedRows(service.getAttacks(id))[0]!;
    service.deleteAttack(id, row.id);
    expect(service.getAttacks(id)).toEqual([]);
    levelTo(service, id, 3);
    service.setAbilities(id, { ...DEX_SCORES, strength: 12 });
    expect(service.getAttacks(id)).toEqual([]);
  });

  it("imports a monk without an unarmed row byte-identically and keeps it absent", () => {
    const { service, id } = newCharacter("Imported Monk");
    pickClass(service, id, MONK_2014);
    levelTo(service, id, 2);
    service.deleteAttack(id, unarmedRows(service.getAttacks(id))[0]!.id);
    const xml = service.exportCharacterXml(id);
    expect(xml).not.toContain("<attack ");

    const reader = new CharacterService(undefined, library);
    reader.importCharacterXml("copy", xml);
    expect(reader.getAttacks("copy")).toEqual([]);
    expect(reader.exportCharacterXml("copy")).toBe(xml);
    // An ordinary edit after the import is not an absent→present transition.
    reader.levelUpMode("copy", { mode: "main" });
    expect(reader.getAttacks("copy")).toEqual([]);
  });

  it("gives a Fighter nothing", () => {
    const { service, id } = newCharacter("Plain Fighter", "2024");
    pickClass(service, id, FIGHTER_2024);
    levelTo(service, id, 3);
    expect(service.getAttacks(id)).toEqual([]);
  });

  it("adds one row when a Fighter multiclasses into Monk", () => {
    const { service, id } = newCharacter("Fighter Monk");
    pickClass(service, id, FIGHTER_2014);
    levelTo(service, id, 2);
    expect(service.getAttacks(id)).toEqual([]);
    service.setCharacterOption(id, { optionId: OPTION_MULTICLASS, enabled: true });
    service.startMulticlass(id, MC_MONK);
    expect(service.getCharacter(id).level).toBe(2);
    const rows = unarmedRows(service.getAttacks(id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.damage).toBe("1d4+4 bludgeoning");
    service.levelUpMode(id, { mode: "multiclass", classId: MC_MONK });
    expect(unarmedRows(service.getAttacks(id))).toHaveLength(1);
  });
});

/** The thrown engine error, so a test can pin its code as well as its message. */
const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
};

describe("adding an unarmed strike by hand", () => {
  it("rejects a second unarmed row for a character who already has one", () => {
    const { service, id } = newCharacter("Double Fists", "2024");
    pickClass(service, id, FIGHTER_2024);
    expect(unarmedRows(service.createAttack(id, { mode: "unarmed" }))).toHaveLength(1);
    expect(thrownBy(() => service.createAttack(id, { mode: "unarmed" }))).toEqual({
      code: "conflict",
      message: "You already have an Unarmed Strike attack.",
    });
    expect(unarmedRows(service.getAttacks(id))).toHaveLength(1);
  });

  it("rejects a hand-added row once the monk's automatic row exists", () => {
    const { service, id } = newCharacter("Auto Then Manual");
    pickClass(service, id, MONK_2014);
    const xml = service.exportCharacterXml(id);
    expect(thrownBy(() => service.createAttack(id, { mode: "unarmed", damageDice: "1d8" }))).toMatchObject({
      code: "conflict",
    });
    // The rejected request leaves the document untouched.
    expect(service.exportCharacterXml(id)).toBe(xml);
  });

  it("rejects an unarmed row when a manual row is already named Unarmed Strike", () => {
    const { service, id } = newCharacter("Named Then Unarmed");
    service.createAttack(id, { mode: "manual", name: "Unarmed Strike", range: "5 ft", bonus: "+2", damage: "1", description: "" });
    expect(thrownBy(() => service.createAttack(id, { mode: "unarmed" }))).toMatchObject({ code: "conflict" });
    expect(service.getAttacks(id).map((row) => row.kind)).toEqual(["manual"]);
  });

  it("allows a new unarmed row after the old one was deleted", () => {
    const { service, id } = newCharacter("Second Chance Monk");
    pickClass(service, id, MONK_2014);
    service.deleteAttack(id, unarmedRows(service.getAttacks(id))[0]!.id);
    expect(unarmedRows(service.createAttack(id, { mode: "unarmed" }))).toHaveLength(1);
  });
});

/**
 * Martial Arts reached through a DM grant rather than the Monk class. No corpus
 * feat grants `martial arts:dice`, so a homebrew feat grants the PHB Martial
 * Arts class feature itself — the shape a "monk dip" feat pack takes.
 */
const MARTIAL_ARTS_2014 = "ID_WOTC_PHB_CLASS_FEATURE_MONK_MARTIAL_ARTS";
const DISCIPLE_FEAT = "ID_TEST_FEAT_DISCIPLE_OF_THE_OPEN_HAND";
const DISCIPLE_PACK = `<?xml version="1.0" encoding="utf-8"?>
<elements>
\t<element name="Disciple of the Open Hand" type="Feat" source="Monk Grant Test" id="${DISCIPLE_FEAT}">
\t\t<description><p>You learn the monk's Martial Arts.</p></description>
\t\t<rules>
\t\t\t<grant type="Class Feature" id="${MARTIAL_ARTS_2014}" />
\t\t</rules>
\t</element>
</elements>
`;

describe("automatic unarmed row from a DM grant", () => {
  let grantLibrary: ElementLibrary;
  beforeAll(() => {
    const files = new Map(library.fileContents);
    files.set("imports/monk-grant-test.xml", DISCIPLE_PACK);
    grantLibrary = { ...library, fileContents: new Map<string, string>() } as ElementLibrary;
    replaceLibraryFiles(grantLibrary, files);
  }, 120_000);

  const grantedFighter = (name: string): { service: CharacterService; id: string } => {
    const service = new CharacterService(undefined, grantLibrary);
    const id = service.createCharacter(name).id;
    service.setAbilities(id, DEX_SCORES);
    const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Class")!;
    service.setSelection(id, rule.identifier, FIGHTER_2014);
    expect(service.getAttacks(id)).toEqual([]);
    return { service, id };
  };

  it("adds exactly one unarmed row when a granted feat gives Martial Arts", () => {
    const { service, id } = grantedFighter("Granted Fists");
    service.addGrantedFeat(id, { featId: DISCIPLE_FEAT });
    const rows = service.getAttacks(id);
    expect(rows.map((row) => row.kind)).toEqual(["unarmed"]);
    expect(rows[0]!.name).toBe("Unarmed Strike");
    expect(rows[0]!.damage).toBe("1d4+4 bludgeoning");
    // The row is in the stored document, not only in the derived view.
    expect(service.exportCharacterXml(id).match(/<attack [^>]*kind="unarmed"/g)).toHaveLength(1);
  });

  it("does not add a second row when the grant is removed and given again", () => {
    const { service, id } = grantedFighter("Regranted Fists");
    service.addGrantedFeat(id, { featId: DISCIPLE_FEAT });
    service.removeGrantedFeat(id, { featId: DISCIPLE_FEAT });
    service.addGrantedFeat(id, { featId: DISCIPLE_FEAT });
    expect(unarmedRows(service.getAttacks(id))).toHaveLength(1);
  });

  it("adds nothing for a grant that does not give Martial Arts", () => {
    const { service, id } = grantedFighter("Brawler Fists");
    service.addGrantedFeat(id, { featId: "ID_PHB_FEAT_TAVERNBRAWLER" });
    expect(service.getAttacks(id)).toEqual([]);
  });
});
