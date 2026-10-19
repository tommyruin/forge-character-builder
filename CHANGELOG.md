# Changelog

All notable changes to Forge Character Builder are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Text a box can't hold continues on a plain "(continued)" page under the box's
  own name, re-wrapped at full width, instead of on a reprint of the character
  page. Background, companion and equipment boxes continue the same way.
- An "All item cards" button in Sheet options.
- The engine supports custom features made on a character: boons, curses,
  feats, racial traits and class features with ability, save, skill, armor
  class, speed and attack bonuses, spells, proficiencies, languages, player
  choices and sheet text. They are stored in the character file, travel with
  exports and packages, and can be edited, removed or copied into a homebrew
  collection with the same id.
- Any feature can be granted to a character, not only feats and ability score
  improvements, and the grants list says which entries are custom.
- A change to a custom choice's name, level or count can be checked first: the
  engine says which picks would be lost.
- Build has a [+] Custom button in every section. It opens a form where you name
  a feature, say where it shows (Race, Class, Feats or Other), write its text
  and add effects: ability scores, bonuses, spells, proficiencies, languages,
  player picks, limited uses and "only while active". The entry is listed with a
  Custom badge and Edit and Remove buttons, and the form can also copy it to My
  homebrew. Saving an edit warns first if it would clear picks already made.

- You can make your own items: a magic weapon on a real base (with a bonus,
  extra damage dice, a different attack ability, die, range or properties), a
  magic armor or shield, a worn item, or plain gear. A weapon's attack row shows
  its extra damage ("1d8+3 slashing + 1d6 cold"). While worn or wielded (and
  attuned, if it asks) an item can add bonuses and grant resistances, spells and
  features; take it off or end the attunement and they go. Custom items are
  stored in the character file, travel with exports, and can be edited,
  removed or copied into a homebrew collection.
- Any item in the inventory can be renamed and given notes. The new name shows
  in the inventory, the attack row, the equipment list, the item cards and the
  armor box on the sheet, with the item's own name beside it on the equipment
  list; the item keeps its rules.
- Equipment has a Custom item button in the catalog and a quick Add custom gear
  line in the inventory; custom items carry a Custom badge, and Edit, Rename and
  Notes buttons.
- A spell a feature or item gave you is listed under that feature in the Magic
  tab's Source column, with a Custom badge when you made it.
