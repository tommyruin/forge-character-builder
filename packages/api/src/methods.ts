import type {
  ChoiceIdentityReportDto,
  CustomContentDto,
  CustomEntryDraft,
  CustomDraftMutationDto,
  CustomItemPreviewDto,
  CustomSpellPreviewDto,
  MissingGrantDto,
  DmGrantDto,
  ElementSourceDto,
  PackCheckRequest,
  PackFindingDto,
  PromotedCustomElementDto,
  ResourcesDto,
  TrackerDef,
} from "./custom.js";
import type { QueueKind } from "./protocol.js";

export type WireObject = Readonly<Record<string, unknown>>;
export type WireList = readonly WireObject[];

export interface AbilityScoresDto {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  /** The document's ability generation method (0 Roll3D6, 1 Roll4D6DiscardLowest,
   *  2 Array, 3 Points). Omitted: the stored option is left untouched. */
  generationOption?: number;
}

export interface Base64Payload {
  base64: string;
}

export interface CoinageDto {
  copper: number;
  silver: number;
  electrum: number;
  gold: number;
  platinum: number;
}

export interface EquipmentShoppingMetadataDto {
  displayPrice: string;
  priceGp: number | null;
  category: string | null;
  equipmentKind: string | null;
  isProficient: boolean | null;
  proficiencyStatus: "proficient" | "not-proficient" | "not-applicable" | "base-dependent" | "unknown";
}

export interface ContentElementsQueryDto extends WireObject {
  characterId?: string;
  equipmentKind?: string;
  rarity?: string;
  proficiency?: "proficient" | "not-proficient";
  maxPriceGp?: number;
}

export interface UploadedFileDto extends Base64Payload {
  path: string;
}

export interface ProgressionClassDto {
  classId: string;
  className: string;
  level: number;
  isMulticlass: boolean;
  hitDie: string;
  hitPointValues: number[];
  /** Whether this class's most recent level can be removed right now. */
  canLower: boolean;
}

export interface ProgressionHistoryEntryDto {
  totalLevel: number;
  classId: string | null;
  className: string;
  classLevel: number | null;
  isMulticlass: boolean;
  isClassStart: boolean;
  isPending: boolean;
  canRemove: boolean;
}

export interface ProgressionDto {
  canLevelUp: boolean;
  canLevelDown: boolean;
  hasMainClass: boolean;
  canMulticlass: boolean;
  hasMulticlass: boolean;
  multiclassRuleEnabled: boolean;
  classes: ProgressionClassDto[];
  usesAverageHitPoints: boolean;
  levelHistory: ProgressionHistoryEntryDto[];
  canUndoDelevel: boolean;
}

export interface SpellPointCostDto {
  spellLevel: number;
  points: number;
  oncePerLongRest: boolean;
}

export type SpellResourceDto =
  | {
      mode: "slots";
      canUseSpellPoints: boolean;
    }
  | {
      mode: "spellPoints";
      currentPoints: number;
      maximumPoints: number;
      costs: SpellPointCostDto[];
      shared: boolean;
      canUseSpellPoints: true;
    };

export interface KnownSpellDto {
  id: string;
  name: string;
  source: string;
  isPrepared: boolean;
  isChosen: boolean;
  level: number;
  school: string;
  isRitual: boolean;
  isConcentration: boolean;
  isAlwaysPrepared: boolean;
  castingTime: string;
  components: string;
  range: string;
  duration: string;
  description: string;
  /**
   * The free-cast allowance the granting feature attaches to the spell
   * ("1/Long Rest" for a Magic Initiate level-1 spell). Absent or null when
   * the spell is cast from slots alone.
   */
  usage?: string | null;
  /** Conditions or shared-feature limits on the free-cast allowance. */
  usageNote?: string;
  /**
   * This character's own name and note for the spell (`setSpellAlias`). When
   * set, `name` stays the spell's real name and the alias is what the Magic tab
   * leads with and the sheet prints.
   */
  alias?: { name: string; note: string };
  /**
   * The feature or item that gave the character this spell, for spells a
   * feature caster projects. The spell lists name it in place of the spell's
   * own book, and mark it when it is custom content.
   */
  grantedBy?: { elementId: string; name: string; isCustom: boolean };
}

