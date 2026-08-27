/**
 * Character state model.
 *
 * The semantic view of a character, mapped from the .dnd5e document model
 * (packages/engine/src/dnd5e/document.ts) and mutated by engine operations.
 * Round-trip byte fidelity lives in the document model; this state is what
 * engine behavior (selections, statistics, spellcasting, ...) operates on.
 */

import type { AbilityKey } from "../elements/types.js";

import type { MagicState } from "../magic/state.js";

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export const DEFAULT_ABILITIES: AbilityScores = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

/** One node of the <elements> tree (wrappers carry selection-rule state). */
export interface RegisteredElement {
  type: string;
  name: string;
  id: string;
  /** Selection-rule wrappers (e.g. Race, Class) carry these. */
  requiredLevel?: number;
  /** Wrapper instance index for select rules with number > 1 (not mapped from documents). */
  number?: number;
  checksum?: string;
  /** The id of the registered selection, when made. */
  registered?: string;
  /** Level wrappers: true for multiclass level wrappers. */
  multiclass?: boolean;
  /** Level wrappers: true for the starting wrapper of a class (holds its rndhp). */
  starting?: boolean;
  /** Level wrappers: the registered multiclass variant id (multiclass levels). */
  classId?: string;
  /** List wrappers (<element ... isList="true">): registered holds a list index. */
  isList?: boolean;
  /** Selected text stored inside a List wrapper, retained for export and snapshots. */
  listText?: string;
  children: RegisteredElement[];
}

/** One entry of the derived level history (document order of level wrappers). */
export interface LevelHistoryEntry {
  totalLevel: number;
  classId: string;
  classLevel: number;
  isMulticlass: boolean;
  isClassStart: boolean;
  /** True while a newly added multiclass level is awaiting its class selection. */
  isPending: boolean;
  /** True when the level can be removed by delevel. */
  canRemove: boolean;
}

/** Per-level removal metadata, recorded during leveling or reconstructed on import. */
export interface LevelRegistrationRecord {
  totalLevel: number;
  classId: string;
  classLevel: number;
  isMulticlass: boolean;
  isClassStart: boolean;
  /** Sum element ids added by this level (level wrapper id + cascade ids). */
  addedElementIds: string[];
  /** Tree nodes appended into the class wrapper (main levels) or Multiclass wrapper. */
  addedNodes: unknown[];
  /** Level-gated rules appended beneath features registered at an earlier class level. */
  nestedAddedNodes?: Array<{ parentPath: number[]; insertIndex: number; nodes: unknown[] }>;
}

/** Snapshot captured by delevel; undoDelevel restores it. */
export interface DelevelSnapshot {
  /** Document text after pending-grant reconciliation and before level removal. */
  documentRaw: string;
  /** The level history records before the delevel (including the removed one). */
  levelRegistrations: LevelRegistrationRecord[];
  /** The removed level's total level. */
  removedLevel: number;
  /** Wrappers invalidated by the delevel (their pre-delevel data). */
  invalidatedWrappers: RegisteredElement[];
}

export interface NotesColumns {
  left: string;
  right: string;
}

export interface BackgroundTraits {
  trinket: string;
  traits: string;
  ideals: string;
  bonds: string;
  flaws: string;
}

export interface BackgroundFeature {
  name: string;
  description: string;
}

/** The calculation block of a calculated attack row (<calculation-source> attrs). */
export interface AttackCalculationState {
  source: string;
  ability: string;
  useProficiency: boolean;
  attackMiscBonus: number;
  damageDice: string;
  addAbilityToDamage: boolean;
  damageMiscBonus: number;
  damageType: string;
  casterIdentifier: string;
}

/** One `<attack>` entry of the input section. */
export interface AttackState {
  /** Opaque row id (the file's id attr, or a session-derived id for id-less imports). */
  id: string;
  /** The referenced inventory item's identifier (weapon rows; "" otherwise). */
  identifier: string;
  name: string;
  range: string;
  attack: string;
  damage: string;
  displayed: boolean;
  /** The row's effective ability name (weapon/calculated; "" for manual). */
  ability: string;
  kind: string;
  /** "default" or "explicit" (weapon rows; "default" for the rest). */
  abilityMode: string;
  description: string;
  calculation: AttackCalculationState | null;
  /** FCB extension for a row linked to a known spell. */
  spell?: {
    casterName: string;
    spellId: string;
    overriddenFields: string[];
  };
  /**
   * FCB extension for an unarmed strike row. `dice` is a manual override of the
   * damage die, kept separate from the display fields so the ability modifier
   * stays live; "" means the die follows the character's content.
   */
  unarmed?: {
    dice: string;
  };
}

export interface Organization {
  name: string;
  symbol: string;
  allies: string;
}

export interface PortraitState {
  companion: string;
  local: string;
  base64: string;
}

export interface AppearanceState {
  portrait: string;
  age: string;
  height: string;
  weight: string;
  eyes: string;
  skin: string;
  hair: string;
}

export interface Coinage {
  copper: number;
  silver: number;
  electrum: number;
  gold: number;
  platinum: number;
}

export interface CompanionSave {
  ability: AbilityKey;
  value: number;
}

export interface CompanionSkill {
  name: string;
  value: number;
}

export interface CompanionState {
  name: string;
  attributes: AbilityScores;
  saves: CompanionSave[];
  skills: CompanionSkill[];
  portraitLocation: string;
}

