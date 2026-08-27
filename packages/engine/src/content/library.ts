/**
 * Element library — ingestion of the corpus into a lookup structure.
 *
 * Ingest order is deterministic: system/ first, then testdata/, files in
 * sorted path order; when two files define the same element id, the later
 * definition wins (matches the corpus convention that later content overrides
 * base content). This ordering is the documented baseline.
 */

import { parseAppendsFile, parseElementsFile, type AppendBlock, type ParsedElement } from "./parser.js";
import { generateItemProxies } from "./proxies.js";

/** Engine-baked grant appended to every class element. */
export const GRANT_MULTICLASSING_PREREQUISITE = "ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE";
/** Engine-baked grant of the Multiclassing option, gated on the prereq grant. */
export const GRANT_MULTICLASS_SPELLCASTING = "ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING";

/**
 * Ruleset classification is content-driven. Precedence: an explicit "ruleset"
 * setter on the element, engine-baked ids and always-shared types, a "ruleset"
 * setter inherited from the element's Source element, edition signals the
 * content itself carries (PHB24/DMG24/MM24 id markers, source-element id
 * ending "_2024", source abbreviation ending "24", "(2024)" in the source
 * name, "5.5e" in the source information), then the legacy 2014 core-book
 * names. The abbreviation signal intentionally also catches playtest
 * documents like UA20170424/UA20200224, which is the intended behaviour:
 * these signals tag the whole bundled corpus consistently.
 */
export type RulesetTag = "2014" | "2024" | "shared";

export const RULESET_2014_SOURCES: ReadonlySet<string> = new Set([
  "Player’s Handbook",
  "Player's Handbook",
  "Dungeon Master’s Guide",
  "Dungeon Master's Guide",
  "Monster Manual",
  "System Reference Document",
]);

/**
 * Element types with no 2014/2024-exclusive members.
 *
 * Alignment, Deity and Proficiency are here because the shipped baseline
 * defines them once, under the 2014 core-book source names, and both editions
 * select from that one pool: Alignment is a required character selection,
 * and every class in either edition picks skills, tools and instruments from
 * the same Proficiency elements. Tagging them 2014 made a 2024-mode character
 * impossible to complete.
 */
const RULESET_SHARED_TYPES: ReadonlySet<string> = new Set([
  "Ability Score Improvement",
  "Alignment",
  "Armor Group",
  "Condition",
  "Deity",
  "Dragonmark",
  "Grants",
  "Ignore",
  "Level",
  "Option",
  "Proficiency",
  "Property",
  "Source",
  "Spellcasting Focus Group",
  "Support",
  "Vision",
  "Weapon Category",
]);

interface RulesetElementView {
  identity: { id: string; type: string; source: string };
  setters?: Array<{ name: string; value: string }>;
}

function rulesetSetterValue(element: RulesetElementView | undefined): RulesetTag | undefined {
  const raw = element?.setters?.find((setter) => setter.name === "ruleset")?.value.trim().toLowerCase();
  if (raw === "2014" || raw === "2024") return raw;
  if (raw === "shared" || raw === "all") return "shared";
  return undefined;
}

/** Source elements keyed by display name (identity.name), for classification. */
export function rulesetSourcesByName(elements: Iterable<ParsedElement>): Map<string, ParsedElement> {
  const out = new Map<string, ParsedElement>();
  for (const element of elements) {
    if (element.identity.type === "Source") out.set(element.identity.name, element);
  }
  return out;
}