export interface SpellcasterDto {
  identifier: string;
  name: string;
  /**
   * "class" for a caster block backed by a spellcasting feature; "feature" for
   * spells a feat or trait grants outside any caster (Magic Initiate, the High
   * Elf cantrip). Feature casters have no slots and prepare nothing.
   */
  kind: "class" | "feature";
  ability: string;
  attackModifier: number;
  saveDc: number;
  requiresPreparation: boolean;
  /** True when the caster feature allows swapping a known spell on level-up. */
  allowReplace: boolean;
  prepareCount: number;
  currentPreparedCount: number;
  slotsPerLevel: number[];
  knownSpells: KnownSpellDto[];
  maxSpellLevel: number;
  resource: SpellResourceDto;
}

/**
 * Fixed manifest identity of a snapshot consumer: the client name, its
 * payload schema version, and the payload codec. Fast Start and character
 * load use the same gzip-json codec with different schema numbers.
 */
export interface ManifestIdentityDto {
  client: string;
  schema: number;
  codec: string;
}

/** Report for a prepared Fast Start library snapshot (kind fcb-fast-start-library, schema 1). */
export interface FastStartSnapshotPreparedDto {
  client: string;
  schema: number;
  codec: string;
  libraryKind: "fcb-fast-start-library";
  schemaVersion: number;
  elementCount: number;
  sourceCount: number;
  fileCount: number;
  typeCounts: Record<string, number>;
  orderedLibraryDigest: string;
  diagnosticsDigest: string;
  serializedBytes: number;
  compressedBytes: number;
  serializationMs: number;
  compressionMs: number;
}

export interface BootFromSnapshotRequestDto {
  /** The manifest the client claims to send. */
  manifest: ManifestIdentityDto;
  /** The manifest the engine expects; mismatch rejects with snapshot-rejected. */
  expectedIdentity: ManifestIdentityDto;
  body: ArrayBuffer;
}

export interface BootFromSnapshotResultDto {
  elementCount: number;
  sourceCount: number;
  fileCount: number;
  typeCounts: Record<string, number>;
  hydrationMs: number;
  validationMs: number;
  totalMs: number;
}

/** Report for a prepared character load snapshot (kind fcb-character-load, schema 1). */
export interface CharacterSnapshotPreparedDto {
  client: string;
  schema: number;
  codec: string;
  libraryKind: "fcb-character-load";
  schemaVersion: number;
  characterId: string;
  xmlHash: string;
  libraryDigest: string;
  engineVersion: string;
  parserVersion: string;
  selectionCount: number;
  elementCount: number;
  inventoryCount: number;
  attackCount: number;
  finalStateDigest: string;
  serializedBytes: number;
  compressedBytes: number;
  serializationMs: number;
  compressionMs: number;
}

export type RestoreMode = "none" | "xml" | "snapshot" | "xml-fallback";

export interface CharacterLoadDiagnosticsDto {
  characterId: string;
  restoreMode: RestoreMode;
  snapshotAccepted: boolean;
  warning: string | null;
  loadIssueCount: number;
  issueKindCounts: Record<string, number>;
  selectionCount: number;
  elementCount: number;
  inventoryCount: number;
  attackCount: number;
  finalStateDigest: string;
  parseMs: number;
  validationMs: number;
  hydrationMs: number;
  totalMs: number;
}

/** A choice a source change removed or kept: the chosen element's name and type. */
export interface SourceSelectionDto {
  name: string;
  type: string;
}

/**
 * A publisher's books. Books group by the author setter's `abbreviation`
 * (else the full author text), so co-authored books join their publisher.
 */
export interface SourceGroupDto extends WireObject {
  name: string;
  canToggle: boolean;
  sources: WireList;
}

/** `getCharacterSources` result. */
export interface CharacterSourcesDto extends WireObject {
  groups: SourceGroupDto[];
  restrictedSourceIds: string[];
  unavailableRestrictedSourceIds: string[];
  /** Compatibility: the restricted source records. */
  sources: WireList;
}

/**
 * `setCharacterSources` result: the `getCharacterSources` payload plus what
 * the change did to the character's choices.
 */
export interface SetCharacterSourcesResultDto extends CharacterSourcesDto {
  /** Spell names only; kept for older clients. */
  removedSpellNames: string[];
  /** Every cleared choice from a disabled book, spells included ("Spell"). */
  removedSelections: SourceSelectionDto[];
  /** Class picks from a disabled book, kept because clearing one deletes its levels. */
  keptSelections: SourceSelectionDto[];
}

export interface MethodContract<Args extends readonly unknown[], Result> {
  args: Args;
  result: Result;
}

