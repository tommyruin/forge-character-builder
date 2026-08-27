/**
 * Content-library graph codec — deterministic index-based encoding of
 * ElementLibrary into plain canonical-JSON data and back.
 *
 * Map/list ordering is preserved (byId insertion order, byType first-seen
 * type order and per-type list order, sources order, fileOrder order,
 * ruleset order). Every distinct ParsedElement object is stored exactly once
 * in elementTable; byId/byType/sources reference it by table index, so
 * hydrated byId.get(id) === byType[type][i] and === sources.get(id) wherever
 * the raw library had that identity. Overridden entries (the 409 non-winning
 * byType entries, e.g. corpus-authored spell-scroll Magic Items that lost to
 * an ingest-generated proxy of the same id) are distinct objects and get
 * their own table slot. Nested children are serialized inline because they
 * are never shared with top-level entries in this corpus.
 */

import { classifyRuleset, rulesetSourcesByName, type ElementLibrary, type RulesetCounts, type RulesetTag } from "../content/library.js";
import type {
  AppendRule,
  ExtractEntry,
  GrantRule,
  MulticlassBlock,
  ParsedElement,
  ParsedSheetEntry,
  RequireRule,
  Rule,
  SelectRule,
  SelectListItem,
  Setter,
  SheetDescription,
  SpellcastingBlock,
  StatRule,
} from "../content/parser.js";
import { SnapshotCodecError, canonicalStringify, sha256Hex } from "./codec.js";

export interface ContentLibraryPayload {
  /** Every distinct element object, once per unique object. */
  elementTable: ParsedElement[];
  /** byId entries as table indexes (winning definitions, in insertion order). */
  byId: Array<{ id: string; index: number }>;
  /** byType lists as table indexes (first-seen type order, list order kept). */
  byType: Array<{ type: string; indexes: number[] }>;
  /** Source elements as table indexes (insertion order). */
  sources: Array<{ id: string; index: number }>;
  typeCounts: Record<string, number>;
  fileOrder: string[];
  /** Ruleset tags per element id (byId insertion order). */
  ruleset: Array<{ id: string; tag: RulesetTag }>;
  rulesetCounts: RulesetCounts;
}

/** Canonical JSON cannot carry `undefined`; this marker preserves own-key shape. */
const UNDEFINED_OPTIONAL = { $fcbUndefined: true } as const;

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isUndefinedOptional(value: unknown): boolean {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return value === undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.$fcbUndefined === true;
}

function setEncodedOptional(
  target: object,
  source: object,
  key: string,
  value: unknown,
  encode: (value: unknown) => unknown = (entry) => entry,
): void {
  if (!hasOwn(source, key)) return;
  (target as Record<string, unknown>)[key] = isUndefinedOptional(value) ? UNDEFINED_OPTIONAL : encode(value);
}

function setDecodedOptional<T extends object>(
  target: T,
  source: Record<string, unknown>,
  key: string,
  context: string,
  decode: (value: unknown, context: string) => unknown,
): void {
  if (!hasOwn(source, key)) return;
  const value = source[key];
  (target as Record<string, unknown>)[key] = isUndefinedOptional(value)
    ? undefined
    : decode(value, `${context}.${key}`);
}

export function serializeContentLibrary(library: ElementLibrary): ContentLibraryPayload {
  const table: ParsedElement[] = [];
  const indexOf = new Map<ParsedElement, number>();

  const tableIndex = (element: ParsedElement): number => {
    let index = indexOf.get(element);
    if (index === undefined) {
      index = table.length;
      indexOf.set(element, index);
      table.push(serializeElement(element));
    }
    return index;
  };

  for (const element of library.byId.values()) tableIndex(element);
  for (const list of library.byType.values()) {
    for (const element of list) tableIndex(element);
  }
  for (const element of library.sources.values()) tableIndex(element);

  const byId = [...library.byId].map(([id, element]) => ({ id, index: indexOf.get(element)! }));
  const byType = [...library.byType].map(([type, list]) => ({
    type,
    indexes: list.map((element) => indexOf.get(element)!),
  }));
  const sources = [...library.sources].map(([id, element]) => ({ id, index: indexOf.get(element)! }));
  const ruleset = [...library.ruleset].map(([id, tag]) => ({ id, tag }));

  return {
    elementTable: table,
    byId,
    byType,
    sources,
    typeCounts: { ...library.typeCounts },
    fileOrder: [...library.fileOrder],
    ruleset,
    rulesetCounts: { ...library.rulesetCounts },
  };
}

