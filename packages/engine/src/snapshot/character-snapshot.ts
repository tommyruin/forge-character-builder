/**
 * Character load-snapshot controller.
 *
 * Prepares a compressed character snapshot (canonical-json + gzip) for a
 * publication slot, restores characters from a snapshot with xml fallback,
 * and records load diagnostics. The payload carries identity, content-binding
 * and version fields so a restore can validate that the snapshot belongs to
 * the supplied xml, the current content library and this engine.
 */

import {
  canonicalStringify,
  canonicalParse,
  gzipToBuffer,
  gunzipBounded,
  sha256Hex,
  sha256HexSync,
  SnapshotCodecError,
  CHARACTER_COMPRESSED_LIMIT,
  CHARACTER_DECOMPRESSED_LIMIT,
  PARSER_VERSION,
  type GzipResult,
  type SnapshotCodecReason,
} from "./codec.js";
import { CHARACTER_LOAD_KIND, CHARACTER_LOAD_SCHEMA_VERSION } from "./identities.js";
import { contentLibraryDigest, serializeContentLibrary } from "./content-graph.js";
import { parseDnd5e, type Dnd5eDocument } from "../dnd5e/document.js";
import { buildLoadIssues } from "../character/options.js";
import { pendingSelectionRules } from "../selection/selection.js";
import { engineError } from "../errors.js";
import type { CharacterService } from "../character/service.js";
import type { CharacterState } from "../character/state.js";
import type { ElementLibrary } from "../content/library.js";
import type {
  CharacterLoadDiagnosticsDto,
  CharacterSnapshotPreparedDto,
  ManifestIdentityDto,
  RestoreMode,
} from "@forge-cb/api";
import { ENGINE_VERSION } from "../index.js";

const CANONICAL_CLIENT = "dm-forge-character-load";
const CANONICAL_SCHEMA = 1;
const CANONICAL_CODEC = "gzip-json";

export interface CharacterSnapshotController {
  prepare(id: string, identity: ManifestIdentityDto): Promise<CharacterSnapshotPreparedDto>;
  /** The pending prepared buffer; consumed by the call. */
  takeBuffer(): ArrayBuffer;
  /** Restores with the supplied xml as the snapshot integrity anchor. */
  importWithSnapshot(id: string, base64: string, identity: ManifestIdentityDto, body: ArrayBuffer): Promise<CharacterState>;
  /** The last recorded load diagnostics entry. */
  diagnostics(): CharacterLoadDiagnosticsDto;
  /** Records diagnostics for a plain xml import performed by the caller. */
  recordXmlImport(id: string, xmlText: string, timing: { parseMs: number; hydrationMs: number }): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return decoder.decode(bytes);
}

const EMPTY_DIAGNOSTICS: CharacterLoadDiagnosticsDto = {
  characterId: "",
  restoreMode: "none",
  snapshotAccepted: false,
  warning: null,
  loadIssueCount: 0,
  issueKindCounts: {},
  selectionCount: 0,
  elementCount: 0,
  inventoryCount: 0,
  attackCount: 0,
  finalStateDigest: "",
  parseMs: 0,
  validationMs: 0,
  hydrationMs: 0,
  totalMs: 0,
};

function throwBad(reason: SnapshotCodecReason, detail: string): never {
  throw new SnapshotCodecError(reason, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalIdentity(identity: ManifestIdentityDto): boolean {
  return (
    identity.client === CANONICAL_CLIENT &&
    identity.schema === CANONICAL_SCHEMA &&
    identity.codec === CANONICAL_CODEC
  );
}

function normalizedStateForDigest(state: CharacterState): CharacterState {
  return { ...state, selectionRuleIds: new Map(), magicCasterIds: new Map() };
}

function checkRecord(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throwBad("invalid-structure", `${path}: expected an object, got ${value === null ? "null" : typeof value}`);
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throwBad("invalid-structure", `${path}: unexpected key "${key}"`);
    }
  }
  for (const key of required) {
    if (!(key in value)) throwBad("invalid-structure", `${path}: missing key "${key}"`);
  }
  return value;
}

function checkString(value: unknown, path: string): string {
  if (typeof value !== "string") throwBad("invalid-structure", `${path}: expected a string, got ${typeof value}`);
  return value;
}

function checkNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwBad("invalid-structure", `${path}: expected a finite number, got ${typeof value}`);
  }
  return value;
}

function checkBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throwBad("invalid-structure", `${path}: expected a boolean, got ${typeof value}`);
  return value;
}

function checkStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throwBad("invalid-structure", `${path}: expected an array`);
  return value.map((entry, index) => checkString(entry, `${path}[${index}]`));
}

function checkStringMap(value: unknown, path: string): Map<string, string> {
  if (!(value instanceof Map)) throwBad("invalid-structure", `${path}: expected a tagged $map object`);
  for (const [key, entry] of value.entries()) {
    if (typeof key !== "string") throwBad("invalid-structure", `${path}: map keys must be strings`);
    checkString(entry, `${path}.${key}`);
  }
  return value;
}

function checkBooleanMap(value: unknown, path: string): Map<string, boolean> {
  if (!(value instanceof Map)) throwBad("invalid-structure", `${path}: expected a tagged $map object`);
  for (const [key, entry] of value.entries()) {
    if (typeof key !== "string") throwBad("invalid-structure", `${path}: map keys must be strings`);
    checkBoolean(entry, `${path}.${key}`);
  }
  return value;
}

function checkStringSet(value: unknown, path: string): Set<string> {
  if (!(value instanceof Set)) throwBad("invalid-structure", `${path}: expected a tagged $set object`);
  for (const member of value) checkString(member, `${path}[]`);
  return value;
}

function checkOpenRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throwBad("invalid-structure", `${path}: expected an object, got ${value === null ? "null" : typeof value}`);
  }
  return value;
}

