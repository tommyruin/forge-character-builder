# System Reference Document 5.2.1 — provenance

Everything under `third-party/srd-5.2/` is the derivation record for the 2024 rules
content the browser ships. The content itself is sliced from the vendored
AuroraLegacy/elements corpus (`../elements/testdata/core/players-handbook-2024/`),
not from this document; this directory decides which of those elements the
System Reference Document covers.

## Source

- **Document**: System Reference Document 5.2.1, Wizards of the Coast LLC.
- **Licence**: Creative Commons Attribution 4.0 International
  (https://creativecommons.org/licenses/by/4.0/legalcode).
- **Pin**: `srd-5.2.1.provenance.json` records the URL, byte length, sha256 and
  page count. `scripts/extract-srd-inventory.mjs` refuses any other file.
- The PDF is not committed and is never fetched by the build or test gates.

## Files

- `srd-5.2.1.inventory.json` — GENERATED. Every class, subclass, background,
  species, feat, metamagic option, eldritch invocation, weapon and mastery
  property, equipment item, language, spell, magic item and animal the document
  names, with the page it appears on, read from the PDF's outline and page
  layout. Monsters are not inventoried; they are not character-builder content.
  Regenerate with `node scripts/extract-srd-inventory.mjs --report`.
- `srd-5.2.1.map.json` — REVIEWED. Maps each inventory entry to the corpus
  element ids that implement it (`entries`), lists corpus elements kept on
  review that the inventory cannot name (`curated`, each with a reason), lists
  every named corpus element that is not published (`excluded`, each with a
  reason), records the spell rename table (`renames`), the reviewed prose edits
  (`edits`), and the inventory entries the corpus has nothing for
  (`unmappedChapters`, `unmatchedInventory`). The map carries the sha256 of the
  inventory it was reviewed against; the build refuses a stale map.
- `ip-denylist.json` — names the document does not carry. The build fails on
  any match in a generated file.

## Method

1. The inventory is extracted once and committed.
2. `scripts/build-srd-content.mjs draft-map` proposes the map by name; a
   person reviews it and records reasons.
3. `scripts/build-srd-content.mjs build` copies the mapped elements from
   the corpus byte-for-byte, keeps everything they grant or select, drops the
   rest, trims the handbook's introductory prose from classes, species and
   backgrounds (the document prints none), applies the rename table and the
   recorded edits, and writes `apps/client/public/content/srd-5.2.1/**.xml`
   with a generator header. `check` (run by `npm run verify`) rebuilds in memory
   and fails on any drift from the committed files.

## What is not included

- Magic items and monsters: the vendored corpus has no 2024 Dungeon Master's
  Guide or Monster Manual content, so there is nothing to publish for those
  chapters. The Animals appendix is used only to check the familiar and
  companion stat blocks the corpus carries.