export function hydrateContentLibrary(payload: unknown): ElementLibrary {
  const root = expectRecord(payload, "payload");
  expectKeys(root, ["elementTable", "byId", "byType", "sources", "typeCounts", "fileOrder", "ruleset", "rulesetCounts"], [], "payload");

  const table = decodeElements(root.elementTable, "payload.elementTable");
  const tableCount = table.length;
  const referenced = new Set<number>();

  if (!Array.isArray(root.byId)) fail("payload.byId", "expected an array");
  const byId = new Map<string, ParsedElement>();
  for (let i = 0; i < root.byId.length; i++) {
    const context = `payload.byId[${i}]`;
    const record = expectRecord(root.byId[i], context);
    expectKeys(record, ["id", "index"], [], context);
    const id = expectString(record.id, `${context}.id`);
    if (byId.has(id)) fail(context, `duplicate id "${id}"`);
    const index = expectIndex(record.index, `${context}.index`, tableCount);
    if (table[index]!.identity.id !== id) {
      fail(context, `element at index ${index} has id "${table[index]!.identity.id}", expected "${id}"`);
    }
    byId.set(id, table[index]!);
    referenced.add(index);
  }

  if (!Array.isArray(root.byType)) fail("payload.byType", "expected an array");
  const byType = new Map<string, ParsedElement[]>();
  for (let i = 0; i < root.byType.length; i++) {
    const context = `payload.byType[${i}]`;
    const record = expectRecord(root.byType[i], context);
    expectKeys(record, ["type", "indexes"], [], context);
    const type = expectString(record.type, `${context}.type`);
    if (type === "") fail(context, "empty type name");
    if (byType.has(type)) fail(context, `duplicate type "${type}"`);
    if (!Array.isArray(record.indexes)) fail(context, "indexes must be an array");
    const list: ParsedElement[] = [];
    for (let j = 0; j < record.indexes.length; j++) {
      const index = expectIndex(record.indexes[j], `${context}.indexes[${j}]`, tableCount);
      if (table[index]!.identity.type !== type) {
        fail(context, `element at index ${index} has type "${table[index]!.identity.type}", expected "${type}"`);
      }
      list.push(table[index]!);
      referenced.add(index);
    }
    byType.set(type, list);
  }

  if (!Array.isArray(root.sources)) fail("payload.sources", "expected an array");
  const sources = new Map<string, ParsedElement>();
  for (let i = 0; i < root.sources.length; i++) {
    const context = `payload.sources[${i}]`;
    const record = expectRecord(root.sources[i], context);
    expectKeys(record, ["id", "index"], [], context);
    const id = expectString(record.id, `${context}.id`);
    if (sources.has(id)) fail(context, `duplicate id "${id}"`);
    const index = expectIndex(record.index, `${context}.index`, tableCount);
    const element = table[index]!;
    if (element.identity.id !== id) {
      fail(context, `element at index ${index} has id "${element.identity.id}", expected "${id}"`);
    }
    if (element.identity.type !== "Source") {
      fail(context, `element at index ${index} has type "${element.identity.type}", expected "Source"`);
    }
    sources.set(id, element);
  }

  const typeCountsRecord = expectRecord(root.typeCounts, "payload.typeCounts");
  const typeCounts: Record<string, number> = {};
  for (const key of Object.keys(typeCountsRecord)) {
    const value = typeCountsRecord[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      fail("payload.typeCounts", `"${key}" must be a non-negative integer`);
    }
    const list = byType.get(key);
    if (list === undefined) fail("payload.typeCounts", `unknown type "${key}"`);
    if (value !== list.length) {
      fail("payload.typeCounts", `"${key}" count ${value} does not match list length ${list.length}`);
    }
    typeCounts[key] = value;
  }
  if (Object.keys(typeCounts).length !== byType.size) {
    fail("payload.typeCounts", `counts for ${Object.keys(typeCounts).length} types, expected ${byType.size}`);
  }

  const fileOrder = expectStringArray(root.fileOrder, "payload.fileOrder");

  if (!Array.isArray(root.ruleset)) fail("payload.ruleset", "expected an array");
  const ruleset = new Map<string, RulesetTag>();
  for (let i = 0; i < root.ruleset.length; i++) {
    const context = `payload.ruleset[${i}]`;
    const record = expectRecord(root.ruleset[i], context);
    expectKeys(record, ["id", "tag"], [], context);
    const id = expectString(record.id, `${context}.id`);
    const tag = expectString(record.tag, `${context}.tag`);
    if (tag !== "2014" && tag !== "2024" && tag !== "shared") fail(context, `unknown ruleset tag "${tag}"`);
    if (ruleset.has(id)) fail(context, `duplicate id "${id}"`);
    ruleset.set(id, tag);
  }
  for (const id of byId.keys()) {
    if (!ruleset.has(id)) fail("payload.ruleset", `missing id "${id}" referenced by byId`);
  }
  for (const id of ruleset.keys()) {
    if (!byId.has(id)) fail("payload.ruleset", `id "${id}" not present in byId`);
  }

  const rulesetRecord = expectRecord(root.rulesetCounts, "payload.rulesetCounts");
  expectKeys(rulesetRecord, ["rules2014Count", "rules2024Count", "sharedCount"], [], "payload.rulesetCounts");
  const rulesetCounts: RulesetCounts = {
    rules2014Count: expectNonNegative(rulesetRecord.rules2014Count, "payload.rulesetCounts.rules2014Count"),
    rules2024Count: expectNonNegative(rulesetRecord.rules2024Count, "payload.rulesetCounts.rules2024Count"),
    sharedCount: expectNonNegative(rulesetRecord.sharedCount, "payload.rulesetCounts.sharedCount"),
  };
  let count2014 = 0;
  let count2024 = 0;
  let countShared = 0;
  for (const tag of ruleset.values()) {
    if (tag === "2014") count2014++;
    else if (tag === "2024") count2024++;
    else countShared++;
  }
  if (
    count2014 !== rulesetCounts.rules2014Count ||
    count2024 !== rulesetCounts.rules2024Count ||
    countShared !== rulesetCounts.sharedCount
  ) {
    fail(
      "payload.rulesetCounts",
      `counts (${rulesetCounts.rules2014Count}, ${rulesetCounts.rules2024Count}, ${rulesetCounts.sharedCount}) ` +
        `do not match the ruleset tags (${count2014}, ${count2024}, ${countShared})`,
    );
  }

  for (let i = 0; i < tableCount; i++) {
    if (!referenced.has(i)) fail("payload.elementTable", `index ${i} is not referenced by any byId or byType record`);
  }

  return {
    byId,
    byType,
    sources,
    typeCounts,
    fileOrder,
    ruleset,
    rulesetCounts,
    elementCount: byId.size,
  };
}