function checkStringRecord(value: unknown, path: string): Record<string, string> {
  const record = checkOpenRecord(value, path);
  for (const key of Object.keys(record)) checkString(record[key], `${path}.${key}`);
  return record as Record<string, string>;
}

function checkStringNumberRecord(value: unknown, path: string): Record<string, number[]> {
  const record = checkOpenRecord(value, path);
  for (const key of Object.keys(record)) {
    const list = record[key];
    if (!Array.isArray(list)) throwBad("invalid-structure", `${path}.${key}: expected an array`);
    list.forEach((entry, index) => checkNumber(entry, `${path}.${key}[${index}]`));
  }
  return record as Record<string, number[]>;
}

const ABILITY_KEYS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;

function checkAbilityScores(value: unknown, path: string): void {
  const record = checkRecord(value, path, ABILITY_KEYS, []);
  for (const key of ABILITY_KEYS) checkNumber(record[key], `${path}.${key}`);
}

/** RegisteredElement nodes (recursive) with their optional wrapper fields. */
function checkElement(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["type", "name", "id", "children"],
    ["requiredLevel", "number", "checksum", "registered", "multiclass", "starting", "classId", "isList", "listText"],
  );
  checkString(record.type, `${path}.type`);
  checkString(record.name, `${path}.name`);
  checkString(record.id, `${path}.id`);
  if (record.requiredLevel !== undefined) checkNumber(record.requiredLevel, `${path}.requiredLevel`);
  if (record.number !== undefined) checkNumber(record.number, `${path}.number`);
  if (record.checksum !== undefined) checkString(record.checksum, `${path}.checksum`);
  if (record.registered !== undefined) checkString(record.registered, `${path}.registered`);
  if (record.multiclass !== undefined) checkBoolean(record.multiclass, `${path}.multiclass`);
  if (record.starting !== undefined) checkBoolean(record.starting, `${path}.starting`);
  if (record.classId !== undefined) checkString(record.classId, `${path}.classId`);
  if (record.isList !== undefined) checkBoolean(record.isList, `${path}.isList`);
  if (record.listText !== undefined) checkString(record.listText, `${path}.listText`);
  const children = record.children;
  if (!Array.isArray(children)) throwBad("invalid-structure", `${path}.children: expected an array`);
  children.forEach((child, index) => checkElement(child, `${path}.children[${index}]`));
}

function checkSetters(value: unknown, path: string): void {
  if (!Array.isArray(value)) throwBad("invalid-structure", `${path}: expected an array`);
  value.forEach((entry, index) => {
    const context = `${path}[${index}]`;
    const record = checkRecord(entry, context, ["name", "value"], ["attrs"]);
    checkString(record.name, `${context}.name`);
    checkString(record.value, `${context}.value`);
    if (record.attrs !== undefined) checkStringRecord(record.attrs, `${context}.attrs`);
  });
}

const RULE_OPTIONAL_KEYS = [
  "type",
  "name",
  "id",
  "level",
  "supports",
  "requirements",
  "prepared",
  "spellcasting",
  "value",
  "bonus",
  "group",
  "entry",
  "equipped",
  "number",
  "expand",
  "default",
  "optional",
  "alt",
  "attrs",
] as const;

function checkRules(value: unknown, path: string): void {
  if (!Array.isArray(value)) throwBad("invalid-structure", `${path}: expected an array`);
  value.forEach((entry, index) => {
    const context = `${path}[${index}]`;
    const record = checkRecord(entry, context, ["kind"], RULE_OPTIONAL_KEYS);
    checkString(record.kind, `${context}.kind`);
    if (record.attrs !== undefined) checkStringRecord(record.attrs, `${context}.attrs`);
  });
}

/** Extract/extras entries: an item id with a content amount. */
function checkExtractEntries(value: unknown, path: string): void {
  if (!Array.isArray(value)) throwBad("invalid-structure", `${path}: expected an array`);
  value.forEach((entry, index) => {
    const context = `${path}[${index}]`;
    const record = checkRecord(entry, context, ["id", "amount"], []);
    checkString(record.id, `${context}.id`);
    checkNumber(record.amount, `${context}.amount`);
  });
}

