#!/usr/bin/env node
/**
 * Extract the entity inventory of System Reference Document 5.2.1 from the
 * published PDF, as reviewable JSON.
 *
 *   node scripts/extract-srd-inventory.mjs [--pdf <path>] [--report] [--out <path>]
 *
 * The PDF is pinned by sha256 in third-party/srd-5.2/srd-5.2.1.provenance.json
 * and is refused on mismatch, so the committed inventory is reproducible.
 * Without --pdf the pinned URL is downloaded into node_modules/.cache. This
 * is a manual derivation step, never part of the build or test gates; the
 * committed inventory is what the content generator and its tests read.
 *
 * Method: chapter and section boundaries come from the PDF outline. Within
 * a chapter, entries are found by page layout — the SRD sets entry headings
 * at 12pt (stat-block names at 15pt), each directly followed by a subtitle
 * line whose shape is chapter-specific ("Level 2 Evocation (Wizard)",
 * "Origin Feat", "Wondrous Item, Rare", "Large Aberration, Lawful Evil").
 * Both signals must agree; a line matching only one is recorded under
 * `warnings` for review. Equipment is tabular and is read from table rows
 * that carry a coin cost.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPdfHelpers } from "./lib/srd-pdf.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVENANCE_PATH = join(ROOT, "third-party", "srd-5.2", "srd-5.2.1.provenance.json");
const DEFAULT_OUT = join(ROOT, "third-party", "srd-5.2", "srd-5.2.1.inventory.json");
const CACHE_PDF = join(ROOT, "node_modules", ".cache", "dm-forge", "SRD_CC_v5.2.1.pdf");

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : (args[index + 1] ?? true);
};
const pdfPath = flag("--pdf");
const outPath = flag("--out") ?? DEFAULT_OUT;
const report = args.includes("--report");

const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));

async function loadPdfBytes() {
  let path = typeof pdfPath === "string" ? resolve(pdfPath) : CACHE_PDF;
  if (!existsSync(path)) {
    if (typeof pdfPath === "string") throw new Error(`PDF not found: ${path}`);
    console.error(`downloading ${provenance.url}`);
    const response = await fetch(provenance.url);
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
  const bytes = new Uint8Array(await readFile(path));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== provenance.bytes || sha256 !== provenance.sha256) {
    throw new Error(
      `PDF does not match the pinned SRD 5.2.1: got ${bytes.byteLength} bytes / ${sha256}, ` +
        `expected ${provenance.bytes} / ${provenance.sha256}`,
    );
  }
  return bytes;
}

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: await loadPdfBytes(), verbosity: 0 }).promise;
if (doc.numPages !== provenance.pages) throw new Error(`expected ${provenance.pages} pages, got ${doc.numPages}`);

// ---------------------------------------------------------------- outline

/** Flattened outline: [{ title, page, depth, children }] */
async function readOutline() {
  const flat = [];
  const walk = async (items, depth, parent) => {
    for (const item of items ?? []) {
      const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
      let page = null;
      try {
        page = (await doc.getPageIndex(dest[0])) + 1;
      } catch {
        page = null;
      }
      const node = { title: item.title.trim(), page, depth, parent, children: [] };
      flat.push(node);
      parent?.children.push(node);
      await walk(item.items, depth + 1, node);
    }
  };
  await walk(await doc.getOutline(), 0, null);
  return flat;
}
const outline = await readOutline();
const section = (title) => {
  const node = outline.find((entry) => entry.title === title);
  if (!node || node.page === null) throw new Error(`outline entry not found: ${title}`);
  return node;
};
const pageOf = (title) => section(title).page;
const childTitles = (title) => section(title).children.map((child) => child.title);

// ------------------------------------------------------------------ pages

const warnings = [];
const { pageLines, lineText, headingEntries, tableRows } = createPdfHelpers(doc, { warnings });

// --------------------------------------------------------------- chapters

const classesNode = section("Classes");
const classNames = classesNode.children.map((child) => child.title);
const subclasses = outline
  .filter((entry) => /^\w+ Subclass: /.test(entry.title))
  .map((entry) => ({ name: entry.title.replace(/^\w+ Subclass: /, ""), class: entry.title.replace(/ Subclass: .*$/, ""), page: entry.page }));

const spells = await headingEntries({
  chapter: "Spells",
  from: pageOf("Spell Descriptions"),
  to: pageOf("Rules Glossary"),
  subtitle: /^(Level \d+ [A-Z]\w+|[A-Z]\w+ Cantrip)\b/,
  skip: /^Level \d+:/,
});
const feats = await headingEntries({
  chapter: "Feats",
  from: pageOf("Feat Descriptions"),
  to: pageOf("Equipment"),
  subtitle: /^(Origin|General|Fighting Style|Epic Boon) Feat\b/,
  skip: /^Level \d+:/,
});
const magicItems = await headingEntries({
  chapter: "Magic Items",
  from: pageOf("Magic Items A–Z"),
  to: pageOf("Monsters A–Z"),
  subtitle: /^(Wondrous Item|Armor|Weapon|Potion|Ring|Rod|Staff|Wand|Scroll)\b/,
  skip: /^Level \d+:/,
});
// Option sections: 12pt headings whose subtitle is ordinary body text. The
// class-feature headings interleaved in the other page column all read
// "Level N: ..." and are skipped; the section title itself is set larger.
const metamagic = await headingEntries({
  chapter: "Metamagic Options",
  from: pageOf("Metamagic Options"),
  to: pageOf("Sorcerer Spell List"),
  subtitle: /^[A-Z]/,
  skip: /^Level \d+:|Spell List$/,
});
const invocations = await headingEntries({
  chapter: "Eldritch Invocation Options",
  from: pageOf("Eldritch Invocation Options"),
  to: pageOf("Warlock Spell List"),
  subtitle: /^[A-Z]/,
  skip: /^Level \d+:|Spell List$/,
});
const statBlocks = async (chapter, from, to) =>
  headingEntries({
    chapter,
    from,
    to,
    size: 15,
    subtitle: /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/,
  });
