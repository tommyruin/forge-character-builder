#!/usr/bin/env node
/**
 * Publishes the System Reference Document subsets the browser ships, sliced
 * from the vendored public elements corpus by the reviewed maps under
 * third-party/srd-5.1 and third-party/srd-5.2:
 *
 *   node scripts/build-srd-content.mjs draft-map --edition 5.1|5.2   # propose the map from the inventory
 *   node scripts/build-srd-content.mjs build --edition 5.1|5.2|all  # write the shipped files
 *   node scripts/build-srd-content.mjs check --edition all          # rebuild in memory and fail on drift
 *
 * Output lives under apps/client/public/content/<edition>/, keyed by the
 * corpus-relative path, so element ids and file names stay stable for saved
 * characters and for uploaded books that override the shipped elements.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_PROVENANCE = join(ROOT, "third-party", "elements", "testdata.provenance.json");
const SYSTEM_DIR = join(ROOT, "third-party", "elements", "system");
const CONTENT_DIR = join(ROOT, "apps", "client", "public", "content");
const CORPUS_ROOT = join(ROOT, "third-party", "elements", "testdata", "core");

/** Element types the SRD names directly; everything else is kept by ownership. */
export const NAMED_TYPES = new Set([
  "Class", "Archetype", "Race", "Sub Race", "Race Variant", "Background", "Spell", "Feat", "Item", "Weapon", "Armor",
  "Magic Item", "Companion", "Language", "Rule", "Weapon Property", "Proficiency", "Weapon Group", "Source", "Deity",
]);