/** SHA-256 hex digest of the canonical payload JSON. */
export async function contentLibraryDigest(payload: ContentLibraryPayload): Promise<string> {
  return sha256Hex(canonicalStringify(payload));
}

/**
 * Full structural validation of a library: round-trips it through serialize +
 * hydrate (which enforces the strict payload grammar) and then checks the
 * library-level invariants — elementCount, typeCounts vs byType lengths,
 * sources identical to byId entries, ruleset exactly covering byId with
 * tags consistent with classifyRuleset, and rulesetCounts matching the tag
 * distribution. Any violation throws SnapshotCodecError("invalid-structure").
 */
export function validateContentLibrary(library: ElementLibrary): void {
  hydrateContentLibrary(serializeContentLibrary(library));

  if (library.elementCount !== library.byId.size) {
    fail("library", `elementCount ${library.elementCount} does not match byId size ${library.byId.size}`);
  }
  for (const [type, list] of library.byType) {
    if (list.length !== library.typeCounts[type]) {
      fail("library", `typeCounts[${type}] ${library.typeCounts[type]} does not match list length ${list.length}`);
    }
    for (const element of list) {
      if (element.identity.type !== type) {
        fail("library", `byType entry "${element.identity.id}" has type "${element.identity.type}", expected "${type}"`);
      }
      if (!library.byId.has(element.identity.id)) {
        fail("library", `byType entry "${element.identity.id}" is missing from byId`);
      }
    }
  }
  if (Object.keys(library.typeCounts).length !== library.byType.size) {
    fail("library", `typeCounts has ${Object.keys(library.typeCounts).length} types, expected ${library.byType.size}`);
  }
  for (const [id, element] of library.sources) {
    if (library.byId.get(id) !== element) {
      fail("library", `sources entry "${id}" is not identical to the byId element`);
    }
  }
  if (library.ruleset.size !== library.byId.size) {
    fail("library", `ruleset size ${library.ruleset.size} does not match byId size ${library.byId.size}`);
  }
  const snapshotSources = rulesetSourcesByName(library.byId.values());
  for (const [id, element] of library.byId) {
    const tag = library.ruleset.get(id);
    if (tag !== "2014" && tag !== "2024" && tag !== "shared") {
      fail("library", `ruleset missing or invalid tag for "${id}"`);
    }
    if (tag !== classifyRuleset(element, snapshotSources)) {
      fail("library", `ruleset tag ${tag} for "${id}" does not match its classification`);
    }
  }
  let count2014 = 0;
  let count2024 = 0;
  let countShared = 0;
  for (const tag of library.ruleset.values()) {
    if (tag === "2014") count2014++;
    else if (tag === "2024") count2024++;
    else countShared++;
  }
  const counts = library.rulesetCounts;
  if (
    count2014 !== counts.rules2014Count ||
    count2024 !== counts.rules2024Count ||
    countShared !== counts.sharedCount ||
    count2014 + count2024 + countShared !== library.byId.size
  ) {
    fail("library", "rulesetCounts does not match the ruleset tag distribution");
  }
}

