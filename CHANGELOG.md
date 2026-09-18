# Changelog

All notable changes to Forge Character Builder are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The inventory Qty column has minus and plus controls: a stack's amount
  changes in place, up to 999, and carried weight follows for stackable items.
- Adding an item that is already carried as an identical stackable stack grows
  that stack instead of adding a row. Items that are equipped, attuned,
  attunable, adorned or stowed keep their own rows.
- Part of a stack can be stowed: assigning a container on a multi-item stack
  asks how many units to move, and returning part of a stowed stack works the
  same way, joining an identical carried stack when one exists.

### Fixed

- Delete on a stack removes the whole record. It previously removed a single
  unit without saying so.
- Equipment's catalog and description panes scroll to the bottom again while a
  magic weapon's or armor's base is being chosen; the base picker no longer
  pushes them past the bottom of the window.
- The Equipment base picker appears only when a magic weapon or armor offers a
  base choice; single-base items add straight to the inventory.
- Content from disabled sources is hidden in the Equipment catalogue, Additional
  features, Optional rules and the DM add-spell/add-feat lists, matching the
  Build choices.
- A source is disabled together with its content even when its entries spell the
  source name differently (straight vs typographic apostrophes, capitalisation,
  repeated spaces).
- Source choices save on imported characters whose file predates the source
  settings region.

## [2.3.0] - 2026-09-16

### Added

- Spells a feature grants outright now reach the spell pages: Divine Smite,
  Find Steed, and every oath, patron and subclass list.
- Spells from a feat or a species get their own block on the spell page, headed
  by the feature that granted them and marked with any free cast.
- A 2024 weapon names its mastery property under the attack, once the character
  has chosen that weapon's mastery.
- A weapon you own but have not equipped can be added to the attacks box, from
  its Equipment row or the attack editor's "Owned weapon" mode.
- Manage → Attacks suggests attack-roll spells the character knows that have no
  row yet, one click each.
- Each level of the Level History takes its class average in one click. The
  Average Hit Points optional rule still fixes every level at once.
- Level Up & XP takes a target level: "Go to level N" advances the main class
  straight there, leaving the intervening choices on the Build tab.
- Manage → Optional rules can save a rules version as the default for new
  characters, beside the existing default for sources.
- The sheet layout follows the open character's rules version until you choose a
  layout yourself, and Manage → Sheet offers "Match ruleset" when they disagree.
- Manage → Sheet can leave pages out: the appearance and portrait page, the
  notes page, the spell cards and the item cards. The rest renumber without a
  gap.
- An item in use passes on everything it grants. A magic weapon's or armor's
  own resistances, languages, proficiencies, senses, spells and choices reach
  the sheet, the spell pages and the Build tab once the item is equipped and,
  where it asks for it, attuned — Dragon Scale Mail's resistance, Elven Chain's
  proficiency, a Ring of Resistance's resistance, a Belt of Dwarvenkind's
  Dwarvish — and leave again with the item.
- Equipment offers **Wear** for a slotless item such as a cloak, an amulet or
  goggles, and **Remove** to take it off. A worn item uses the compatible `.dnd5e`
  format, so the file still opens in other builders.
- Manage → **Additional features** is its own sub-tab: supernatural gifts,
  extra features and the other adjustments browse like the Equipment catalog,
  with a category strip, a search box, Add and Remove on each card, and the
  description pane beside them. A gift an attuned item brings shows "Granted
  by" that item and can still be taken on in its own right.

### Changed

- Features on the details and companion pages are separated by a gap sized to
  the type rather than the breath between one feature's own paragraphs, so where
  one ends and the next begins is legible.
- The Monochrome sheet theme is now "Print (black & white)" and drops the
  parchment fills and warm greys along with the colour, so a printed sheet costs
  no colour ink.
- Cached sheets are redrawn once after this upgrade, so they pick up the
  per-page edition label.
- Manage → Sheet shows which sheet layout is live. The 2014/2024 choice is a
  segmented toggle now, and the chosen set carries the same tint the workspace
  tabs and spell level pills use, instead of two identical buttons.
- A slotless item that needs no attunement applies its benefits once it is
  worn, not while it is merely carried. Goggles of Night in a pack no longer
  grant darkvision; click Wear.

### Fixed

- Clearing or changing a weapon mastery removes its label from attacks and
  character sheets, while keeping custom attack notes.