export function classifyRuleset(
  element: RulesetElementView,
  sourcesByName?: ReadonlyMap<string, RulesetElementView>,
): RulesetTag {
  const own = rulesetSetterValue(element);
  if (own) return own;
  const { id, type, source } = element.identity;
  if (id.startsWith("ID_INTERNAL_")) return "shared";
  if (RULESET_SHARED_TYPES.has(type)) return "shared";
  const sourceElement = sourcesByName?.get(source);
  const inherited = rulesetSetterValue(sourceElement);
  if (inherited) return inherited;
  if (/_(?:PHB24|DMG24|MM24)_/.test(id)) return "2024";
  if (sourceElement?.identity.id.endsWith("_2024")) return "2024";
  const abbreviation = sourceElement?.setters?.find((setter) => setter.name === "abbreviation")?.value.trim();
  if (abbreviation?.endsWith("24")) return "2024";
  if (source.toLowerCase().includes("(2024)")) return "2024";
  const information = sourceElement?.setters?.find((setter) => setter.name === "information")?.value;
  if (information?.includes("5.5e")) return "2024";
  if (RULESET_2014_SOURCES.has(source)) return "2014";
  return "shared";
}

export interface RulesetCounts {
  rules2014Count: number;
  rules2024Count: number;
  sharedCount: number;
}

export interface ElementLibrary {
  /** Top-level elements by id (later definition wins). */
  byId: Map<string, ParsedElement>;
  /** Top-level elements by type, in ingest order. */
  byType: Map<string, ParsedElement[]>;
  /** Element count per type. */
  typeCounts: Record<string, number>;
  /** Source elements (type "Source") by id. */
  sources: Map<string, ParsedElement>;
  /** Number of top-level elements. */
  elementCount: number;
  /** Files ingested (declaredBy -> order index). */
  fileOrder: string[];
  /** Ruleset classification per element id. */
  ruleset: Map<string, RulesetTag>;
  /** Classification counts over the whole library. */
  rulesetCounts: RulesetCounts;
  /** Monotonic content revision; increments after each successful mutation. */
  revision?: number;
  /** Raw XML files currently installed, keyed by normalized path. */
  fileContents?: Map<string, string>;
  /** Non-fatal findings from the most recent rebuild (per offending file). */
  diagnostics?: ContentDiagnostic[];
}

export interface ContentDiagnostic {
  kind: "duplicate-id" | "empty-file" | "append-target";
  /** Normalized path of the file the finding is about. */
  file: string;
  message: string;
  detail?: string;
}

const IMPROVEMENT_OPTION = /^Improvement Option \((.+) (\d+)\)$/;

function normalizeMulticlassVariants(
  byId: Map<string, ParsedElement>,
  byType: Map<string, ParsedElement[]>,
): void {
  const classes = byType.get("Class") ?? [];
  for (const classElement of classes) {
    const variant = classElement.multiclass;
    if (variant === undefined || byId.has(variant.id)) continue;
    const element: ParsedElement = {
      identity: {
        id: variant.id,
        name: classElement.identity.name,
        type: "Multiclass",
        source: classElement.identity.source,
      },
      descriptionXml: classElement.descriptionXml,
      setters: [...variant.setters],
      rules: [...variant.rules],
      supports: [],
      requirements: variant.requirements
        ? `!${classElement.identity.id}&&(${variant.requirements})`
        : `!${classElement.identity.id}`,
      prerequisite: variant.prerequisite,
      compendiumHidden: true,
      sheets: [],
      children: [],
      declaredBy: `${classElement.declaredBy}#multiclass`,
    };
    byId.set(element.identity.id, element);
    const list = byType.get("Multiclass") ?? [];
    if (list.length === 0) byType.set("Multiclass", list);
    list.push(element);
  }
}

/**
 * Ensures the per-class "Feat (N)" improvement variant exists and can
 * actually be taken: the full corpus ships identity-only clones (no
 * rules) and the public profile ships none at all, so the supports tags,
 * the feats-optional-rule requirement, and the feat select are ensured
 * here regardless of which parts the content provided.
 */