export const EDITIONS = {
  "5.2": {
    key: "5.2",
    title: "System Reference Document 5.2.1",
    srdDir: join(ROOT, "third-party", "srd-5.2"),
    inventory: "srd-5.2.1.inventory.json",
    map: "srd-5.2.1.map.json",
    outputDir: "srd-5.2.1",
    sourceDirs: [{ dir: join(CORPUS_ROOT, "players-handbook-2024"), prefix: "" }],
    sourceLabel: "the vendored public elements corpus",
    /**
     * The 2024 content grants engine-level Internal elements (race grants, the
     * background ability-score combinations, spellcasting feature grants) that
     * the vendored corpus defines in core/internal.xml and the shipped core
     * baseline does not. They are kept only when a retained element reaches
     * them, never as roots, and never when the baseline already defines the id.
     */
    dependencyFiles: { "internal.xml": join(CORPUS_ROOT, "internal.xml") },
    skipShippedIds: false,
    /** Committed files in the output directory that are written by hand, not generated. */
    authored: /^(skill-supports|skill-expertise|source)\.xml$/,
    /** Files copied whole (every element is SRD content) — a dropped element here is reported, not removed. */
    tierA: new Set(["rules.xml", "misc/languages.xml", "misc/weapon-mastery-properties.xml"]),
    /** Source files that are never published, with the reason. */
    excludedFiles: {
      "source.xml": "the corpus Source element carries the publisher's product description, which is not SRD text; an authored Source element ships instead",
      "backgrounds/optional-background-feature.xml": "the optional background feature rule is not part of SRD 5.2.1",
      "races/race-aasimar.xml": "Aasimar is not an SRD 5.2.1 species",
    },
    /** Where the document's entry prose begins, per element type; everything before it is the handbook's. */
    trims: { Class: '<div class="sidebar">', Race: "<h5>", Background: "trailing-flavor" },
    chapterTypes: {
      classes: ["Class"], subclasses: ["Archetype"], backgrounds: ["Background"], species: ["Race"], feats: ["Feat"],
      metamagicOptions: ["Class Feature"], eldritchInvocations: ["Class Feature"], masteryProperties: ["Weapon Property"],
      equipment: ["Item", "Weapon", "Armor"], languages: ["Language"], spells: ["Spell"], animals: ["Companion"],
    },
    chapterFiles: {
      metamagicOptions: /^classes\/class-sorcerer\.xml$/, eldritchInvocations: /^classes\/eldritch-invocations\.xml$/,
      masteryProperties: /^misc\/weapon-mastery-properties\.xml$/, animals: /^companions\.xml$/, spells: /^spells\.xml$/, feats: /^feats\//,
    },
    unmatchedReasons: {
      animals: "SRD 5.2.1 animals without a corpus companion stat block are not published; companions.xml carries only the Find Familiar and Pact of the Chain forms",
      languages: "the standard languages ship with the 2014 core content and are shared by both editions; the corpus adds only Common Sign Language and Draconic",
    },
    unmappedChapters: {
      magicItems: "SRD 5.2.1 magic items have no 2024 corpus source (the vendored corpus carries no 2024 Dungeon Master's Guide)",
      weaponProperties: "the general weapon properties ship with the 2014 core content and are shared by both editions",
    },
    generatedDeities: false,
  },
  "5.1": {
    key: "5.1",
    title: "System Reference Document 5.1",
    srdDir: join(ROOT, "third-party", "srd-5.1"),
    inventory: "srd-5.1.inventory.json",
    map: "srd-5.1.map.json",
    outputDir: "srd-5.1",
    // The 2014 handbook chapters plus the Dungeon Master's Guide magic item
    // tables the document reprints. Element ids and file names follow the
    // corpus, so saved characters keep resolving and an uploaded handbook
    // overrides the shipped elements one by one.
    sourceDirs: [
      { dir: join(CORPUS_ROOT, "players-handbook"), prefix: "" },
      { dir: join(CORPUS_ROOT, "dungeon-masters-guide", "items"), prefix: "items/magic/" },
    ],
    sourceLabel: "the vendored public elements corpus",
    // Handbook elements grant a few engine-level Internal elements (armor
    // strength waivers, half-elf and half-orc grants, lesser darkvision) that
    // the corpus defines in core/internal.xml; they ship only when reached.
    dependencyFiles: { "internal.xml": join(CORPUS_ROOT, "internal.xml") },
    // The corpus repeats definitions the core baseline already ships
    // (proficiencies, languages, the handbook's Source element); those are
    // never emitted twice.
    skipShippedIds: true,
    authored: /^ranger-favored-terrains\.xml$/,
    /** The companion stat blocks ship whole: their traits and actions belong to the creatures that carry them. */
    tierA: new Set(["companions.xml"]),
    excludedFiles: {
      "deities.xml": "the corpus pantheon is not SRD 5.1 content; the document's Celtic, Greek, Egyptian and Norse pantheons are generated into this file instead",
      "source.xml": "the corpus Source element carries the publisher's product description; the core baseline ships the Source element",
      "items/magic/items-firearms.xml": "firearms are not SRD 5.1 content",
      "items/magic/items-gifts.xml": "supernatural gifts are not SRD 5.1 content",
      "items/magic/items-treasure.xml": "treasure tables are not SRD 5.1 content",
      "items/magic/items-vehicle.xml": "vehicles are not SRD 5.1 magic items",
      "items/magic/items-vehicles.xml": "vehicles are not SRD 5.1 magic items",
      "items/magic/replicate-infusions.xml": "artificer infusions are not SRD 5.1 content",
    },
    trims: { Class: "<h3>CLASS FEATURES</h3>", Race: /<h4>[A-Z-]+ TRAITS<\/h4>/ },
    chapterTypes: {
      classes: ["Class"], subclasses: ["Archetype"], backgrounds: ["Background"], races: ["Race"], subraces: ["Sub Race"],
      feats: ["Feat"], eldritchInvocations: ["Class Feature"], equipment: ["Item", "Weapon", "Armor"], spells: ["Spell"],
      magicItems: ["Magic Item"],
    },
    chapterFiles: { eldritchInvocations: /^(classes\/class-warlock|eldritch-invocations)\.xml$/ },
    unmatchedReasons: {},
    unmappedChapters: {
      deities: "generated from the document's pantheon tables into the deities file; the corpus pantheon is not SRD content",
    },
    generatedDeities: true,
    /** Document entries whose family members carry the variant inside the name. */
    familyPatterns: {
      "belt of giant strength": /^belt of \w+ giant strength$/,
      "potion of giant strength": /^potion of \w+ giant strength$/,
      "potions of healing": /^potion of (greater |superior |supreme )?healing$/,
      "ring of elemental command": /^ring of (air|earth|fire|water) elemental command$/,
      "spell scroll": /^spell scroll/,
      "manual of golems": /^manual of (clay|flesh|iron|stone) golems$/,
      "stone of good luck (luckstone)": /^stone of good luck/,
    },
    /** Elements kept on review that the inventory cannot name by heading. */
    /** Elements dropped on review although a retained element would otherwise own them. */
    excludedIds: {
      ID_WOTC_MM_CLASS_FEATURE_RANGER_FAVORED_ENEMY_HUMANOID_KUO_TOA: "favored-enemy entry describing a creature SRD 5.1 does not carry",
      ID_WOTC_MM_CLASS_FEATURE_RANGER_FAVORED_ENEMY_HUMANOID_YUAN_TI_PUREBLOOD: "favored-enemy entry describing a creature SRD 5.1 does not carry",
    },
    curatedIds: {
      ID_WOTC_DMG_MAGIC_ITEM_AMULET_OF_PROOF_AGAINST_DETECTION_AND_LOCATION: "SRD 5.1 magic item; its heading wraps onto a second line in the document, which the inventory records as two fragments",
      ID_WOTC_DMG_MAGIC_ITEM_CRYSTAL_BALL_OF_MIND_READING: "SRD 5.1 Crystal Ball variant, described inside the Crystal Ball entry",
      ID_WOTC_DMG_MAGIC_ITEM_CRYSTAL_BALL_OF_TELEPATHY: "SRD 5.1 Crystal Ball variant, described inside the Crystal Ball entry",
      ID_WOTC_DMG_MAGIC_ITEM_CRYSTAL_BALL_OF_TRUE_SEEING: "SRD 5.1 Crystal Ball variant, described inside the Crystal Ball entry",
      ID_WOTC_DMG_ITEM_POISON_CARRION_CRAWLER_MUCUS: "SRD 5.1 Poisons table; the inventory row loses the first word of the name to the table layout",
      ID_WOTC_ITEM_BURGLARS_PACK: "SRD 5.1 Equipment Packs",
      ID_WOTC_ITEM_DIPLOMATS_PACK: "SRD 5.1 Equipment Packs",
      ID_WOTC_ITEM_DUNGEONEERS_PACK: "SRD 5.1 Equipment Packs",
      ID_WOTC_ITEM_ENTERTAINERS_PACK: "SRD 5.1 Equipment Packs",
      ID_WOTC_ITEM_EXPLORERS_PACK: "SRD 5.1 Equipment Packs",
      ID_WOTC_ITEM_PRIESTS_PACK: "SRD 5.1 Equipment Packs",
      ID_WOTC_ITEM_SCHOLARS_PACK: "SRD 5.1 Equipment Packs",
    },
  },
};

let edition;
let SRD_DIR;
let INVENTORY_PATH;
let MAP_PATH;
let DENYLIST_PATH;
let SOURCE_DIRS;
let OUTPUT_DIR;
let DEPENDENCY_FILES;
let TIER_A;
let EXCLUDED_FILES;
function selectEdition(key) {
  edition = EDITIONS[key];
  if (!edition) throw new Error(`unknown edition ${key}; use ${Object.keys(EDITIONS).join(" or ")}`);
  SRD_DIR = edition.srdDir;
  INVENTORY_PATH = join(SRD_DIR, edition.inventory);
  MAP_PATH = join(SRD_DIR, edition.map);
  DENYLIST_PATH = join(SRD_DIR, "ip-denylist.json");
  SOURCE_DIRS = edition.sourceDirs;
  OUTPUT_DIR = join(CONTENT_DIR, edition.outputDir);
  DEPENDENCY_FILES = edition.dependencyFiles;
  TIER_A = edition.tierA;
  EXCLUDED_FILES = edition.excludedFiles;
  shippedCache = undefined;
}

const command = process.argv[2];
const args = new Set(process.argv.slice(3));
const editionArg = process.argv[process.argv.indexOf("--edition") + 1];