/** The grant targets recorded in level registrations (lighter than full rules). */
function checkParsedElement(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["identity", "setters", "rules", "supports", "compendiumHidden", "children", "declaredBy"],
    ["descriptionXml", "rulesXml", "requirements", "prerequisite", "multiclass", "spellcasting", "extract", "extras", "overridesBundledCore", "sheets"],
  );
  const identity = checkRecord(record.identity, `${path}.identity`, ["id", "name", "type", "source"], []);
  checkString(identity.id, `${path}.identity.id`);
  checkString(identity.name, `${path}.identity.name`);
  checkString(identity.type, `${path}.identity.type`);
  checkString(identity.source, `${path}.identity.source`);
  checkSetters(record.setters, `${path}.setters`);
  checkRules(record.rules, `${path}.rules`);
  checkStringArray(record.supports, `${path}.supports`);
  checkBoolean(record.compendiumHidden, `${path}.compendiumHidden`);
  checkString(record.declaredBy, `${path}.declaredBy`);
  const children = record.children;
  if (!Array.isArray(children)) throwBad("invalid-structure", `${path}.children: expected an array`);
  children.forEach((child, index) => checkParsedElement(child, `${path}.children[${index}]`));
  if (record.descriptionXml !== undefined) checkString(record.descriptionXml, `${path}.descriptionXml`);
  if (record.rulesXml !== undefined) checkString(record.rulesXml, `${path}.rulesXml`);
  if (record.requirements !== undefined) checkString(record.requirements, `${path}.requirements`);
  if (record.prerequisite !== undefined) checkString(record.prerequisite, `${path}.prerequisite`);
  if (record.multiclass !== undefined) {
    const block = checkRecord(record.multiclass, `${path}.multiclass`, ["id", "setters", "rules"], ["prerequisite", "requirements"]);
    checkString(block.id, `${path}.multiclass.id`);
    checkSetters(block.setters, `${path}.multiclass.setters`);
    checkRules(block.rules, `${path}.multiclass.rules`);
    if (block.prerequisite !== undefined) checkString(block.prerequisite, `${path}.multiclass.prerequisite`);
    if (block.requirements !== undefined) checkString(block.requirements, `${path}.multiclass.requirements`);
  }
  if (record.spellcasting !== undefined) {
    const block = checkRecord(
      record.spellcasting,
      `${path}.spellcasting`,
      ["name", "extend"],
      ["ability", "prepare", "list", "listKnown", "all", "allowReplace", "extension"],
    );
    checkString(block.name, `${path}.spellcasting.name`);
    checkStringArray(block.extend, `${path}.spellcasting.extend`);
    if (block.ability !== undefined) checkString(block.ability, `${path}.spellcasting.ability`);
    if (block.prepare !== undefined) checkBoolean(block.prepare, `${path}.spellcasting.prepare`);
    if (block.list !== undefined) checkString(block.list, `${path}.spellcasting.list`);
    if (block.listKnown !== undefined) checkBoolean(block.listKnown, `${path}.spellcasting.listKnown`);
    if (block.all !== undefined) checkBoolean(block.all, `${path}.spellcasting.all`);
    if (block.allowReplace !== undefined) checkBoolean(block.allowReplace, `${path}.spellcasting.allowReplace`);
    if (block.extension !== undefined) checkBoolean(block.extension, `${path}.spellcasting.extension`);
  }
  if (record.extract !== undefined) checkExtractEntries(record.extract, `${path}.extract`);
  if (record.extras !== undefined) {
    const extras = checkRecord(record.extras, `${path}.extras`, ["gold", "items", "choices"], []);
    checkNumber(extras.gold, `${path}.extras.gold`);
    checkExtractEntries(extras.items, `${path}.extras.items`);
    if (!Array.isArray(extras.choices)) throwBad("invalid-structure", `${path}.extras.choices: expected an array`);
    extras.choices.forEach((choice, index) => {
      const context = `${path}.extras.choices[${index}]`;
      const choiceRecord = checkRecord(choice, context, ["label", "candidates"], []);
      checkString(choiceRecord.label, `${context}.label`);
      checkExtractEntries(choiceRecord.candidates, `${context}.candidates`);
    });
  }
  if (record.overridesBundledCore !== undefined) checkBoolean(record.overridesBundledCore, `${path}.overridesBundledCore`);
  if (record.sheets !== undefined) {
    if (!Array.isArray(record.sheets)) throwBad("invalid-structure", `${path}.sheets: expected an array`);
    record.sheets.forEach((sheet, sheetIndex) => {
      const context = `${path}.sheets[${sheetIndex}]`;
      const sheetRecord = checkRecord(
        sheet,
        context,
        ["descriptions"],
        ["display", "action", "usage", "alt", "name"],
      );
      if (!Array.isArray(sheetRecord.descriptions)) {
        throwBad("invalid-structure", `${context}.descriptions: expected an array`);
      }
      sheetRecord.descriptions.forEach((description, descriptionIndex) => {
        const descriptionContext = `${context}.descriptions[${descriptionIndex}]`;
        const descriptionRecord = checkRecord(
          description,
          descriptionContext,
          ["descriptionXml", "text"],
          ["level", "usage", "action"],
        );
        checkString(descriptionRecord.descriptionXml, `${descriptionContext}.descriptionXml`);
        checkString(descriptionRecord.text, `${descriptionContext}.text`);
        if (descriptionRecord.level !== undefined) checkNumber(descriptionRecord.level, `${descriptionContext}.level`);
        if (descriptionRecord.usage !== undefined) checkString(descriptionRecord.usage, `${descriptionContext}.usage`);
        if (descriptionRecord.action !== undefined) checkString(descriptionRecord.action, `${descriptionContext}.action`);
      });
      if (sheetRecord.display !== undefined) checkBoolean(sheetRecord.display, `${context}.display`);
      if (sheetRecord.action !== undefined) checkString(sheetRecord.action, `${context}.action`);
      if (sheetRecord.usage !== undefined) checkString(sheetRecord.usage, `${context}.usage`);
      if (sheetRecord.alt !== undefined) checkString(sheetRecord.alt, `${context}.alt`);
      if (sheetRecord.name !== undefined) checkString(sheetRecord.name, `${context}.name`);
    });
  }
}

/** The level-registration node records that delevel restores. */
function checkTreeNodeArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) throwBad("invalid-structure", `${path}: expected an array`);
  value.forEach((node, index) => checkTreeNode(node, `${path}[${index}]`));
}

function checkTreeNode(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["kind"],
    ["type", "name", "requiredLevel", "number", "checksum", "registered", "isList", "listText", "element", "children"],
  );
  const kind = checkString(record.kind, `${path}.kind`);
  if (kind === "wrapper") {
    checkString(record.type, `${path}.type`);
    checkString(record.name, `${path}.name`);
    checkNumber(record.requiredLevel, `${path}.requiredLevel`);
    if (record.number !== undefined) checkNumber(record.number, `${path}.number`);
    if (record.checksum !== undefined) checkString(record.checksum, `${path}.checksum`);
    if (record.registered !== undefined) checkString(record.registered, `${path}.registered`);
    if (record.isList !== undefined) checkBoolean(record.isList, `${path}.isList`);
    if (record.listText !== undefined) checkString(record.listText, `${path}.listText`);
    if (record.children !== undefined) checkTreeNodeArray(record.children, `${path}.children`);
  } else if (kind === "element") {
    checkParsedElement(record.element, `${path}.element`);
    checkTreeNodeArray(record.children, `${path}.children`);
  } else {
    throwBad("invalid-structure", `${path}.kind: unknown tree node kind "${kind}"`);
  }
}