function ensureFeatClone(
  byId: Map<string, ParsedElement>,
  byType: Map<string, ParsedElement[]>,
  id: string,
  className: string,
  level: string,
  tags: readonly string[],
): void {
  let clone = byId.get(id);
  if (clone === undefined) {
    clone = {
      identity: { id, name: `Feat (${level})`, type: "Class Feature", source: "Player’s Handbook" },
      descriptionXml: "<p>Select a feat of your choice.</p>",
      setters: [],
      rules: [],
      supports: [],
      compendiumHidden: true,
      sheets: [],
      children: [],
      declaredBy: "system/generated-improvement-options",
    };
    byId.set(id, clone);
    const list = byType.get("Class Feature") ?? [];
    if (list.length === 0) byType.set("Class Feature", list);
    list.push(clone);
  }
  for (const tag of tags) {
    if (!clone.supports.includes(tag)) clone.supports.push(tag);
  }
  if (clone.requirements === undefined || clone.requirements.trim() === "") {
    clone.requirements = "ID_INTERNAL_OPTION_ALLOW_FEATS";
  }
  if (!clone.rules.some((rule) => rule.kind === "select" && rule.type === "Feat")) {
    // Wrapper naming is part of the .dnd5e format: a registered clone
    // spawns <element type="Feat" name="Feat (BARBARIAN 4)" requiredLevel="4">.
    clone.rules.push({ kind: "select", type: "Feat", name: `Feat (${className.toUpperCase()} ${level})`, level: Number(level) });
  }
  if (!clone.setters.some((setter) => setter.name === "allow duplicate")) {
    clone.setters.push({ name: "allow duplicate", value: "true" });
  }
}

function normalizeImprovementOptions(
  byId: Map<string, ParsedElement>,
  byType: Map<string, ParsedElement[]>,
): void {
  const classFeatures = byType.get("Class Feature") ?? [];
  const options = new Map<string, string[]>();
  for (const element of classFeatures) {
    for (const rule of element.rules) {
      if (rule.kind !== "select" || rule.type !== "Class Feature" || rule.name === undefined) continue;
      const match = IMPROVEMENT_OPTION.exec(rule.name);
      if (!match) continue;
      const className = match[1]!.trim();
      const level = match[2]!;
      const slug = className.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
      const tags = ["Improvement Option", className, level];
      options.set(`ID_INTERNAL_CLASS_FEATURE_ASI_${level}_${slug}`, tags);
      ensureFeatClone(byId, byType, `ID_INTERNAL_CLASS_FEATURE_FEAT_${level}_${slug}`, className, level, tags);
    }
  }

  if (options.size > 0) {
    const abilityScoreImprovements = [
      ["ID_INTERNAL_ASI_CHARISMA", "Charisma"],
      ["ID_INTERNAL_ASI_CONSTITUTION", "Constitution"],
      ["ID_INTERNAL_ASI_DEXTERITY", "Dexterity"],
      ["ID_INTERNAL_ASI_INTELLIGENCE", "Intelligence"],
      ["ID_INTERNAL_ASI_STRENGTH", "Strength"],
      ["ID_INTERNAL_ASI_WISDOM", "Wisdom"],
    ] as const;
    for (const [id, name] of abilityScoreImprovements) {
      // A +1 improvement may be registered once per pick, so the same score
      // can be raised twice for a +2 — the elements carry "allow duplicate"
      // whether they came from the corpus or were generated here.
      const existing = byId.get(id);
      if (existing !== undefined) {
        if (!existing.setters.some((setter) => setter.name === "allow duplicate")) {
          existing.setters.push({ name: "allow duplicate", value: "true" });
        }
        continue;
      }
      const element: ParsedElement = {
        identity: { id, name, type: "Ability Score Improvement", source: "Player’s Handbook" },
        descriptionXml: `<p>Your ${name} score increases by 1.</p>`,
        setters: [{ name: "allow duplicate", value: "true" }],
        rules: [],
        supports: [],
        compendiumHidden: false,
        sheets: [],
        children: [],
        declaredBy: "system/generated-ability-score-improvements",
      };
      byId.set(id, element);
      const list = byType.get("Ability Score Improvement") ?? [];
      if (list.length === 0) byType.set("Ability Score Improvement", list);
      list.push(element);
    }
  }

  for (const [id, supports] of options) {
    const existing = byId.get(id);
    if (existing !== undefined) {
      for (const tag of supports) {
        if (!existing.supports.includes(tag)) existing.supports.push(tag);
      }
      continue;
    }
    const level = supports[2]!;
    const element: ParsedElement = {
      identity: {
        id,
        name: `Ability Score Improvement (${level})`,
        type: "Class Feature",
        source: "Player’s Handbook",
      },
      descriptionXml:
        "<p>You can increase one ability score of your choice by 2, or you can increase two ability scores of your choice by 1. As normal, you can’t increase an ability score above 20 using this feature.</p>",
      setters: [],
      rules: [{
        kind: "select",
        type: "Ability Score Improvement",
        name: `Ability Score Increase (${supports[1]!.toUpperCase()} ${level})`,
        number: 2,
        level: Number(level),
        supports: [
          "ID_INTERNAL_ASI_CHARISMA",
          "ID_INTERNAL_ASI_CONSTITUTION",
          "ID_INTERNAL_ASI_DEXTERITY",
          "ID_INTERNAL_ASI_INTELLIGENCE",
          "ID_INTERNAL_ASI_STRENGTH",
          "ID_INTERNAL_ASI_WISDOM",
        ].join("|"),
      }],
      supports,
      compendiumHidden: true,
      sheets: [],
      children: [],
      declaredBy: "system/generated-improvement-options",
    };
    byId.set(id, element);
    const list = byType.get("Class Feature") ?? [];
    if (list.length === 0) byType.set("Class Feature", list);
    list.push(element);
  }
}