// -------------------------------------------------------------- utilities

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const norm = (text) =>
  text
    .replace(/[-­‐‑‒–—]+/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const attr = (tag, name) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : undefined;
};
const decodeEntities = (text) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function xmlFiles(root) {
  const out = [];
  const walk = async (dir, rel) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path);
      else if (entry.name.endsWith(".xml")) out.push(path);
    }
  };
  await walk(root, "");
  return out;
}

/** Every source file of the edition, keyed by its output-relative path. */
async function corpusFiles() {
  const out = [];
  for (const { dir, prefix } of SOURCE_DIRS) {
    for (const relative of await xmlFiles(dir)) out.push({ path: `${prefix}${relative}`, full: join(dir, relative) });
  }
  return out;
}

// --------------------------------------------------------- corpus scanner

/**
 * Splits a corpus file into its top-level nodes without re-serialising
 * anything: each node keeps the exact source bytes. Verified against the
 * pinned corpus: no <element> or <append> is ever nested.
 */
export function scanFile(text, path) {
  const nodes = [];
  const rootOpen = text.indexOf("<elements");
  if (rootOpen === -1) throw new Error(`${path}: no <elements> root`);
  const rootOpenEnd = text.indexOf(">", rootOpen) + 1;
  const rootClose = text.lastIndexOf("</elements>");
  if (rootClose === -1) throw new Error(`${path}: no </elements>`);
  const prologue = text.slice(0, rootOpenEnd);
  let position = rootOpenEnd;
  const tagEnd = (from) => {
    // Quote-aware scan for the end of an open tag.
    let quote = null;
    for (let i = from; i < text.length; i += 1) {
      const char = text[i];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") return i;
    }
    throw new Error(`${path}: unterminated tag at ${from}`);
  };
  while (position < rootClose) {
    const rest = text.slice(position, rootClose);
    const leading = /^\s*/.exec(rest)[0];
    if (leading.length === rest.length) break;
    const start = position + leading.length;
    let end;
    let kind;
    if (text.startsWith("<!--", start)) {
      end = text.indexOf("-->", start) + 3;
      kind = "comment";
    } else if (/^<(element|append|info)\b/.test(text.slice(start, start + 8))) {
      kind = /^<(\w+)/.exec(text.slice(start))[1];
      const openEnd = tagEnd(start);
      if (text[openEnd - 1] === "/") end = openEnd + 1;
      else {
        const close = text.indexOf(`</${kind}>`, openEnd);
        if (close === -1) throw new Error(`${path}: unterminated <${kind}> at ${start}`);
        end = close + kind.length + 3;
      }
    } else if (text[start] !== "<") {
      // Stray top-level text (the corpus has a doubly closed comment); it is
      // not part of any element and is not reproduced.
      const next = text.indexOf("<", start);
      end = next === -1 ? rootClose : next;
      kind = "text";
    } else {
      throw new Error(`${path}: unexpected content at ${start}: ${JSON.stringify(text.slice(start, start + 40))}`);
    }
    const source = text.slice(start, end);
    const node = { kind, leading, source, path };
    if (kind === "element" || kind === "append") {
      Object.assign(node, parseNode(kind, source, path));
    }
    nodes.push(node);
    position = end;
  }
  return { prologue, nodes, epilogue: text.slice(rootClose) };
}

function parseNode(kind, source, path) {
  const openTag = /^<\w+\b[^>]*?(?:"[^"]*"[^>]*?)*>/.exec(source)?.[0] ?? source;
  const id = attr(openTag, "id") ?? "";
  const node = {
    id,
    name: decodeEntities(attr(openTag, "name") ?? ""),
    type: attr(openTag, "type") ?? "",
    sourceBook: decodeEntities(attr(openTag, "source") ?? ""),
    supports: [],
    grants: [],
    selects: [],
    requirements: [],
    level: undefined,
  };
  const body = source.slice(openTag.length);
  const supportsText = /<supports>([^<]*)<\/supports>/.exec(body)?.[1];
  if (supportsText) node.supports = supportsText.split(",").map((tag) => tag.trim()).filter(Boolean);
  for (const match of body.matchAll(/<support\b[^>]*?(?:\sid="([^"]*)"|\stype="([^"]*)")[^>]*\/?>/g)) node.supports.push(match[1] ?? match[2]);
  for (const match of body.matchAll(/<grant\b[^>]*>/g)) {
    const grantId = attr(match[0], "id");
    if (grantId) node.grants.push(grantId);
  }
  for (const match of body.matchAll(/<select\b[^>]*>/g)) {
    node.selects.push({
      type: attr(match[0], "type") ?? "",
      supports: attr(match[0], "supports") === undefined ? undefined : decodeEntities(attr(match[0], "supports")),
      name: attr(match[0], "name"),
      requires: (attr(match[0], "requirements") ?? "").split(/[,|&()\s]+/).filter((token) => /^ID_/.test(token)),
      optional: /^true$/i.test(attr(match[0], "optional") ?? ""),
    });
  }
  const requirements = /<requirements>([^<]*)<\/requirements>/.exec(body)?.[1] ?? attr(openTag, "requirements");
  if (requirements) node.requirements = requirements.split(/[,|&()!\s]+/).filter((token) => token.startsWith("ID_"));
  node.level = /<set name="level">([^<]*)<\/set>/.exec(body)?.[1]?.trim();
  return node;
}