function checkLevelRegistrationRecord(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["totalLevel", "classId", "classLevel", "isMulticlass", "isClassStart", "addedElementIds", "addedNodes"],
    ["nestedAddedNodes"],
  );
  checkNumber(record.totalLevel, `${path}.totalLevel`);
  checkString(record.classId, `${path}.classId`);
  checkNumber(record.classLevel, `${path}.classLevel`);
  checkBoolean(record.isMulticlass, `${path}.isMulticlass`);
  checkBoolean(record.isClassStart, `${path}.isClassStart`);
  checkStringArray(record.addedElementIds, `${path}.addedElementIds`);
  const nodes = record.addedNodes;
  if (!Array.isArray(nodes)) throwBad("invalid-structure", `${path}.addedNodes: expected an array`);
  nodes.forEach((node, index) => checkTreeNode(node, `${path}.addedNodes[${index}]`));
  if (record.nestedAddedNodes !== undefined) {
    if (!Array.isArray(record.nestedAddedNodes)) {
      throwBad("invalid-structure", `${path}.nestedAddedNodes: expected an array`);
    }
    record.nestedAddedNodes.forEach((value, index) => {
      const nestedPath = `${path}.nestedAddedNodes[${index}]`;
      const nested = checkRecord(value, nestedPath, ["parentPath", "insertIndex", "nodes"], []);
      if (!Array.isArray(nested.parentPath)) {
        throwBad("invalid-structure", `${nestedPath}.parentPath: expected an array`);
      }
      nested.parentPath.forEach((part, partIndex) => checkNumber(part, `${nestedPath}.parentPath[${partIndex}]`));
      checkNumber(nested.insertIndex, `${nestedPath}.insertIndex`);
      if (!Array.isArray(nested.nodes)) throwBad("invalid-structure", `${nestedPath}.nodes: expected an array`);
      nested.nodes.forEach((node, nodeIndex) => checkTreeNode(node, `${nestedPath}.nodes[${nodeIndex}]`));
    });
  }
}

function checkLevelHistoryEntry(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["totalLevel", "classId", "classLevel", "isMulticlass", "isClassStart", "isPending", "canRemove"],
    [],
  );
  checkNumber(record.totalLevel, `${path}.totalLevel`);
  checkString(record.classId, `${path}.classId`);
  checkNumber(record.classLevel, `${path}.classLevel`);
  checkBoolean(record.isMulticlass, `${path}.isMulticlass`);
  checkBoolean(record.isClassStart, `${path}.isClassStart`);
  checkBoolean(record.isPending, `${path}.isPending`);
  checkBoolean(record.canRemove, `${path}.canRemove`);
}

function checkAttack(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["id", "identifier", "name", "range", "attack", "damage", "displayed", "ability", "kind", "abilityMode", "description", "calculation"],
    ["spell"],
  );
  checkString(record.id, `${path}.id`);
  checkString(record.identifier, `${path}.identifier`);
  checkString(record.name, `${path}.name`);
  checkString(record.range, `${path}.range`);
  checkString(record.attack, `${path}.attack`);
  checkString(record.damage, `${path}.damage`);
  checkBoolean(record.displayed, `${path}.displayed`);
  checkString(record.ability, `${path}.ability`);
  checkString(record.kind, `${path}.kind`);
  checkString(record.abilityMode, `${path}.abilityMode`);
  checkString(record.description, `${path}.description`);
  if (record.spell !== undefined) {
    const spell = checkRecord(record.spell, `${path}.spell`, ["casterName", "spellId", "overriddenFields"], []);
    checkString(spell.casterName, `${path}.spell.casterName`);
    checkString(spell.spellId, `${path}.spell.spellId`);
    if (!Array.isArray(spell.overriddenFields)) {
      throwBad("invalid-structure", `${path}.spell.overriddenFields: expected an array`);
    }
    spell.overriddenFields.forEach((field, index) =>
      checkString(field, `${path}.spell.overriddenFields[${index}]`),
    );
  }
  if (record.calculation === null) return;
  const calc = checkRecord(
    record.calculation,
    `${path}.calculation`,
    ["source", "ability", "useProficiency", "attackMiscBonus", "damageDice", "addAbilityToDamage", "damageMiscBonus", "damageType", "casterIdentifier"],
    [],
  );
  checkString(calc.source, `${path}.calculation.source`);
  checkString(calc.ability, `${path}.calculation.ability`);
  checkBoolean(calc.useProficiency, `${path}.calculation.useProficiency`);
  checkNumber(calc.attackMiscBonus, `${path}.calculation.attackMiscBonus`);
  checkString(calc.damageDice, `${path}.calculation.damageDice`);
  checkBoolean(calc.addAbilityToDamage, `${path}.calculation.addAbilityToDamage`);
  checkNumber(calc.damageMiscBonus, `${path}.calculation.damageMiscBonus`);
  checkString(calc.damageType, `${path}.calculation.damageType`);
  checkString(calc.casterIdentifier, `${path}.calculation.casterIdentifier`);
}

function checkItem(value: unknown, path: string): void {
  const record = checkRecord(
    value,
    path,
    ["identifier", "itemId", "name", "amount", "equipped", "attuned", "adorners", "detailsName", "notes"],
    ["location", "card", "sidebar"],
  );
  checkString(record.identifier, `${path}.identifier`);
  checkString(record.itemId, `${path}.itemId`);
  checkString(record.name, `${path}.name`);
  checkNumber(record.amount, `${path}.amount`);
  checkBoolean(record.equipped, `${path}.equipped`);
  checkBoolean(record.attuned, `${path}.attuned`);
  checkStringArray(record.adorners, `${path}.adorners`);
  checkString(record.detailsName, `${path}.detailsName`);
  checkString(record.notes, `${path}.notes`);
  if (record.card !== undefined) checkBoolean(record.card, `${path}.card`);
  if (record.sidebar !== undefined) checkBoolean(record.sidebar, `${path}.sidebar`);
  if (record.location !== undefined) checkString(record.location, `${path}.location`);
}