function normalizeAdjustmentProxyMetadata(byId: Map<string, ParsedElement>, fileOrder: readonly string[]): void {
  // The full corpus includes the adjustment baseline; the reviewed
  // browser profile relies on the authored proxy metadata instead.
  if (fileOrder.includes("system/system-elements-extended.xml")) return;
  const familiar = byId.get("ID_INTERNAL_ITEM_PROXY_FAMILIAR_SELECTION");
  if (familiar === undefined || familiar.identity.type !== "Item") return;
  if (!familiar.setters.some((setter) => setter.name === "category")) {
    familiar.setters.push({ name: "category", value: "Additional Feature" });
  }
}

export async function buildLibrary(
  corpusRoot: string,
  includePath: (relativePath: string) => boolean = () => true,
  systemRoot: string = `${corpusRoot}/system`,
): Promise<ElementLibrary> {
  // Node 22 exposes built-in modules through process.getBuiltinModule. The
  // browser entry never evaluates this function, and bundlers therefore do
  // not pull Node's fs/path implementations into worker code.
  const processObject = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process;
  const fs = processObject?.getBuiltinModule?.("fs/promises") as {
    readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }> >;
    readFile(path: string, encoding: "utf8"): Promise<string>;
  } | undefined;
  const pathModule = processObject?.getBuiltinModule?.("path") as { join(...parts: string[]): string } | undefined;
  if (fs === undefined || pathModule === undefined) throw new Error("buildLibrary is only available in a Node host");
  const files = new Map<string, string>();
  // The engine's own system elements come first, then the corpus.
  for (const [sub, root] of [["system", systemRoot], ["testdata", pathModule.join(corpusRoot, "testdata")]] as const) {
    for (const file of await collectXmlFilesNode(root, fs.readdir)) {
      const relative = `${sub}/${file.slice(root.length + 1).replaceAll("\\", "/")}`;
      if (includePath(relative)) files.set(relative, await fs.readFile(file, "utf8"));
    }
  }
  const library = createEmptyLibrary();
  replaceLibraryFiles(library, files, false);
  return library;
}

async function collectXmlFilesNode(
  root: string,
  readDirectory: (path: string, options: { withFileTypes: true }) => Promise<Array<{ name: string; isDirectory(): boolean }>>,
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readDirectory(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".xml")) out.push(full);
    }
  };
  await walk(root);
  return out;
}

