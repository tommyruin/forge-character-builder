/**
 * Find Familiar, against the content the browser actually ships.
 *
 * Two defects sat here at once. The shipped baseline carried no Companion
 * elements at all, so every rule that selects one offered "No options
 * available" --- the wizard's Find Familiar, the warlock's Pact of the Chain,
 * and the two companion item proxies. And the shipped SRD spell was missing
 * the `<select type="Companion">` rule that the vendored Player's Handbook
 * spell carries, which mattered twice over: a character built here never got
 * the choice, and one imported from another builder arrived with the choice already
 * made but no rule to read `supports` from, so the filter was skipped and
 * every companion in the library was offered as a familiar.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createEmptyLibrary, replaceLibraryFiles, type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, selectSupportsFor, selectionOptions, type SelectionRule } from "./selection.js";
import { seededRng } from "../testing/character-factory.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../apps/client/public/content/", import.meta.url));
const SYSTEM_ROOT = fileURLToPath(new URL("../../../../third-party/elements/system/", import.meta.url));

/** The 15 forms the SRD Find Familiar spell names. */
const FAMILIAR_FORMS = [
  "Bat", "Cat", "Crab", "Frog", "Hawk", "Lizard", "Octopus", "Owl",
  "Poisonous Snake", "Quipper", "Rat", "Raven", "Sea Horse", "Spider", "Weasel",
];

/** The library exactly as the shipped browser build assembles it. */
async function shippedLibrary(): Promise<ElementLibrary> {
  const { PUBLIC_BASE_PATHS } = (await import(
    fileURLToPath(new URL("../../../../apps/client/config/contentProfile.mjs", import.meta.url))
  )) as { PUBLIC_BASE_PATHS: Set<string> };
  const files = new Map<string, string>();
  for (const name of PUBLIC_BASE_PATHS) files.set(name, await readFile(join(PUBLIC_ROOT, name), "utf8"));
  files.set("system/system-proxies.xml", await readFile(join(SYSTEM_ROOT, "system-proxies.xml"), "utf8"));
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files);
  return library;
}

/** A level 1 wizard who knows Find Familiar. */
function wizardWithFindFamiliar(library: ElementLibrary) {
  const service = new CharacterService(undefined, library, { rng: seededRng(1) });
  const id = service.createCharacter("Familiar Test").id;
  // The shipped baseline now carries the 2024 companions as well; this test
  // is about the 2014 spell's own list, so the character stays on the 2014
  // rules. In "All content" mode both editions' forms are offered.
  service.setRulesetMode(id, "2014");
  const pick = (type: string, elementId: string): void => {
    const rule = pendingSelectionRules(service.getCharacter(id)).find(
      (r) => r.type === type && !r.hasSelection,
    );
    if (rule) service.setSelection(id, rule.identifier, elementId);
  };
  pick("Race", "ID_RACE_HALFELF");
  pick("Class", "ID_WOTC_PHB_CLASS_WIZARD");
  for (const rule of pendingSelectionRules(service.getCharacter(id)).filter((r) => r.type === "Spell")) {
    try {
      service.setSelection(id, rule.identifier, "ID_PHB_SPELL_FIND_FAMILIAR");
      break;
    } catch {
      // A cantrip slot cannot hold a 1st-level spell; try the next rule.
    }
  }
  return { service, id };
}

/** Every Companion node in the tree, whether or not it already holds a choice. */
function companionRules(state: ReturnType<CharacterService["getCharacter"]>): SelectionRule[] {
  const rules: SelectionRule[] = [];
  const walk = (nodes: readonly { type: string; name: string; requiredLevel?: number; registered?: string; children: readonly unknown[] }[], path: number[]): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      if (node.type === "Companion") {
        rules.push({
          identifier: here.join("."),
          type: node.type,
          name: node.name,
          requiredLevel: node.requiredLevel ?? 1,
          hasSelection: Boolean(node.registered),
          selectedElementIds: node.registered ? [node.registered] : [],
          path: here,
        });
      }
      walk(node.children as never[], here);
    });
  };
  walk(state.elements as never[], []);
  return rules;
}

describe("Find Familiar against the shipped content", () => {
  it("ships companion elements for the rules that select one", async () => {
    const library = await shippedLibrary();
    const companions = [...library.byId.values()].filter((e) => e.identity.type === "Companion");
    expect(companions.length).toBeGreaterThan(0);
    // Every form the spell names has to be selectable.
    const names = new Set(companions.map((e) => e.identity.name));
    for (const form of FAMILIAR_FORMS) expect(names).toContain(form);
  });

  it("gives a wizard who learns the spell a familiar to choose", async () => {
    const library = await shippedLibrary();
    const { service, id } = wizardWithFindFamiliar(library);
    const rules = companionRules(service.getCharacter(id));
    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe("Find Familiar");
  });

  it("offers exactly the spell's fifteen forms, not every companion", async () => {
    const library = await shippedLibrary();
    const { service, id } = wizardWithFindFamiliar(library);
    const state = service.getCharacter(id);
    const rule = companionRules(state)[0]!;

    // The filter only applies when the granting element carries the select
    // rule; without it `selectSupportsFor` is undefined and everything passes.
    expect(selectSupportsFor(state, library, rule)).toBe("Familiar");

    const offered = selectionOptions(state, library, rule).map((option) => option.name).sort();
    expect(offered).toEqual([...FAMILIAR_FORMS].sort());
  });
});