function checkSpell(value: unknown, path: string): void {
  const record = checkRecord(value, path, ["name", "level", "id", "prepared", "alwaysPrepared", "known"], []);
  checkString(record.name, `${path}.name`);
  checkString(record.level, `${path}.level`);
  checkString(record.id, `${path}.id`);
  checkBoolean(record.prepared, `${path}.prepared`);
  checkBoolean(record.alwaysPrepared, `${path}.alwaysPrepared`);
  checkBoolean(record.known, `${path}.known`);
}

function checkSpellcastingBlock(value: unknown, path: string): void {
  const record = checkRecord(value, path, ["name", "ability", "attack", "dc", "source", "slots", "cantrips", "spells"], []);
  checkString(record.name, `${path}.name`);
  checkString(record.ability, `${path}.ability`);
  checkString(record.attack, `${path}.attack`);
  checkString(record.dc, `${path}.dc`);
  checkString(record.source, `${path}.source`);
  checkStringRecord(record.slots, `${path}.slots`);
  checkStringArray(record.cantrips, `${path}.cantrips`);
  const spells = record.spells;
  if (!Array.isArray(spells)) throwBad("invalid-structure", `${path}.spells: expected an array`);
  spells.forEach((spell, index) => checkSpell(spell, `${path}.spells[${index}]`));
}

function checkMagic(value: unknown, path: string): void {
  if (value === null) return;
  const record = checkRecord(value, path, ["multiclass", "level", "casters", "additional"], []);
  checkBoolean(record.multiclass, `${path}.multiclass`);
  if (record.level !== null) checkString(record.level, `${path}.level`);
  const casters = record.casters;
  if (!Array.isArray(casters)) throwBad("invalid-structure", `${path}.casters: expected an array`);
  casters.forEach((caster, index) => {
    const context = `${path}.casters[${index}]`;
    const block = checkRecord(caster, context, ["name", "ability", "attack", "dc", "source", "slots", "cantrips", "spells"], []);
    checkString(block.name, `${context}.name`);
    checkString(block.ability, `${context}.ability`);
    checkString(block.attack, `${context}.attack`);
    checkString(block.dc, `${context}.dc`);
    checkString(block.source, `${context}.source`);
    checkStringRecord(block.slots, `${context}.slots`);
    const cantrips = block.cantrips;
    if (!Array.isArray(cantrips)) throwBad("invalid-structure", `${context}.cantrips: expected an array`);
    cantrips.forEach((cantrip, i) => checkSpell(cantrip, `${context}.cantrips[${i}]`));
    const spells = block.spells;
    if (!Array.isArray(spells)) throwBad("invalid-structure", `${context}.spells: expected an array`);
    spells.forEach((spell, i) => checkSpell(spell, `${context}.spells[${i}]`));
  });
  const additional = record.additional;
  if (!Array.isArray(additional)) throwBad("invalid-structure", `${path}.additional: expected an array`);
  additional.forEach((entry, index) => {
    const context = `${path}.additional[${index}]`;
    const spell = checkRecord(entry, context, ["name", "level", "id", "source"], []);
    checkString(spell.name, `${context}.name`);
    checkString(spell.level, `${context}.level`);
    checkString(spell.id, `${context}.id`);
    checkString(spell.source, `${context}.source`);
  });
}

function checkDelevelSnapshot(value: unknown, path: string): void {
  if (value === null) return;
  const record = checkRecord(value, path, ["documentRaw", "levelRegistrations", "removedLevel", "invalidatedWrappers"], []);
  checkString(record.documentRaw, `${path}.documentRaw`);
  const registrations = record.levelRegistrations;
  if (!Array.isArray(registrations)) throwBad("invalid-structure", `${path}.levelRegistrations: expected an array`);
  registrations.forEach((entry, index) => checkLevelRegistrationRecord(entry, `${path}.levelRegistrations[${index}]`));
  checkNumber(record.removedLevel, `${path}.removedLevel`);
  const wrappers = record.invalidatedWrappers;
  if (!Array.isArray(wrappers)) throwBad("invalid-structure", `${path}.invalidatedWrappers: expected an array`);
  wrappers.forEach((wrapper, index) => checkElement(wrapper, `${path}.invalidatedWrappers[${index}]`));
}

const CHARACTER_STATE_KEYS = [
  "id",
  "group",
  "generationOption",
  "name",
  "race",
  "klass",
  "archetype",
  "background",
  "level",
  "portrait",
  "playerName",
  "gender",
  "experience",
  "attacksDescription",
  "attacks",
  "backstory",
  "backgroundTraits",
  "backgroundFeature",
  "organization",
  "additionalFeatures",
  "notes",
  "quest",
  "coins",
  "equipmentNote",
  "treasureNote",
  "appearance",
  "abilities",
  "availablePoints",
  "elements",
  "levelCount",
  "registeredCount",
  "hitPointRolls",
  "levelHistory",
  "levelRegistrations",
  "delevelSnapshot",
  "conditional",
  "companion",
  "storages",
  "items",
  "spellcasting",
  "magic",
  "magicCasterIds",
  "sum",
  "restrictedSources",
  "restrictedElements",
  "options",
  "controls",
  "rulesetMode",
  "selectionRuleIds",
] as const;