export interface EngineMethodMap {
  boot: MethodContract<[request: WireObject], WireObject>;
  bootFromSnapshot: MethodContract<[request: BootFromSnapshotRequestDto], BootFromSnapshotResultDto>;
  ingestSupplementBundle: MethodContract<[request: { contentUrl: string }], WireObject>;
  ingestUploaded: MethodContract<[request: { files: UploadedFileDto[] }], WireObject>;
  removeUploaded: MethodContract<[request: { paths: string[] }], WireObject>;
  patchHomebrew: MethodContract<[request: { path: string; base64: string | null }], WireObject>;
  prepareFastStartSnapshot: MethodContract<[], FastStartSnapshotPreparedDto>;
  getFastStartSnapshotBuffer: MethodContract<[], ArrayBuffer>;
  contentStatus: MethodContract<[], WireObject>;
  contentSources: MethodContract<[], WireList>;
  equipmentCategories: MethodContract<[characterId?: string], WireList>;
  contentElements: MethodContract<[query: ContentElementsQueryDto], WireObject>;
  contentElement: MethodContract<[id: string], WireObject | null>;
  /**
   * A loaded element written out as `<element>` XML, the starting point for
   * changing a book element or reflavouring it in a pack. `xml` is null (with a
   * `reason`) for an element whose structure a copy would lose.
   */
  getElementSource: MethodContract<[id: string], ElementSourceDto | null>;
  /**
   * Checks a pack's compiled file against the loaded library without loading
   * it: grants that resolve to nothing, ids defined twice, Background Features
   * nothing attaches, appends to targets that are not loaded and requirements
   * the engine cannot read.
   */
  checkPackContent: MethodContract<[request: PackCheckRequest], PackFindingDto[]>;
  createCharacter: MethodContract<[name: string], WireObject>;
  getCharacter: MethodContract<[id: string], WireObject>;
  deleteCharacter: MethodContract<[id: string], void>;
  // Results are CharacterSourcesDto / SetCharacterSourcesResultDto; the contract
  // stays WireObject so existing callers keep their own narrowing.
  setCharacterSources: MethodContract<[id: string, request: { restrictedSourceIds: string[] }], WireObject>;
  getCharacterSources: MethodContract<[id: string], WireObject>;
  setPortrait: MethodContract<[id: string, base64: string], WireObject>;
  removePortrait: MethodContract<[id: string], WireObject>;
  updateDetails: MethodContract<[id: string, details: WireObject], WireObject>;
  setAbilities: MethodContract<[id: string, abilities: AbilityScoresDto], WireObject>;
  getSelectionOptions: MethodContract<[id: string, ruleId: string, request?: { number?: number }], WireList>;
  setSelection: MethodContract<
    [id: string, ruleId: string, request: { selectionId: string; number?: number }],
    WireObject
  >;
  clearSelection: MethodContract<[id: string, ruleId: string, request: { number?: number }], WireObject>;
  getOptionalRules: MethodContract<[id: string], WireList>;
  setCharacterOption: MethodContract<[id: string, request: { optionId: string; enabled: boolean }], WireObject>;
  getRulesetMode: MethodContract<[id: string], WireObject>;
  setRulesetMode: MethodContract<[id: string, request: { mode: string }], WireObject>;
  getCharacterAdjustments: MethodContract<[id: string], WireList>;
  setCharacterControl: MethodContract<[id: string, request: { key: string; enabled: boolean }], WireObject>;
  getStatistics: MethodContract<[id: string], WireObject>;
  getAppearanceSuggestions: MethodContract<[id: string, seed: number], WireObject>;
  exportCharacterXml: MethodContract<[id: string], Base64Payload>;
  importCharacterXml: MethodContract<[id: string, base64: string], WireObject>;
  importCharacterXmlWithSnapshot: MethodContract<
    [id: string, base64: string, identity: ManifestIdentityDto, body: ArrayBuffer],
    WireObject
  >;
  getCharacterLoadDiagnostics: MethodContract<[], CharacterLoadDiagnosticsDto>;
  prepareCharacterLoadSnapshot: MethodContract<[id: string, identity: ManifestIdentityDto], CharacterSnapshotPreparedDto>;
  getCharacterLoadSnapshotBuffer: MethodContract<[], ArrayBuffer>;
  levelUp: MethodContract<
    [id: string, request: { mode: "main" | "new-multiclass" | "multiclass"; classId?: string }],
    WireObject
  >;
  levelUpTo: MethodContract<[id: string, request: { level: number }], WireObject>;
  levelDown: MethodContract<[id: string], WireObject>;
  delevel: MethodContract<[id: string, request: { mode: "last" | "class"; classId?: string }], WireObject>;
  undoDelevel: MethodContract<[id: string], WireObject>;
  setHitPointRoll: MethodContract<
    [id: string, request: { classId: string; classLevel: number; value: number }],
    ProgressionDto
  >;
  getProgression: MethodContract<[id: string], ProgressionDto>;
  getSpellcasting: MethodContract<[id: string], SpellcasterDto[]>;
  setPrepared: MethodContract<
    [id: string, casterId: string, request: { spellId: string; prepared: boolean }],
    SpellcasterDto[]
  >;
  getSpellBrowse: MethodContract<[id: string, ruleId: string], WireObject>;
  /**
   * Gives a spell a display name and a note on this character: any spell the
   * library knows, book or custom, that the character has. Presentation only:
   * the spell keeps its element, its rules and its numbers, and the Magic tab,
   * the sheet's spell pages and cards and the spell's attack row print the
   * name. An empty name goes back to the spell's own; an omitted field is left
   * alone. Returns the spellcasting projection.
   */
  setSpellAlias: MethodContract<[id: string, spellId: string, request: { name?: string; note?: string }], SpellcasterDto[]>;
  /**
   * The character's resources: every limited use its features and items carry
   * (read from sheet usage lines, custom entries and manual trackers), with
   * what is spent, and the switches that gate custom modifiers.
   */
  getResources: MethodContract<[id: string], ResourcesDto>;
  /** Sets how many of a tracker are spent (clamped to its maximum). `trackerId` is a `TrackerDto.id`. */
  setTrackerUsed: MethodContract<[id: string, request: { trackerId: string; used: number }], ResourcesDto>;
  /**
   * Turns a switch on or off. Turning one on spends one use of the tracker it
   * is linked to, and is refused when none is left.
   */
  setResourceSwitch: MethodContract<[id: string, request: { name: string; on: boolean }], ResourcesDto>;
  /**
   * A short rest refills what recharges on a short rest; a long rest also
   * refills long rest, dawn and day trackers. Dice-roll and never trackers
   * are left to the player.
   */
  restCharacter: MethodContract<[id: string, request: { kind: "short" | "long" }], ResourcesDto>;
  /** Adds or replaces a tracker kept by hand on the Resources page. */
  saveManualTracker: MethodContract<[id: string, request: { tracker: TrackerDef }], ResourcesDto>;
  deleteManualTracker: MethodContract<[id: string, request: { trackerId: string }], ResourcesDto>;
  /**
   * Grants any spell to the character, ignoring class lists and known/prepared
   * limits. With `caster` (a class spellcasting name the character has) the
   * spell joins that caster's spells, always prepared, and casts with its
   * attack bonus and save DC; without one it gathers in "Additional Spells".
   */
  addGrantedSpell: MethodContract<[id: string, request: { spellId: string; caster?: string | null }], WireObject>;
  removeGrantedSpell: MethodContract<[id: string, request: { spellId: string }], WireObject>;
  addGrantedFeat: MethodContract<[id: string, request: { featId: string }], WireObject>;
  removeGrantedFeat: MethodContract<[id: string, request: { featId: string }], WireObject>;
  addGrantedAbilityScore: MethodContract<[id: string, request: { abilityElementIds: string[] }], WireObject>;
  removeGrantedAbilityScore: MethodContract<[id: string, request: { abilityElementId: string }], WireObject>;
  /**
   * Grants any feature-type element (book, homebrew, or the character's own
   * pack) at the top level of the character: the general form of
   * `addGrantedFeat` and `addGrantedAbilityScore`, which remain as wrappers.
   */
  addGrantedElement: MethodContract<[id: string, request: { elementId: string }], WireObject>;
  removeGrantedElement: MethodContract<[id: string, request: { elementId: string }], WireObject>;
  getDmGrants: MethodContract<[id: string], DmGrantDto[]>;
  /** The character's own pack: its custom drafts and what the engine knows of each. */
  getCustomContent: MethodContract<[id: string], CustomContentDto>;
  /**
   * Grants the character holds from custom or homebrew content that resolve to
   * no element (a pack that grants a spell it never defines), and DM-granted
   * spells the library no longer has. Book content is never reported.
   */
  getMissingGrants: MethodContract<[id: string], MissingGrantDto[]>;
  /**
   * Creates or updates a custom draft: stores it in the character file,
   * compiles and installs it, and (for a new draft, unless `grant` is false)
   * grants it. Editing a granted draft re-registers it and keeps the picks
   * whose choice identity did not change.
   */
  saveCustomDraft: MethodContract<
    [
      id: string,
      request: {
        draft: CustomEntryDraft;
        grant?: boolean;
        /** A new item draft: how many copies the inventory record holds (default 1). */
        amount?: number;
        /** A new item draft: the record's notes. */
        notes?: string;
        /**
         * A new spell draft: the class spellcasting name that casts it (see
         * `addGrantedSpell`); without one it gathers in "Additional Spells".
         * Ignored when `grant` is false.
         */
        caster?: string;
      },
    ],
    CustomDraftMutationDto
  >;
  /**
   * Removes the draft's grant (a feature) or every inventory record of it (an
   * item), its stored copy and its installed element.
   */
  deleteCustomDraft: MethodContract<[id: string, request: { draftId: string }], CustomDraftMutationDto>;
  /**
   * What the client needs to copy a draft into a homebrew collection, keeping
   * its id. The collection store is the client's, so the engine returns the
   * element in that store's shape and does not write it.
   */
  promoteCustomDraft: MethodContract<[id: string, request: { draftId: string; source: string }], PromotedCustomElementDto>;
  /**
   * Which choices of `draft` would change identity against the stored draft of
   * the same id, and whether any loaded character has picks under them.
   */
  getChoiceIdentityImpact: MethodContract<[id: string, request: { draft: CustomEntryDraft }], ChoiceIdentityReportDto>;
  /**
   * What an item draft would give this character, computed on a scratch copy so
   * nothing is saved: the weapon's attack row once it is wielded and attuned.
   */
  previewCustomItem: MethodContract<[id: string, request: { draft: CustomEntryDraft }], CustomItemPreviewDto>;
  /**
   * What a spell draft would give this character, computed on a scratch copy so
   * nothing is saved: the attack or save row it projects once granted to
   * `caster`.
   */
  previewCustomSpell: MethodContract<[id: string, request: { draft: CustomEntryDraft; caster?: string }], CustomSpellPreviewDto>;
  getCompanion: MethodContract<[id: string], WireObject | null>;
  setCompanionName: MethodContract<[id: string, request: { name: string }], WireObject>;
  setCompanionPortrait: MethodContract<[id: string, base64: string], WireObject>;
  removeCompanionPortrait: MethodContract<[id: string], WireObject>;
  getInventory: MethodContract<[id: string], WireObject>;
  getItemBaseOptions: MethodContract<[id: string, itemId: string], WireObject>;
  addItem: MethodContract<
    [
      id: string,
      request: {
        itemId: string;
        amount?: number;
        baseElementId?: string | null;
        /** `significant` cards only magic items, tools and useful gear; omitted cards every new record. */
        cardPolicy?: "all" | "significant";
      },
    ],
    WireObject
  >;
  removeItem: MethodContract<[id: string, identifier: string, amount?: number], WireObject>;
  setItemAmount: MethodContract<[id: string, identifier: string, request: { amount: number }], WireObject>;
  extractItem: MethodContract<
    [
      id: string,
      identifier: string,
      selections?: Record<string, string>,
      /** `significant` cards only the unpacked magic items, tools and useful gear; omitted cards them all. */
      options?: { cardPolicy?: "all" | "significant" },
    ],
    WireObject
  >;
  equipItem: MethodContract<[id: string, identifier: string, request: { location: string }], WireObject>;
  setItemStorage: MethodContract<
    [id: string, identifier: string, request: { storage: string | null; amount?: number }],
    WireObject
  >;
  attuneItem: MethodContract<[id: string, identifier: string, request: { attuned: boolean }], WireObject>;
  setItemPresentation: MethodContract<
    [id: string, request: { identifier: string; card?: boolean; sidebar?: boolean }],
    WireObject
  >;
  setItemCards: MethodContract<[id: string, request: { policy: "all" | "significant" | "none" }], WireObject>;
  /**
   * Sets one inventory record's own name and notes (`<details><name>` and
   * `<notes>`). Any record can carry them, book or custom; the record keeps its
   * element and rules, and the name is what the inventory, attack rows and
   * sheet print. An empty name goes back to the item's own; an omitted field is
   * left alone.
   */
  setItemDetails: MethodContract<[id: string, identifier: string, request: { name?: string; notes?: string }], WireObject>;
  setCoins: MethodContract<[id: string, coins: CoinageDto], WireObject>;
  getAttacks: MethodContract<[id: string], WireList>;
  getAttackOptions: MethodContract<[id: string], WireObject>;
  createAttack: MethodContract<[id: string, request: WireObject], WireList>;
  updateAttack: MethodContract<[id: string, attackId: string, request: WireObject], WireList>;
  setAttackVisibility: MethodContract<
    [id: string, attackId: string, request: { isDisplayed: boolean }],
    WireList
  >;
  moveAttack: MethodContract<[id: string, attackId: string, request: { direction: "up" | "down" }], WireList>;
  deleteAttack: MethodContract<[id: string, attackId: string], WireList>;
  generateSheet: MethodContract<
    [
      id: string,
      request: {
        lite: boolean;
        include?: SheetPageInclusionsDto;
        /** Item notes: the inventory notes column also describes magic items, tools and useful gear. */
        inventoryNotes?: boolean;
        /** The body face the sheet will be drawn in, so card prose is measured in its widths. */
        bodyFace?: string;
      },
    ],
    WireObject
  >;
  ensureHostFile: MethodContract<[path: string, base64: string], { path: string }>;
}

