/**
 * Shared test support: build characters through the engine's own API.
 *
 * Tests construct the characters they need here rather than loading pre-made
 * `.dnd5e` files, so the creation flow is exercised on the way to every
 * assertion and the repository carries no character files.
 *
 * The library is the expensive part (~500 ms for the full corpus, ~75 ms for
 * the reviewed profile), so both are memoised per process.
 */

import { type ElementLibrary } from "../content/library.js";
import { CharacterService } from "../character/service.js";
import { pendingSelectionRules, type SelectionRule } from "../selection/selection.js";
import type { AbilityScores, CharacterState } from "../character/state.js";
import { buildCorpusLibrary } from "./corpus.js";

/** The vendored content corpus root (`third-party/elements`). */
export { CORPUS_ROOT } from "./corpus.js";

let fullLibrary: Promise<ElementLibrary> | undefined;

/** The complete corpus library, built once per process. */
export function sharedLibrary(): Promise<ElementLibrary> {
  fullLibrary ??= buildCorpusLibrary();
  return fullLibrary;
}


/** Deterministic mulberry32 RNG so hit-die rolls are reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first pending selection rule of `type`; throws when absent. */
export function ruleOfType(rules: SelectionRule[], type: string): SelectionRule {
  const rule = rules.find((r) => r.type === type);
  if (!rule) throw new Error(`no pending rule of type '${type}'`);
  return rule;
}

/** The first pending selection rule named `name`; throws when absent. */
export function ruleOfName(rules: SelectionRule[], name: string): SelectionRule {
  const rule = rules.find((r) => r.name === name);
  if (!rule) throw new Error(`no pending rule named '${name}'`);
  return rule;
}

/** A service over `library` with a deterministic RNG. */
export function freshService(library: ElementLibrary, seed = 23): CharacterService {
  return new CharacterService(undefined, library, { rng: seededRng(seed) });
}

/** Resolves the pending rule of `type` on `id` to `elementId`. */
export function select(service: CharacterService, id: string, type: string, elementId: string): void {
  const rule = ruleOfType(pendingSelectionRules(service.getCharacter(id)), type);
  service.setSelection(id, rule.identifier, elementId);
}

export const STANDARD_ARRAY: AbilityScores = {
  strength: 15, dexterity: 14, constitution: 13,
  intelligence: 12, wisdom: 10, charisma: 8,
};

export const ID = {
  RACE_DWARF: "ID_SRD_RACE_DWARF",
  RACE_ELF: "ID_RACE_ELF",
  SUB_RACE_HILL_DWARF: "ID_SUB_RACE_HILL_DWARF",
  SUB_RACE_HIGH_ELF: "ID_SUB_RACE_HIGH_ELF",
  CLASS_BARBARIAN: "ID_WOTC_PHB_CLASS_BARBARIAN",
  CLASS_DRUID: "ID_WOTC_PHB_CLASS_DRUID",
  CLASS_FIGHTER: "ID_WOTC_PHB_CLASS_FIGHTER",
  CLASS_PALADIN: "ID_WOTC_PHB_CLASS_PALADIN",
  CLASS_RANGER: "ID_WOTC_PHB_CLASS_RANGER",
  CLASS_ROGUE: "ID_WOTC_PHB_CLASS_ROGUE",
  CLASS_WIZARD: "ID_WOTC_PHB_CLASS_WIZARD",
  MULTICLASS_ROGUE: "ID_WOTC_PHB_MULTICLASS_ROGUE",
  MULTICLASS_WIZARD: "ID_WOTC_PHB_MULTICLASS_WIZARD",
  OPTION_MULTICLASS: "ID_INTERNAL_OPTION_ALLOW_MULTICLASSING",
  OPTION_FEATS: "ID_INTERNAL_OPTION_ALLOW_FEATS",
  EXPERTISE_THIEVES_TOOLS: "ID_EXPERTISE_TOOL_THIEVES_TOOLS",
} as const;

export type BuiltCharacter = {
  service: CharacterService;
  id: string;
  state: CharacterState;
};

/**
 * A race + sub-race + class character at `levels` — the base every archetype
 * below is built from. Pass `subRaceId: ""` for a race with no sub-race.
 */
export function buildCharacter(
  library: ElementLibrary,
  options: {
    id: string;
    raceId?: string;
    subRaceId?: string;
    classId: string;
    levels?: number;
    abilities?: AbilityScores;
    seed?: number;
  },
): BuiltCharacter {
  const {
    id, raceId = ID.RACE_DWARF, subRaceId = ID.SUB_RACE_HILL_DWARF,
    classId, levels = 1, abilities = STANDARD_ARRAY, seed = 23,
  } = options;

  const service = freshService(library, seed);
  service.createCharacter(id);
  service.setAbilities(id, abilities);
  select(service, id, "Race", raceId);
  if (subRaceId !== "") select(service, id, "Sub Race", subRaceId);
  select(service, id, "Class", classId);
  for (let level = 2; level <= levels; level++) service.levelUp(id);

  return { service, id, state: service.getCharacter(id) };
}