function validateCharacterState(value: unknown): void {
  const state = checkRecord(value, "state", CHARACTER_STATE_KEYS, []);
  checkString(state.id, "state.id");
  checkString(state.group, "state.group");
  checkNumber(state.generationOption, "state.generationOption");
  checkString(state.name, "state.name");
  checkString(state.race, "state.race");
  checkString(state.klass, "state.klass");
  checkString(state.archetype, "state.archetype");
  checkString(state.background, "state.background");
  checkNumber(state.level, "state.level");
  const portrait = checkRecord(state.portrait, "state.portrait", ["companion", "local", "base64"], []);
  checkString(portrait.companion, "state.portrait.companion");
  checkString(portrait.local, "state.portrait.local");
  checkString(portrait.base64, "state.portrait.base64");
  checkString(state.playerName, "state.playerName");
  checkString(state.gender, "state.gender");
  checkNumber(state.experience, "state.experience");
  checkString(state.attacksDescription, "state.attacksDescription");
  const attacks = state.attacks;
  if (!Array.isArray(attacks)) throwBad("invalid-structure", "state.attacks: expected an array");
  attacks.forEach((attack, index) => checkAttack(attack, `state.attacks[${index}]`));
  checkString(state.backstory, "state.backstory");
  const traits = checkRecord(state.backgroundTraits, "state.backgroundTraits", ["trinket", "traits", "ideals", "bonds", "flaws"], []);
  for (const key of ["trinket", "traits", "ideals", "bonds", "flaws"] as const) {
    checkString(traits[key], `state.backgroundTraits.${key}`);
  }
  const feature = checkRecord(state.backgroundFeature, "state.backgroundFeature", ["name", "description"], []);
  checkString(feature.name, "state.backgroundFeature.name");
  checkString(feature.description, "state.backgroundFeature.description");
  const organization = checkRecord(state.organization, "state.organization", ["name", "symbol", "allies"], []);
  checkString(organization.name, "state.organization.name");
  checkString(organization.symbol, "state.organization.symbol");
  checkString(organization.allies, "state.organization.allies");
  checkString(state.additionalFeatures, "state.additionalFeatures");
  const notes = checkRecord(state.notes, "state.notes", ["left", "right"], []);
  checkString(notes.left, "state.notes.left");
  checkString(notes.right, "state.notes.right");
  checkString(state.quest, "state.quest");
  const coins = checkRecord(state.coins, "state.coins", ["copper", "silver", "electrum", "gold", "platinum"], []);
  for (const key of ["copper", "silver", "electrum", "gold", "platinum"] as const) {
    checkNumber(coins[key], `state.coins.${key}`);
  }
  checkString(state.equipmentNote, "state.equipmentNote");
  checkString(state.treasureNote, "state.treasureNote");
  const appearance = checkRecord(
    state.appearance,
    "state.appearance",
    ["portrait", "age", "height", "weight", "eyes", "skin", "hair"],
    [],
  );
  for (const key of ["portrait", "age", "height", "weight", "eyes", "skin", "hair"] as const) {
    checkString(appearance[key], `state.appearance.${key}`);
  }
  checkAbilityScores(state.abilities, "state.abilities");
  checkNumber(state.availablePoints, "state.availablePoints");
  const elements = state.elements;
  if (!Array.isArray(elements)) throwBad("invalid-structure", "state.elements: expected an array");
  elements.forEach((element, index) => checkElement(element, `state.elements[${index}]`));
  checkNumber(state.levelCount, "state.levelCount");
  checkNumber(state.registeredCount, "state.registeredCount");
  checkStringNumberRecord(state.hitPointRolls, "state.hitPointRolls");
  const levelHistory = state.levelHistory;
  if (!Array.isArray(levelHistory)) throwBad("invalid-structure", "state.levelHistory: expected an array");
  levelHistory.forEach((entry, index) => checkLevelHistoryEntry(entry, `state.levelHistory[${index}]`));
  const registrations = state.levelRegistrations;
  if (!Array.isArray(registrations)) throwBad("invalid-structure", "state.levelRegistrations: expected an array");
  registrations.forEach((entry, index) => checkLevelRegistrationRecord(entry, `state.levelRegistrations[${index}]`));
  checkDelevelSnapshot(state.delevelSnapshot, "state.delevelSnapshot");
  checkStringArray(state.conditional, "state.conditional");
  const companion = checkRecord(
    state.companion,
    "state.companion",
    ["name", "attributes", "saves", "skills", "portraitLocation"],
    [],
  );
  checkString(companion.name, "state.companion.name");
  checkAbilityScores(companion.attributes, "state.companion.attributes");
  const saves = companion.saves;
  if (!Array.isArray(saves)) throwBad("invalid-structure", "state.companion.saves: expected an array");
  saves.forEach((save, index) => {
    const context = `state.companion.saves[${index}]`;
    const record = checkRecord(save, context, ["ability", "value"], []);
    checkString(record.ability, `${context}.ability`);
    checkNumber(record.value, `${context}.value`);
  });
  const skills = companion.skills;
  if (!Array.isArray(skills)) throwBad("invalid-structure", "state.companion.skills: expected an array");
  skills.forEach((skill, index) => {
    const context = `state.companion.skills[${index}]`;
    const record = checkRecord(skill, context, ["name", "value"], []);
    checkString(record.name, `${context}.name`);
    checkNumber(record.value, `${context}.value`);
  });
  checkString(companion.portraitLocation, "state.companion.portraitLocation");
  checkStringArray(state.storages, "state.storages");
  const items = state.items;
  if (!Array.isArray(items)) throwBad("invalid-structure", "state.items: expected an array");
  items.forEach((item, index) => checkItem(item, `state.items[${index}]`));
  const spellcasting = state.spellcasting;
  if (!Array.isArray(spellcasting)) throwBad("invalid-structure", "state.spellcasting: expected an array");
  spellcasting.forEach((block, index) => checkSpellcastingBlock(block, `state.spellcasting[${index}]`));
  checkMagic(state.magic, "state.magic");
  checkStringMap(state.magicCasterIds, "state.magicCasterIds");
  const sum = checkRecord(state.sum, "state.sum", ["elementCount", "elements"], []);
  checkNumber(sum.elementCount, "state.sum.elementCount");
  const sumElements = sum.elements;
  if (!Array.isArray(sumElements)) throwBad("invalid-structure", "state.sum.elements: expected an array");
  sumElements.forEach((entry, index) => {
    const context = `state.sum.elements[${index}]`;
    const record = checkRecord(entry, context, ["type", "id"], []);
    checkString(record.type, `${context}.type`);
    checkString(record.id, `${context}.id`);
  });
  checkStringArray(state.restrictedSources, "state.restrictedSources");
  checkStringArray(state.restrictedElements, "state.restrictedElements");
  checkStringSet(state.options, "state.options");
  checkBooleanMap(state.controls, "state.controls");
  checkString(state.rulesetMode, "state.rulesetMode");
  checkStringMap(state.selectionRuleIds, "state.selectionRuleIds");
}

