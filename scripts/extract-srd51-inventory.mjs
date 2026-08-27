#!/usr/bin/env node
/**
 * Extract the entity inventory of System Reference Document 5.1 (the 2014
 * rules) from the published PDF, as reviewable JSON.
 *
 *   node scripts/extract-srd51-inventory.mjs [--pdf <path>] [--report] [--out <path>]
 *
 * Same contract as extract-srd-inventory.mjs (the 5.2.1 extractor): the PDF
 * is pinned by sha256 in third-party/srd-5.1/srd-5.1.provenance.json and is
 * refused on mismatch; without --pdf the pinned URL is downloaded into
 * node_modules/.cache. Manual derivation step only.
 *
 * The 5.1 PDF has no outline, so sections come from its large headings
 * (chapter titles at ~26pt, sections at 18pt). Entries are 12pt headings
 * followed by a chapter-specific subtitle ("2nd-level evocation (ritual)",
 * "Wondrous item, rare", "As a hill dwarf, ..."). Deities come from the
 * Fantasy-Historical Pantheons tables. Monsters are not inventoried.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPdfHelpers } from "./lib/srd-pdf.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVENANCE_PATH = join(ROOT, "third-party", "srd-5.1", "srd-5.1.provenance.json");
const DEFAULT_OUT = join(ROOT, "third-party", "srd-5.1", "srd-5.1.inventory.json");
const CACHE_PDF = join(ROOT, "node_modules", ".cache", "dm-forge", "SRD-OGL_V5.1.pdf");

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
    throw new Error(`PDF does not match the pinned SRD 5.1: got ${bytes.byteLength} bytes / ${sha256}`);
  }
  return bytes;
}

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: await loadPdfBytes(), verbosity: 0 }).promise;
if (doc.numPages !== provenance.pages) throw new Error(`expected ${provenance.pages} pages, got ${doc.numPages}`);

const warnings = [];
const { pageLines, lineText, headingText, headingEntries, tableRows } = createPdfHelpers(doc, { warnings });

// The PDF's soft and non-breaking hyphens ("1st-­‐‑level") normalise to "-".
const tidy = (text) => text.replace(/[­‐‑‒–−]+/g, "-").replace(/-{2,}/g, "-");

// ------------------------------------------------------------- sections

/** Every heading set at 17pt or larger, in page order: chapter and section titles. */
const sections = [];
for (let page = 1; page <= doc.numPages; page += 1) {
  for (const line of (await pageLines(page)).columns) {
    const size = Math.max(...line.items.map((item) => item.size));
    if (size >= 17) sections.push({ title: lineText(line), page, size, column: line.column, y: line.y });
  }
}
const sectionPage = (title, after = 0) => {
  const hit = sections.find((section) => section.title === title && section.page >= after);
  if (!hit) throw new Error(`section heading not found: ${title}`);
  return hit.page;
};
const between = (fromTitle, toTitle) => [sectionPage(fromTitle), sectionPage(toTitle, sectionPage(fromTitle))];

const RACES_RANGE = between("Races", "Barbarian");
const CLASSES_RANGE = between("Barbarian", "Beyond 1st Level");
const SUBCLASS_SECTION = /(Archetypes|Traditions|Oaths|Origins|Patrons|Domains|Circles|Colleges|Paths)$/;

// Race names are 18pt sections under the 26pt "Races" chapter title; each
// class is its own 26pt chapter title with 18pt sections inside it.
const races = sections
  .filter((section) => section.size < 20 && section.page >= RACES_RANGE[0] && section.page < RACES_RANGE[1] && section.title !== "Races")
  .map((section) => ({ name: section.title, page: section.page }));
const classes = sections
  .filter((section) => section.size >= 20 && section.page >= CLASSES_RANGE[0] && section.page < CLASSES_RANGE[1])
  .map((section) => ({ name: section.title, page: section.page }));

/**
 * One subclass per class. Eight classes open their subclass with an 18pt
 * section ("Martial Archetypes"); the first 14pt heading after it is the
 * subclass. The other four print the subclass straight after the class
 * features, so it is found by the naming convention of the slot feature the
 * class lists ("Primal Path" -> "Path of ...", "Bard College" -> "College of
 * ...", "Divine Domain" -> "... Domain", "Druid Circle" -> "Circle of ...").
 */
const SLOT_CONVENTIONS = [
  ["Primal Path", /^Path of /],
  ["Bard College", /^College of /],
  ["Divine Domain", / Domain$/],
  ["Druid Circle", /^Circle of /],
];
async function subclasses() {
  const out = [];
  for (let index = 0; index < classes.length; index += 1) {
    const cls = classes[index];
    const end = index + 1 < classes.length ? classes[index + 1].page : CLASSES_RANGE[1];
    const lines = [];
    for (let page = cls.page; page < end; page += 1) lines.push(...(await pageLines(page)).columns);
    const section = sections.find((entry) => SUBCLASS_SECTION.test(entry.title) && entry.page >= cls.page && entry.page < end);
    let name;
    if (section) {
      const start = lines.findIndex((line) => line.page === section.page && line.column === section.column && line.y === section.y);
      name = lines.slice(start + 1).map((line) => headingText(line, 14)).find(Boolean);
    } else {
      const headings = lines.map((line) => headingText(line, 14)).filter(Boolean);
      const convention = SLOT_CONVENTIONS.find(([slot]) => headings.includes(slot));
      name = convention ? headings.find((heading) => heading !== convention[0] && convention[1].test(heading)) : undefined;
    }
    if (name) out.push({ name, class: cls.name, page: cls.page });
    else warnings.push({ chapter: "Subclasses", page: cls.page, issue: "no subclass heading found", text: cls.name, next: "" });
  }
  return out;
}