function serializeSheet(sheet: ParsedSheetEntry): ParsedSheetEntry {
  const out: ParsedSheetEntry = {
    descriptions: sheet.descriptions.map((description) => {
      const entry: SheetDescription = {
        descriptionXml: description.descriptionXml,
        text: description.text,
      };
      setEncodedOptional(entry, description, "level", description.level);
      setEncodedOptional(entry, description, "usage", description.usage);
      setEncodedOptional(entry, description, "action", description.action);
      return entry;
    }),
  };
  setEncodedOptional(out, sheet, "display", sheet.display);
  setEncodedOptional(out, sheet, "action", sheet.action);
  setEncodedOptional(out, sheet, "usage", sheet.usage);
  setEncodedOptional(out, sheet, "alt", sheet.alt);
  setEncodedOptional(out, sheet, "name", sheet.name);
  return out;
}

function decodeSheet(record: unknown, context: string): ParsedSheetEntry {
  const sheetRecord = expectRecord(record, context);
  expectKeys(
    sheetRecord,
    [],
    ["display", "action", "usage", "alt", "name", "descriptions"],
    context,
  );
  const descriptions: SheetDescription[] = [];
  for (const [index, entry] of expectArray(sheetRecord.descriptions, `${context}.descriptions`).entries()) {
    const descriptionRecord = expectRecord(entry, `${context}.descriptions[${index}]`);
    expectKeys(
      descriptionRecord,
      ["descriptionXml", "text"],
      ["level", "usage", "action"],
      `${context}.descriptions[${index}]`,
    );
    const description: SheetDescription = {
      descriptionXml: expectString(descriptionRecord.descriptionXml, `${context}.descriptions[${index}].descriptionXml`),
      text: expectString(descriptionRecord.text, `${context}.descriptions[${index}].text`),
    };
    setDecodedOptional(description, descriptionRecord, "level", `${context}.descriptions[${index}]`, expectNumber);
    setDecodedOptional(description, descriptionRecord, "usage", `${context}.descriptions[${index}]`, expectString);
    setDecodedOptional(description, descriptionRecord, "action", `${context}.descriptions[${index}]`, expectString);
    descriptions.push(description);
  }
  const sheet: ParsedSheetEntry = { descriptions };
  setDecodedOptional(sheet, sheetRecord, "display", context, expectBoolean);
  setDecodedOptional(sheet, sheetRecord, "action", context, expectString);
  setDecodedOptional(sheet, sheetRecord, "usage", context, expectString);
  setDecodedOptional(sheet, sheetRecord, "alt", context, expectString);
  setDecodedOptional(sheet, sheetRecord, "name", context, expectString);
  return sheet;
}

