#!/usr/bin/env node
// perf-sheet-render.mjs — engine-level benchmark for sheet PDF generation.
//
// Renders three fixtures against the real templates and reports the writer's
// own phase breakdown, so a change to the writer can be shown to move the
// number it claims. This is the Node-side counterpart to `perf:choice`, which
// measures the same work end to end through a real browser.
//
// Run `npm run build` first: this imports the compiled engine, not the source.
//
//   npm run perf:sheet
//   npm run perf:sheet -- --set=2024 --runs=9
//   PERF_SHEET_BUDGET_MS=150 npm run perf:sheet   # non-zero exit past the budget

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "packages", "engine", "dist");

const args = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, value = "true"] = arg.slice(2).split("=");
      return [key, value];
    }),
);

const SET = args.get("set") ?? "2014";
const RUNS = Number(args.get("runs") ?? process.env.PERF_SHEET_RUNS ?? 5);
// The slowest fixture's median is what a budget gates on; unset means report only.
const BUDGET_MS = Number(process.env.PERF_SHEET_BUDGET_MS ?? 0);
const EXTRA_SPELLS = Number(args.get("spells") ?? 60);
// The default body face is standard Helvetica, which pdf-lib embeds without
// fontkit. `--body=spectral` renders in a real TTF instead, which is what a
// reader who changed the typeface pays: every embed subsets the face.
const BODY = args.get("body");
// Inventory drives equipment continuation pages, which is where one template
// is drawn several times in a sheet — the case the artwork cache targets.
const EXTRA_ITEMS = Number(args.get("items") ?? 0);

if (!["2014", "2024"].includes(SET)) {
  console.error(`[perf:sheet] unknown template set "${SET}" — expected 2014 or 2024`);
  process.exit(2);
}

const { buildCorpusLibrary } = await import(join(DIST, "testing", "corpus.js"));
const { localTemplateBundle } = await import(join(DIST, "testing", "sheet-bundle.js"));
const { buildFullSheetCharacter, buildRogue5 } = await import(join(DIST, "testing", "character-factory.js"));
const { buildCharacterSheetModel } = await import(join(DIST, "sheet", "model.js"));
const { writeCharacterSheetPdfWithTemplateBundle } = await import(join(DIST, "sheet", "pdf.js"));

const library = await buildCorpusLibrary();
const { DEFAULT_SHEET_FONTS } = await import(join(DIST, "sheet", "template-contract.js"));
const fonts = BODY === undefined
  ? DEFAULT_SHEET_FONTS
  : { ...DEFAULT_SHEET_FONTS, body: BODY, numbers: BODY };
const bundle = localTemplateBundle(SET, fonts);

/**
 * Spell ids the corpus knows. Library elements carry their type in the id
 * rather than a field, and the model resolves the rest from the library, so an
 * id and a display name are all a benchmark fixture has to supply.
 */
function spellIds(count) {
  const ids = [];
  for (const id of library.byId.keys()) {
    if (!/^ID_[A-Z0-9]+_SPELL_[A-Z0-9_]+$/.test(id)) continue;
    ids.push(id);
    if (ids.length >= count) break;
  }
  return ids;
}

/**
 * The card-heavy fixture. Additional spells are the writer's worst case: each
 * one earns a description card, and nine cards fill a page.
 */
function withExtraSpells(state, count) {
  if (state.magic === null) return state;
  for (const id of spellIds(count)) {
    state.magic.additional.push({
      name: id.split("_SPELL_")[1].replaceAll("_", " "),
      level: "1",
      id,
      source: "Benchmark",
    });
  }
  return state;
}

/** Repeats the character's first item until the inventory spills onto more pages. */
function withExtraItems(state, count) {
  const template = state.items[0];
  if (template === undefined) return state;
  for (let index = 0; index < count; index += 1) {
    state.items.push({ ...template, adorners: [], amount: 1, equipped: false, attuned: false });
  }
  return state;
}

const fixtures = [
  {
    name: "rogue5 (lite)",
    model: () => buildCharacterSheetModel(buildRogue5(library, "perf-rogue").state, library, { mode: "lite" }),
  },
  {
    name: "full sheet",
    model: () => buildCharacterSheetModel(buildFullSheetCharacter(library, "perf-full").state, library, { mode: "full" }),
  },
  {
    name: "full sheet +120 items",
    model: () => buildCharacterSheetModel(
      withExtraItems(buildFullSheetCharacter(library, "perf-items").state, 120),
      library,
      { mode: "full" },
    ),
  },
  {
    name: `full sheet +${EXTRA_SPELLS} spells`,
    model: () => buildCharacterSheetModel(
      withExtraSpells(buildFullSheetCharacter(library, "perf-spells").state, EXTRA_SPELLS),
      library,
      { mode: "full" },
    ),
  },
];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const ms = (value) => `${value.toFixed(1)}ms`;

async function benchmark(fixture) {
  const model = fixture.model();
  const totals = [];
  let phases = new Map();
  let bytes = 0;
  let pages = 0;
  // The first run pays fontkit's module load and V8's warm-up, and is discarded:
  // the app renders a sheet many times per session, so steady state is the number
  // that matters.
  for (let run = 0; run <= RUNS; run += 1) {
    const collected = new Map();
    const trace = (phase, elapsed, detail) => {
      const entry = collected.get(phase) ?? { ms: 0, calls: 0 };
      entry.ms += elapsed;
      entry.calls += 1;
      collected.set(phase, entry);
      if (detail?.pages !== undefined) pages = detail.pages;
    };
    const started = performance.now();
    const output = await writeCharacterSheetPdfWithTemplateBundle(model, bundle, { trace });
    const elapsed = performance.now() - started;
    if (run === 0) continue;
    totals.push(elapsed);
    bytes = output.byteLength;
    phases = collected;
  }
  return { name: fixture.name, median: median(totals), totals, phases, bytes, pages };
}

const results = [];
for (const fixture of fixtures) results.push(await benchmark(fixture));

console.log(`[perf:sheet] set ${SET}, body ${fonts.body}, ${RUNS} timed runs each (first discarded)\n`);
for (const result of results) {
  console.log(`  ${result.name} — ${ms(result.median)} median, ${result.pages} pages, ${(result.bytes / 1024).toFixed(0)} KB`);
  const rows = [...result.phases.entries()].sort((left, right) => right[1].ms - left[1].ms);
  for (const [phase, entry] of rows) {
    const share = ((entry.ms / result.median) * 100).toFixed(0);
    console.log(`      ${phase.padEnd(24)} ${ms(entry.ms).padStart(9)}  ${String(entry.calls).padStart(3)}×  ${share.padStart(3)}%`);
  }
  console.log();
}

const slowest = Math.max(...results.map((result) => result.median));
if (BUDGET_MS > 0 && slowest > BUDGET_MS) {
  console.error(`[perf:sheet] FAIL — slowest fixture ${ms(slowest)} exceeded the ${BUDGET_MS}ms budget`);
  process.exit(1);
}
console.log(`[perf:sheet] slowest fixture ${ms(slowest)}${BUDGET_MS > 0 ? ` (budget ${BUDGET_MS}ms)` : ""}`);
