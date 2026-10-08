/**
 * Automatic monk unarmed strike row: gaining Martial Arts (the
 * `martial arts:dice` statistic going from absent to present) appends one
 * unarmed attack row in the same mutation. These expectations are the
 * specification for that behaviour; changing one is a deliberate behaviour
 * change, not a rebaseline.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
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