/** A browser-safe empty library used before the first content boot. */
export function createEmptyLibrary(): ElementLibrary {
  return {
    byId: new Map(),
    byType: new Map(),
    typeCounts: {},
    sources: new Map(),
    elementCount: 0,
    fileOrder: [],
    ruleset: new Map(),
    rulesetCounts: { rules2014Count: 0, rules2024Count: 0, sharedCount: 0 },
    revision: 0,
    fileContents: new Map(),
  };
}

/** Replace the XML file set and hydrate the supplied library object in place. */
export function replaceLibraryFiles(
  library: ElementLibrary,
  files: ReadonlyMap<string, string> | ReadonlyArray<readonly [string, string]>,
  incrementRevision = true,
): void {
  const fileContents = new Map<string, string>(files instanceof Map ? files : files);
  const byId = new Map<string, ParsedElement>();
  const byType = new Map<string, ParsedElement[]>();
  const sources = new Map<string, ParsedElement>();
  const appends: Array<{ append: AppendBlock; file: string }> = [];
  const diagnostics: ContentDiagnostic[] = [];
  const declaredIn = new Map<string, string>();
  const comparePath = (a: string, b: string): number => {
    const aParts = a.split("/");
    const bParts = b.split("/");
    for (let index = 0; index < Math.min(aParts.length, bParts.length); index += 1) {
      const result = aParts[index]!.localeCompare(bParts[index]!);
      if (result !== 0) return result;
    }
    return aParts.length - bParts.length;
  };
  // Ingest tiers: system content first, the bundled corpus next, user uploads
  // (stored under imports/) last. Later definitions win on id collision, so an
  // uploaded pack must be able to override a bundled element — sorting uploads
  // lexicographically ("imports/…" < "testdata/…") silently inverted that.
  const ingestTier = (path: string): number => {
    if (path === "system" || path.startsWith("system/")) return 0;
    if (path === "imports" || path.startsWith("imports/")) return 2;
    return 1;
  };
  const fileOrder = [...fileContents.keys()].sort((a, b) => {
    const tierDelta = ingestTier(a) - ingestTier(b);
    if (tierDelta !== 0) return tierDelta;
    return comparePath(a, b);
  });
  for (const relative of fileOrder) {
    const text = fileContents.get(relative)!;
    let fileElementCount = 0;
    for (const element of parseElementsFile(text, relative)) {
      const id = element.identity.id;
      if (id === "") continue;
      fileElementCount += 1;
      const declaredBy = declaredIn.get(id);
      if (declaredBy !== undefined && declaredBy !== relative) {
        diagnostics.push({
          kind: "duplicate-id",
          file: relative,
          message: `duplicate element id ${id}`,
          detail: `overrides the definition from ${declaredBy}`,
        });
      }
      declaredIn.set(id, relative);
      byId.set(id, element);
      const list = byType.get(element.identity.type) ?? [];
      if (list.length === 0) byType.set(element.identity.type, list);
      list.push(element);
      if (element.identity.type === "Source") sources.set(id, element);
    }
    const fileAppends = parseAppendsFile(text, relative);
    for (const append of fileAppends) appends.push({ append, file: relative });
    if (fileElementCount === 0 && fileAppends.length === 0) {
      diagnostics.push({
        kind: "empty-file",
        file: relative,
        message: "no content elements were found in this file",
      });
    }
  }
  for (const { append, file } of appends) {
    const target = byId.get(append.id);
    if (target) {
      target.rules.push(...append.rules);
      target.supports.push(...append.supports);
    } else {
      diagnostics.push({
        kind: "append-target",
        file,
        message: `append target ${append.id} was not found`,
        detail: "its rules were skipped; upload the pack that defines the target element",
      });
    }
  }
  for (const [type, list] of byType) {
    const seen = new Set<string>();
    const deduped: ParsedElement[] = [];
    for (const element of list) {
      if (seen.has(element.identity.id)) continue;
      seen.add(element.identity.id);
      deduped.push(byId.get(element.identity.id) ?? element);
    }
    byType.set(type, deduped);
  }
  for (const element of byType.get("Class") ?? []) {
    element.rules.push({ kind: "grant", type: "Grants", id: GRANT_MULTICLASSING_PREREQUISITE, requirements: element.multiclass?.requirements });
  }
  normalizeMulticlassVariants(byId, byType);
  const multiclassOption = byId.get("ID_INTERNAL_OPTION_ALLOW_MULTICLASSING");
  if (multiclassOption) {
    multiclassOption.rules.push({ kind: "grant", type: "Grants", id: GRANT_MULTICLASS_SPELLCASTING, requirements: GRANT_MULTICLASSING_PREREQUISITE });
  }
  normalizeImprovementOptions(byId, byType);
  normalizeAdjustmentProxyMetadata(byId, fileOrder);
  const corpusIds = new Set(byId.keys());
  for (const proxy of generateItemProxies({ byType, sources })) {
    if (corpusIds.has(proxy.identity.id)) {
      corpusIds.delete(proxy.identity.id);
      continue;
    }
    byId.set(proxy.identity.id, proxy);
    const list = byType.get(proxy.identity.type) ?? [];
    if (list.length === 0) byType.set(proxy.identity.type, list);
    list.push(proxy);
  }
  const typeCounts: Record<string, number> = {};
  for (const [type, list] of byType) typeCounts[type] = list.length;
  const ruleset = new Map<string, RulesetTag>();
  const rulesetCounts: RulesetCounts = { rules2014Count: 0, rules2024Count: 0, sharedCount: 0 };
  const sourcesForRuleset = rulesetSourcesByName(byId.values());
  for (const element of byId.values()) {
    const tag = classifyRuleset(element, sourcesForRuleset);
    ruleset.set(element.identity.id, tag);
    if (tag === "2014") rulesetCounts.rules2014Count++;
    else if (tag === "2024") rulesetCounts.rules2024Count++;
    else rulesetCounts.sharedCount++;
  }
  library.byId = byId;
  library.byType = byType;
  library.typeCounts = typeCounts;
  library.sources = sources;
  library.elementCount = byId.size;
  library.fileOrder = fileOrder;
  library.ruleset = ruleset;
  library.rulesetCounts = rulesetCounts;
  library.fileContents = fileContents;
  library.diagnostics = diagnostics;
  library.revision = (library.revision ?? 0) + (incrementRevision ? 1 : 0);
}