export function createCharacterSnapshotController(
  service: CharacterService,
  library: ElementLibrary,
): CharacterSnapshotController {
  return new CharacterSnapshotControllerImpl(service, library);
}

class CharacterSnapshotControllerImpl implements CharacterSnapshotController {
  private readonly service: CharacterService;
  private readonly library: ElementLibrary;
  private pendingBuffer: ArrayBuffer | undefined;
  private lastDiagnostics: CharacterLoadDiagnosticsDto = { ...EMPTY_DIAGNOSTICS };
  /** The controller's own fallback import must not re-record as a plain xml. */
  private internalFallbackInProgress = false;

  constructor(service: CharacterService, library: ElementLibrary) {
    this.service = service;
    this.library = library;
  }

  async prepare(id: string, identity: ManifestIdentityDto): Promise<CharacterSnapshotPreparedDto> {
    this.pendingBuffer = undefined;
    if (!isCanonicalIdentity(identity)) {
      throw engineError(
        "invalid-argument",
        `unsupported character snapshot identity ${identity.client}/${identity.schema}/${identity.codec}`,
      );
    }
    const state = this.service.getCharacter(id);
    const issues = buildLoadIssues(state, this.library);
    if (issues.length > 0) {
      throw engineError("conflict", `character '${id}' has ${issues.length} load issue(s) and cannot be snapshotted`);
    }
    const selectionCount = pendingSelectionRules(state).length;
    const xmlHash = await sha256Hex(this.service.documentOf(id).raw);
    const libraryDigest = await this.libraryDigest();
    const payload = {
      client: identity.client,
      schema: identity.schema,
      codec: identity.codec,
      libraryKind: CHARACTER_LOAD_KIND,
      schemaVersion: 1,
      characterId: id,
      xmlHash,
      libraryDigest,
      engineVersion: ENGINE_VERSION,
      parserVersion: PARSER_VERSION,
      state,
    };
    const serializationStart = performance.now();
    let json: string;
    try {
      json = canonicalStringify(payload);
    } catch (error) {
      throw engineError("conflict", `snapshot preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const serializationMs = Math.max(0, performance.now() - serializationStart);
    const serializedBytes = encoder.encode(json).byteLength;
    const compressionStart = performance.now();
    let gzipped: GzipResult;
    try {
      gzipped = await gzipToBuffer(encoder.encode(json), CHARACTER_COMPRESSED_LIMIT);
    } catch (error) {
      throw engineError("conflict", `snapshot preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const compressionMs = Math.max(0, performance.now() - compressionStart);
    this.pendingBuffer = gzipped.bytes;
    return {
      client: payload.client,
      schema: payload.schema,
      codec: payload.codec,
      libraryKind: payload.libraryKind,
      schemaVersion: payload.schemaVersion,
      characterId: id,
      xmlHash,
      libraryDigest,
      engineVersion: ENGINE_VERSION,
      parserVersion: PARSER_VERSION,
      selectionCount,
      elementCount: state.registeredCount,
      inventoryCount: state.items.length,
      attackCount: state.attacks.length,
      finalStateDigest: await sha256Hex(canonicalStringify(normalizedStateForDigest(state))),
      serializedBytes,
      compressedBytes: gzipped.compressedBytes,
      serializationMs,
      compressionMs,
    };
  }

  takeBuffer(): ArrayBuffer {
    const buffer = this.pendingBuffer;
    if (buffer === undefined) throw engineError("conflict", "no pending character snapshot buffer");
    this.pendingBuffer = undefined;
    return buffer;
  }

  async importWithSnapshot(
    id: string,
    base64: string,
    identity: ManifestIdentityDto,
    body: ArrayBuffer,
  ): Promise<CharacterState> {
    const parseStart = performance.now();
    let xmlText: string;
    let document: Dnd5eDocument;
    try {
      xmlText = decodeBase64Utf8(base64);
      document = parseDnd5e(xmlText);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw engineError("content-invalid", `invalid character xml for '${id}': ${message}`);
    }
    const parseMs = Math.max(0, performance.now() - parseStart);

    const validationStart = performance.now();
    const verdict = await this.decodeAndValidate(id, identity, xmlText, body);
    const validationMs = Math.max(0, performance.now() - validationStart);
    if (verdict.ok) {
      const hydrationStart = performance.now();
      this.service.installSnapshot(id, document, verdict.state);
      const hydrationMs = Math.max(0, performance.now() - hydrationStart);
      this.record("snapshot", true, null, verdict.state, { parseMs, validationMs, hydrationMs });
      return verdict.state;
    }

    const hydrationStart = performance.now();
    this.internalFallbackInProgress = true;
    let state: CharacterState;
    try {
      state = this.service.importCharacterXml(id, xmlText);
    } finally {
      this.internalFallbackInProgress = false;
    }
    const hydrationMs = Math.max(0, performance.now() - hydrationStart);
    this.record(
      "xml-fallback",
      false,
      `snapshot rejected: ${verdict.reason}: ${verdict.detail}`,
      state,
      { parseMs, validationMs, hydrationMs },
    );
    return state;
  }

  diagnostics(): CharacterLoadDiagnosticsDto {
    return { ...this.lastDiagnostics, issueKindCounts: { ...this.lastDiagnostics.issueKindCounts } };
  }

  async recordXmlImport(
    id: string,
    _xmlText: string,
    timing: { parseMs: number; hydrationMs: number },
  ): Promise<void> {
    if (this.internalFallbackInProgress) return;
    const state = this.service.getCharacter(id);
    this.record("xml", false, null, state, {
      parseMs: timing.parseMs,
      validationMs: 0,
      hydrationMs: timing.hydrationMs,
    });
  }

  private libraryDigest(): Promise<string> {
    return contentLibraryDigest(serializeContentLibrary(this.library));
  }

  private async decodeAndValidate(
    id: string,
    identity: ManifestIdentityDto,
    xmlText: string,
    body: ArrayBuffer,
  ): Promise<{ ok: true; state: CharacterState } | { ok: false; reason: SnapshotCodecReason; detail: string }> {
    try {
      const decompressed = await gunzipBounded(
        new Uint8Array(body),
        CHARACTER_COMPRESSED_LIMIT,
        CHARACTER_DECOMPRESSED_LIMIT,
      );
      const decoded = canonicalParse(decoder.decode(decompressed));
      if (!isRecord(decoded)) throwBad("invalid-structure", "payload must be an object");
      if (
        !isCanonicalIdentity(identity) ||
        decoded.client !== CANONICAL_CLIENT ||
        decoded.schema !== CANONICAL_SCHEMA ||
        decoded.codec !== CANONICAL_CODEC
      ) {
        throwBad(
          "identity-mismatch",
          `payload identity (${String(decoded.client)}/${String(decoded.schema)}/${String(decoded.codec)}) ` +
            `or expected identity (${identity.client}/${identity.schema}/${identity.codec}) is not ` +
            `${CANONICAL_CLIENT}/${CANONICAL_SCHEMA}/${CANONICAL_CODEC}`,
        );
      }
      if (decoded.characterId !== id) {
        throwBad("identity-mismatch", `payload characterId "${String(decoded.characterId)}" does not match "${id}"`);
      }
      if (decoded.libraryKind !== CHARACTER_LOAD_KIND || decoded.schemaVersion !== CHARACTER_LOAD_SCHEMA_VERSION) {
        throwBad(
          "schema-mismatch",
          `payload libraryKind/schemaVersion (${String(decoded.libraryKind)}/${String(decoded.schemaVersion)}) is not ${CHARACTER_LOAD_KIND}/${CHARACTER_LOAD_SCHEMA_VERSION}`,
        );
      }
      const xmlHash = await sha256Hex(xmlText);
      if (decoded.xmlHash !== xmlHash) {
        throwBad("identity-mismatch", "payload xmlHash does not match the supplied xml");
      }
      const digest = await this.libraryDigest();
      if (decoded.libraryDigest !== digest) {
        throwBad("schema-mismatch", "payload libraryDigest does not match the current content library");
      }
      if (decoded.engineVersion !== ENGINE_VERSION) {
        throwBad("schema-mismatch", `payload engineVersion "${String(decoded.engineVersion)}" does not match "${ENGINE_VERSION}"`);
      }
      if (decoded.parserVersion !== PARSER_VERSION) {
        throwBad("schema-mismatch", `payload parserVersion "${String(decoded.parserVersion)}" does not match "${PARSER_VERSION}"`);
      }
      validateCharacterState(decoded.state);
      const state = decoded.state as CharacterState;
      // Schema-1 snapshots do not carry presentation flags. Keep
      // those payloads loadable while giving sheet projections explicit
      // defaults.
      state.items = state.items.map((item) => ({
        ...item,
        card: item.card === true,
        sidebar: item.sidebar === true,
      }));
      if (state.id !== id) throwBad("identity-mismatch", `payload state id "${state.id}" does not match "${id}"`);
      return { ok: true, state };
    } catch (error) {
      if (error instanceof SnapshotCodecError) return { ok: false, reason: error.reason, detail: error.message };
      return { ok: false, reason: "corrupt", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private record(
    mode: RestoreMode,
    snapshotAccepted: boolean,
    warning: string | null,
    state: CharacterState,
    timings: { parseMs: number; validationMs: number; hydrationMs: number },
  ): void {
    const selectionCount = pendingSelectionRules(state).length;
    const issues = buildLoadIssues(state, this.library);
    const issueKindCounts: Record<string, number> = {};
    for (const issue of issues) {
      issueKindCounts[issue.kind] = (issueKindCounts[issue.kind] ?? 0) + 1;
    }
    // Per-session identifier maps hold random uuids that differ between
    // restore paths, so the diagnostics digest strips them to stay
    // comparable across xml, snapshot and xml-fallback loads. The digest is
    // synchronous (sha256HexSync) so diagnostics() is immediately readable
    // after a plain import: the service's onImport hook fires synchronously.
    const finalStateDigest = sha256HexSync(canonicalStringify(normalizedStateForDigest(state)));
    this.lastDiagnostics = {
      characterId: state.id,
      restoreMode: mode,
      snapshotAccepted,
      warning,
      loadIssueCount: issues.length,
      issueKindCounts,
      selectionCount,
      elementCount: state.registeredCount,
      inventoryCount: state.items.length,
      attackCount: state.attacks.length,
      finalStateDigest,
      parseMs: Math.max(0, timings.parseMs),
      validationMs: Math.max(0, timings.validationMs),
      hydrationMs: Math.max(0, timings.hydrationMs),
      totalMs: Math.max(0, timings.parseMs + timings.validationMs + timings.hydrationMs),
    };
  }
}
