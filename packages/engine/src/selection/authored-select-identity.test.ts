/**
 * Same-label selects. One element may author several selects that share a
 * type, name and level but filter differently — the 2014 Arcane Trickster's
 * free Wizard spell beside its two Enchantment/Illusion spells, Arcane
 * Mastery's four Wizard picks of different spell levels, Giant Power's
 * edition-conditional cantrip pair. Each wrapper must resolve to the select
 * that spawned it (its checksum; for old or foreign checksums, its position
 * in a run that has exactly the authored shape), and the detail groups,
 * numbered slots, option lists and spell browse all follow that identity.
 * A wrapper whose select cannot be identified keeps its saved choice but
 * offers no new picks rather than guessing a filter.
 *
 * Synthetic content only; the corpus cases live in
 * subclass-school-spells.test.ts.
 */

import { describe, expect, it } from "vitest";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import type { SelectRule } from "../content/parser.js";
import type { CharacterState } from "../character/state.js";
import { CharacterService } from "../character/service.js";
import { buildCharacterDetail } from "./detail.js";
import {
  pendingSelectionRules,
  selectionRuleChecksum,
  selectionOptions,
  selectionSlotRule,
  type SelectionRule,
} from "./selection.js";
import { seededRng } from "../testing/character-factory.js";

const FOLK = "ID_TEST_RACE_FOLK";
const SINGLE = "ID_TEST_RACE_SINGLE";
const EDITIONS = "ID_TEST_RACE_EDITIONS";
const NEW_MARK = "ID_TEST_TRAIT_NEW_EDITION";
const OLD_MARK = "ID_TEST_TRAIT_OLD_EDITION";

const BOLT = "ID_TEST_SPELL_BOLT";
const CHARM = "ID_TEST_SPELL_CHARM";
const VEIL = "ID_TEST_SPELL_VEIL";
const SLEEP = "ID_TEST_SPELL_SLEEP";
const WARD = "ID_TEST_SPELL_WARD";

const spell = (id: string, name: string, school: string, tags = "Arcane"): string => `
  <element name="${name}" type="Spell" source="Identity Test" id="${id}">
    <supports>${tags}</supports>
    <setters><set name="level">1</set><set name="school">${school}</set></setters>
  </element>`;