- You can make your own spells. Magic's Add a spell says "X isn't in your
  library. Create it?" when a search finds nothing, and opens a form for the
  spell's level, school, casting time, range, duration, components, text, class
  lists, and what it rolls: a ranged or melee spell attack or a saving throw
  (with half damage on a success), damage dice and types, healing, and growth by
  character level or by slot. The spell's attack bonus, save DC and damage come
  from those fields, so they never depend on how its text is worded, and the
  form shows the attack row for the caster you pick. A custom spell is stored in
  the character file, is known to the caster you chose (or appears among its
  class lists' pickers when you tick a class), can be edited and deleted from
  Magic, and can be copied into a homebrew collection with the same id.
- Any spell can be given your own name and a note on one character. The Magic
  tab leads with the name and keeps the real one beside it; the sheet's spell
  list prints the name, the spell cards print it with the real name in
  parentheses and close with the note, and the spell's attack row says "Moonlit
  Ward (Barkskin)". The spell keeps its rules.
- A spell that a homebrew pack grants but never defines is listed on the Magic
  tab, and on Content warnings, with Create spell. Making the spell under the
  missing id resolves the grant; from Content warnings it is written into the
  pack that granted it.

- Manage has a Resources page. It lists every limited use the character has:
  book features that state a count and a rest (Rage, Bardic Inspiration, Wild
  Shape, Second Wind), custom features and items, the free cast of a spell a
  custom feature grants, and trackers you add by hand (a minutes budget on a
  pair of boots). A few uses are pips to tap; many are a counter with - and +.
  Short rest and Long rest buttons refill what recharges on them, and a long
  rest also refills Dawn and Day trackers. Spent counts are saved in the
  character file and undoable.
- Custom features and items can carry real limited uses: a number or a value that
  follows the character (proficiency bonus, an ability modifier with a minimum,
  a level), counted in uses, charges, minutes or points, recharging on a short
  rest, long rest, dawn, day, never or a dice roll. Several features can share
  one pool, and an item's charges are tracked while you carry it. The sheet's
  usage line is written from them, and the sheet closes its features text with
  a Resources line of boxes to tick off.
- "Only while active" is a real switch. Custom bonuses gated by one apply only
  while it is on, from a Switches row on the Resources page; turning one on can
  spend a use of a linked tracker. The form suggests the switches your other
  entries already use.
- Custom features can have scale values: a die or a count that grows by level
  (1d6 at level 1, 2d6 at level 5). A bonus or a limited use can follow a
  count, and the sheet text prints either with {{scale:name}}.

- Homebrew collections are now packs. A pack has a name, text, abbreviation,
  author, release date, playtest flag and rules version, and the packs list
  includes the open character's own pack beside My homebrew and your other
  packs. Packs saved before this open as they were, with nothing lost.
- New element is a template picker: boon or blessing, curse or injury,
  transformation, feature, feat, spell, weapon, armor or shield, magic weapon
  or armor, wondrous or worn item, gear, language, proficiency, sense or damage
  type, deity, optional rule, alignment and weapon property. Advanced covers
  changing a book element, adding to one, reflavouring one, and a custom type
  written as XML. Species, subspecies, class, subclass, background and
  companion are listed as coming next and start as XML.
- A pack element is edited with the same blocks as a character's custom
  feature: ability scores, bonuses, grants (which can be tied to a switch),
  player picks, requirements, tags, sheet text, limited uses and scale values.
  Spells and items use their own forms. An element made with the earlier editor
  opens as its XML with a notice.
- Pack health lists grants to things that are not in your library, ids defined
  twice, Background Features nothing can attach, additions to elements that are
  not loaded and requirements the builder cannot read, each with the element
  that carries it. A missing spell can be created from the card, and an
  unattachable Background Feature can be converted to a feature.
- Editing a choice in a pack element that characters have picked under shows
  which picks would be cleared, and Update builder asks before clearing them.
- A pack can hold languages, proficiencies, senses, deities, optional rules,
  alignments, weapon properties, new base weapons and armor, additions to book
  elements and replacements of them.
- A grant in a custom feature can be gated on a switch, like a bonus.

### Changed

- The 2024 and Hybrid character pages are redesigned: one Armor Class box holds
  armor, AC sources, resistances and the Shield and Stealth ticks; ability
  blocks put the modifier in a circle with the score beside it; Encounter Notes
  is gone; Species Traits is shorter; Weapons has five rows and features get
  the rest. The compact top row is the default on these sheets.
- On the Hybrid page, Senses joins "Proficiencies, Training, Languages &
  Senses" and Conditions & Exhaustion moves to the bottom left.
- The 2014 page prints five attack rows and no Actions box. The compact top
  row stacks Proficiency Bonus and Initiative, and the readable body keeps the
  classic ability shields with larger numbers and roomier Armor Class and Hit
  Points boxes.
- Split feature boxes print one box with Class Features, Subclass Features and
  Feats headings.
- Sheet text never prints below 5.5pt: a value that doesn't fit ends in "…" and
  prints in full on a continuation page. Every text box starts its first line
  the same distance below its top.
- Prepared and known spells fill their circle on the spell pages, for casters
  that prepare spells and those that don't. Cantrips are never marked.
- Tool and gear notes in the inventory column say what the item does (ability,
  use, DC, save, damage) and leave out its weight.
- Familiar & Companion moves from Magic to Build, background personality picks
  sit in Background, and an open spell choice flags the Magic tab. Manage's
  sheet tab is called Sheet options.
- Levelling up several levels at once offers each new spell choice only spells
  of the level it was gained at. Swapping a spell still reaches your current
  level.

### Fixed

- A homebrew pack's languages, proficiencies, feats and ability score
  improvements now appear in Manage's Additional items; before, only the
  builder's own books had them.
- A rule gated on a level and an element is removed when the element is
  removed.
- A new base weapon and a new base armor no longer share an id with the magic
  item templates, so a magic item is no longer read as the wrong kind.
- Add a spell now adds the spell to the caster you pick. Before, every spell
  landed in Additional Spells whatever the dialog said; it now appears among
  that caster's spells, ready without preparing, and casts with that caster's
  attack bonus and save DC. The dialog offers your class casters.
- A spell name with an ampersand or a quote no longer breaks the saved character
  file, and prints as written on the spell cards.
- Fields in the custom feature form no longer show what you type in the bold
  capitals of their captions.
- The library search in the custom feature form shows results only after you
  type, as option rows with the source in muted text, and works with the arrow
  keys and Enter.
- The buttons in Build's section header sit together on the right.
- A spell added to a custom feature is cast with your spellcasting ability, and
  the form asks for one if you have none.
- Passive Perception on the sheet and in VTT exports includes features that
  raise the passive score.
- A multiclass caster lists each class's spells only up to that class's own
  spell level, prints the shared slots once and points the other classes to
  them. Feat spellcasting gets no slot circles, and a Druid 5 can't prepare
  4th-level spells.
- A Warlock's spell pages list lower-level spells as well as the pact level.
- 2014 Magic Initiate and other feat spellcasting use the ability the feat
  states and keep their free cast.
- Spell card details no longer drop words, usage notes in the spell list use
  the space beside a short name, and card text lays out in the chosen body
  font.
- A long card continues in a slot of its own instead of printing over a later
  card.
- A magic weapon or armor offers each edition's base item, such as both
  Shields for a Sentinel Shield, and keeps the one chosen. An attack matches
  its own item when two share a name.
- Gear, magic items and containers past the equipment tables' rows print in
  the notes column instead of being left off.
- Background feature text and Roll20 exports keep their paragraph and list
  breaks.
- Save and skill numbers sit centred between their lines, and 2024 range,
  speed and armor cells no longer clip.
- Companion Trait choices sit with their companion.
- Stat values written as +2 work, a fraction rounds down, and a stat's maximum
  caps the value it refers to.
- Homebrew armor and shields set Armor Class, with the right dexterity cap for
  light, medium and heavy armor.
- A homebrew weapon adds your proficiency bonus when you are proficient with
  its category, and can be versatile.
- A homebrew magic weapon or armor can be laid over a base weapon or armor and
  equipped to a hand or the body.
- A weapon or armor that offers a choice or grants a sense or spell applies it
  while equipped (and attuned, when required).
- A ring or charm that grants a feat, language, proficiency, spell or ability
  score increase can be added and worn like any other item.
- A homebrew feat can require ability scores, levels or other elements, and
  pickers only offer it to characters who meet them.
- A homebrew feat can be tagged Origin, General, Fighting Style or Epic Boon so
  the matching picker offers it.
- A homebrew racial trait, feat or subclass feature written without sheet text
  prints its name and description on the character sheet.
- The Add ability score improvement dialog applies its grant.
- A grant or choice default that points at content you haven't loaded is listed
  under Content warnings with the feature that needs it.
- Saving a homebrew collection again replaces its stored file, its warnings
  show, and deleting it removes it; copies left by earlier saves are cleaned up.

## [2.5.0] - 2026-10-08

### Added

- A 2024 Hybrid character sheet: the 2024 page with 2014-style ability, save
  and skill columns and separate Class Features, Subclass Features and Feats
  boxes.
- Optional sheet layouts in Sheet settings: split feature boxes, a compact top
  row (AC, Hit Points, Hit Dice with Max and Spent, and Death Saves side by
  side, with a shield tick box) and a readable body with larger captions and
  more room for features. The 2014 readable layout prints six attack rows.
- Each inventory item has Card and Sheet notes buttons, with bulk "magic &
  useful only" and "none" actions. An optional setting prints magic items in
  full and short tool and gear notes in the inventory column.
- The equipment list shows price, type and rarity, bolds items you are
  proficient with, and filters by type, rarity, proficiency and maximum price.
- Martial Arts adds an Unarmed Strike to a monk's attacks, including when it
  comes from a DM grant.
- Initiative advantage from features and items such as Feral Instinct,
  Remarkable Athlete, Assassinate and a Sentinel Shield ticks the sheet's
  advantage circle and shows ADV in the app.

### Changed

- Spells from feats such as Magic Initiate print in the class spell list,
  labelled with the feat and any free casts.
- The sheet notes attacks per Attack action only when there is more than one.
- Helvetica and Alegreya Sans can be chosen for sheet titles.
- Hit Points, Armor Class, Initiative, Proficiency and Speed show as a compact
  row on phones.

### Fixed

- Class-level requirements are checked, so 2024 invocations such as Eldritch
  Spear and Agonizing Blast print their values and apply their rules.
- A feature that is replaced by another, such as the base Wild Shape for a
  Circle of the Moon druid, is no longer printed beside its replacement.
  Feature text follows the level in that class.
- The 2024 Shield and other mundane armor are added as themselves. A magic item
  that still needs its base item grants nothing until it has one.
- The attack editor won't add a second Unarmed Strike, and its tabs wrap on
  phones.
- Unpacked pack armor is worn and its shield held when those slots are free.
- Co-written official books are listed with the other official books in
  Sources. Turning a book off removes choices and spells from it and lists them.
- A 2024 Bard can swap an earlier spell for one of any level they can cast.
- Magic items without a listed price show "Not listed".
- A trait that raises Intelligence or Wisdom by 2 also raises its maximum by 2.

## [2.4.0] - 2026-09-25

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

- Spell choices browse by school: a caster whose spell list is limited to
  certain schools lists its spells again, and its cantrip choices browse every
  school.
- Same-named choices that one feature authors with different filters no longer
  merge: a free pick beside school-restricted picks, picks of different spell
  levels, and options that differ between the 2014 and 2024 rules each keep
  their own list. Saved choices are kept; a choice whose rule can no longer be
  identified keeps its pick but offers nothing new.
- Goggles of Night grant 60 feet of darkvision, not 120, and add 60 feet to
  darkvision a character already has. Other features that grant darkvision the
  same way give their stated range as well.
- Statistics that several features set as a base value now take the highest
  one, and keep every other bonus to that statistic. A feature that grants 60
  feet of darkvision, or 30 more to darkvision already there, takes a dwarf's
  60 feet to 90; counts with a "minimum of 1" floor such as 2024 Sear Undead
  follow the ability modifier; and a DC that can come from either of two
  statistics no longer comes out 0.
- Walking and other movement speeds take the higher of the character's own
  speed and one a feature or item sets: the 2024 Wood Elf walks 35 feet, not
  65, and Boots of Striding and Springing give a dwarf 30 feet, not 55.
- The 2014 Bard's Bardic Inspiration die is d6/d8/d10/d12 by level instead of
  the sum of those dice, and a feature count that grows by level keeps growing
  instead of dropping back to 1.
- Ability scores rise above 20 in the shipped content: a level-20 barbarian's
  Primal Champion takes Strength 20 to 24 (maximum 25). The engine now works out
  the raised maximum itself instead of relying on an internal grant only the
  full corpus carries.
- A bonus that says "to a maximum of X" stops at its own X even when another
  feature allows a higher maximum, so two bonuses capped at different
  maximums each stop at their own. Raises that say "as does your maximum"
  still stack.
- The local `full` and `reviewed-test` content profiles load the engine's system
  elements again, so characters built against the corpus have their speed and
  item grants (such as Goggles of Night).
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
- The base picker keeps its Add button in reach on short windows; it no longer
  gives up height to the description pane beside it.
- Build's Ability Scores total shows a score above 20 once a feature raises the
  maximum, matching the sheet, and previews an edited score against that
  maximum instead of a fixed 20.
- A bonus with no maximum of its own, such as an Ability Score Improvement,
  still stops at 20 when Primal Champion or an epic boon raises the cap:
  Strength 20 with an Ability Score Improvement and Primal Champion is 24, not
  25.
- The Sources panel counts a book's rules even when its entries spell the book's
  name differently, instead of reporting "No rules loaded".
- The 2014 Bard can use Bardic Inspiration at least once per long rest whatever
  the Charisma modifier.
- Attacks past the sheet's four attack rows lead the attack notes under them
  ("More attacks: …"), continuing onto an attack-note page when long, instead
  of being left off.
- A spell level with slots but no spells chosen keeps its band and slot circles
  on the spell page, and a single slot reads "1 SPELL SLOT".

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
