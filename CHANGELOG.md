# Changelog

All notable changes to Forge Character Builder are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A host logo painted over the sheet's brand badge no longer punches a white
  block through the masthead. Covering the template's die mark took the header
  rule's left end and the name plate's top corner with it; the mark now stays
  inside its own badge box, and the slice of rule the knockout crosses is
  painted back.

## [2.2.0] - 2026-08-28

### Changed

- Character sheets generate about twice as fast. A sheet redrawn after an edit
  takes 42ms of writer time where it took 100ms, and the whole cycle from asking
  for the sheet to seeing every page lands in 165ms where it took 250ms. A
  spell-heavy sheet is also 40% smaller to download.

## [2.1.1] - 2026-08-28

### Fixed

- On the 2024 set, the inventory, companion and appearance pages printed each
  panel's title over its own contents. Those pages now label a panel inside its
  lower edge, as the 2014 set does.
- Numbers are sized by the template that drew the box around them, instead of a
  fixed table in the writer that left the companion sheet, hit dice, hit points
  and the 2024 vitals row rendering at 8pt whatever their box.
- Values sit optically centred in their box for any chosen typeface. They are
  drawn rather than filled through the form, because a form field centres a line
  on the font's ascender — which dropped a tall-ascender face onto the rule
  beneath it. Sheets are also markedly smaller, having lost an appearance stream
  per field.
- The ability score's box is derived from the shield it sits in, so the
  character and companion pages centre their scores alike.

## [2.1.0] - 2026-08-27

### Added

- A host logo slot for the generated sheets: a shell may supply `sheet.logo`,
  which the writer paints over the masthead's die badge.

### Changed

- The 2014 sheets follow the printed idiom more closely: a masthead carrying
  the brand badge, the character's name and the identity grid; chamfered
  panels; captions printed inside each panel's lower edge instead of on
  hanging ribbons; hit dice and death saves as their own panels beneath the
  hit points; and a companion page that fills the sheet.

## [2.0.0] - 2026-08-27

### Changed

- The project's own code is now under the MIT licence instead of AGPL-3.0.
  The bundled System Reference Document content and the third-party fonts,
  ornaments and libraries are unaffected and keep their own licences.

## [1.2.0] - 2026-08-27

### Changed

- Browser persistence names are the builder's own by default — the IndexedDB
  database `fcb-local`, the localStorage keys `fcb-autosave`,
  `fcb-active-character` and `fcb-split-view`, and the package token
  `fcb-character-package` — and a host shell may supply the names its users
  already hold through `shell.storage` (see `docs/host-shell.md`).
- Snapshot identities are `fcb-fast-start-library` and `fcb-character-load`
  at parser version 9; cached snapshots rebuild once.

## [1.1.2] - 2026-08-27

### Fixed

- The corpus coverage gate reads the system elements from `content/system`.

## [1.1.1] - 2026-08-27

### Changed

- The engine's system elements ship from `content/system` alongside the rest
  of the bundled content; `third-party/` now holds only the reviewed SRD maps,
  their provenance and the optional development corpus.
- The client's corpus-backed tests skip without the corpus, and CI fetches the
  corpus only when its cache misses.

## [1.1.0] - 2026-08-27

### Added

- Original character sheet templates for the 2014 and 2024 rules, generated
  by `scripts/build-sheet-templates.mjs`. The 2014 set keeps the classic sheet
  arrangement; the 2024 set groups each ability's saving throw and skills
  beneath its score.
- Sheet settings under Manage → Sheet: the layout (2014 or 2024), the colours
  of the frames, lines and text (with preset themes) and the typefaces for
  titles, captions, body text and numbers. Templates are recoloured and their
  text drawn at render time, so one template set serves every choice.
- A host shell seam (`@shell`, `FCB_HOST_SHELL_DIR`) and an asset overlay
  (`FCB_ASSET_OVERLAY_DIR`) so a host site can brand the client without
  forking it.
- A publication audit (`npm run audit:public`) that checks the tree for
  terms, file names, digests and secrets that must not ship.
- The test suite runs without the content corpus; `npm run test:corpus`
  demands it.

### Changed

- Bundled content lives under `content/{core,srd-5.1,srd-5.2.1}`. The core
  rules baseline is authored in this repository and the System Reference
  Document 5.1 subset is generated from the public corpus, like the 5.2.1
  subset already was.
- The client mounts at `/` by default; `PUBLIC_BASE_PATH` sets another base.
- Packages are `@forge-cb/api` and `@forge-cb/engine`; the client's class
  prefix is `fcb-`. Persisted identifiers (storage names, file-format tokens)
  are unchanged.
- Snapshot identities, the parser revision and the engine version have one
  definition each, in `@forge-cb/api`.

### Removed

- The vendored sheet PDFs, help documents and third-party core data files
  the client previously shipped.