function contentXml(restricted = "Arcane,1,(Enchantment||Illusion)"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <element name="Test Folk" type="Race" source="Identity Test" id="${FOLK}">
    <rules>
      <select type="Spell" name="Folk Spell" supports="Arcane,1" />
      <select type="Spell" name="Folk Spell" supports="${restricted}" number="2" />
    </rules>
  </element>
  <element name="Single Folk" type="Race" source="Identity Test" id="${SINGLE}">
    <rules>
      <select type="Spell" name="Single Spell" supports="Arcane,1" number="3" />
    </rules>
  </element>
  <element name="Edition Folk" type="Race" source="Identity Test" id="${EDITIONS}">
    <rules>
      <grant type="Racial Trait" id="${NEW_MARK}" />
      <select type="Spell" name="Edition Spell" supports="${BOLT}|${WARD}" requirements="${OLD_MARK}" />
      <select type="Spell" name="Edition Spell" supports="${CHARM}|${VEIL}" requirements="${NEW_MARK}" />
    </rules>
  </element>
  <element name="New Edition" type="Racial Trait" source="Identity Test" id="${NEW_MARK}" />
  <element name="Old Edition" type="Racial Trait" source="Identity Test" id="${OLD_MARK}" />
  ${spell(BOLT, "Bolt", "Evocation")}
  ${spell(CHARM, "Charm", "Enchantment")}
  ${spell(VEIL, "Veil", "Illusion")}
  ${spell(SLEEP, "Sleep", "Enchantment")}
  ${spell(WARD, "Ward", "Abjuration")}
</elements>`;
}

function syntheticLibrary(restricted?: string): ElementLibrary {
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, new Map([["test/identity.xml", contentXml(restricted)]]));
  return library;
}

interface Built {
  service: CharacterService;
  id: string;
  library: ElementLibrary;
}

function withRace(raceId: string, library = syntheticLibrary()): Built {
  const service = new CharacterService(undefined, library, { rng: seededRng(1) });
  const id = service.createCharacter("identity").id;
  const race = pendingSelectionRules(service.getCharacter(id)).find((rule) => rule.type === "Race")!;
  service.setSelection(id, race.identifier, raceId);
  return { service, id, library };
}

/** The detail groups of a spell rule name, in spawn order. */
function groups(built: Built, name: string, id = built.id) {
  return built.service.getCharacterDetail(id).selectionRules.filter((rule) => rule.name === name);
}

/** Every wrapper of a rule name, filled or not, in spawn order. */
function wrappers(state: CharacterState, name: string): SelectionRule[] {
  const found: SelectionRule[] = [];
  const walk = (nodes: CharacterState["elements"], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (node.requiredLevel !== undefined && node.name === name) {
        const registered = node.registered ?? "";
        found.push({
          identifier: state.selectionRuleIds.get(here.join(".")) ?? "",
          type: node.type,
          name: node.name,
          requiredLevel: node.requiredLevel,
          hasSelection: registered !== "",
          selectedElementIds: registered !== "" ? [registered] : [],
          path: here,
        });
      }
      walk(node.children, here);
    });
  };
  walk(state.elements, []);
  return found;
}

function options(built: Built, rule: SelectionRule, id = built.id): string[] {
  return selectionOptions(built.service.getCharacter(id), built.library, rule).map((option) => option.id);
}

/** Rewrites every wrapper line of a rule name in exported XML. */
function rewriteWrappers(xml: string, name: string, rewrite: (line: string, index: number) => string | null): string {
  let index = 0;
  return xml
    .split("\n")
    .flatMap((line) => {
      if (!line.includes(`name="${name}"`) || !line.includes("requiredLevel=")) return [line];
      const next = rewrite(line, index++);
      return next === null ? [] : [next];
    })
    .join("\n");
}

const foreignChecksum = (line: string): string =>
  line.replace(/ checksum="[^"]*"/, ' checksum="0badc0de"').replace(/ number="\d+"/, "");

describe("same-label selects on one element", () => {
  it("form separate detail groups, each with its own filter", () => {
    const built = withRace(FOLK);
    const [free, restricted] = groups(built, "Folk Spell");
    expect(groups(built, "Folk Spell").map((group) => group.selectionCount)).toEqual([1, 2]);
    expect(free!.hasAvailableOptions).toBe(true);
    expect(restricted!.hasAvailableOptions).toBe(true);

    const [freeSlot, firstRestricted, secondRestricted] = wrappers(built.service.getCharacter(built.id), "Folk Spell");
    expect(options(built, freeSlot!)).toEqual([BOLT, CHARM, VEIL, SLEEP, WARD]);
    expect(options(built, firstRestricted!)).toEqual([CHARM, VEIL, SLEEP]);
    expect(options(built, secondRestricted!)).toEqual([CHARM, VEIL, SLEEP]);
  });

  it("selects, replaces and clears within one group without touching the other", () => {
    const built = withRace(FOLK);
    const { service, id } = built;
    const [free, restricted] = groups(built, "Folk Spell");

    expect(() => service.setSelection(id, restricted!.identifier, BOLT, 1)).toThrow(/not eligible/);
    service.setSelection(id, free!.identifier, BOLT);
    service.setSelection(id, restricted!.identifier, CHARM, 1);
    service.setSelection(id, restricted!.identifier, VEIL, 2);
    expect(groups(built, "Folk Spell").map((group) => group.selectedElementIds)).toEqual([[BOLT], [CHARM, VEIL]]);

    service.setSelection(id, restricted!.identifier, SLEEP, 1);
    expect(groups(built, "Folk Spell").map((group) => group.selectedElementIds)).toEqual([[BOLT], [SLEEP, VEIL]]);

    service.clearSelection(id, restricted!.identifier, 2);
    expect(groups(built, "Folk Spell").map((group) => group.selectedElementIds)).toEqual([[BOLT], [SLEEP, null]]);
    const sum = service.getCharacter(id).sum.elements.map((element) => element.id);
    expect(sum).toEqual(expect.arrayContaining([BOLT, SLEEP]));
    expect(sum).not.toContain(VEIL);
  });

  it("clamps numbered slots to the authored group, not the whole label run", () => {
    const built = withRace(FOLK);
    const state = built.service.getCharacter(built.id);
    const [freeSlot, firstRestricted, secondRestricted] = wrappers(state, "Folk Spell");
    expect(selectionSlotRule(state, freeSlot!, 3, built.library).path).toEqual(freeSlot!.path);
    expect(selectionSlotRule(state, firstRestricted!, 2, built.library).path).toEqual(secondRestricted!.path);
    expect(selectionSlotRule(state, secondRestricted!, 1, built.library).path).toEqual(firstRestricted!.path);
  });

  it("browses each group separately: the restricted group never lists an out-of-school spell", () => {
    const built = withRace(FOLK);
    const { service, id } = built;
    const [free, restricted] = groups(built, "Folk Spell");
    service.setSelection(id, restricted!.identifier, CHARM, 1);

    const freeBrowse = service.getSpellBrowse(id, free!.identifier);
    expect(freeBrowse.selectionCount).toBe(1);
    expect(freeBrowse.spells.map((entry) => entry.id)).toContain(BOLT);

    const restrictedBrowse = service.getSpellBrowse(id, restricted!.identifier);
    expect(restrictedBrowse.selectionCount).toBe(2);
    expect(restrictedBrowse.slots.map((slot) => slot.spellId)).toEqual([CHARM, null]);
    const statuses = Object.fromEntries(restrictedBrowse.spells.map((entry) => [entry.id, entry.status]));
    expect(statuses).toEqual({ [CHARM]: "selected", [SLEEP]: "learnable", [VEIL]: "learnable" });
  });

  it("keeps both groups and every pick through export and import", () => {
    const built = withRace(FOLK);
    const { service, id } = built;
    const [free, restricted] = groups(built, "Folk Spell");
    service.setSelection(id, free!.identifier, BOLT);
    service.setSelection(id, restricted!.identifier, CHARM, 1);

    service.importCharacterXml("reimported", service.exportCharacterXml(id));
    const again = groups(built, "Folk Spell", "reimported");
    expect(again.map((group) => group.selectedElementIds)).toEqual([[BOLT], [CHARM, null]]);
    const open = wrappers(service.getCharacter("reimported"), "Folk Spell")[2]!;
    expect(options(built, open, "reimported")).toEqual([VEIL, SLEEP]);
  });
});

describe("wrappers without their current checksum", () => {
  function picked(): { built: Built; xml: string } {
    const built = withRace(FOLK);
    const [free, restricted] = groups(built, "Folk Spell");
    built.service.setSelection(built.id, free!.identifier, BOLT);
    built.service.setSelection(built.id, restricted!.identifier, CHARM, 1);
    return { built, xml: built.service.exportCharacterXml(built.id) };
  }

  it("resolve by position when the run has exactly the authored shape", () => {
    const { built, xml } = picked();
    built.service.importCharacterXml("legacy", rewriteWrappers(xml, "Folk Spell", foreignChecksum));

    const legacy = groups(built, "Folk Spell", "legacy");
    expect(legacy.map((group) => group.selectedElementIds)).toEqual([[BOLT], [CHARM, null]]);
    const open = wrappers(built.service.getCharacter("legacy"), "Folk Spell")[2]!;
    expect(options(built, open, "legacy")).toEqual([VEIL, SLEEP]);
  });

  it("keep saved picks but offer nothing new when an incomplete run is ambiguous", () => {
    const { built, xml } = picked();
    // Drop the empty third wrapper: two wrappers cannot be matched to the
    // three authored slots, so neither survivor can name its select.
    const incomplete = rewriteWrappers(xml, "Folk Spell", (line, index) => (index === 2 ? null : foreignChecksum(line)));
    built.service.importCharacterXml("ambiguous", incomplete);

    const ambiguous = groups(built, "Folk Spell", "ambiguous");
    expect(ambiguous.map((group) => group.selectedElementIds)).toEqual([[BOLT], [CHARM]]);
    for (const rule of wrappers(built.service.getCharacter("ambiguous"), "Folk Spell")) {
      expect(options(built, rule, "ambiguous")).toEqual([]);
    }
    const sum = built.service.getCharacter("ambiguous").sum.elements.map((element) => element.id);
    expect(sum).toEqual(expect.arrayContaining([BOLT, CHARM]));
    expect(() => built.service.setSelection("ambiguous", ambiguous[1]!.identifier, SLEEP)).toThrow(/not eligible/);
  });

  it("still resolve an incomplete run by exact checksum", () => {
    const { built, xml } = picked();
    built.service.importCharacterXml("exact", rewriteWrappers(xml, "Folk Spell", (line, index) => (index === 2 ? null : line)));
    const exact = groups(built, "Folk Spell", "exact");
    expect(exact.map((group) => group.selectedElementIds)).toEqual([[BOLT], [CHARM]]);
    const restricted = wrappers(built.service.getCharacter("exact"), "Folk Spell")[1]!;
    expect(options(built, restricted, "exact")).toEqual([CHARM, VEIL, SLEEP]);
  });

  it("refuse a positional guess when in-memory slot numbers conflict with the authored shape", () => {
    const { built, xml } = picked();
    built.service.importCharacterXml("numbered", rewriteWrappers(xml, "Folk Spell", foreignChecksum));
    const state = structuredClone(built.service.getCharacter("numbered"));
    const [, first, second] = wrappers(state, "Folk Spell");
    const nodeAt = (path: number[]) => path.reduce<{ children: CharacterState["elements"] } & Partial<CharacterState["elements"][number]>>(
      (node, index) => node.children[index]!,
      { children: state.elements },
    );
    nodeAt(first!.path).number = 2;
    nodeAt(second!.path).number = 1;
    expect(selectionOptions(state, built.library, second!)).toEqual([]);

    nodeAt(first!.path).number = 1;
    nodeAt(second!.path).number = 2;
    expect(selectionOptions(state, built.library, second!).map((option) => option.id)).toEqual([VEIL, SLEEP]);
  });

  it("keep a sole authored select's partial group together (old saved groups)", () => {
    const built = withRace(SINGLE);
    const [single] = groups(built, "Single Spell");
    expect(single!.selectionCount).toBe(3);
    built.service.setSelection(built.id, single!.identifier, BOLT, 1);
    const xml = rewriteWrappers(built.service.exportCharacterXml(built.id), "Single Spell", (line, index) =>
      index === 2 ? null : foreignChecksum(line),
    );
    built.service.importCharacterXml("partial", xml);

    const partial = groups(built, "Single Spell", "partial");
    expect(partial.map((group) => group.selectedElementIds)).toEqual([[BOLT, null]]);
    expect(partial[0]!.hasAvailableOptions).toBe(true);
    const open = wrappers(built.service.getCharacter("partial"), "Single Spell")[1]!;
    expect(options(built, open, "partial")).toEqual([CHARM, VEIL, SLEEP, WARD]);
  });
});

describe("edition-conditional same-label selects", () => {
  it("emit only the active select, and an old checksum maps to that one rather than the first", () => {
    const built = withRace(EDITIONS);
    const [edition] = groups(built, "Edition Spell");
    expect(groups(built, "Edition Spell")).toHaveLength(1);
    const rule = wrappers(built.service.getCharacter(built.id), "Edition Spell")[0]!;
    expect(options(built, rule)).toEqual([CHARM, VEIL]);

    built.service.setSelection(built.id, edition!.identifier, CHARM);
    const xml = rewriteWrappers(built.service.exportCharacterXml(built.id), "Edition Spell", foreignChecksum);
    built.service.importCharacterXml("legacy", xml);
    const legacy = wrappers(built.service.getCharacter("legacy"), "Edition Spell")[0]!;
    expect(options(built, legacy, "legacy")).toEqual([CHARM, VEIL]);
  });

  it("keep an inactive select's exact identity: the saved pick stays, no new pick is offered", () => {
    const built = withRace(EDITIONS);
    const [edition] = groups(built, "Edition Spell");
    built.service.setSelection(built.id, edition!.identifier, CHARM);
    const oldRule = built.library.byId.get(EDITIONS)!.rules.find(
      (rule): rule is SelectRule => rule.kind === "select" && rule.requirements === OLD_MARK,
    )!;
    const oldChecksum = selectionRuleChecksum(EDITIONS, oldRule, 1);
    const xml = rewriteWrappers(built.service.exportCharacterXml(built.id), "Edition Spell", (line) =>
      line.replace(/ checksum="[^"]*"/, ` checksum="${oldChecksum}"`),
    );
    built.service.importCharacterXml("inactive", xml);

    const [inactive] = groups(built, "Edition Spell", "inactive");
    expect(inactive!.selectedElementIds).toEqual([CHARM]);
    const rule = wrappers(built.service.getCharacter("inactive"), "Edition Spell")[0]!;
    expect(options(built, rule, "inactive")).toEqual([]);
    expect(built.service.getCharacter("inactive").sum.elements.map((element) => element.id)).toContain(CHARM);
  });
});

describe("callers without identity context", () => {
  it("group by label when no library is at hand, as before", () => {
    const built = withRace(FOLK);
    const state = built.service.getCharacter(built.id);
    const detail = buildCharacterDetail(state);
    expect(detail.selectionRules.filter((rule) => rule.name === "Folk Spell").map((rule) => rule.selectionCount)).toEqual([3]);
    const [first, , third] = wrappers(state, "Folk Spell");
    expect(selectionSlotRule(state, first!, 3).path).toEqual(third!.path);
  });

  it("re-read availability after the library is refreshed in place", () => {
    const library = syntheticLibrary("Arcane,1,Necromancy");
    const built = withRace(FOLK, library);
    expect(groups(built, "Folk Spell").map((group) => group.hasAvailableOptions)).toEqual([true, false]);

    replaceLibraryFiles(library, new Map([["test/identity.xml", contentXml()]]));
    expect(groups(built, "Folk Spell").map((group) => group.hasAvailableOptions)).toEqual([true, true]);
  });
});
