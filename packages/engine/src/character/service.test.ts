import { describe, expect, it } from "vitest";
import { parseDnd5e } from "../dnd5e/document.js";
import { mapToState } from "./mapping.js";
import { CharacterService } from "./service.js";
import { SAMPLE_CASTER, SAMPLE_CHARACTER } from "../testing/dnd5e-samples.js";

const DOCUMENTS: Record<string, string> = {
  "tst.dnd5e": SAMPLE_CHARACTER,
  "Billy.dnd5e": SAMPLE_CASTER,
};

const FIXTURES = Object.keys(DOCUMENTS);

const readFixture = (name: string): string => DOCUMENTS[name]!;

describe("character service", () => {
  it("round-trips every sample document byte-identically", () => {
    const service = new CharacterService();
    expect(FIXTURES.length).toBeGreaterThan(0);
    for (const file of FIXTURES) {
      const raw = readFixture(file);
      service.importCharacterXml(file, raw);
      expect(service.exportCharacterXml(file), file).toBe(raw);
    }
  }, 120_000);

  it("import stores the mapped state under the given id", () => {
    const service = new CharacterService();
    const state = service.importCharacterXml("billy", readFixture("Billy.dnd5e"));
    expect(state.id).toBe("billy");
    expect(state.name).toBe("Caster");
    expect(service.getCharacter("billy")).toBe(state);
  });

  it("holds multiple characters keyed by id", () => {
    const service = new CharacterService();
    service.importCharacterXml("a", readFixture("tst.dnd5e"));
    service.importCharacterXml("b", readFixture("Billy.dnd5e"));
    expect(service.getCharacter("a").name).toBe("tst");
    expect(service.getCharacter("b").name).toBe("Caster");
  });

  it("createCharacter produces a fresh level-1 character whose export round-trips", () => {
    const service = new CharacterService();
    const state = service.createCharacter("X");
    expect(state.id).toBe("X");
    expect(state.generationOption).toBe(2);
    expect(state.availablePoints).toBe(15);
    expect(state.level).toBe(1);
    expect(state.levelCount).toBe(1);
    expect(state.name).toBe("X");
    expect(state.abilities).toEqual({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    });
    const xml = service.exportCharacterXml("X");
    expect(xml.startsWith("<?xml version=\"1.0\" encoding=\"utf-8\"?>")).toBe(true);
    const remapped = mapToState(parseDnd5e(xml), "X");
    expect(remapped.generationOption).toBe(2);
    expect(remapped.availablePoints).toBe(15);
    expect(remapped.level).toBe(1);
    expect(remapped.levelCount).toBe(1);
    expect(remapped.name).toBe("X");
    expect(remapped.sum.elementCount).toBe(8);
    expect(remapped.registeredCount).toBe(3);
    expect(remapped.options.has("ID_INTERNAL_OPTION_ALLOW_MULTICLASSING")).toBe(true);
    expect(remapped.options.has("ID_INTERNAL_OPTION_ALLOW_FEATS")).toBe(true);
  });

  it("createCharacter exports CRLF line endings without an EOF newline", () => {
    const service = new CharacterService();
    service.createCharacter("Fresh");

    const xml = service.exportCharacterXml("Fresh");

    expect(xml).toContain("\r\n");
    expect(xml.replaceAll("\r\n", "")).not.toContain("\n");
    expect(xml.endsWith("\n")).toBe(false);
  });

  it("createCharacter names are escaped in the export", () => {
    const service = new CharacterService();
    const state = service.createCharacter('A&B <C>');
    expect(state.name).toBe('A&B <C>');
    const xml = service.exportCharacterXml('A&B <C>');
    expect(xml).toContain("<name>A&amp;B &lt;C&gt;</name>");
  });

  it("createCharacter exports the pinned fresh template: options first, registered-count 3, ruleset", () => {
    const service = new CharacterService();
    service.createCharacter("Fresh");
    const xml = service.exportCharacterXml("Fresh");
    expect(xml).toContain('<ruleset mode="all" />');
    expect(xml).toContain('<gender>Male</gender>');
    expect(xml).toContain('<player-name>Player One</player-name>');
    expect(xml).toContain('<elements level-count="1" registered-count="3">');
    const optionsIndex = xml.indexOf('<element type="Option" name="Multiclassing" id="ID_INTERNAL_OPTION_ALLOW_MULTICLASSING" />');
    const featsIndex = xml.indexOf('<element type="Option" name="Feats" id="ID_INTERNAL_OPTION_ALLOW_FEATS" />');
    const levelIndex = xml.indexOf('<element type="Level" name="1" id="ID_LEVEL_1">');
    expect(optionsIndex).toBeGreaterThan(-1);
    expect(featsIndex).toBeGreaterThan(optionsIndex);
    expect(levelIndex).toBeGreaterThan(featsIndex);
    expect(xml).toContain('<sum element-count="8">');
  });

  it("updateDetails mutates state and the exported bytes", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    const updated = service.updateDetails("X", {
      name: "Bob",
      playerName: "Alice",
      gender: "Female",
      experience: 500,
      age: "30",
      height: "6'",
      weight: "180 lb.",
      eyes: "blue",
      skin: "fair",
      hair: "brown",
      backstory: "a story",
      additionalFeatures: "extra",
      allies: "friend",
      organisationName: "Order of the Stick",
      notes1: "left note",
      notes2: "right note",
    });
    expect(updated.name).toBe("Bob");
    expect(updated.playerName).toBe("Alice");
    expect(updated.gender).toBe("Female");
    expect(updated.experience).toBe(500);
    expect(updated.appearance.age).toBe("30");
    expect(updated.appearance.height).toBe("6'");
    expect(updated.appearance.weight).toBe("180 lb.");
    expect(updated.appearance.eyes).toBe("blue");
    expect(updated.appearance.skin).toBe("fair");
    expect(updated.appearance.hair).toBe("brown");
    expect(updated.backstory).toBe("a story");
    expect(updated.additionalFeatures).toBe("extra");
    expect(updated.organization).toEqual({ name: "Order of the Stick", symbol: "", allies: "friend" });
    expect(updated.notes).toEqual({ left: "left note", right: "right note" });

    const xml = service.exportCharacterXml("X");
    expect(xml).toContain("<name>Bob</name>");
    expect(xml).toContain("<player-name>Alice</player-name>");
    expect(xml).toContain("<gender>Female</gender>");
    expect(xml).toContain("<experience>500</experience>");
    expect(xml).toContain("<age>30</age>");
    expect(xml).toContain("<name>Order of the Stick</name>");
    expect(xml).toContain("<note column=\"left\">left note</note>");
    expect(xml).toContain("<note column=\"right\">right note</note>");

    const remapped = mapToState(parseDnd5e(xml), "X");
    expect(remapped.name).toBe("Bob");
    expect(remapped.playerName).toBe("Alice");
    expect(remapped.notes).toEqual({ left: "left note", right: "right note" });
    expect(remapped.organization.allies).toBe("friend");
    expect(remapped.backstory).toBe("a story");
    expect(remapped.additionalFeatures).toBe("extra");
    expect(remapped.appearance).toMatchObject({ age: "30", height: "6'", weight: "180 lb.", eyes: "blue", skin: "fair", hair: "brown" });
    expect(remapped.generationOption).toBe(2);
    expect(remapped.sum.elementCount).toBe(8);
  });

  it("updateDetails on an imported character mutates only the requested fields", () => {
    const service = new CharacterService();
    service.importCharacterXml("tst", readFixture("tst.dnd5e"));
    service.updateDetails("tst", { name: "Renamed" });
    const xml = service.exportCharacterXml("tst");
    expect(xml).toContain("<name>Renamed</name>");
    expect(xml).toContain("<race>Rock Gnome</race>");
    expect(xml).toContain("available-points=\"15\"");
    const remapped = mapToState(parseDnd5e(xml), "tst");
    expect(remapped.name).toBe("Renamed");
    expect(remapped.race).toBe("Rock Gnome");
    expect(remapped.registeredCount).toBe(3);
  });

  it("setAbilities persists the generation option alongside the scores", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    const updated = service.setAbilities("X", {
      strength: 15, dexterity: 15, constitution: 15,
      intelligence: 8, wisdom: 8, charisma: 8,
    }, 3);
    expect(updated.generationOption).toBe(3);
    expect(updated.abilities.strength).toBe(15);
    const xml = service.exportCharacterXml("X");
    expect(xml).toContain("<generationOption>3</generationOption>");
    const remapped = mapToState(parseDnd5e(xml), "X");
    expect(remapped.generationOption).toBe(3);
    expect(remapped.abilities.strength).toBe(15);
  });

  it("setAbilities keeps the stored generation option when none is provided", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    service.setAbilities("X", {
      strength: 15, dexterity: 15, constitution: 15,
      intelligence: 8, wisdom: 8, charisma: 8,
    }, 1);
    const updated = service.setAbilities("X", {
      strength: 14, dexterity: 15, constitution: 15,
      intelligence: 8, wisdom: 8, charisma: 8,
    });
    expect(updated.generationOption).toBe(1);
    expect(service.exportCharacterXml("X")).toContain("<generationOption>1</generationOption>");
  });

  it("setAbilities writes the recomputed available-points attribute", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    service.setAbilities("X", {
      strength: 15, dexterity: 14, constitution: 13,
      intelligence: 12, wisdom: 10, charisma: 8,
    }, 3);
    expect(service.exportCharacterXml("X")).toContain('available-points="0"');
    const updated = service.setAbilities("X", {
      strength: 16, dexterity: 10, constitution: 10,
      intelligence: 10, wisdom: 10, charisma: 10,
    });
    expect(updated.availablePoints).toBe(6);
    expect(service.exportCharacterXml("X")).toContain('available-points="6"');
  });

  it("setAbilities adds the generation option to a file that has none", () => {
    const service = new CharacterService();
    const xml = readFixture("tst.dnd5e").replace(/[ \t]*<generationOption>\d+<\/generationOption>\r?\n/, "");
    expect(xml).not.toContain("<generationOption>");
    const imported = service.importCharacterXml("tst", xml);
    expect(imported.generationOption).toBe(2);
    service.setAbilities("tst", {
      strength: 15, dexterity: 14, constitution: 13,
      intelligence: 12, wisdom: 10, charisma: 8,
    }, 3);
    const exported = service.exportCharacterXml("tst");
    expect(exported).toContain("<generationOption>3</generationOption>");
    expect(mapToState(parseDnd5e(exported), "tst").generationOption).toBe(3);
  });

  it("setAbilities rejects a non-integer generation option", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    expect(() => service.setAbilities("X", {
      strength: 10, dexterity: 10, constitution: 10,
      intelligence: 10, wisdom: 10, charisma: 10,
    }, 1.5)).toThrowError(/generation option/);
  });

  it("setPortrait embeds base64 into the exported bytes", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    service.setPortrait("X", b64);
    const xml = service.exportCharacterXml("X");
    expect(xml).toContain(`<base64><![CDATA[${b64}]]></base64>`);
    const remapped = mapToState(parseDnd5e(xml), "X");
    expect(remapped.portrait.base64).toBe(b64);
  });

  it("setPortrait creates the base64 node when the imported document lacks one", () => {
    const service = new CharacterService();
    service.createCharacter("seed");
    // The format only carries <base64> when a portrait was stored, so
    // imported documents routinely carry <portrait> without it.
    const stripped = service
      .exportCharacterXml("seed")
      .replace(/[ \t]*<base64>.*<\/base64>\r?\n/, "");
    expect(stripped).not.toContain("<base64>");
    service.importCharacterXml("Y", stripped);
    const b64 = "dGVzdA==";
    service.setPortrait("Y", b64);
    const xml = service.exportCharacterXml("Y");
    expect(xml).toContain(`<base64><![CDATA[${b64}]]></base64>`);
    expect(mapToState(parseDnd5e(xml), "Y").portrait.base64).toBe(b64);
  });

  it("setPortrait creates the whole portrait block when the document lacks one", () => {
    const service = new CharacterService();
    service.createCharacter("seed2");
    // Strip only the display-properties portrait block; the appearance
    // portrait nodes elsewhere in the document stay untouched.
    const stripped = service
      .exportCharacterXml("seed2")
      .replace(/[ \t]*<portrait>[\s\S]*?<\/portrait>\r?\n/, "");
    expect(stripped).not.toContain("<base64>");
    service.importCharacterXml("Z", stripped);
    const b64 = "dGVzdA==";
    service.setPortrait("Z", b64);
    const xml = service.exportCharacterXml("Z");
    expect(xml).toContain(`<base64><![CDATA[${b64}]]></base64>`);
    expect(mapToState(parseDnd5e(xml), "Z").portrait.base64).toBe(b64);
  });

  it("setPortrait writes a local filename so other readers accept the portrait", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    service.setPortrait("X", "dGVzdA==");
    // Readers of the format require BOTH <local> and <base64> to be non-blank
    // before they rehydrate the portrait.
    expect(service.exportCharacterXml("X")).toContain("<local>X-portrait.png</local>");
    service.removePortrait("X");
    const cleared = service.exportCharacterXml("X");
    expect(cleared).not.toContain("X-portrait.png");
  });

  it("removePortrait clears the embedded base64", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    service.setPortrait("X", "dGVzdA==");
    service.removePortrait("X");
    const xml = service.exportCharacterXml("X");
    expect(xml).toContain("<base64><![CDATA[]]></base64>");
    expect(mapToState(parseDnd5e(xml), "X").portrait.base64).toBe("");
  });

  it("getCharacter throws not-found for unknown ids", () => {
    const service = new CharacterService();
    expect(() => service.getCharacter("missing")).toThrowError(expect.objectContaining({ code: "not-found" }));
  });

  it("updateDetails throws not-found for unknown ids", () => {
    const service = new CharacterService();
    expect(() => service.updateDetails("missing", { name: "X" })).toThrowError(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("exportCharacterXml throws not-found for unknown ids", () => {
    const service = new CharacterService();
    expect(() => service.exportCharacterXml("missing")).toThrowError(expect.objectContaining({ code: "not-found" }));
  });

  it("deleteCharacter removes the character", () => {
    const service = new CharacterService();
    service.createCharacter("X");
    service.deleteCharacter("X");
    expect(() => service.getCharacter("X")).toThrowError(expect.objectContaining({ code: "not-found" }));
  });

  it("importCharacterXml rejects invalid xml with content-invalid", () => {
    const service = new CharacterService();
    expect(() => service.importCharacterXml("bad", "<character>")).toThrowError(
      expect.objectContaining({ code: "content-invalid" }),
    );
    expect(() => service.importCharacterXml("bad", "not xml at all")).toThrowError(
      expect.objectContaining({ code: "content-invalid" }),
    );
  });
});