export interface InventoryItemState {
  /** Per-session GUID, persisted verbatim in the file. */
  identifier: string;
  itemId: string;
  name: string;
  amount: number;
  equipped: boolean;
  /** Equip location when equipped (e.g. primary, armor). */
  location?: string;
  attuned: boolean;
  /** Storage container name (`state.storages` entry) when stowed; absent when carried on the character. */
  storage?: string;
  /** Adorner element ids (magic-item attachments). */
  adorners: string[];
  /** `<details card="true">` opts the item into full-sheet item cards. */
  card?: boolean;
  /** Item-level `sidebar="true"` opts its description into the inventory sidebar. */
  sidebar?: boolean;
  detailsName: string;
  notes: string;
}

export interface SumElement {
  type: string;
  id: string;
}

export interface SpellState {
  name: string;
  level: string;
  id: string;
  prepared: boolean;
  alwaysPrepared: boolean;
  known: boolean;
}

export interface SpellcastingState {
  name: string;
  ability: string;
  attack: string;
  dc: string;
  source: string;
  /** Slot counts keyed by level (e.g. s1..s9). */
  slots: Record<string, string>;
  /** Registered cantrip ids. */
  cantrips: string[];
  spells: SpellState[];
}

export interface SumState {
  elementCount: number;
  elements: SumElement[];
}

export interface CharacterState {
  /** Engine slot id (the client's storage key). */
  id: string;

  // information
  group: string;
  generationOption: number;

  // display properties
  name: string;
  race: string;
  klass: string;
  archetype: string;
  background: string;
  level: number;
  portrait: PortraitState;

  // build/input
  playerName: string;
  gender: string;
  experience: number;
  attacksDescription: string;
  attacks: AttackState[];
  backstory: string;
  backgroundTraits: BackgroundTraits;
  backgroundFeature: BackgroundFeature;
  organization: Organization;
  additionalFeatures: string;
  notes: NotesColumns;
  quest: string;
  coins: Coinage;
  equipmentNote: string;
  treasureNote: string;

  // build/appearance
  appearance: AppearanceState;

  // build/abilities
  abilities: AbilityScores;
  availablePoints: number;

  // build/elements
  elements: RegisteredElement[];
  levelCount: number;
  registeredCount: number;
  /**
   * Pre-rolled hit point dice per class (20 values each, class order):
   * classId (main class id or multiclass variant id) -> rolls.
   * Derived from the starting level wrappers' rndhp attributes.
   */
  hitPointRolls: Record<string, number[]>;
  /** Derived level history (one entry per level wrapper, in order). */
  levelHistory: LevelHistoryEntry[];
  /**
   * Per-level registration records, carried across remaps and reconstructed
   * conservatively for imported characters from their document and content.
   */
  levelRegistrations: LevelRegistrationRecord[];
  /** Delevel snapshot for undoDelevel (session state). */
  delevelSnapshot: DelevelSnapshot | null;

  // build/defenses
  conditional: string[];

  // build/companion
  companion: CompanionState;

  // build/equipment
  storages: string[];
  items: InventoryItemState[];

  // build/magic
  spellcasting: SpellcastingState[];
  /**
   * Parsed `<magic>` region (casters, additional spells, root attributes).
   * Null when the document has no magic region.
   */
  magic: MagicState | null;
  /** Per-caster session identifiers (persisted across remaps). */
  magicCasterIds: Map<string, string>;

  // build/sum
  sum: SumState;

  // sources
  restrictedSources: string[];
  /** Element ids listed in <sources><restricted><element> (ruleset-derived restrictions). */
  restrictedElements: string[];

  /** Optional rules toggled on (e.g. ID_INTERNAL_OPTION_ALLOW_FEATS). */
  options: Set<string>;
  /** Character control keys (e.g. spellcasting display flags). */
  controls: Map<string, boolean>;
  rulesetMode: string;
  /**
   * Per-session selection-rule identifiers (element-tree path -> uuid).
   * Populated by pendingSelectionRules; the service carries it across remaps.
   */
  selectionRuleIds: Map<string, string>;
}

export function emptyCharacterState(id: string): CharacterState {
  return {
    id,
    group: "",
    generationOption: 1,
    name: id,
    race: "",
    klass: "",
    archetype: "",
    background: "",
    level: 1,
    portrait: { companion: "", local: "", base64: "" },
    playerName: "",
    gender: "",
    experience: 0,
    attacksDescription: "",
    attacks: [],
    backstory: "",
    backgroundTraits: { trinket: "", traits: "", ideals: "", bonds: "", flaws: "" },
    backgroundFeature: { name: "", description: "" },
    organization: { name: "", symbol: "", allies: "" },
    additionalFeatures: "",
    notes: { left: "", right: "" },
    quest: "",
    coins: { copper: 0, silver: 0, electrum: 0, gold: 0, platinum: 0 },
    equipmentNote: "",
    treasureNote: "",
    appearance: {
      portrait: "",
      age: "",
      height: "",
      weight: "",
      eyes: "",
      skin: "",
      hair: "",
    },
    abilities: { ...DEFAULT_ABILITIES },
    availablePoints: 15,
    elements: [],
    levelCount: 1,
    registeredCount: 0,
    hitPointRolls: {},
    levelHistory: [],
    levelRegistrations: [],
    delevelSnapshot: null,
    conditional: [],
    companion: {
      name: "",
      attributes: { ...DEFAULT_ABILITIES },
      saves: [],
      skills: [],
      portraitLocation: "",
    },
    storages: [],
    items: [],
    spellcasting: [],
    magic: null,
    magicCasterIds: new Map(),
    sum: { elementCount: 0, elements: [] },
    restrictedSources: [],
    restrictedElements: [],
    options: new Set(),
    controls: new Map(),
    rulesetMode: "all",
    selectionRuleIds: new Map(),
  };
}
