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
  equipmentCategories: MethodContract<[], WireList>;
  contentElements: MethodContract<[query: WireObject], WireObject>;
  contentElement: MethodContract<[id: string], WireObject | null>;
  createCharacter: MethodContract<[name: string], WireObject>;
  getCharacter: MethodContract<[id: string], WireObject>;
  deleteCharacter: MethodContract<[id: string], void>;
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
  addGrantedSpell: MethodContract<[id: string, request: { spellId: string }], WireObject>;
  removeGrantedSpell: MethodContract<[id: string, request: { spellId: string }], WireObject>;
  addGrantedFeat: MethodContract<[id: string, request: { featId: string }], WireObject>;
  removeGrantedFeat: MethodContract<[id: string, request: { featId: string }], WireObject>;
  addGrantedAbilityScore: MethodContract<[id: string, request: { abilityElementIds: string[] }], WireObject>;
  removeGrantedAbilityScore: MethodContract<[id: string, request: { abilityElementId: string }], WireObject>;
  getDmGrants: MethodContract<[id: string], WireList>;
  getCompanion: MethodContract<[id: string], WireObject | null>;
  setCompanionName: MethodContract<[id: string, request: { name: string }], WireObject>;
  setCompanionPortrait: MethodContract<[id: string, base64: string], WireObject>;
  removeCompanionPortrait: MethodContract<[id: string], WireObject>;
  getInventory: MethodContract<[id: string], WireObject>;
  getItemBaseOptions: MethodContract<[id: string, itemId: string], WireObject>;
  addItem: MethodContract<
    [id: string, request: { itemId: string; amount?: number; baseElementId?: string | null }],
    WireObject
  >;
  removeItem: MethodContract<[id: string, identifier: string, amount?: number], WireObject>;
  extractItem: MethodContract<[id: string, identifier: string], WireObject>;
  equipItem: MethodContract<[id: string, identifier: string, request: { location: string }], WireObject>;
  setItemStorage: MethodContract<[id: string, identifier: string, request: { storage: string | null }], WireObject>;
  attuneItem: MethodContract<[id: string, identifier: string, request: { attuned: boolean }], WireObject>;
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
  generateSheet: MethodContract<[id: string, request: { lite: boolean }], WireObject>;
  ensureHostFile: MethodContract<[path: string, base64: string], { path: string }>;
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
  "levelDown",
  "delevel",
  "undoDelevel",
  "setHitPointRoll",
  "getProgression",
  "getSpellcasting",
  "setPrepared",
  "getSpellBrowse",
  "addGrantedSpell",
  "removeGrantedSpell",
  "addGrantedFeat",
  "removeGrantedFeat",
  "addGrantedAbilityScore",
  "removeGrantedAbilityScore",
  "getDmGrants",
  "getCompanion",
  "setCompanionName",
  "setCompanionPortrait",
  "removeCompanionPortrait",
  "getInventory",
  "getItemBaseOptions",
  "addItem",
  "removeItem",
  "extractItem",
  "equipItem",
  "setItemStorage",
  "attuneItem",
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
  levelDown: implemented,
  delevel: implemented,
  undoDelevel: implemented,
  setHitPointRoll: implemented,
  getProgression: implemented,
  getSpellcasting: implemented,
  setPrepared: implemented,
  getSpellBrowse: implemented,
  addGrantedSpell: implemented,
  removeGrantedSpell: implemented,
  addGrantedFeat: implemented,
  removeGrantedFeat: implemented,
  addGrantedAbilityScore: implemented,
  removeGrantedAbilityScore: implemented,
  getDmGrants: implemented,
  getCompanion: implemented,
  setCompanionName: implemented,
  setCompanionPortrait: implemented,
  removeCompanionPortrait: implemented,
  getInventory: implemented,
  getItemBaseOptions: implemented,
  addItem: implemented,
  removeItem: implemented,
  extractItem: implemented,
  equipItem: implemented,
  setItemStorage: implemented,
  attuneItem: implemented,
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
  levelDown: "character-write",
  delevel: "character-write",
  undoDelevel: "character-write",
  setHitPointRoll: "character-write",
  getProgression: "read-only",
  getSpellcasting: "read-only",
  setPrepared: "character-write",
  getSpellBrowse: "read-only",
  addGrantedSpell: "character-write",
  removeGrantedSpell: "character-write",
  addGrantedFeat: "character-write",
  removeGrantedFeat: "character-write",
  addGrantedAbilityScore: "character-write",
  removeGrantedAbilityScore: "character-write",
  getDmGrants: "read-only",
  getCompanion: "read-only",
  setCompanionName: "character-write",
  setCompanionPortrait: "character-write",
  removeCompanionPortrait: "character-write",
  getInventory: "read-only",
  getItemBaseOptions: "read-only",
  addItem: "character-write",
  removeItem: "character-write",
  extractItem: "character-write",
  equipItem: "character-write",
  setItemStorage: "character-write",
  attuneItem: "character-write",
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