/**
 * The optional sheet pages a `generateSheet` caller can leave out. Each flag
 * defaults to `true`; `background` is the appearance/portrait page, and the
 * remaining pages renumber 1..n so the numbering stays contiguous.
 */
export interface SheetPageInclusionsDto {
  background?: boolean;
  notes?: boolean;
  spellCards?: boolean;
  itemCards?: boolean;
}

export const ENGINE_METHOD_NAMES = [
  "boot",
  "bootFromSnapshot",
  "ingestSupplementBundle",
  "ingestUploaded",
  "removeUploaded",
  "patchHomebrew",
  "prepareFastStartSnapshot",
  "getFastStartSnapshotBuffer",
  "contentStatus",
  "contentSources",
  "equipmentCategories",
  "contentElements",
  "contentElement",
  "getElementSource",
  "checkPackContent",
  "createCharacter",
  "getCharacter",
  "deleteCharacter",
  "setCharacterSources",
  "getCharacterSources",
  "setPortrait",
  "removePortrait",
  "updateDetails",
  "setAbilities",
  "getSelectionOptions",
  "setSelection",
  "clearSelection",
  "getOptionalRules",
  "setCharacterOption",
  "getRulesetMode",
  "setRulesetMode",
  "getCharacterAdjustments",
  "setCharacterControl",
  "getStatistics",
  "getAppearanceSuggestions",
  "exportCharacterXml",
  "importCharacterXml",
  "importCharacterXmlWithSnapshot",
  "getCharacterLoadDiagnostics",
  "prepareCharacterLoadSnapshot",
  "getCharacterLoadSnapshotBuffer",
  "levelUp",
  "levelUpTo",
  "levelDown",
  "delevel",
  "undoDelevel",
  "setHitPointRoll",
  "getProgression",
  "getSpellcasting",
  "setPrepared",
  "getSpellBrowse",
  "setSpellAlias",
  "getResources",
  "setTrackerUsed",
  "setResourceSwitch",
  "restCharacter",
  "saveManualTracker",
  "deleteManualTracker",
  "addGrantedSpell",
  "removeGrantedSpell",
  "addGrantedFeat",
  "removeGrantedFeat",
  "addGrantedAbilityScore",
  "removeGrantedAbilityScore",
  "addGrantedElement",
  "removeGrantedElement",
  "getDmGrants",
  "getCustomContent",
  "getMissingGrants",
  "saveCustomDraft",
  "deleteCustomDraft",
  "promoteCustomDraft",
  "getChoiceIdentityImpact",
  "previewCustomItem",
  "previewCustomSpell",
  "getCompanion",
  "setCompanionName",
  "setCompanionPortrait",
  "removeCompanionPortrait",
  "getInventory",
  "getItemBaseOptions",
  "addItem",
  "removeItem",
  "setItemAmount",
  "extractItem",
  "equipItem",
  "setItemStorage",
  "attuneItem",
  "setItemPresentation",
  "setItemCards",
  "setItemDetails",
  "setCoins",
  "getAttacks",
  "getAttackOptions",
  "createAttack",
  "updateAttack",
  "setAttackVisibility",
  "moveAttack",
  "deleteAttack",
  "generateSheet",
  "ensureHostFile",
] as const satisfies readonly (keyof EngineMethodMap)[];