/** The engine's supports grammar: "," / "&" AND, "|" OR, parentheses, "!" negation. */
export function evaluateSupports(expression, have) {
  const tokens = [];
  let buffer = "";
  const flush = () => {
    const tag = buffer.trim();
    buffer = "";
    if (tag !== "") tokens.push({ kind: "tag", text: tag });
  };
  for (const char of expression) {
    if (char === "(" || char === ")") {
      flush();
      tokens.push({ kind: char === "(" ? "open" : "close" });
    } else if (char === "," || char === "&") {
      flush();
      if (tokens[tokens.length - 1]?.kind !== "and") tokens.push({ kind: "and" });
    } else if (char === "|") {
      flush();
      if (tokens[tokens.length - 1]?.kind !== "or") tokens.push({ kind: "or" });
    } else buffer += char;
  }
  flush();
  let position = 0;
  const unit = () => {
    const token = tokens[position];
    if (token === undefined) return false;
    if (token.kind === "open") {
      position += 1;
      const value = or();
      if (tokens[position]?.kind === "close") position += 1;
      return value;
    }
    if (token.kind === "tag") {
      position += 1;
      return token.text.startsWith("!") ? !have.has(token.text.slice(1).trim()) : have.has(token.text);
    }
    position += 1;
    return false;
  };
  const and = () => {
    let value = unit();
    while (tokens[position]?.kind === "and") {
      position += 1;
      value = unit() && value;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[position]?.kind === "or") {
      position += 1;
      value = and() || value;
    }
    return value;
  };
  return or();
}

const tagSet = (element) => {
  const have = new Set(element.supports);
  have.add(element.id);
  if (element.level !== undefined) have.add(element.level);
  return have;
};

// ------------------------------------------------------------- load corpus

async function loadCorpus() {
  const files = new Map();
  for (const { path, full } of await corpusFiles()) {
    const text = await readFile(full, "utf8");
    files.set(path, { path, text, dependency: false, ...scanFile(text, path) });
  }
  for (const [path, full] of Object.entries(DEPENDENCY_FILES)) {
    const text = await readFile(full, "utf8");
    files.set(path, { path, text, dependency: true, ...scanFile(text, path) });
  }
  return files;
}

const elementsOf = (files) => [...files.values()].flatMap((file) => file.nodes.filter((node) => node.kind === "element"));

// --------------------------------------------------------------- draft map

function inventoryNames(inventory, chapter) {
  const value = inventory.chapters[chapter];
  return (Array.isArray(value) ? value.map((entry) => entry.name) : value.names).map(norm);
}

/** Familiar and companion forms that are SRD 5.2.1 monsters rather than animals. */
const MONSTER_COMPANION_FORMS = ["Imp", "Pseudodragon", "Quasit", "Sprite", "Skeleton", "Sphinx of Wonder"];

/**
 * How an SRD equipment name may appear in the corpus: the SRD prints "Padded
 * Armor", plural ammunition, parenthetical notes, and "Spell Scroll(Cantrip)".
 */
function aliases(chapter, name) {
  const out = [name];
  if (chapter === "subraces") {
    // "Lightfoot" is the SRD heading for the Lightfoot Halfling sub-race.
    for (const race of ["halfling", "dwarf", "elf", "gnome"]) if (!name.endsWith(race)) out.push(`${name} ${race}`);
    return out;
  }
  if (chapter !== "equipment") return out;
  out.push(name.replace(/ armor$/, ""));
  out.push(name.replace(/^(\w+)s\b/, "$1"));
  out.push(name.replace(/\s*\([^)]*\)\s*$/, ""));
  out.push(name.replace(/\s*\(/, ", ").replace(/\)/, ""));
  out.push(name.replace(/ per day$/, " (per day)"));
  if (/^(exotic|military|riding)$/.test(name)) out.push(`saddle, ${name}`);
  // SRD 5.1 table shapes: "Crossbow, hand" for Hand Crossbow, "Arrows (20)",
  // "Acid (vial)", "Donkey or mule", "Half plate" for Half Plate Armor.
  const bare = name.replace(/\s*\([^)]*\)\s*$/, "");
  const swapped = /^([^,]+), (.+)$/.exec(bare);
  if (swapped) out.push(`${swapped[2]} ${swapped[1]}`);
  out.push(bare.replace(/^(\w+)s\b/, "$1"));
  out.push(bare.replace(/(\w+)s$/, "$1"));
  out.push(bare.replace(/ or .*$/, ""));
  out.push(bare.replace(/^(\w+) (\w+)$/, "$2 $1"));
  return [...new Set(out)];
}

/**
 * A document entry that the source spells out as a family: "Bag of Tricks"
 * is Gray/Rust/Tan, "Armor, +1, +2, or +3" is three elements, "Potions of
 * Healing" is a table of four. Returns every family member, or undefined.
 */