/** A level-5 dwarf rogue with one expertise pick resolved. */
export function buildRogue5(library: ElementLibrary, id = "Rogue5"): BuiltCharacter {
  const built = buildCharacter(library, {
    id,
    classId: ID.CLASS_ROGUE,
    levels: 5,
    abilities: { strength: 10, dexterity: 16, constitution: 14, intelligence: 12, wisdom: 14, charisma: 8 },
  });
  const { service } = built;
  const expertise = pendingSelectionRules(service.getCharacter(id)).filter((r) => r.name === "Expertise (Rogue)");
  if (expertise[0] !== undefined) {
    service.setSelection(id, expertise[0].identifier, ID.EXPERTISE_THIEVES_TOOLS);
  }
  return { ...built, state: service.getCharacter(id) };
}

/** A level-4 high-elf wizard: a prepared full caster with slots and an ASI due. */
export function buildWizard4(library: ElementLibrary, id = "Wizard4"): BuiltCharacter {
  return buildCharacter(library, {
    id,
    raceId: ID.RACE_ELF,
    subRaceId: ID.SUB_RACE_HIGH_ELF,
    classId: ID.CLASS_WIZARD,
    levels: 4,
    abilities: { strength: 8, dexterity: 14, constitution: 14, intelligence: 16, wisdom: 12, charisma: 10 },
  });
}

/** A level-3 paladin — a prepared half-caster with an oath. */
export function buildPaladin3(library: ElementLibrary, id = "Paladin3"): BuiltCharacter {
  return buildCharacter(library, {
    id,
    classId: ID.CLASS_PALADIN,
    levels: 3,
    abilities: { strength: 16, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 12, charisma: 14 },
  });
}

/** A level-3 fighter — the simple martial baseline for attacks and inventory. */
export function buildFighter3(library: ElementLibrary, id = "Fighter3"): BuiltCharacter {
  return buildCharacter(library, { id, classId: ID.CLASS_FIGHTER, levels: 3 });
}

/**
 * A level-8 Ranger (5) / Rogue (3): a deep multiclass with a class start
 * partway up the ladder, for delevel and progression-history tests.
 */
export function buildRangerRogue8(library: ElementLibrary, id = "RangerRogue8"): BuiltCharacter {
  const built = buildCharacter(library, {
    id,
    classId: ID.CLASS_RANGER,
    levels: 6,
    abilities: { strength: 14, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 14, charisma: 8 },
  });
  const { service } = built;
  service.setCharacterOption(id, { optionId: ID.OPTION_MULTICLASS, enabled: true });
  service.startMulticlass(id, ID.MULTICLASS_ROGUE);
  service.levelUpMode(id, { mode: "multiclass", classId: ID.MULTICLASS_ROGUE });
  service.levelUpMode(id, { mode: "multiclass", classId: ID.MULTICLASS_ROGUE });
  return { ...built, state: service.getCharacter(id) };
}

/** A fighter who has multiclassed into wizard — two classes, shared caster level. */
export function buildMulticlassCaster(library: ElementLibrary, id = "Multiclass"): BuiltCharacter {
  const built = buildCharacter(library, {
    id,
    classId: ID.CLASS_FIGHTER,
    levels: 3,
    abilities: { strength: 15, dexterity: 13, constitution: 14, intelligence: 14, wisdom: 12, charisma: 8 },
  });
  const { service } = built;
  service.setCharacterOption(id, { optionId: ID.OPTION_MULTICLASS, enabled: true });
  service.startMulticlass(id, ID.MULTICLASS_WIZARD);
  service.levelUpMode(id, { mode: "multiclass", classId: ID.MULTICLASS_WIZARD });
  return { ...built, state: service.getCharacter(id) };
}

/**
 * A paladin carrying equipment and granted spells — rich enough that the
 * character sheet produces all six page kinds (details, background, equipment,
 * spell list, spell cards, item cards).
 */
export function buildFullSheetCharacter(library: ElementLibrary, id = "FullSheet"): BuiltCharacter {
  const built = buildPaladin3(library, id);
  const { service } = built;
  for (const itemId of [
    "ID_WOTC_PHB_WEAPON_LONGSWORD",
    "ID_WOTC_DMG_MAGIC_ITEM_POTION_OF_HEALING",
    "ID_WOTC_PHB_WEAPON_SHORTSWORD",
  ]) {
    service.addItem(id, { itemId, amount: 1, baseElementId: null });
  }
  for (const spellId of [
    "ID_PHB_SPELL_BLESS",
    "ID_PHB_SPELL_CURE_WOUNDS",
    "ID_PHB_SPELL_HEROISM",
    "ID_PHB_SPELL_DIVINE_FAVOR",
    "ID_PHB_SPELL_SHIELD_OF_FAITH",
    "ID_PHB_SPELL_COMMAND",
  ]) {
    service.addGrantedSpell(id, { spellId });
  }
  return { ...built, state: service.getCharacter(id) };
}

/**
 * A deterministic, effectively incompressible payload of `bytes` bytes,
 * base64-encoded. Used where a test needs a large embedded portrait rather
 * than a real image — real photographic portraits do not compress either, so
 * the bytes must come from a PRNG rather than a repeating pattern.
 */
export function syntheticPortrait(bytes: number): string {
  const buffer = Buffer.alloc(bytes);
  const next = seededRng(0x5eed);
  for (let i = 0; i < bytes; i++) buffer[i] = Math.floor(next() * 256) & 0xff;
  return buffer.toString("base64");
}
