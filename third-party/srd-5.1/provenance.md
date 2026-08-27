# System Reference Document 5.1 — provenance

Everything under `third-party/srd-5.1/` is the derivation record for the 2014
rules content the browser ships under `apps/client/public/content/srd-5.1/`.
The content itself is sliced from the vendored public elements corpus (the
2014 handbook chapters under `../elements/testdata/core/players-handbook/` and
the magic item tables under `../elements/testdata/core/dungeon-masters-guide/items/`);
this directory decides which of those elements the document covers.

## Source

- **Document**: System Reference Document 5.1, Wizards of the Coast, Inc.
- **Licence**: Open Game License v 1.0a (the notice ships with the client at
  `/legal/`).
- **Pin**: `srd-5.1.provenance.json` records the URL, byte length, sha256 and
  page count. `scripts/extract-srd51-inventory.mjs` refuses any other file.
- The PDF is not committed and is never fetched by the build or test gates.

## Files

- `srd-5.1.inventory.json` — GENERATED. Classes, subclasses, races, sub-races,
  the background and feat, eldritch invocations, equipment and poisons, spells,
  magic items and the four Fantasy-Historical pantheons the document names. The
  document has no outline, so sections come from its large headings.
  Regenerate with `node scripts/extract-srd51-inventory.mjs --report`.
- `srd-5.1.map.json` — REVIEWED. Same shape as the 5.2.1 map: `entries`,
  `curated`, `excluded` (each with a reason), the `renames` table (the
  seventeen spells and seven magic items the document lists without their
  original proper nouns), the prose `edits` (setting names the document prints
  without), and the inventory rows nothing implements (`unmatchedInventory`).
- `ip-denylist.json` — names the document does not carry. Setting names the
  document itself uses (Forgotten Realms, Faerûn, Strahd in Divine Sense, the
  Deck of Many Things cards) are deliberately absent.

## What the generator changes against the corpus

- Class descriptions open at Class Features and race descriptions at their
  traits list, as the document prints them.
- Handbook-only spells, magic items, subclasses, backgrounds and feats are not
  published; the corpus elements the core baseline already ships (proficiencies,
  languages, the Source element) are not emitted twice.
- The deities file is generated from the document's Celtic, Greek, Egyptian
  and Norse pantheon tables; the corpus pantheon is not SRD content.
- `companions.xml` ships whole: the familiar, Beast Master and companion
  features select from its stat blocks, and each creature's traits and actions
  belong with it.
- `ranger-favored-terrains.xml` is authored: the eight favored-terrain options
  the ranger's Natural Explorer feature selects from, under the identifiers
  saved characters carry.
- Nothing else changes: ids, file names, mechanics and the document's own text
  are untouched, so uploading the handbook restores every dropped or trimmed
  element in place.