function magicItemFamily(name, byName) {
  const keys = [...byName.keys()];
  const bonus = /^(.*?), \+1, \+2, or \+3$/.exec(name);
  if (bonus) {
    const members = ["+1", "+2", "+3"].flatMap((plus) => byName.get(`${bonus[1]}, ${plus}`) ?? byName.get(`${bonus[1]} ${plus}`) ?? []);
    return members.length ? members : undefined;
  }
  const patterns = edition.familyPatterns?.[name];
  const matcher = patterns ?? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(, | \\()`);
  const members = keys.filter((key) => matcher.test(key)).flatMap((key) => byName.get(key));
  return members.length ? members : undefined;
}

async function draftMap(corpus, inventory) {
  const existing = existsSync(MAP_PATH) ? await readJson(MAP_PATH) : null;
  const renames = existing?.renames ?? {};
  const renameTargets = new Map(Object.entries(renames).map(([from, to]) => [norm(from), to]));
  const corpusProvenance = await readJson(CORPUS_PROVENANCE);
  const entries = {};
  const curated = existing?.curated ?? {};
  const excluded = {};
  const unmatchedInventory = {};
  const elements = elementsOf(corpus).filter((element) => !EXCLUDED_FILES[element.path] && !DEPENDENCY_FILES[element.path] && element.type !== "Source");

  const chapterTypes = edition.chapterTypes;
  const chapterFiles = edition.chapterFiles;
  const mapped = new Set();
  for (const [chapter, types] of Object.entries(chapterTypes)) {
    const fileFilter = chapterFiles[chapter];
    const byName = new Map();
    for (const element of elements) {
      if (!types.includes(element.type)) continue;
      if (fileFilter && !fileFilter.test(element.path)) continue;
      const key = renameTargets.has(norm(element.name)) ? norm(renameTargets.get(norm(element.name))) : norm(element.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(element);
      // "Ladder (10-foot)" and "Ladder" are the same item; the parenthetical
      // is a note, so the bare name is indexed too when nothing else owns it.
      const bare = key.replace(/\s*\([^)]*\)\s*$/, "");
      if (bare !== key && !byName.has(bare)) byName.set(bare, byName.get(key));
    }
    for (const name of inventoryNames(inventory, chapter)) {
      const key = `${chapter}/${name}`;
      let hits = aliases(chapter, name).map((alias) => byName.get(alias)).find(Boolean);
      if (!hits && chapter === "magicItems") hits = magicItemFamily(name, byName);
      if (hits) {
        entries[key] = hits.map((element) => element.id).sort();
        hits.forEach((element) => mapped.add(element.id));
      } else if (edition.unmatchedReasons[chapter]) {
        // Chapters where the SRD lists more than the corpus carries; the
        // reason is recorded once per chapter under unmappedChapters.
      } else unmatchedInventory[key] = existing?.unmatchedInventory?.[key] ?? "no corpus element with this name";
    }
  }
  // Companion forms that are monsters, and the rules file, are kept by curation.
  for (const element of edition.key === "5.2" ? elements : []) {
    if (element.type === "Companion" && MONSTER_COMPANION_FORMS.map(norm).includes(norm(element.name))) {
      curated[element.id] ??= "Find Familiar / Pact of the Chain form; an SRD 5.2.1 monster stat block";
    }
    if (element.type === "Rule") curated[element.id] ??= "SRD 5.2.1 Rules Glossary hazard";
    if (element.id === "ID_WOTC_PHB24_WEAPON_GROUP_POLEARMS" || element.id === "ID_WOTC_PHB24_PROFICIENCY_WEAPON_POLEARMS") {
      curated[element.id] ??= "weapon group referenced by the Polearm-style feats and the SRD polearm weapons";
    }
  }
  // The SRD's Gaming Set and Musical Instrument tool entries are generic
  // ("Varies"); the corpus instantiates them per instrument and game with the
  // same Ability/Utilize text. Keep the generically named ones and drop the
  // two games whose names are the publisher's own.
  for (const element of edition.key === "5.2" ? elements : []) {
    if (element.path !== "items/items-tools.xml") continue;
    if (/^ID_WOTC_PHB24_INSTRUMENT_/.test(element.id)) curated[element.id] ??= "instance of the SRD 5.2.1 Musical Instrument tool entry (generic instrument name)";
    if (/^ID_WOTC_PHB24_ITEM_TOOL_(DICE_SET|PLAYING_CARDS_SET)$/.test(element.id)) curated[element.id] ??= "instance of the SRD 5.2.1 Gaming Set tool entry (generic game)";
    if (/^ID_WOTC_PHB24_ITEM_TOOL_(DRAGONCHESS_SET|THREE_DRAGON_ANTE_SET)$/.test(element.id)) excluded[element.id] = "gaming set named for a publisher-specific game; SRD 5.2.1 lists Gaming Set generically";
  }
  for (const element of edition.key === "5.2" ? elements : []) {
    if (element.id === "ID_WOTC_PHB24_ITEM_BARDING") curated[element.id] ??= "listed in the SRD 5.2.1 Mounts and Vehicles table at a multiple of the armor's cost, so it carries no coin cell to extract";
  }
  // The 2014 companion stat blocks: the familiar, Beast Master and companion
  // item features select from them, and the animals are the document's own.
  for (const element of edition.key === "5.1" ? elements : []) {
    if (element.type === "Companion" && element.path === "companions.xml") {
      curated[element.id] ??= "companion stat block the 2014 familiar, Beast Master and companion features select from";
    }
  }
  for (const [id, reason] of Object.entries(edition.curatedIds ?? {})) curated[id] ??= reason;
  for (const [id, reason] of Object.entries(edition.excludedIds ?? {})) excluded[id] = reason;
  const keepNames = new Set([...inventoryNames(inventory, "classes"), ...inventoryNames(inventory, "backgrounds")]);
  for (const element of edition.key === "5.2" ? elements : []) {
    if (element.path === "items/items-packs.xml") {
      const owner = /\(([^),]+)/.exec(element.name)?.[1];
      if (owner && keepNames.has(norm(owner))) curated[element.id] ??= `starting equipment pack for an SRD 5.2.1 ${element.type === "Item" ? "class or background" : "entry"}`;
    }
  }
  for (const element of elements) {
    if (!NAMED_TYPES.has(element.type)) continue;
    if (mapped.has(element.id) || curated[element.id] || excluded[element.id]) continue;
    excluded[element.id] = existing?.excluded?.[element.id] ?? `not in ${edition.title}`;
  }
  // Whole-file exclusions are listed too, so the map alone accounts for every
  // named element of the corpus.
  for (const element of elementsOf(corpus)) {
    if (element.type === "Source") continue; // the corpus Source is replaced by the authored one, not excluded
    if (EXCLUDED_FILES[element.path] && NAMED_TYPES.has(element.type) && !excluded[element.id]) excluded[element.id] = EXCLUDED_FILES[element.path];
  }
  const map = {
    schemaVersion: 1,
    inventoryDigest: sha256(await readFile(INVENTORY_PATH, "utf8")),
    corpusCommit: corpusProvenance.commit,
    excludedFiles: EXCLUDED_FILES,
    renames,
    edits: existing?.edits ?? {},
    toleratedEmptySelects: existing?.toleratedEmptySelects ?? {},
    unmappedChapters: {
      ...edition.unmappedChapters,
      ...edition.unmatchedReasons,
      ...(existing?.unmappedChapters ?? {}),
    },
    unmatchedInventory,
    entries,
    curated,
    excluded,
  };
  await writeFile(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`entries ${Object.keys(entries).length}, curated ${Object.keys(curated).length}, excluded ${Object.keys(excluded).length}, unmatched inventory ${Object.keys(unmatchedInventory).length}`);
  for (const [key, reason] of Object.entries(unmatchedInventory)) console.log(`  unmatched: ${key} — ${reason}`);
}

// -------------------------------------------------------------------- build

function renameRegex(from) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[’']/g, "[’']");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

function applyRenames(text, renames) {
  let out = text;
  for (const [from, to] of Object.entries(renames)) {
    out = out.replace(renameRegex(from), (match) => {
      const words = match.split(/\s+/);
      const rest = words.slice(1).join(" ");
      if (rest && rest === rest.toUpperCase() && /[A-Z]/.test(rest)) return to.toUpperCase();
      if (rest && rest === rest.toLowerCase()) return to.toLowerCase();
      return to;
    });
  }
  return out;
}

function applyEdits(text, edits, path) {
  let out = text;
  for (const [key, edit] of Object.entries(edits)) {
    if (edit.file !== path) continue;
    if (!out.includes(edit.from)) throw new Error(`edit ${key}: text not found in ${path}`);
    out = out.split(edit.from).join(edit.to);
  }
  return out;
}

/**
 * The SRD prints classes, species and backgrounds without the handbook's
 * introductory prose: a class entry opens with its Core Traits table, a
 * species with its traits list, a background with its ability scores. Those
 * paragraphs are the publisher's, so they are trimmed from the element
 * descriptions here. Subclasses keep their prose; the SRD carries it.
 */
export function trimDescription(element) {
  const source = element.source;
  const open = source.indexOf("<description>");
  const close = source.indexOf("</description>");
  if (open === -1 || close === -1) return { source, trimmed: 0 };
  const body = source.slice(open + "<description>".length, close);
  let next = body;
  const rule = edition.trims[element.type];
  if (rule === undefined) return { source, trimmed: 0 };
  if (rule !== "trailing-flavor") {
    const anchor = typeof rule === "string" ? body.indexOf(rule) : body.search(rule);
    if (anchor === -1) throw new Error(`${element.path}: ${element.id} has no ${String(rule)} anchor to trim before`);
    next = `\n${body.slice(body.lastIndexOf("\n", anchor) + 1)}`;
  } else if (element.type === "Background") {
    // Flavor follows the traits list and precedes the feat reference.
    next = body.replace(/(<\/ul>\s*)(?:<p(?:\s[^>]*)?>[\s\S]*?<\/p>\s*)+(?=<div class="reference">|$)/, "$1");
    if (next === body) throw new Error(`${element.path}: ${element.id} has no trailing flavor paragraph to trim`);
  } else return { source, trimmed: 0 };
  const removed = body.length - next.length;
  return { source: `${source.slice(0, open + "<description>".length)}${next}${source.slice(close)}`, trimmed: removed > 0 ? 1 : 0 };
}

const relativeSrd = (path) => path.slice(ROOT.length + 1);

let shippedCache;
/** Elements the browser already ships (baseline files plus system files), by id. */
async function shippedElements() {
  if (shippedCache) return shippedCache;
  const elements = new Map();
  const { PUBLIC_BASE_PATHS } = await import(join(ROOT, "apps", "client", "config", "contentProfile.mjs"));
  const sources = [];
  const generatedPrefix = `${edition.outputDir}/`;
  for (const name of PUBLIC_BASE_PATHS) {
    if (name.startsWith(generatedPrefix) && !edition.authored.test(name.slice(generatedPrefix.length))) continue;
    sources.push(join(CONTENT_DIR, name));
  }
  for (const name of ["system-proxies.xml", "system-unarmed-riders.xml", "system-elements-extended.xml"]) sources.push(join(SYSTEM_DIR, name));
  for (const full of sources) {
    if (!existsSync(full)) continue;
    const text = await readFile(full, "utf8");
    let scanned;
    try {
      scanned = scanFile(text, full);
    } catch {
      // Not every shipped file is a plain <elements> document; fall back to ids only.
      for (const match of text.matchAll(/<element\b[^>]*\sid="([^"]*)"/g)) elements.set(match[1], { id: match[1], type: "", supports: [], level: undefined });
      continue;
    }
    for (const node of scanned.nodes) if (node.kind === "element" && node.id) elements.set(node.id, node);
    for (const node of scanned.nodes) {
      if (node.kind !== "append") continue;
      const target = elements.get(node.id);
      if (target) target.supports = [...target.supports, ...node.supports];
    }
  }
  shippedCache = elements;
  return elements;
}

async function shippedIds() {
  return new Set((await shippedElements()).keys());
}

async function buildOutputs(corpus, map) {
  const keepIds = new Set([...Object.values(map.entries).flat(), ...Object.keys(map.curated)]);
  const shipped = await shippedElements();
  const elements = elementsOf(corpus).filter(
    (element) =>
      !EXCLUDED_FILES[element.path] &&
      !((DEPENDENCY_FILES[element.path] || edition.skipShippedIds) && shipped.has(element.id)),
  );
  const byId = new Map(elements.map((element) => [element.id, element]));
  const retained = new Set();
  const report = { droppedNamed: [], droppedOwned: [], tierAWouldDrop: [], unresolvedGrants: [], emptySelects: [], denylist: [], trimmed: 0 };

  // Roots: named-type elements the map keeps. Everything else is kept only
  // when a retained element owns it — by grant id, or by a select whose
  // supports expression the candidate satisfies.
  const roots = elements.filter((element) => keepIds.has(element.id) && !map.excluded[element.id] && !DEPENDENCY_FILES[element.path]);
  const queue = [...roots];
  const candidatesByType = new Map();
  for (const element of elements) {
    if (!candidatesByType.has(element.type)) candidatesByType.set(element.type, []);
    candidatesByType.get(element.type).push(element);
  }
  while (queue.length > 0) {
    const element = queue.pop();
    if (retained.has(element.id)) continue;
    retained.add(element.id);
    for (const grantId of element.grants) {
      const target = byId.get(grantId);
      if (target && !retained.has(target.id) && !map.excluded[target.id]) queue.push(target);
    }
    // Requirement markers ("!ID_INTERNAL_GRANTS_TIEFLING_SUBRACE") are kept
    // with the element that tests them; other content grants them.
    for (const requiredId of element.requirements) {
      const target = byId.get(requiredId);
      if (target && !NAMED_TYPES.has(target.type) && !retained.has(target.id) && !map.excluded[target.id]) queue.push(target);
    }
    for (const select of element.selects) {
      if (!select.supports || select.supports.includes("$(")) continue;
      for (const candidate of candidatesByType.get(select.type) ?? []) {
        if (retained.has(candidate.id) || map.excluded[candidate.id]) continue;
        if (NAMED_TYPES.has(candidate.type) && !keepIds.has(candidate.id)) continue;
        if (evaluateSupports(select.supports, tagSet(candidate))) queue.push(candidate);
      }
    }
  }

  const outputs = new Map();
  const denylist = (await readJson(DENYLIST_PATH)).patterns.map((pattern) => new RegExp(pattern, "i"));
  const corpusCommit = map.corpusCommit;
  for (const [path, file] of corpus) {
    if (EXCLUDED_FILES[path]) continue;
    const dependencyOf = file.dependency ? "core/internal.xml (engine-level Internal elements the 2024 content grants)" : null;
    const kept = [];
    let dropped = 0;
    for (const node of file.nodes) {
      if (node.kind === "comment" || node.kind === "text") continue;
      if (node.kind === "info") {
        kept.push(node);
        continue;
      }
      if (node.kind === "append") {
        // An append ships only when its target exists and everything it
        // references is retained: the excluded subclasses and firearms patch
        // retained class features and proficiencies with their own ids.
        const targetRetained = retained.has(node.id) || (await shippedIds()).has(node.id);
        const referenced = [...node.source.matchAll(/ID_[A-Z0-9_]+/g)].map((match) => match[0]).filter((id) => id !== node.id);
        const referencesDropped = referenced.some((id) => byId.has(id) && !retained.has(id));
        if (targetRetained && !referencesDropped) kept.push(node);
        else dropped += 1;
        continue;
      }
      // Support elements are category definitions (poison delivery types);
      // they belong with any file that still has content.
      const keep = retained.has(node.id) || (node.type === "Support" && kept.some((other) => other.kind === "element" || retained.has(other.id)) && !map.excluded[node.id]);
      if (keep && !retained.has(node.id)) retained.add(node.id);
      if (keep) kept.push(node);
      else if (TIER_A.has(path)) {
        report.tierAWouldDrop.push(`${path}: ${node.type} ${node.id}`);
        kept.push(node);
        retained.add(node.id);
      } else {
        dropped += 1;
        (NAMED_TYPES.has(node.type) ? report.droppedNamed : report.droppedOwned).push(`${path}: ${node.type} "${node.name}" ${node.id}`);
      }
    }
    if (kept.every((node) => node.kind === "info")) continue;
    let text = "";
    for (const node of kept) {
      if (node.kind === "element" && edition.trims[node.type] !== undefined) {
        const { source, trimmed } = trimDescription(node);
        report.trimmed += trimmed;
        text += `${node.leading}${source}`;
      } else text += `${node.leading}${node.source}`;
    }
    text = applyEdits(applyRenames(text, map.renames), map.edits, path);
    const header =
      `${file.prologue.replace(/<elements[^>]*>$/, "")}` +
      `<!--\n\t${edition.title} subset of ${dependencyOf ?? path} from\n` +
      `\t${edition.sourceLabel} (commit ${corpusCommit}), generated by\n` +
      `\tscripts/build-srd-content.mjs. Do not edit by hand: change\n` +
      `\t${relativeSrd(MAP_PATH)} and regenerate.\n` +
      `\tRetained ${kept.filter((node) => node.kind !== "info").length} of ${file.nodes.filter((node) => node.kind === "element" || node.kind === "append").length} blocks; dropped ${dropped}.\n-->\n` +
      `${/<elements[^>]*>$/.exec(file.prologue)?.[0] ?? "<elements>"}`;
    // Emit LF only: a few corpus files carry CRLF, and the repository
    // normalises line endings, so CRLF output would drift on checkout.
    const output = `${header}${text}\n${file.epilogue.trimEnd()}\n`.replace(/\r\n?/g, "\n");
    for (const pattern of denylist) {
      for (const hit of output.matchAll(new RegExp(pattern.source, "gi"))) {
        report.denylist.push(`${path}: ${JSON.stringify(hit[0])} in ${JSON.stringify(output.slice(Math.max(0, hit.index - 70), hit.index + 50).replace(/\s+/g, " "))}`);
      }
    }
    outputs.set(path, output);
  }

  if (edition.generatedDeities) {
    outputs.set("deities.xml", generateDeities(await readJson(INVENTORY_PATH)));
  }

  // Referential integrity against the retained set plus the shipped baseline.
  const known = new Set([...retained, ...(await shippedIds())]);
  const retainedElements = elements.filter((element) => retained.has(element.id));
  for (const element of retainedElements) {
    for (const grantId of element.grants) if (!known.has(grantId)) report.unresolvedGrants.push(`${element.path}: ${element.id} grants ${grantId}`);
    for (const select of element.selects) {
      if (!select.supports || select.supports.includes("$(") || select.type === "List") continue;
      // A select gated on an id nothing ships can never activate (optional-rule
      // options from other books); its candidates are that book's concern.
      if (select.requires.some((id) => !known.has(id))) continue;
      if (select.optional) continue;
      if (map.toleratedEmptySelects?.[element.id]) continue;
      // Improvement options (the level-4/8/... ability score increase or feat
      // choice) are generated at ingest by the engine, not defined in files.
      if (/\bImprovement Option\b/.test(select.supports)) continue;
      const pool = [
        ...(candidatesByType.get(select.type) ?? []).filter((candidate) => retained.has(candidate.id)),
        ...[...shipped.values()].filter((candidate) => candidate.type === select.type),
      ];
      const candidates = pool.filter((candidate) => evaluateSupports(select.supports, tagSet(candidate)));
      if (candidates.length === 0) report.emptySelects.push(`${element.path}: ${element.id} select ${select.type} "${select.name ?? ""}" supports=${select.supports}`);
    }
  }
  return { outputs, report, retained };
}

const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The document's Fantasy-Historical Pantheons, as Deity elements in the
 * shape the content format uses (description, setting, alignment, domains,
 * symbol). Their ids are the document's own; the corpus pantheon is not SRD
 * content and is not published.
 */
function generateDeities(inventory) {
  const rows = [...inventory.chapters.deities].sort((a, b) => a.pantheon.localeCompare(b.pantheon) || a.name.localeCompare(b.name));
  const idOf = (row) => `ID_SRD_DEITY_${row.pantheon}_${row.name}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_+$/, "");
  const element = (row) => {
    const description = row.description.replace(/^[^,]+, /, "");
    return `\t<element name="${escapeXml(row.name)}" type="Deity" source="System Reference Document" id="${idOf(row)}">
\t\t<description>
\t\t\t<p class="flavor">${escapeXml(description)}</p>
\t\t</description>
\t\t<setters>
\t\t\t<set name="setting">${escapeXml(row.pantheon)}</set>
\t\t\t<set name="alignment">${escapeXml(row.alignment)}</set>
\t\t\t<set name="domains">${escapeXml(row.domains)}</set>
\t\t\t<set name="symbol">${escapeXml(row.symbol)}</set>
\t\t</setters>
\t\t<sheet>
\t\t\t<description>${escapeXml(description)}</description>
\t\t</sheet>
\t</element>`;
  };
  return `<?xml version="1.0" encoding="utf-8" ?>
<!--
\tSystem Reference Document 5.1 deities: the Celtic, Greek, Egyptian and Norse
\tpantheons from the document's Fantasy-Historical Pantheons tables, generated by
\tscripts/build-srd-content.mjs from third-party/srd-5.1/srd-5.1.inventory.json.
\tDo not edit by hand.
-->
<elements>
${rows.map(element).join("\n\n")}
</elements>
`;
}

