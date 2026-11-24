import { describe, expect, it } from "vitest";
import { saveAdvantageTerms, savingThrowNote } from "./save-notes.js";

const terms = (text: string, title = "Test Feature"): string[] => saveAdvantageTerms({ title, text });
const note = (...texts: string[]): string =>
  savingThrowNote(texts.map((text, index) => ({ title: `Feature ${index}`, text })));

describe("saveAdvantageTerms", () => {
  it.each<[string, string[]]>([
    ["You have advantage on Dexterity saving throws.", ["Dex"]],
    ["You have Advantage on Strength and Constitution saving throws.", ["Str", "Con"]],
    ["You gain advantage on all Strength, Wisdom, and Charisma saving throws.", ["Str", "Wis", "Cha"]],
    ["You have advantage on Dexterity checks and Dexterity saving throws.", ["Dex"]],
    ["You gain advantage on Wisdom-based ability checks and Wisdom saving throws.", ["Wis"]],
    ["You have Advantage on saving throws to avoid or end the Blinded or Stunned condition.", ["Blinded", "Stunned"]],
    ["You have advantage on saving throws you make to avoid or end the stunned condition on yourself.", ["Stunned"]],
    ["You have advantage on saving throws against the blinded and deafened conditions.", ["Blinded", "Deafened"]],
    ["You have advantage on saving throws against being paralyzed, stunned, or put to sleep.", ["Paralysed", "Stunned", "Sleep"]],
    ["You gain advantage on saving throws against being paralysed.", ["Paralysed"]],
    ["You have advantage on saving throws to avoid becoming petrified or restrained.", ["Petrified", "Restrained"]],
    ["You gain advantage on saving throws against disease and being stunned.", ["Disease", "Stunned"]],
    ["You have advantage on saving throws against illusions and against being charmed.", ["Illusions", "Charmed"]],
    ["You gain Advantage on saving throws you make to maintain Concentration.", ["Concentration"]],
    ["You gain advantage on Constitution saves made to maintain your concentration on a spell.", ["Concentration"]],
    ["Also, you gain Advantage on Death Saving Throws.", ["Death"]],
    ["You have advantage on saving throws against poison, and you have resistance to poison damage.", ["Poison"]],
    ["You gain advantage on saving throws against spells.", ["Spells"]],
    ["In addition, you gain advantage on saving throws against spells and other magical effects.", ["Magic"]],
    ["You have advantage on Intelligence and Wisdom saving throws against magic.", ["Int/Wis vs Magic"]],
    ["You have advantage on Dexterity saving throws against effects that you can see.", ["Dex (seen)"]],
    ["You gain Advantage on Wisdom saving throws unless you have the Incapacitated condition.", ["Wis"]],
    ["Advantage on saving throws against being charmed, and magic can't reach you.", ["Charmed"]],
    ["You keep watch.\n• You gain advantage on death saving throws.", ["Death"]],
    ["You are changed by this, with these benefits:\n• You have advantage on saving throws against disease.", ["Disease"]],
  ])("reads %j", (text, expected) => {
    expect(terms(text)).toEqual(expected);
  });

  it.each([
    // Disadvantage, on the character or on a target.
    "You have disadvantage on Wisdom saving throws.",
    "The target has Disadvantage on the next saving throw it makes.",
    "When you hit a creature, it has disadvantage on saves against your spells.",
    // Another creature's benefit.
    "Your allies within 10 feet of you have advantage on saving throws against being charmed.",
    "They gain Advantage on attack rolls and saving throws until your next turn.",
    "The creature has advantage on the next saving throw it makes.",
    "You and your allies gain advantage on Strength saving throws.",
    "If the target can hear you, it gains advantage on the saving throw.",
    // Not a standing benefit on a save.
    "You have advantage on attack rolls.",
    "You can gain advantage on a single saving throw.",
    "When you fail a Wisdom saving throw, you can reroll it with advantage.",
    "You have advantage on saving throws.",
    // A scope the note cannot state.
    "You also have Advantage on any saving throw you make to maintain Concentration on that ward.",
    "You have advantage on saving throws you are forced to make by giants.",
    "You have advantage on saving throws against spells cast by dragons.",
    "You have advantage on Wisdom saving throws, as do your allies.",
    // A temporary state.
    "While wearing this token, you have advantage on saving throws against being poisoned.",
    "Until you emerge, you gain a bonus to AC, and you have advantage on Strength saving throws.",
    "For the duration, you have advantage on saving throws against spells.",
    "Your speed increases, and you gain advantage on Dexterity saving throws for 1 minute.",
    "You gain these benefits, which last for 1 minute:\n• You have advantage on Strength saving throws.",
    "Until it ends, you enjoy these benefits:\n• You have advantage on Strength saving throws.",
  ])("leaves out %j", (text) => {
    expect(terms(text)).toEqual([]);
  });

  it("marks a benefit that holds while raging", () => {
    expect(terms("While Raging, you have Advantage on Strength checks and Strength saving throws.")).toEqual(["Str (Rage)"]);
    expect(terms("Until your rage ends, your friends gain a boost and you have advantage on saving throws against being frightened."))
      .toEqual(["Frightened (Rage)"]);
  });

  it("reads a Rage feature's own text as raging, whatever its level prefix", () => {
    expect(terms("Advantage on Strength Saves.", "Rage")).toEqual(["Str (Rage)"]);
    expect(terms("You have advantage on Strength saving throws.", "Level 1: Rage")).toEqual(["Str (Rage)"]);
    expect(terms("You have advantage on Strength saving throws.", "Rage of the Tides")).toEqual(["Str"]);
  });
});

describe("savingThrowNote", () => {
  it("is empty when nothing grants Advantage on a save", () => {
    expect(savingThrowNote([])).toBe("");
    expect(note("You can see in the dark.", "The target has disadvantage on saving throws.")).toBe("");
  });

  it("joins features into one deduplicated line", () => {
    expect(note(
      "You gain Advantage on saving throws you make to maintain Concentration.",
      "You gain Advantage on saving throws to avoid or end the Charmed or Frightened conditions.",
      "You have advantage on saving throws against being charmed.",
    )).toBe("Adv: Charmed, Frightened, Concentration");
  });

  it("keeps a stable order whatever the feature order", () => {
    const texts = [
      "You gain advantage on death saving throws.",
      "You have advantage on saving throws against being stunned.",
      "You have advantage on Wisdom saving throws.",
      "You have advantage on Dexterity saving throws.",
    ];
    expect(note(...texts)).toBe("Adv: Dex, Wis, Stunned, Death");
    expect(note(...[...texts].reverse())).toBe("Adv: Dex, Wis, Stunned, Death");
  });

  it("drops a term a broader one already covers", () => {
    expect(note("While Raging, you have advantage on Strength saving throws.", "You have advantage on Strength saving throws."))
      .toBe("Adv: Str");
    expect(note("You have advantage on saving throws against poison.", "You gain advantage on saving throws against being poisoned."))
      .toBe("Adv: Poison");
    expect(note("You gain advantage on saving throws against spells.", "In addition, you gain advantage on saving throws against spells and other magical effects."))
      .toBe("Adv: Magic");
  });
});