function serializeElement(element: ParsedElement): ParsedElement {
  const out: ParsedElement = {
    identity: { ...element.identity },
    setters: element.setters.map(serializeSetter),
    rules: element.rules.map(serializeRule),
    supports: [...element.supports],
    compendiumHidden: element.compendiumHidden,
    sheets: element.sheets.map(serializeSheet),
    children: element.children.map(serializeElement),
    declaredBy: element.declaredBy,
  };
  setEncodedOptional(out, element, "descriptionXml", element.descriptionXml);
  setEncodedOptional(out, element, "rulesXml", element.rulesXml);
  setEncodedOptional(out, element, "requirements", element.requirements);
  setEncodedOptional(out, element, "prerequisite", element.prerequisite);
  setEncodedOptional(out, element, "multiclass", element.multiclass, (value) => serializeMulticlass(value as MulticlassBlock));
  setEncodedOptional(out, element, "spellcasting", element.spellcasting, (value) => serializeSpellcasting(value as SpellcastingBlock));
  setEncodedOptional(out, element, "extract", element.extract, (value) => (value as ExtractEntry[]).map(serializeExtractEntry));
  return out;
}

function serializeSetter(setter: Setter): Setter {
  return setter.attrs === undefined
    ? { name: setter.name, value: setter.value }
    : { name: setter.name, value: setter.value, attrs: { ...setter.attrs } };
}

function serializeRule(rule: Rule): Rule {
  switch (rule.kind) {
    case "grant": {
      const out: GrantRule = { kind: "grant" };
      setEncodedOptional(out, rule, "type", rule.type);
      setEncodedOptional(out, rule, "name", rule.name);
      setEncodedOptional(out, rule, "id", rule.id);
      setEncodedOptional(out, rule, "level", rule.level);
      setEncodedOptional(out, rule, "supports", rule.supports);
      setEncodedOptional(out, rule, "requirements", rule.requirements);
      setEncodedOptional(out, rule, "prepared", rule.prepared);
      setEncodedOptional(out, rule, "spellcasting", rule.spellcasting);
      return out;
    }
    case "stat": {
      const out: StatRule = { kind: "stat", name: rule.name };
      setEncodedOptional(out, rule, "value", rule.value);
      setEncodedOptional(out, rule, "bonus", rule.bonus);
      setEncodedOptional(out, rule, "group", rule.group);
      setEncodedOptional(out, rule, "requirements", rule.requirements);
      setEncodedOptional(out, rule, "entry", rule.entry);
      setEncodedOptional(out, rule, "type", rule.type);
      setEncodedOptional(out, rule, "level", rule.level);
      setEncodedOptional(out, rule, "equipped", rule.equipped);
      setEncodedOptional(out, rule, "alt", rule.alt);
      setEncodedOptional(out, rule, "inline", rule.inline);
      setEncodedOptional(out, rule, "condition", rule.condition);
      return out;
    }
    case "select": {
      const out: SelectRule = { kind: "select", type: rule.type };
      setEncodedOptional(out, rule, "name", rule.name);
      setEncodedOptional(out, rule, "id", rule.id);
      setEncodedOptional(out, rule, "number", rule.number);
      setEncodedOptional(out, rule, "expand", rule.expand);
      setEncodedOptional(out, rule, "default", rule.default);
      setEncodedOptional(out, rule, "supports", rule.supports);
      setEncodedOptional(out, rule, "level", rule.level);
      setEncodedOptional(out, rule, "optional", rule.optional);
      setEncodedOptional(out, rule, "requirements", rule.requirements);
      setEncodedOptional(out, rule, "spellcasting", rule.spellcasting);
      setEncodedOptional(out, rule, "items", rule.items, (value) =>
        (value as SelectListItem[]).map((item) => ({ id: item.id, text: item.text })),
      );
      return out;
    }
    case "append":
    case "require": {
      const out: AppendRule | RequireRule = { kind: rule.kind };
      setEncodedOptional(out, rule, "type", rule.type);
      setEncodedOptional(out, rule, "name", rule.name);
      setEncodedOptional(out, rule, "id", rule.id);
      setEncodedOptional(out, rule, "level", rule.level);
      setEncodedOptional(out, rule, "supports", rule.supports);
      return out;
    }
    case "other":
      return { kind: "other", name: rule.name, attrs: { ...rule.attrs } };
  }
}