/** The generated files currently committed under the edition's output directory. */
async function existingOutputs() {
  const out = new Map();
  if (!existsSync(OUTPUT_DIR)) return out;
  for (const name of await xmlFiles(OUTPUT_DIR)) {
    if (!edition.authored.test(name)) out.set(name, await readFile(join(OUTPUT_DIR, name), "utf8"));
  }
  return out;
}

async function writeOutput(name, text) {
  await mkdir(dirname(join(OUTPUT_DIR, name)), { recursive: true });
  await writeFile(join(OUTPUT_DIR, name), text);
}

function printReport(report, retained) {
  console.log(`retained ${retained.size} elements`);
  console.log(`dropped named-type elements: ${report.droppedNamed.length}`);
  console.log(`dropped owned elements: ${report.droppedOwned.length}`);
  console.log(`descriptions trimmed of handbook-only prose: ${report.trimmed}`);
  if (report.tierAWouldDrop.length) {
    console.log(`tier A elements kept without an owner (review): ${report.tierAWouldDrop.length}`);
    report.tierAWouldDrop.forEach((line) => console.log(`  ${line}`));
  }
  if (report.unresolvedGrants.length) {
    console.log(`UNRESOLVED GRANTS: ${report.unresolvedGrants.length}`);
    report.unresolvedGrants.forEach((line) => console.log(`  ${line}`));
  }
  if (report.emptySelects.length) {
    console.log(`SELECTS WITH NO RETAINED CANDIDATE: ${report.emptySelects.length}`);
    report.emptySelects.forEach((line) => console.log(`  ${line}`));
  }
  if (report.denylist.length) {
    console.log(`DENYLIST HITS: ${report.denylist.length}`);
    report.denylist.forEach((line) => console.log(`  ${line}`));
  }
  if (args.has("--verbose")) {
    report.droppedNamed.forEach((line) => console.log(`  dropped: ${line}`));
    report.droppedOwned.forEach((line) => console.log(`  dropped(owned): ${line}`));
  }
}