/** The ruleset tag of an element id (shared for unknown ids). */
/**
 * Legacy item/weapon id prefixes from old exports, migrated on lookup: the
 * legacy id resolves to its PHB successor only when the legacy id itself is
 * absent from the library.
 */
const LEGACY_ID_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["ID_WOTC_ITEM_", "ID_WOTC_PHB_ITEM_"],
  ["ID_WOTC_WEAPON_", "ID_WOTC_PHB_WEAPON_"],
];

/** An element by id, falling back through the legacy id migration table. */
export function elementById(library: ElementLibrary, id: string): ParsedElement | undefined {
  const direct = library.byId.get(id);
  if (direct !== undefined) return direct;
  for (const [legacy, current] of LEGACY_ID_PREFIXES) {
    if (id.startsWith(legacy)) return library.byId.get(current + id.slice(legacy.length));
  }
  return undefined;
}

export function rulesetOf(library: ElementLibrary, id: string): RulesetTag {
  return library.ruleset.get(id) ?? "shared";
}

/**
 * True when the element may be registered more than once on a character
 * (the "allow duplicate" setter, e.g. a +1 ability score improvement taken
 * twice for a +2).
 */
export function allowsDuplicate(element: ParsedElement): boolean {
  return element.setters.some(
    (setter) => setter.name === "allow duplicate" && setter.value.trim().toLowerCase() === "true",
  );
}