function serializeMulticlass(block: MulticlassBlock): MulticlassBlock {
  const out: MulticlassBlock = {
    id: block.id,
    setters: block.setters.map(serializeSetter),
    rules: block.rules.map(serializeRule),
  };
  setEncodedOptional(out, block, "prerequisite", block.prerequisite);
  setEncodedOptional(out, block, "requirements", block.requirements);
  return out;
}

function serializeSpellcasting(block: SpellcastingBlock): SpellcastingBlock {
  const out: SpellcastingBlock = { name: block.name, extend: [...block.extend] };
  setEncodedOptional(out, block, "ability", block.ability);
  setEncodedOptional(out, block, "prepare", block.prepare);
  setEncodedOptional(out, block, "allowReplace", block.allowReplace);
  setEncodedOptional(out, block, "list", block.list);
  setEncodedOptional(out, block, "listKnown", block.listKnown);
  setEncodedOptional(out, block, "all", block.all);
  setEncodedOptional(out, block, "extension", block.extension);
  return out;
}

function serializeExtractEntry(entry: ExtractEntry): ExtractEntry {
  return { id: entry.id, amount: entry.amount };
}

function decodeElements(value: unknown, context: string): ParsedElement[] {
  if (!Array.isArray(value)) fail(context, "expected an array");
  return value.map((entry, i) => decodeElement(entry, `${context}[${i}]`));
}

function decodeElement(value: unknown, context: string): ParsedElement {
  const record = expectRecord(value, context);
  expectKeys(
    record,
    ["identity", "setters", "rules", "supports", "compendiumHidden", "children", "declaredBy"],
    ["descriptionXml", "rulesXml", "requirements", "prerequisite", "multiclass", "spellcasting", "extract", "sheets"],
    context,
  );
  const identityRecord = expectRecord(record.identity, `${context}.identity`);
  expectKeys(identityRecord, ["id", "name", "type", "source"], [], `${context}.identity`);
  const element: ParsedElement = {
    identity: {
      id: expectString(identityRecord.id, `${context}.identity.id`),
      name: expectString(identityRecord.name, `${context}.identity.name`),
      type: expectString(identityRecord.type, `${context}.identity.type`),
      source: expectString(identityRecord.source, `${context}.identity.source`),
    },
    sheets:
      record.sheets === undefined
        ? []
        : expectArray(record.sheets, `${context}.sheets`).map((sheet, index) =>
            decodeSheet(expectRecord(sheet, `${context}.sheets[${index}]`), `${context}.sheets[${index}]`),
          ),
    setters: decodeSetters(record.setters, `${context}.setters`),
    rules: decodeRules(record.rules, `${context}.rules`),
    supports: expectStringArray(record.supports, `${context}.supports`),
    compendiumHidden: expectBoolean(record.compendiumHidden, `${context}.compendiumHidden`),
    children: decodeElements(record.children, `${context}.children`),
    declaredBy: expectString(record.declaredBy, `${context}.declaredBy`),
  };
  setDecodedOptional(element, record, "descriptionXml", context, expectString);
  setDecodedOptional(element, record, "rulesXml", context, expectString);
  setDecodedOptional(element, record, "requirements", context, expectString);
  setDecodedOptional(element, record, "prerequisite", context, expectString);
  setDecodedOptional(element, record, "multiclass", context, decodeMulticlass);
  setDecodedOptional(element, record, "spellcasting", context, decodeSpellcasting);
  setDecodedOptional(element, record, "extract", context, decodeExtract);
  return element;
}

function decodeSetters(value: unknown, context: string): Setter[] {
  if (!Array.isArray(value)) fail(context, "expected an array");
  return value.map((entry, i) => {
    const record = expectRecord(entry, `${context}[${i}]`);
    expectKeys(record, ["name", "value"], ["attrs"], `${context}[${i}]`);
    const setter: Setter = {
      name: expectString(record.name, `${context}[${i}].name`),
      value: expectString(record.value, `${context}[${i}].value`),
    };
    if (record.attrs !== undefined) {
      setter.attrs = expectStringRecord(record.attrs, `${context}[${i}].attrs`);
    }
    return setter;
  });
}