// --------------------------------------------------------------------- main

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

async function run(key) {
  selectEdition(key);
  const corpus = await loadCorpus();
  if (command === "draft-map") {
    await draftMap(corpus, await readJson(INVENTORY_PATH));
    return true;
  }
  const map = await readJson(MAP_PATH);
  const inventoryDigest = sha256(await readFile(INVENTORY_PATH, "utf8"));
  if (map.inventoryDigest !== inventoryDigest) throw new Error(`${relativeSrd(MAP_PATH)} was reviewed against a different inventory; run draft-map and re-review`);
  const { outputs, report, retained } = await buildOutputs(corpus, map);
  console.log(`== ${edition.title} ==`);
  printReport(report, retained);
  const failures = report.unresolvedGrants.length + report.emptySelects.length + report.denylist.length;
  let ok = failures === 0;
  if (command === "build") {
    for (const [name] of await existingOutputs()) if (!outputs.has(name)) await unlink(join(OUTPUT_DIR, name));
    for (const [name, text] of outputs) await writeOutput(name, text);
    console.log(`wrote ${outputs.size} files`);
  } else {
    const existing = await existingOutputs();
    let drift = 0;
    for (const [name, text] of outputs) if (existing.get(name) !== text) { drift += 1; console.log(`drift: ${name}`); }
    for (const name of existing.keys()) if (!outputs.has(name)) { drift += 1; console.log(`stale: ${name}`); }
    if (drift) { console.error(`${drift} file(s) differ from the generator output`); ok = false; }
    else console.log("committed output matches the generator");
  }
  if (failures) console.error("integrity failures");
  return ok;
}

if (!isMain) {
  // Imported for its scanner, supports evaluator and edition table (tests, debugging).
} else if (command === "draft-map" || command === "build" || command === "check") {
  const keys = !editionArg || editionArg === "all" ? ["5.1", "5.2"] : [editionArg];
  if (command === "draft-map" && keys.length !== 1) throw new Error("draft-map needs --edition 5.1 or 5.2");
  let ok = true;
  for (const key of keys) ok = (await run(key)) && ok;
  if (!ok) process.exit(1);
} else {
  console.error("usage: build-srd-content.mjs <draft-map|build|check> --edition 5.1|5.2|all [--verbose]");
  process.exit(2);
}