export type EngineMethodName = (typeof ENGINE_METHOD_NAMES)[number];
export const ENGINE_METHOD_COUNT: Exclude<keyof EngineMethodMap, EngineMethodName> extends never
  ? (typeof ENGINE_METHOD_NAMES)["length"]
  : never = ENGINE_METHOD_NAMES.length;
export type MethodArgs<M extends EngineMethodName> = EngineMethodMap[M]["args"];
export type MethodResult<M extends EngineMethodName> = EngineMethodMap[M]["result"];
export type MaybePromise<T> = T | Promise<T>;
export type EngineMethodHandlers = Partial<{
  [M in EngineMethodName]: (...args: MethodArgs<M>) => MaybePromise<MethodResult<M>>;
}>;
export type EngineClient = {
  [M in EngineMethodName]: (...args: MethodArgs<M>) => Promise<MethodResult<M>>;
};

export type MethodSupport =
  | { status: "implemented" }
  | { status: "test-only" };

const implemented = { status: "implemented" } as const;

export const METHOD_SUPPORT: Readonly<Record<EngineMethodName, MethodSupport>> = {
  boot: implemented,
  bootFromSnapshot: implemented,
  ingestSupplementBundle: implemented,
  ingestUploaded: implemented,
  removeUploaded: implemented,
  patchHomebrew: implemented,
  prepareFastStartSnapshot: implemented,
  getFastStartSnapshotBuffer: implemented,
  contentStatus: implemented,
  contentSources: implemented,
  equipmentCategories: implemented,
  contentElements: implemented,
  contentElement: implemented,
  getElementSource: implemented,
  checkPackContent: implemented,
  createCharacter: implemented,
  getCharacter: implemented,
  deleteCharacter: implemented,
  setCharacterSources: implemented,
  getCharacterSources: implemented,
  setPortrait: implemented,
  removePortrait: implemented,
  updateDetails: implemented,
  setAbilities: implemented,
  getSelectionOptions: implemented,
  setSelection: implemented,
  clearSelection: implemented,
  getOptionalRules: implemented,
  setCharacterOption: implemented,
  getRulesetMode: implemented,
  setRulesetMode: implemented,
  getCharacterAdjustments: implemented,
  setCharacterControl: implemented,
  getStatistics: implemented,
  getAppearanceSuggestions: implemented,
  exportCharacterXml: implemented,
  importCharacterXml: implemented,
  importCharacterXmlWithSnapshot: implemented,
  getCharacterLoadDiagnostics: implemented,
  prepareCharacterLoadSnapshot: implemented,
  getCharacterLoadSnapshotBuffer: implemented,
  levelUp: implemented,
  levelUpTo: implemented,
  levelDown: implemented,
  delevel: implemented,
  undoDelevel: implemented,
  setHitPointRoll: implemented,
  getProgression: implemented,
  getSpellcasting: implemented,
  setPrepared: implemented,
  getSpellBrowse: implemented,
  setSpellAlias: implemented,
  getResources: implemented,
  setTrackerUsed: implemented,
  setResourceSwitch: implemented,
  restCharacter: implemented,
  saveManualTracker: implemented,
  deleteManualTracker: implemented,
  addGrantedSpell: implemented,
  removeGrantedSpell: implemented,
  addGrantedFeat: implemented,
  removeGrantedFeat: implemented,
  addGrantedAbilityScore: implemented,
  removeGrantedAbilityScore: implemented,
  addGrantedElement: implemented,
  removeGrantedElement: implemented,
  getDmGrants: implemented,
  getCustomContent: implemented,
  getMissingGrants: implemented,
  saveCustomDraft: implemented,
  deleteCustomDraft: implemented,
  promoteCustomDraft: implemented,
  getChoiceIdentityImpact: implemented,
  previewCustomItem: implemented,
  previewCustomSpell: implemented,
  getCompanion: implemented,
  setCompanionName: implemented,
  setCompanionPortrait: implemented,
  removeCompanionPortrait: implemented,
  getInventory: implemented,
  getItemBaseOptions: implemented,
  addItem: implemented,
  removeItem: implemented,
  setItemAmount: implemented,
  extractItem: implemented,
  equipItem: implemented,
  setItemStorage: implemented,
  attuneItem: implemented,
  setItemPresentation: implemented,
  setItemCards: implemented,
  setItemDetails: implemented,
  setCoins: implemented,
  getAttacks: implemented,
  getAttackOptions: implemented,
  createAttack: implemented,
  updateAttack: implemented,
  setAttackVisibility: implemented,
  moveAttack: implemented,
  deleteAttack: implemented,
  generateSheet: implemented,
  ensureHostFile: { status: "test-only" },
};