function decodeRules(value: unknown, context: string): Rule[] {
  if (!Array.isArray(value)) fail(context, "expected an array");
  return value.map((entry, i) => decodeRule(entry, `${context}[${i}]`));
}

function decodeRule(value: unknown, context: string): Rule {
  const record = expectRecord(value, context);
  const kind = record.kind;
  if (typeof kind !== "string") fail(context, "missing rule kind");
  switch (kind) {
    case "grant": {
      expectKeys(record, ["kind"], ["type", "name", "id", "level", "supports", "requirements", "prepared", "spellcasting"], context);
      const rule: GrantRule = { kind: "grant" };
      setDecodedOptional(rule, record, "type", context, expectString);
      setDecodedOptional(rule, record, "name", context, expectString);
      setDecodedOptional(rule, record, "id", context, expectString);
      setDecodedOptional(rule, record, "level", context, expectNumber);
      setDecodedOptional(rule, record, "supports", context, expectString);
      setDecodedOptional(rule, record, "requirements", context, expectString);
      setDecodedOptional(rule, record, "prepared", context, expectBoolean);
      setDecodedOptional(rule, record, "spellcasting", context, expectString);
      return rule;
    }
    case "stat": {
      expectKeys(record, ["kind", "name"], ["value", "bonus", "group", "requirements", "entry", "type", "level", "equipped", "alt", "inline", "condition"], context);
      const rule: StatRule = { kind: "stat", name: expectString(record.name, `${context}.name`) };
      setDecodedOptional(rule, record, "value", context, expectString);
      setDecodedOptional(rule, record, "bonus", context, expectString);
      setDecodedOptional(rule, record, "group", context, expectString);
      setDecodedOptional(rule, record, "requirements", context, expectString);
      setDecodedOptional(rule, record, "entry", context, expectString);
      setDecodedOptional(rule, record, "type", context, expectString);
      setDecodedOptional(rule, record, "level", context, expectNumber);
      setDecodedOptional(rule, record, "equipped", context, expectString);
      setDecodedOptional(rule, record, "alt", context, expectString);
      setDecodedOptional(rule, record, "inline", context, expectBoolean);
      setDecodedOptional(rule, record, "condition", context, expectString);
      return rule;
    }
    case "select": {
      expectKeys(record, ["kind", "type"], ["name", "id", "number", "expand", "default", "supports", "level", "optional", "requirements", "spellcasting", "items"], context);
      const rule: SelectRule = { kind: "select", type: expectString(record.type, `${context}.type`) };
      setDecodedOptional(rule, record, "name", context, expectString);
      setDecodedOptional(rule, record, "id", context, expectString);
      setDecodedOptional(rule, record, "number", context, expectNumber);
      setDecodedOptional(rule, record, "expand", context, expectBoolean);
      setDecodedOptional(rule, record, "default", context, expectString);
      setDecodedOptional(rule, record, "supports", context, expectString);
      setDecodedOptional(rule, record, "level", context, expectNumber);
      setDecodedOptional(rule, record, "optional", context, expectBoolean);
      setDecodedOptional(rule, record, "requirements", context, expectString);
      setDecodedOptional(rule, record, "spellcasting", context, expectString);
      setDecodedOptional(rule, record, "items", context, decodeSelectItems);
      return rule;
    }
    case "append":
    case "require": {
      expectKeys(record, ["kind"], ["type", "name", "id", "level", "supports"], context);
      const rule: AppendRule | RequireRule = { kind };
      setDecodedOptional(rule, record, "type", context, expectString);
      setDecodedOptional(rule, record, "name", context, expectString);
      setDecodedOptional(rule, record, "id", context, expectString);
      setDecodedOptional(rule, record, "level", context, expectNumber);
      setDecodedOptional(rule, record, "supports", context, expectString);
      return rule;
    }
    case "other":
      expectKeys(record, ["kind", "name", "attrs"], [], context);
      return {
        kind: "other",
        name: expectString(record.name, `${context}.name`),
        attrs: expectStringRecord(record.attrs, `${context}.attrs`),
      };
    default:
      fail(context, `unknown rule kind "${kind}"`);
  }
}