/** Backgrounds: 14pt headings after the "Backgrounds" section whose entry lists skill proficiencies. */
async function backgroundEntries() {
  const out = [];
  const from = sectionPage("Backgrounds");
  const to = sectionPage("Equipment") - 1;
  const lines = [];
  for (let page = from; page <= to; page += 1) lines.push(...(await pageLines(page)).columns);
  const startIndex = lines.findIndex((line) => lineText(line) === "Backgrounds");
  for (let index = Math.max(startIndex, 0); index < lines.length; index += 1) {
    const heading = headingText(lines[index], 14);
    if (!heading || /Inspiration|Characteristics|Background/.test(heading)) continue;
    const following = lines.slice(index + 1, index + 40).map(lineText);
    if (following.some((text) => /^Skill Proficiencies/.test(text))) out.push({ name: heading, page: lines[index].page });
  }
  return out;
}

const subraces = await headingEntries({
  chapter: "Subraces",
  from: RACES_RANGE[0],
  to: RACES_RANGE[1] - 1,
  subtitle: /^As an? /,
});
const invocations = await headingEntries({
  chapter: "Eldritch Invocations",
  from: sectionPage("Eldritch Invocations"),
  to: sectionPage("Otherworldly Patrons"),
  subtitle: /^[A-Z]/,
});
const backgrounds = await backgroundEntries();
const feats = await headingEntries({
  chapter: "Feats",
  from: sectionPage("Feats"),
  to: sectionPage("Feats"),
  size: 14,
  subtitle: /^(Prerequisite|You)/,
});
const COST_51 = /^\s*\d[\d,]*\s*(cp|sp|ep|gp|pp)\s*$/i;
const equipmentRows = [
  ...(await tableRows({ from: sectionPage("Armor"), to: sectionPage("Trade Goods"), stopHeading: "Trade Goods", costPattern: COST_51 })),
  // The Poisons table (price per dose) lives with the other hazards, not in Equipment.
  ...(await tableRows({ from: sectionPage("Poisons"), to: sectionPage("Poisons") + 1, costPattern: COST_51 })),
];
const spells = (
  await headingEntries({
    chapter: "Spells",
    from: sectionPage("Spell Descriptions"),
    to: sectionPage("Traps"),
    subtitle: /^(\d(?:st|nd|rd|th)[­‐‑‒–-]*level [a-z]+|[a-z]+ cantrip)/i,
  })
).map((entry) => ({ ...entry, subtitle: tidy(entry.subtitle) }));
const magicItems = await headingEntries({
  chapter: "Magic Items",
  from: sectionPage("Magic Items A-Z"),
  to: sectionPage("Monsters"),
  subtitle: /^(Wondrous item|Armor|Weapon|Potion|Ring|Rod|Staff|Wand|Scroll)\b/i,
});

/** Fantasy-Historical Pantheons: rows of "Name, god of X | alignment | domains | symbol". */
async function deities() {
  const out = [];
  const pantheon = /^(Celtic|Greek|Egyptian|Norse) Deities$/;
  let current = null;
  for (let page = 1; page <= doc.numPages; page += 1) {
    const { whole } = await pageLines(page);
    const pageHasPantheon = whole.some((line) => pantheon.test(lineText(line)));
    if (!pageHasPantheon && current === null) continue;
    for (const line of whole) {
      const text = lineText(line);
      const heading = pantheon.exec(text);
      if (heading) {
        current = heading[1];
        continue;
      }
      if (current === null) continue;
      const cells = line.items.map((item) => item.text.trim()).filter(Boolean);
      const match = /^([A-Z][A-Za-z' -]+?), (?:god|goddess|deity) of (.+)$/.exec(cells[0] ?? "");
      if (!match) continue;
      out.push({ name: match[1].trim(), pantheon: current, description: cells[0], alignment: cells[1] ?? "", domains: cells[2] ?? "", symbol: cells.slice(3).join(" "), page });
    }
    if (current !== null && !pageHasPantheon && !whole.some((line) => /, (god|goddess) of /.test(lineText(line)))) current = null;
  }
  return out;
}
const deityRows = await deities();

const sortByName = (entries) => [...entries].sort((a, b) => a.name.localeCompare(b.name, "en"));
const inventory = {
  schemaVersion: 1,
  source: { title: provenance.title, url: provenance.url, sha256: provenance.sha256, bytes: provenance.bytes, pages: provenance.pages },
  generator: "scripts/extract-srd51-inventory.mjs",
  chapters: {
    classes,
    subclasses: sortByName(await subclasses()),
    backgrounds: sortByName(backgrounds),
    races,
    subraces: sortByName(subraces),
    feats: sortByName(feats),
    eldritchInvocations: sortByName(invocations),
    equipment: sortByName(equipmentRows),
    spells: sortByName(spells),
    magicItems: sortByName(magicItems),
    deities: sortByName(deityRows),
  },
  warnings: warnings.sort((a, b) => a.page - b.page || a.text.localeCompare(b.text, "en")),
};
await writeFile(outPath, `${JSON.stringify(inventory, null, 2)}\n`);
if (report) {
  for (const [key, value] of Object.entries(inventory.chapters)) console.log(`${key.padEnd(22)} ${String(value.length).padStart(5)}`);
  console.log(`${"warnings".padEnd(22)} ${String(warnings.length).padStart(5)}`);
}
console.error(`wrote ${outPath}`);