const animals = await statBlocks("Animals", pageOf("Animals"), doc.numPages);
const equipmentRows = await tableRows({ from: pageOf("Weapons"), to: pageOf("Lifestyle Expenses"), stopHeading: "Lifestyle Expenses" });
// Tools are not tabulated: each is a 12pt heading carrying its cost,
// "Alchemist's Supplies (50 GP)", followed by Ability/Utilize/Craft lines.
const tools = (
  await headingEntries({
    chapter: "Tools",
    from: pageOf("Tools"),
    to: pageOf("Adventuring Gear"),
    subtitle: /^Ability:/,
    skip: /^Level \d+:/,
  })
).map((entry) => ({ ...entry, cost: /\(([^)]+)\)\s*$/.exec(entry.name)?.[1] ?? "", name: entry.name.replace(/\s*\([^)]*\)\s*$/, "") }));
const equipment = [...equipmentRows, ...tools];
// Weapon properties and mastery properties are interleaved on the same
// pages; a mastery property's text always opens with the hit condition.
const MASTERY_SUBTITLE = /^(If you hit|If your attack roll|When you make the extra attack)/;
const propertyHeadings = await headingEntries({
  chapter: "Weapon Properties",
  from: pageOf("Weapons"),
  to: pageOf("Armor"),
  subtitle: /^[A-Z]/,
  skip: /^Level \d+:|Armor$|^Shield$/,
});
const masteryProperties = propertyHeadings.filter((entry) => MASTERY_SUBTITLE.test(entry.subtitle));
const weaponProperties = propertyHeadings.filter((entry) => !MASTERY_SUBTITLE.test(entry.subtitle));

/**
 * Languages: the Standard Languages and Rare Languages tables in Character
 * Creation. Each row is a die-roll cell followed by the language name.
 */
async function languages() {
  const names = [];
  let page = null;
  const roll = /^(—|\d+(?:–\d+)?)$/;
  for (let candidate = 1; candidate <= 40; candidate += 1) {
    const { columns } = await pageLines(candidate);
    for (let index = 0; index < columns.length; index += 1) {
      if (!/^(Standard|Rare) Languages$/.test(lineText(columns[index]))) continue;
      page ??= candidate;
      for (let row = index + 1; row < columns.length; row += 1) {
        const line = columns[row];
        if (line.column !== columns[index].column) break;
        const [first, ...rest] = line.items;
        if (rest.length === 0 && /^1d\d+$/.test(first.text.trim())) continue;
        if (first.text.trim() === "1d12" || first.text.trim() === "1d8") continue;
        if (!roll.test(first.text.trim()) || rest.length === 0) {
          if (names.length > 0 && !/^Language/.test(lineText(line))) break;
          continue;
        }
        names.push(rest.map((item) => item.text).join("").replace(/\s+/g, " ").trim());
      }
    }
  }
  return { page, names: [...new Set(names)] };
}
const languageTable = await languages();

// ---------------------------------------------------------------- output

const sortByName = (entries) => [...entries].sort((a, b) => a.name.localeCompare(b.name, "en"));
const inventory = {
  schemaVersion: 1,
  source: {
    title: provenance.title,
    url: provenance.url,
    sha256: provenance.sha256,
    bytes: provenance.bytes,
    pages: provenance.pages,
  },
  generator: "scripts/extract-srd-inventory.mjs",
  chapters: {
    classes: classNames.map((name) => ({ name, page: section(name).page })),
    subclasses: sortByName(subclasses),
    backgrounds: childTitles("Character Backgrounds").map((name) => ({ name, page: section(name).page })),
    species: childTitles("Character Species").map((name) => ({ name, page: section(name).page })),
    feats: sortByName(feats),
    metamagicOptions: sortByName(metamagic),
    eldritchInvocations: sortByName(invocations),
    weaponProperties: sortByName(weaponProperties),
    masteryProperties: sortByName(masteryProperties),
    equipment: sortByName(equipment),
    languages: languageTable,
    spells: sortByName(spells),
    magicItems: sortByName(magicItems),
    animals: sortByName(animals),
  },
  warnings: warnings.sort((a, b) => a.page - b.page || a.text.localeCompare(b.text, "en")),
};

await writeFile(outPath, `${JSON.stringify(inventory, null, 2)}\n`);

if (report) {
  const rows = Object.entries(inventory.chapters).map(([key, value]) => [key, Array.isArray(value) ? value.length : value.names.length]);
  for (const [key, count] of rows) console.log(`${key.padEnd(22)} ${String(count).padStart(5)}`);
  console.log(`${"warnings".padEnd(22)} ${String(warnings.length).padStart(5)}`);
}
console.error(`wrote ${outPath}`);