function decodeSelectItems(value: unknown, context: string): SelectListItem[] {
  if (!Array.isArray(value)) fail(context, "expected an array");
  return value.map((entry, index) => {
    const itemContext = `${context}[${index}]`;
    const record = expectRecord(entry, itemContext);
    expectKeys(record, ["id", "text"], [], itemContext);
    return {
      id: expectString(record.id, `${itemContext}.id`),
      text: expectString(record.text, `${itemContext}.text`),
    };
  });
}

function decodeMulticlass(value: unknown, context: string): MulticlassBlock {
  const record = expectRecord(value, context);
  expectKeys(record, ["id", "setters", "rules"], ["prerequisite", "requirements"], context);
  const block: MulticlassBlock = {
    id: expectString(record.id, `${context}.id`),
    setters: decodeSetters(record.setters, `${context}.setters`),
    rules: decodeRules(record.rules, `${context}.rules`),
  };
  setDecodedOptional(block, record, "prerequisite", context, expectString);
  setDecodedOptional(block, record, "requirements", context, expectString);
  return block;
}

function decodeSpellcasting(value: unknown, context: string): SpellcastingBlock {
  const record = expectRecord(value, context);
  expectKeys(record, ["name", "extend"], ["ability", "prepare", "allowReplace", "list", "listKnown", "all", "extension"], context);
  const block: SpellcastingBlock = {
    name: expectString(record.name, `${context}.name`),
    extend: expectStringArray(record.extend, `${context}.extend`),
  };
  setDecodedOptional(block, record, "ability", context, expectString);
  setDecodedOptional(block, record, "prepare", context, expectBoolean);
  setDecodedOptional(block, record, "allowReplace", context, expectBoolean);
  setDecodedOptional(block, record, "list", context, expectString);
  setDecodedOptional(block, record, "listKnown", context, expectBoolean);
  setDecodedOptional(block, record, "all", context, expectBoolean);
  setDecodedOptional(block, record, "extension", context, expectBoolean);
  return block;
}

function decodeExtract(value: unknown, context: string): ExtractEntry[] {
  if (!Array.isArray(value)) fail(context, "expected an array");
  return value.map((entry, i) => {
    const record = expectRecord(entry, `${context}[${i}]`);
    expectKeys(record, ["id", "amount"], [], `${context}[${i}]`);
    return {
      id: expectString(record.id, `${context}[${i}].id`),
      amount: expectNumber(record.amount, `${context}[${i}].amount`),
    };
  });
}

function fail(context: string, detail: string): never {
  throw new SnapshotCodecError("invalid-structure", `${context}: ${detail}`);
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    fail(context, `expected an object, got ${actual}`);
  }
  return value as Record<string, unknown>;
}

function expectKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!required.includes(key) && !optional.includes(key)) fail(context, `unexpected key "${key}"`);
  }
  for (const key of required) {
    if (!(key in record)) fail(context, `missing key "${key}"`);
  }
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") fail(context, `expected a string, got ${typeof value}`);
  return value;
}

function expectNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(context, `expected an integer, got ${typeof value}`);
  }
  return value;
}

function expectArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) fail(context, `expected an array, got ${typeof value}`);
  return value;
}

function expectNonNegative(value: unknown, context: string): number {
  const number = expectNumber(value, context);
  if (number < 0) fail(context, "expected a non-negative integer");
  return number;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") fail(context, `expected a boolean, got ${typeof value}`);
  return value;
}

function expectIndex(value: unknown, context: string, tableCount: number): number {
  const index = expectNumber(value, context);
  if (index < 0 || index >= tableCount) {
    fail(context, `index ${index} out of range (table size ${tableCount})`);
  }
  return index;
}

function expectStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) fail(context, "expected an array");
  return value.map((entry, i) => expectString(entry, `${context}[${i}]`));
}

function expectStringRecord(value: unknown, context: string): Record<string, string> {
  const record = expectRecord(value, context);
  const out: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    out[key] = expectString(record[key], `${context}.${key}`);
  }
  return out;
}