- Spells handed out through the DM-grant surface now appear for a character who
  casts nothing otherwise. They gather into an "Additional Spells" block, always
  ready and still removable.
- A 2024 weapon's NOTES cell no longer clips its second line or shrinks the text
  to fit. The column is wider and each cell takes the row's full pitch, so the
  longest property list prints at full size, level with the rest of the row.
- Every sheet page carries the rules version it was laid out for. The 2024
  character page and both equipment pages had no label at all.
- A level-gated grant on a feature registered at an earlier level now registers
  when that level arrives: Draconic Sorcery's Fear at sorcerer 5, the Oath of
  Devotion's 5th-level spells, the Fiend patron's Fireball.
- Subclass features above the level the subclass was chosen at now register at
  all: a Champion gains Remarkable Athlete at fighter 7, a Draconic Sorcerer
  gains Elemental Affinity at sorcerer 6.
- A host logo painted over the sheet's brand badge no longer punches a white
  block through the masthead. Covering the template's die mark took the header
  rule's left end and the name plate's top corner with it; the mark now stays
  inside its own badge box, and the slice of rule the knockout crosses is
  painted back.
- Unequipping one of two identical items — a pair of longswords, two rings
  granting the same resistance — no longer strips the other's benefits with it.
- Stowing an attuned item in a container now takes its benefits away; they
  return when the item is taken out and put to use again.
- A DM can grant a feat that an item already provides, and removing either copy
  leaves the other in place.
- The sheet's Resistances box now prints what the character has: resistances,
  immunities and vulnerabilities from items, species and features, grouped as
  "Resistances: Acid, Fire" and "Immunities: Poison". Hand-written text in an imported
  `.dnd5e` file keeps its place after them.
- A multi-line sheet box keeps its line breaks. Backstory paragraphs, the
  additional-features notes and the magic item sidebars printed as one run of
  text; each now starts where the writer broke the line.
- Choosing Brass, Gold or Red Draconic Ancestry for a 2024 Dragonborn no longer
  fails with "engine method 'setSelection' failed". The three fire ancestries
  each grant fire resistance, and settling the choice deleted that resistance
  twice, corrupting the character.
- Changing or re-picking a Draconic Ancestry keeps exactly one matching
  resistance in the tree and sum, including changes between fire ancestries.
  Re-picking also repairs missing resistance in older saves; untouched imports
  retain their original bytes.
- A spell choice accepts any level the class has slots for at its current level,
  not only the level it had when the choice was gained. It applies to known and prepared
  spell lists in both rules versions, including the 2024 Bard's first four
  picks and the Eldritch Knight's and Arcane Trickster's choices; Wizard
  spellbook choices, including Savant, retain their acquisition-level limits
  regardless of the select's name. The editor does not enforce per-level
  replacement counts; Sorcerers still replace only one spell per class level. The
  Magic tab's spell browser offers the same levels, and losing a level takes
  back a spell that is now too high and asks for a new pick. Secondary
  multiclass casters use their own class level. Old Bard checksums retain their
  filled wrappers through import, editing and deleveling.
- Converting the latest level to another class removes the original level's
  features, preventing a later class delevel from finding orphaned features.
- Spells a feature lets the caster cast without a slot print their free cast
  beside the name on the spell pages ("Divine Smite 1/LR", a Magic Initiate
  spell), and the Magic tab shows it for class spells too. A feat's spell block
  no longer prints "0 SPELL SLOTS". Grasping Tentacles and the selected Lunar
  phase receive their allowances; Mantle of Majesty distinguishes an activation
  from a single Command, and Fateful Naming labels its shared pool. Long names
  shorten at the minimum font size so their markers stay inside both sheet sets.
- Add attack → Known spell includes supported spells
  a subclass or feature grants (the Draconic Sorcerer's Chromatic Orb), DM-granted
  spells, 2024 "attack roll" wording (Sorcerous Burst), and damaging saving-throw
  spells such as Mind Sliver, Sacred Flame and Fireball, which show "DC 13 INT"
  and are labelled Save DC. Manage → Attacks suggests them the same way.
  DCs and attack modifiers include the Magic tab's caster-specific item bonuses.
  Selected subclass spell grants observe their own class-level gates. Saves
  unrelated to the damage and complex conditional effects are excluded from
  automatic save rows; the editor points to Manual for those effects.
- The content-library digest equality test has a 15-second timeout for full
  corpus canonicalization under coverage; its assertions are unchanged.

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