const QUEUE_KINDS: Readonly<Record<EngineMethodName, QueueKind>> = {
  boot: "content-write",
  bootFromSnapshot: "content-write",
  ingestSupplementBundle: "content-write",
  ingestUploaded: "content-write",
  removeUploaded: "content-write",
  patchHomebrew: "homebrew",
  prepareFastStartSnapshot: "read-only",
  getFastStartSnapshotBuffer: "read-only",
  contentStatus: "read-only",
  contentSources: "read-only",
  equipmentCategories: "read-only",
  contentElements: "read-only",
  contentElement: "read-only",
  getElementSource: "read-only",
  checkPackContent: "read-only",
  createCharacter: "character-write",
  getCharacter: "read-only",
  deleteCharacter: "character-write",
  setCharacterSources: "character-write",
  getCharacterSources: "read-only",
  setPortrait: "character-write",
  removePortrait: "character-write",
  updateDetails: "character-write",
  setAbilities: "character-write",
  getSelectionOptions: "read-only",
  setSelection: "character-write",
  clearSelection: "character-write",
  getOptionalRules: "read-only",
  setCharacterOption: "character-write",
  getRulesetMode: "read-only",
  setRulesetMode: "character-write",
  getCharacterAdjustments: "read-only",
  setCharacterControl: "character-write",
  getStatistics: "read-only",
  getAppearanceSuggestions: "read-only",
  exportCharacterXml: "read-only",
  importCharacterXml: "character-write",
  importCharacterXmlWithSnapshot: "character-write",
  getCharacterLoadDiagnostics: "read-only",
  prepareCharacterLoadSnapshot: "read-only",
  getCharacterLoadSnapshotBuffer: "read-only",
  levelUp: "character-write",
  levelUpTo: "character-write",
  levelDown: "character-write",
  delevel: "character-write",
  undoDelevel: "character-write",
  setHitPointRoll: "character-write",
  getProgression: "read-only",
  getSpellcasting: "read-only",
  setPrepared: "character-write",
  getSpellBrowse: "read-only",
  setSpellAlias: "character-write",
  getResources: "read-only",
  setTrackerUsed: "character-write",
  setResourceSwitch: "character-write",
  restCharacter: "character-write",
  saveManualTracker: "character-write",
  deleteManualTracker: "character-write",
  addGrantedSpell: "character-write",
  removeGrantedSpell: "character-write",
  addGrantedFeat: "character-write",
  removeGrantedFeat: "character-write",
  addGrantedAbilityScore: "character-write",
  removeGrantedAbilityScore: "character-write",
  addGrantedElement: "character-write",
  removeGrantedElement: "character-write",
  getDmGrants: "read-only",
  getCustomContent: "read-only",
  getMissingGrants: "read-only",
  saveCustomDraft: "character-write",
  deleteCustomDraft: "character-write",
  promoteCustomDraft: "read-only",
  getChoiceIdentityImpact: "read-only",
  previewCustomItem: "read-only",
  previewCustomSpell: "read-only",
  getCompanion: "read-only",
  setCompanionName: "character-write",
  setCompanionPortrait: "character-write",
  removeCompanionPortrait: "character-write",
  getInventory: "read-only",
  getItemBaseOptions: "read-only",
  addItem: "character-write",
  removeItem: "character-write",
  setItemAmount: "character-write",
  extractItem: "character-write",
  equipItem: "character-write",
  setItemStorage: "character-write",
  attuneItem: "character-write",
  setItemPresentation: "character-write",
  setItemCards: "character-write",
  setItemDetails: "character-write",
  setCoins: "character-write",
  getAttacks: "read-only",
  getAttackOptions: "read-only",
  createAttack: "character-write",
  updateAttack: "character-write",
  setAttackVisibility: "character-write",
  moveAttack: "character-write",
  deleteAttack: "character-write",
  generateSheet: "read-only",
  ensureHostFile: "content-write",
};

export function queueKindFor(method: EngineMethodName): QueueKind {
  return QUEUE_KINDS[method];
}
