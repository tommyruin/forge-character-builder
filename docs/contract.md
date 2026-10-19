# Contract — our API surface

This document specifies OUR wire contract (design authority: user directive —
RPC method names, envelopes, DTO field names, status codes, error strings are
ours to define; 1:1 conformance applies to `.dnd5e` files and XML content semantics).

## Transport

- One engine worker per tab; the React client talks to it through a bridge
  (`apps/client/src/transport/`).
- Protocol messages: see `packages/api/src/protocol.ts` (request/response
  correlation by monotonic id; `ready`/`progress`/`queue`/`fatal` events;
  ArrayBuffer results for sheet bytes).
- The production browser entry is `@forge-cb/engine/browser`; it starts the same
  worker runtime without importing Node filesystem, path, crypto, or buffer
  modules. Browser deployments boot the pinned corpus through the generated
  `content/manifest.json` artifact, while uploads and patches use the same
  content-write queue as the desktop/runtime path.
- Queue discipline: content-write and character-write serialize (FIFO);
  homebrew patches may overtake queued reads; reads never run concurrently.
- Progress events: `scope: "content" | "character"`, coalesced and bounded.
- `packages/api/src/runtime.ts` validates request envelopes, schedules work,
  converts unexpected failures to stable error envelopes, transfers
  `ArrayBuffer` arguments/results, emits ready/progress/queue/fatal messages, and
  provides the typed client bridge with monotonic request correlation.
- `packages/engine/src/worker-handlers.ts` binds the implemented content,
  character, progression, inventory, and attack domains to that runtime.

## Errors

- Every failure is an `EngineError`: `{ code, message, details? }` with a stable
  code from `packages/api/src/errors.ts` (`not-found`, `invalid-argument`,
  `conflict`, `content-invalid`, `snapshot-rejected`, `unsupported`, `internal`).
- The client maps codes to UI states (loading/loaded/empty/error + Retry).

## Method surface

Defined once as the typed `EngineMethodMap` in `packages/api/src/methods.ts`.
Request tuples, result types, dispatcher handlers, and client method types are
derived from that map. The runtime list contains 99 unique methods: 98 are
implemented and dispatched, and `ensureHostFile` is intentionally test-only.
There are currently no public roadmap-unsupported methods. Groups:

- **Boot/content**: `boot`, `bootFromSnapshot`, `ingestSupplementBundle`,
  `ingestUploaded`, `removeUploaded`, `patchHomebrew`,
  `prepareFastStartSnapshot`, `getFastStartSnapshotBuffer`
- **Content reads**: `contentStatus`, `contentSources`, `equipmentCategories`,
  `contentElements`, `contentElement`, `getElementSource`, `checkPackContent`
- **Characters**: `createCharacter`, `getCharacter`, `deleteCharacter`,
  `setCharacterSources`, `getCharacterSources`, `setPortrait`, `removePortrait`,
  `updateDetails`, `setAbilities`, `getSelectionOptions`, `setSelection`,
  `getOptionalRules`, `setCharacterOption`, `getRulesetMode`, `setRulesetMode`,
  `getCharacterAdjustments`, `setCharacterControl`, `getStatistics`,
  `getAppearanceSuggestions`, `exportCharacterXml`, `importCharacterXml`,
  `importCharacterXmlWithSnapshot`, `getCharacterLoadDiagnostics`,
  `prepareCharacterLoadSnapshot`, `getCharacterLoadSnapshotBuffer`
- **Progression**: `levelUp`, `levelUpTo`, `levelDown`, `delevel`,
  `undoDelevel`, `setHitPointRoll`, `getProgression`
- **Magic**: `getSpellcasting`, `setPrepared`, `getSpellBrowse`,
  `setSpellAlias`, `addGrantedSpell`, `removeGrantedSpell`, `addGrantedFeat`,
  `removeGrantedFeat`, `addGrantedAbilityScore`, `removeGrantedAbilityScore`,
  `addGrantedElement`, `removeGrantedElement`, `getDmGrants`, `getCompanion`,
  `setCompanionName`
- **Custom content**: `getCustomContent`, `getMissingGrants`, `saveCustomDraft`,
  `deleteCustomDraft`, `promoteCustomDraft`, `getChoiceIdentityImpact`,
  `previewCustomItem`, `previewCustomSpell`, `getPackChoiceImpact`
- **Resources**: `getResources`, `setTrackerUsed`, `setResourceSwitch`,
  `restCharacter`, `saveManualTracker`, `deleteManualTracker`
- **Inventory**: `getInventory`, `getItemBaseOptions`, `addItem`, `removeItem`,
  `setItemAmount`, `extractItem`, `equipItem`, `attuneItem`, `setItemStorage`,
  `setItemPresentation`, `setItemCards`, `setItemDetails`, `setCoins`
- **Attacks**: `getAttacks`, `getAttackOptions`, `createAttack`, `updateAttack`,
  `setAttackVisibility`, `moveAttack`, `deleteAttack`
- **Sheet**: `generateSheet` (lite flag, optional `include`, optional `inventoryNotes`), `getSheetBuffer`.
  `inventoryNotes: true` widens the equipment page's notes column: after the
  attuned and `sidebar` items (printed exactly as without it), the other magic
  items in full, then tools and useful gear as a one-sentence summary capped
  near 200 characters, each group in inventory order, never repeating an item
  or printing a trivial one (`inventoryColumnEntries` in `sheet/model.ts`).
  Absent or `false` builds the model exactly as before.
  `generateSheet(id, {lite, include?})` — `include` is `{background?, notes?,
  spellCards?, itemCards?}`, each defaulting to `true`. A page set to `false`
  is not built, and the surviving pages carry contiguous `page` numbers
  `1..n`. `background` is the appearance/portrait page; `notes`, `spellCards`
  and `itemCards` exist only in the full sheet, so excluding one under `lite`
  is a no-op.
- **Testing**: `ensureHostFile`

If a deployment cannot provide a method, it must return
`EngineError {code: "unsupported", ...}` with the method name in `details`; it
must never return a plausible empty domain value. The current classification is
exported as `METHOD_SUPPORT` and is pinned by the API contract test. Every
public method is implemented and dispatched; the only non-public method is the
test-only host-file helper.

## Frontend contract

The browser client is served at the configured `PUBLIC_BASE_PATH` (`/` by
default). Its default `public-base` content profile ships the bundled baseline
under `apps/client/public/content` — the core rules baseline, the System
Reference Document 5.1 and 5.2.1 subsets, and the authored system files — with
exactly these source categories: `Core`, `Internal`, `Player’s Handbook`,
`Player’s Handbook (2024)` and `System Reference Document`. The exact file list
and its digest are pinned in `apps/client/config/contentManifest.test.mjs`.
The raw corpus is never part of the shipped baseline: users may upload it, and
the explicit local `reviewed-test` (fixture compatibility set) and `full`
(entire corpus) profiles remain available for local inspection.
The Vite plugin emits the selected manifest and assets for builds and serves the
same manifest/XML subtree during development.
Every browser sheet-template URL resolves against that configured base; an
origin-root candidate is never attempted. Missing browser assets return a
`conflict` diagnostic naming the base and files. A rejected template load is
retryable, while a successful bundle remains cached. Node/no-location rendering
retains the generated fallback path.
The typed module-worker adapter preserves the persisted IndexedDB database
(schema/version 5; its name comes from the host shell and is a frozen storage contract), localStore/orchestration, homebrew
upload/patch/remove, ruleset/source controls, migration, and sheet journeys.
Character restore waits for both bundled and persisted content. Uploaded-content
mutations reconcile the live worker to the exact persisted path-and-byte set:
removed/replaced paths call `removeUploaded`, changed paths are re-ingested, and
a failed persistence step restores the prior live set. `contentElement` includes
the public description plus equipment `rarity` and
`attunement: {required, addition}` metadata when applicable.

## Resource, sheet, and public-client contract

- `getSpellcasting` and `setPrepared` return `SpellcasterDto[]`; every caster
  includes `resource: SpellResourceDto`.
- `SpellResourceDto` is the discriminated union
  `{mode: "slots", canUseSpellPoints: boolean}` or
  `{mode: "spellPoints", currentPoints: number, maximumPoints: number,
  costs: SpellPointCostDto[], shared: boolean, canUseSpellPoints: true}`.
  `SpellPointCostDto` is `{spellLevel, points, oncePerLongRest}` — the public
  per-slot-level conversion table (2/3/5/6/7/9/10/11/13, levels 6-9 once per
  long rest). `maximumPoints` is the caster's own slot table weighted by
  those costs, so half/third casters project their own totals.
  The reviewed Wizard 5 Spell Points option still projects `27/27`, with
  `slotsPerLevel` zeroed so callers cannot display a contradictory active
  ordinary-slot pool. Pact Magic remains slot-based. Shared multiclass pools
  and point spending/depletion persistence remain outside this contract
  (`currentPoints === maximumPoints`).
- `SpellcasterDto` carries `allowReplace: boolean`, the caster feature's
  `allowReplace` spellcasting attribute (Sorcerer/Bard/Ranger/Warlock-style
  spell swap on level-up); the builder's free re-selection already supersets
  the swap flow, so this is informational for the client.
- Repeated selection rules are identified by `type`, `name`, and their own
  `requiredLevel`. Spell browse eligibility and slot expansion use that
  rule-local level, so same-name Wizard spellbook rules at later class levels
  do not collapse into the first rule.
- `SelectionRuleDetail` includes `isOptional`, propagated from authored XML
  `optional="true"`, and `hasAvailableOptions`, derived from legal candidates.
  Optional and zero-option rows stay visible but do not display an incomplete
  notification; invalidated-choice warnings remain visible.
- `SelectionRuleDetail` includes `allocatesAbilityScores`, true when resolving
  the rule raises an ability score. Clients group flagged rules under ability
  scores wherever the content authored the choice: type-authored improvements
  (class, 2024 backgrounds, half-feats), `Feat Feature` sub-choices
  (Fey-Touched, 2014 Resilient) and `Racial Trait` choices (half-elf,
  dragonmarks). Ancestry pickers that merely bundle stats (Dwarven Subrace,
  Dragonborn Variant) and the 2024 classes' level-4 "Ability Score
  Improvement (X N)" feat chooser stay unflagged.
- Known-spell reconciliation de-duplicates repeated wrapper registrations in
  first-seen order. Preparation rewrites keep cantrips exclusively in
  `<cantrips>` and never serialize them into `<spells>`.
- A generated class Ability Score Improvement creates two level-gated ability
  selections over the six internal ability identities. Those internal helpers
  are synthesized only for libraries containing class ASI options, and only
  when an identity is absent.
- Full sheets carry the same resource union. Spell Points retain known
  leveled-spell sections, display the current point total, and suppress
  contradictory ordinary-slot totals. A full notes page is included when
  either notes field is non-empty. Fresh live and development acceptance for
  C1/C2/C3 matched at 4/6/3 pages respectively; the historical audit's 5/7/4
  page counts remain recorded as historical evidence.
- Sheet feature streams use a stable parent-before-child dependency order for
  registered feature selections, so Ranger Favored Enemy and Natural Explorer
  prose precede their selected values even when an imported `.dnd5e` sum is
  reversed. The PDF writer uses an 8pt feature baseline, bounded adaptive
  fitting down to 6pt, and continuation pages for feature prose and card descriptions.
- The Sheet tab and split preview make the PDF canvas the bounded scroll owner.
  Sheet cache keys include the renderer revision, content/library revision, and
  mutation tick, so profile or layout changes cannot reuse stale PDFs.
- Public client mode exposes one `Create & Open` action and the Additional
  Content upload/remove lifecycle. Internal development controls are hidden
  unless `VITE_FCB_DEVELOPMENT_MODE=true` exactly.
- The browser sheet gate requires deterministic identity after reload, a real
  rendered PDF canvas, every template, label sheet and font request exactly once under the
  configured base with HTTP 200, and no unclassified page, worker, request, or
  console error. One exact malformed embedded data-image diagnostic from the
  public template bundle is classified; a changed or additional diagnostic
  fails the gate.
- Uploading content does not make arbitrary feats DM-grantable. The DM feat
  picker admits only feats whose `declaredBy` path is an exact member of the
  active `public-base` profile; path-prefix lookalikes are rejected.

## Source catalogue and character-source contract

- `contentSources` returns source records with `id`, publication `name`,
  `source`, `author`, `publisher`, `releaseDate`, `isPlaytest`, `hasElements`,
  and `canToggle`, sorted deterministically by display name and then ID.
  `publisher` is the author setter's `abbreviation` attribute (upper-cased),
  else the full author text; `author` keeps the full co-author text.
- `getCharacterSources` and `setCharacterSources` return publisher-grouped
  `groups`, normalized `restrictedSourceIds`,
  `unavailableRestrictedSourceIds`, and a compatibility `sources` field for
  restricted records. Required sources form a leading `Core` group; every
  other group holds one publisher's books, so "Wizards of the Coast, Penny
  Arcade" joins "Wizards of the Coast". A group sharing an abbreviation is
  named by its most common author text before the first comma. Group
  `canToggle` is true when at least one member can be toggled.
- Source mutation input trims, removes empty IDs, and de-duplicates while
  retaining IDs absent from the currently loaded corpus. Such IDs are reported
  as unavailable instead of causing a not-found failure, so later content
  imports can restore them. IDs of required (`canToggle: false`) sources are
  dropped, and restriction checks ignore them when an imported file lists
  them.
- `setCharacterSources` also removes the character's choices from newly
  disabled books in the same mutation: every filled selection whose chosen
  element comes from a restricted source is cleared with its granted subtree,
  and spells the character can no longer use are dropped from selections and
  preparation. Class and multiclass picks are kept, since clearing one would
  delete its levels. The response adds `removedSelections` and
  `keptSelections` (`{ name, type }` lists, spells typed `Spell`) and keeps
  `removedSpellNames` for older clients.
- After bundled boot, the client replays persisted uploaded files through
  `ingestUploaded` before publishing the supplements-ready state. A character
  source mutation returns the engine's source response and persists local state
  without an unnecessary character-detail refetch.
- Source identity matches a normalized display name (case, typographic vs
  straight apostrophes and quotes, collapsed whitespace), so content whose
  `source` attribute drifts from its Source element's name is still restricted
  and classified by the Source element's ruleset.
- `setCharacterSources` creates the `<sources><restricted>` region when the
  imported document has none; a document without the region no longer rejects
  the mutation.
- Content reads that take a character — `equipmentCategories(id?)` and
  `contentElements({characterId?})` — prune elements from the character's
  disabled sources as well as the other ruleset, exactly like the selection
  pickers and `getSpellBrowse`. Without an id they read the whole library
  (the content-manager view).

## DTOs

Response payloads are defined in the engine model files. Rule:
DTO shapes follow what the client UI consumes (it is the only consumer); where the
UI has no opinion, we design freely. All payloads are camelCase JSON; `null` and
absent are distinguished; timings/boot metadata follow the boot result shape.

## Progression contract

- Main starting-class `rndhp` remains a 20-value serialized list, but its first
  value is the class hit-die maximum (Fighter 10, Wizard 6). All later values
  retain the existing seeded/random behavior. A later multiclass's first class
  roll is not forced to its maximum.
- `ProgressionDto` is `{canLevelUp, canLevelDown, hasMainClass, canMulticlass,
  hasMulticlass, multiclassRuleEnabled, classes, usesAverageHitPoints,
  levelHistory, canUndoDelevel}`. Each class includes `{classId, className,
  level, isMulticlass, hitDie, hitPointValues}`; each history entry includes
  `{totalLevel, classId, className, classLevel, isMulticlass, isClassStart,
  isPending, canRemove}`.
- `setHitPointRoll(id, {classId, classLevel, value})` returns `ProgressionDto`
  directly, exactly like `getProgression`; it never returns character detail.
  The workspace may refresh detail separately.
- `levelUp(id, {mode: "main"})` advances the main class.
- `levelUpTo(id, {level})` advances the main class to `level` in one call (one
  undo step), surfacing every intervening choice on the Build tab. Errors:
  `invalid-argument` when `level` is not a whole number above the current level
  and at most 20; `conflict` when the character has no main class. A failure
  part-way rolls the character back to its pre-call state.
- A level-gated `<grant>` on a feature registered at an earlier level — a
  class feature's, gated on the class level; a race's, feat's or item's, gated
  on the character level — registers when that level arrives and is removed
  again by the delevel that takes the level away.
- A Spell select's `$(spellcasting:slots)` token expands to every slot level the
  caster has at its current level in its own class (multiclass-variant levels
  count toward that class; a subclass caster such as the Eldritch Knight counts
  the class that offers the subclass), not the level the select was gained at
  and not the combined multiclass table. A caster with `prepare=true` and
  without `listKnown=true` acquires spells into a book: its selects, including
  Savant and renamed homebrew choices, keep their acquisition-level ceiling.
  The spell browse DTO's `maxSpellLevel` and `activeSpellLevels` report the same
  ceiling. This bounds repertoire editing; it does not enforce advancement
  replacement counts (such as the Sorcerer's one replacement per class level).
- A delevel that lowers that ceiling below a filled pick's spell level clears
  the pick and reports its select in `requiredRepicks`, as it does for a choice
  granted above the new level.
- `levelUp(id, {mode: "new-multiclass"})` creates an unresolved multiclass level
  and its `Multiclass` selection. The progression history exposes that entry with
  `classId`/`classLevel` as `null`, `className: "Unresolved multiclass"`, and
  `isPending: true`; `canLevelUp` and `canMulticlass` remain derived normally.
- Filling that selection starts the chosen multiclass at class level 1.
  `levelUp(id, {mode: "multiclass", classId})` only advances an already-started
  multiclass; it never silently starts one.
- Multiclass choices evaluate the candidate requirements against the current
  abilities and registrations. Same-name choices use stable
  source/ruleset ordering. Advancing a class activates level-gated selections
  nested on features registered at earlier levels; delevel and undo remove/restore
  those exact inserted spans.

## Character option DTOs

- `getOptionalRules` → `[{key, kind, elementId, name, source, description, enabled, defaultEnabled, eligible, unavailableReason}]`
- `getCharacterAdjustments` → `[{key, elementId, name, source, category, description, enabled, grantedBy}]`; `enabled` is true only for a registration the character owns (a top-level elements node or a carried control record), so `setCharacterControl` can switch it off; `grantedBy` lists the display names of inventory records whose own registration carries the element (an attuned item granting a Supernatural Gift), which is on the character but not removable here
- `getCharacterControls` → `[{key, elementId, name, type, enabled}]`; `setCharacterControl({key, enabled})` accepts `option:`/`item:` prefixes
- `getRulesetMode` → `{mode, availableModes, rules2014Count, rules2024Count, sharedCount, incompatibleWith2014, incompatibleWith2024}`
- `setRulesetMode(mode)` → `{mode, repaired, removed, unresolved}` with `RulesetChangeItemDto {ruleName, ruleType, previousElementId, previousElementName, previousSource, newElementId, newElementName, newSource}`
- `LoadIssueDto` (in `getCharacter` detail): `{kind, ruleType, ruleName, requiredLevel, previousElementId, previousElementName, message}` (kinds: `elementMissing`, `equipmentMissing`, `selectionInvalidated`)
- `getInventory` → `InventoryDto {items: InventoryItemDto[], coins: Coinage, equipmentWeight: number, attunedItemCount: number, maxAttunedItemCount: number}`
- `InventoryItemDto`: `{identifier, itemId, name, type, amount, isEquippable, isEquipped, equippedLocation, isAttunable, isAttuned, displayPrice, source, equipLocations, weight, category, isPhysicalEquipment, description, rarity, attunement: {required, addition}, isExtractable, extractableContents: {itemId, name, amount}[], hasAttackRow: boolean, card: boolean, sidebar: boolean}`
  (`hasAttackRow` is true when an attack row is stored for this inventory record; a slotless item that can be worn — real equipment that is not a weapon, armor, an unbased magic overlay or a stackable consumable — has `equipLocations: ["worn"]`, `isEquippable: true`, and `equippedLocation: null` while worn)
- `card` mirrors the record's `<details card="true">` (an item card on the full sheet) and `sidebar` its `<item sidebar="true">` (its description in the equipment page's inventory notes). `setItemPresentation({identifier, card?, sidebar?})` toggles either flag and `setItemCards({policy: "all"|"significant"|"none"})` sets every physical record's card at once (control records and records whose content is not installed are skipped); both return `InventoryDto`. A flag is only ever written as `"true"`: switching on rewrites another value (an imported `card="false"`) or appends the attribute after the tag's last one, switching off removes it whole, and a record with no `<details>` gains the empty details element a new record carries. All other bytes are unchanged, so toggling back restores the imported bytes. `significant` means `itemSignificance` (`content/equipment/significance.ts`) is not `trivial`: magic items, tools (tools, poison, spellcasting foci, instruments) and adventuring gear whose description reads as rules.
- Any record, book or custom, can carry its own name and notes on this character. `setItemDetails(id, identifier, {name?, notes?})` writes the record's `<details><name>` and `<notes>` (an omitted field is left alone, an empty name goes back to the item's own, a value equal to the stored one writes nothing, and clearing both of a record that had neither restores its bytes) and returns `InventoryDto`. A name is one line of at most 120 characters, notes at most 2000; both refuse control characters. The record keeps its element, so its rules and attack math do not change. `InventoryItemDto` carries `name` (the custom name when there is one), `customName` ("" when none), `baseName` (the physical base element, `Longsword`), `defaultName` (what the record is called without a custom name, `Frostbite` or `Longsword +1`) and `isCustom` (the record's element was made on the character or in a homebrew collection). The name is what the inventory, the record's automatic attack row (unless the player typed a row name by hand), the equipment lines (`Grandfather's Blade (Scimitar)`), the equipment tables, the item cards and the armor and shield boxes print.
- A Magic Item laid over a base weapon may shape the weapon's attack row through setters, applied only while the wielder is attuned when the item requires attunement: `extra damage` (repeatable, `type` attribute; `1d8+3 slashing + 1d6 cold`), `attack ability` (the ability its attack and damage rolls use by default), `damage` (with `type`), `versatile` and `range` (replace the base's), and `weapon properties` (comma-separated property ids replacing the base's own). The `weapon` and `armor` base setters accept an element id as well as a name or a tag expression; an id names exactly one edition's base.
- `getItemBaseOptions(itemId)` → `{slot: "weapon"|"armor"|null, options: {id, name}[]}`
- `addItem({itemId, amount, baseElementId, cardPolicy?})` (`cardPolicy: "significant"` writes `card="true"` only for significant items; omitted or `"all"` cards every new record) / `removeItem(identifier, amount?)` (amount omitted removes the whole record) / `setItemAmount(identifier, {amount})` (a positive integer; registrations, equip and attunement state do not change) / `equipItem(identifier, {location})` (keys `primary|secondary|armor|primary-twohanded|worn|none`; `worn` writes `<equipped>true</equipped>` with no location, evicts nothing and is never applied automatically on add) / `attuneItem(identifier, {attuned})` / `setItemStorage(identifier, {storage, amount?})` (`amount` omitted moves the whole record; a smaller amount splits off that many units into a new plain record or an identical stack already in the destination) / `setCoins(Coinage)` / `extractItem(identifier, selections?, {cardPolicy?}?)` (the policy is `addItem`'s, applied to each unpacked record; unpacked armor is worn the way `addItem` would wear it, body armor first and then a shield, each only into a free location, so it never evicts worn armor or an occupied off hand, including a two-handed weapon; every other unpacked record, weapons included, stays carried; the unpacking and these equips are one stored change) — all return `InventoryDto`. A carried add of an identical plain stackable item (same `itemId`, no adorners, not equipped or attuned, not stowed) grows that record instead of appending a row; it is only the resulting `amount` that changes, so the caller can identify the stack from `InventoryDto` alone.
- An item conveys its benefits while it is not stowed and: for a weapon or armor, equipped (and attuned when it requires attunement); for a slotless item, attuned, or worn when it requires no attunement. While it does, the item's own element registers as a top-level `<elements>` node holding what it grants (the compatible imported shape for an adorner such as Weapon of Warning), with its `<sum>` entries following the base's (`base, base grants, adorner, adorner grants`); an item with nothing to grant or choose registers as a sum entry alone. Spells, choices, languages, senses and resistances the item grants therefore reach the same surfaces a feat's do, and leave with the item. A file saved in the earlier flat form (sum entries, no node) is migrated on import; an imported compatible file round-trips byte-identically.

## Inventory and attack DTOs

- `getAttacks` → `AttackDto[]` (rows in stored order; sheet positions among displayed rows):
  `{id, name, range, bonus, damage, description, isDisplayed, isAutomatic, isCurrentlyEquipped, sheetPosition: number|null, kind: "weapon"|"manual"|"calculated"|"spell"|"unarmed", abilityMode: "default"|"explicit"|null, ability: string|null, defaultAbility: string|null, generated: {name, range, bonus, damage, description}|null, overriddenFields: string[], calculation: {source, ability, useProficiency, attackMiscBonus, damageDice, addAbilityToDamage, damageMiscBonus, damageType, casterIdentifier: string|null}|null, source: {casterIdentifier, spellId, warning, beamCount}|null, unarmed: {dice: string}|null, computation: {attackBonusContributions: {label, value}[], appliedModifiers: {id, name, field, effect}[], sourceNotes: string[], attackCount: number, isPerHit: boolean}|null}`
- `AttackDto.mastery: {name, active} | null` — the 2024 weapon-mastery property the weapon carries (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex, resolved from the weapon's `Weapon Property` support and the content's Weapon Mastery features); `active` only when the character has chosen that weapon's mastery. Non-weapon rows and 2014 weapons are `null`. When active, the generated weapon description ends with `, Mastery: <Name>`. A stored description exactly matching either the bare property list or that weapon's mastery-suffixed list counts as generated, including after mastery is cleared or replaced; other custom prose remains an override.
- `getAttackOptions` → `{abilities: {name, abbreviation}[] (STR/DEX/CON/INT/WIS/CHA), casters: [], spells: [], weapons: {identifier, itemId, name, isEquipped}[]}` — `weapons` lists owned weapons that have no attack row.
- `createAttack({mode: "manual", name, range, bonus, damage, description} | {mode: "calculated", name, range, description?, calculationSource, abilityName, useProficiency, attackMiscBonus, damageDice, addAbilityToDamage, damageMiscBonus, damageType} | {mode: "spell", casterIdentifier, spellId, name?, range?, bonus?, damage?, description?} | {mode: "unarmed"} | {mode: "weapon", identifier})` → `AttackDto[]`. Spell rows resolve generated fields and computation from the current known-spell option; non-null display fields are explicit overrides. Weapon mode appends the automatic row for an owned weapon that has none (`not-found` for a missing inventory record, `invalid-argument` for a non-weapon, `conflict` when a row already exists); it is the same row an equip would have created, so it may later be deleted while unequipped and is never duplicated by an equip.
- `updateAttack(attackId, partial)` — display fields (name/range/bonus/damage/description), weapon and unarmed rows accept `abilityMode` + `abilityName` (explicit ability override), unarmed rows additionally accept `damageDice` (a manual damage-die override; `""` restores the derived die), calculated rows accept the calculation fields → `AttackDto[]`. For generated weapon display fields, explicit `null` or `undefined` clears the stored override and restores the generated value; the strings `"null"` and `"undefined"` are never serialized.
- Unarmed rows carry no inventory item. Their damage die, default ability, and bonuses resolve from the character's content statistics on every read: `martial arts:dice` (both rulesets), `unarmed fighting:size`, and `unarmed strike:dice` replace the die (largest wins, base `1`); `unarmed strike:attack|damage` and `unarmed:attack|damage` sum into the totals; the presence of `martial arts:attack|damage` or `martial arts:ability modifier` allows the higher of STR/DEX. Proficiency always applies, and the `melee:*` category keys never do. Only the die override is persisted, as `unarmed-dice` on the attack node.
- A mutation that gives the character `martial arts:dice` (absent or 0 before, present after — choosing, levelling into or multiclassing into Monk) appends one unarmed row (`kind="unarmed"`, no die override) at the end of the list in the same operation, unless a `kind="unarmed"` row or any row named "Unarmed Strike" (case-insensitive) already exists. Only that transition inserts: imports and snapshot loads never add the row, and a deleted row is not re-added by later edits.
- `content/system/system-unarmed-riders.xml` appends those keys to published items and feats that the upstream corpus ships as prose only (both Eldritch Claw Tattoo printings, Wraps of Unarmed Prowess, Tavern Brawler, the 2024 Unarmed Fighting feat). Appends are gathered across every ingested file and applied once all elements are known, so they patch bundled and user-imported content alike; an append whose target is absent records an `append-target` diagnostic and is otherwise inert. All `unarmed strike:dice` rules share one bonus bucket so the largest die wins instead of the values summing.
- Spell rows persist the stable caster name, spell id, and override-field names in the `.dnd5e` attack node. Session-only caster UUIDs are regenerated on load and are never used as durable identity.
- `setAttackVisibility(attackId, {isDisplayed})` / `moveAttack(attackId, {direction: "up"|"down"})` / `deleteAttack(attackId)` — all return `AttackDto[]`; deleting an equipped weapon's automatic row is rejected (conflict)

## Magic, grants, and companion DTOs

### Magic reads and mutations

- `getSpellcasting` → `SpellcasterDto[]` (order: class casters in caster block
  order, then feature casters in registration order):
  `{identifier, name, kind: "class"|"feature", ability, attackModifier, saveDc,
  requiresPreparation, allowReplace, prepareCount, currentPreparedCount,
  slotsPerLevel: number[9], knownSpells: KnownSpellDto[], maxSpellLevel, resource}`
  - A `"feature"` caster projects the spells a feat or trait grants or lets the
    character choose outside any spellcasting feature (Magic Initiate,
    Fey-Touched, Ritual Caster, a tiefling legacy, spell-granting invocations),
    grouped under the granting feature and named by it. It has zero slots,
    `requiresPreparation: false`, `prepareCount: 0`, `allowReplace: false`, a
    slot resource that cannot use spell points, and attack/DC from proficiency
    plus the ability the feature nominates (the sibling Intelligence/Wisdom/
    Charisma sub-feature, else the first class caster's ability, else
    Intelligence). It is read-only: `setPrepared` and the grant mutations
    return 404 for it. A character with no `<magic>` block still gets its
    feature casters. A `"feature"` caster is also how additional spells reach
    the sheet: the `<magic><additional>` entries and the generated
    "Additional ... Spell" item proxies belong to no caster block, so any the
    class casters' projected lists do not already carry project as one or more
    blocks named `"Additional Spells"` of the same slotless read-only shape.
    A spell a class list already has stays there instead, with no block; the
    same spell never appears twice. Blocks group by their printed header — all
    spells sharing one ability, attack bonus and save DC — so grants whose
    casting values differ never share a block. Their spells are always prepared
    and never counted in `currentPreparedCount`. A grant names no ability, so
    the block reports the character's highest of Intelligence, Wisdom and
    Charisma (ties in that order) — a display default, not a rules claim.
    Unlike a feat's spells these stay DM grants: `removeGrantedSpell` still
    removes them, being keyed by spell id and never by caster. Spell cards keep
    filing granted spells under the `<additional>` entry's own `source`.
- `KnownSpellDto`: `{id, name, source, isPrepared, isChosen, level, school,
  isRitual, isConcentration, isAlwaysPrepared, castingTime, components, range,
  duration, description, usage?, usageNote?, grantedBy?}`
  - `grantedBy` (`{elementId, name, isCustom}`) names the feature or item that
    gave the character a spell a feature caster projects; the spell lists show
    it in place of the spell's own book, with a Custom badge for custom content.
  - `isPrepared` excludes always-prepared spells (their count is not in
    `currentPreparedCount`); `isAlwaysPrepared`/`isChosen` derive from the
    character's spell rules (domain/oath/known-spell rules), NOT from XML
    attributes (a stale `always-prepared="true"` in the file shows as false).
  - A `<grant type="Spell">` naming a `spellcasting` target projects as always
    prepared for that caster whether or not it carries `prepared="true"`, once
    its target has registered (so `level=` and `<requirements>` gates hold).
    This is how the 2024 files express Divine Smite, Find Steed and every
    subclass spell table. Full-list and known casters alike receive them.
  - `usage` (feature casters, levelled spells only) is the free-cast allowance
    the granting feature attaches: its `<sheet usage="…">` when declared, else
    `"1/Long Rest"` when the feature's text promises a cast without a spell
    slot that returns on a long rest, else absent. It is read from content,
    not assumed.
  - A class caster's granted spell normally carries `usage` only when the
    granting element both declares `<sheet usage="…">` and promises a slotless
    cast. Reviewed content-ID exceptions cover Grasping Tentacles and Lunar
    Embodiment, whose allowances are not expressed by a sheet usage. Lunar
    allowances follow the selected phase; published content limits this to its
    first-level spell, while the playtest grants one use per eligible spell.
    Mantle of Majesty labels one feature activation rather than one Command;
    Fateful Naming labels the shared Bane/Bless pool. Optional `usageNote`
    explains these conditions in the Magic tab's allowance tooltip.
    `{{stat}}` tokens resolve against the statistics (Favored Enemy →
    `"2/Long Rest"`); a usage with an unresolvable token is left absent.
  - Prepared casters: `knownSpells` = the caster's full spell list (duplicates
    across sources included, e.g. PHB + PHB24). Known casters (bard/ranger/
    warlock): the character's known spells only (warlock: cantrips + chosen).
  - Ordering rules are pinned by the engine's DTO tests and must be reproduced
    exactly.
- `setPrepared` returns the updated `SpellcasterDto[]`. Errors (404 + body):
  unknown spell `{"error":"Spell '<id>' is not known by this caster."}`;
  unprepare of an always-prepared spell `{"error":"Spell '<id>' is not
  prepared by this caster."}`; unknown caster `{"error":"No spellcaster
  '<id>' on the loaded character."}`. Missing `spellId` → 400 validation
  (`SpellId` required). The preparation limit is NOT enforced by the engine —
  it is advisory. A `setPrepared` on an already-prepared spell moves it within
  the prepared order.
- `getSpellBrowse(ruleId)` → `SpellBrowseDto {ruleIdentifier, ruleName,
  spellcastingName, selectionCount, selectedCount, slots:
  SpellRuleSlotDto[]{number, spellId, spellName}, activeSpellLevels,
  maxSpellLevel, spells: SpellBrowseEntryDto[]}`; `SpellBrowseEntryDto {id,
  name, source, level, school, isRitual, isConcentration, components, status,
  selectedNumber, castingTime, range, duration, description}`. Errors: unknown
  rule → 404 `{"error":
  "Selection rule '<id>' does not exist on the loaded character."}`;
  non-Spell rule → 404 `{"error":"Selection rule '<id>' is not a Spell
  rule."}`.
- Spell selections take `{elementId, number}` where `number` is the 1-based
  slot number; the spell registers into the caster state and
  is re-serialized with `always-prepared="true" known="true"` (wizard
  spellbook). Numbered groups retain `null` holes, and a partially filled group
  reports `hasSelection: true`. Selecting an occupied numbered Spell or
  Companion slot replaces that slot's previous registration, element subtree,
  and sum entry atomically.
- Serialization: ANY prepared mutation rewrites the whole `<spells>` section of
  the touched caster: prepared spells first (level then name, attributes
  preserved), then the caster's full spell list minus the prepared ids (level
  then name, then source; PHB before PHB24; duplicates included). `<cantrips>`
  and `<slots>` are preserved; `<magic>` root attributes preserved. With no
  magic mutation, imported magic bytes are preserved byte for byte.
- Spell points: `option:ID_INTERNAL_OPTION_ALLOW_SPELL_POINTS` via the controls
  route. With points enabled the `spellcasting:slots:N` statistics zero out
  while `{class}:spellcasting:slots:N` and `warlock:*` (Pact Magic) remain.
  The resource contract returns `resource.mode: "spellPoints"` and zeroes
  `slotsPerLevel`, preventing contradictory active slot totals.

### DM grants

`add/removeGrantedSpell|Feat|AbilityScore|Element` and `getDmGrants` are
engine-defined methods with no counterpart elsewhere. Contract:
- Requests are exact: spell add `{spellId, caster?}` and remove `{spellId}`; feat add/remove `{featId}`;
  ability-score add `{abilityElementIds}` and remove `{abilityElementId}`;
  element add/remove `{elementId}`.
- `addGrantedElement` is the general form: it registers any grantable feature
  at the top level of the elements tree, whether it comes from a book, a
  homebrew collection or the character's own pack. Grantable types are Feat,
  Feat Feature, Ability Score Improvement, Racial Trait, Class Feature,
  Archetype Feature, Background Feature, Dragonmark Feature, Language Feature,
  Custom Feature, Language, Proficiency and Vision. Anything else (a spell, a
  class, an item) answers `not-found`. `addGrantedFeat` and
  `addGrantedAbilityScore` are the same operation with a narrower type check.
  Another character's own custom content answers `not-found`.
- `getDmGrants` returns `DmGrantDto[]` (`packages/api/src/custom.ts`): `{kind,
  id, name, source, type, isCustom, origin, section}`. `kind` is `spell`,
  `feat`, `ability` or `feature` (every other grantable type); `origin` is
  `book`, `character` (the character's own pack) or `homebrew`; `section` is
  the Build section key the type belongs in (`race`, `class`, `background`,
  `abilities`, `languages`, `proficiencies`, `feats`, or `other`) and null for
  spells.
- Granted spells serialize as `<magic><additional><spell name level id
  source="Additional Spell, {Name}"/></additional></magic>`. Rule-granted spells
  additionally carry the granting feature's name as `source`, e.g.
  `source="Wind Caller"`.
- `addGrantedSpell` may name the class caster that casts the spell (`caster`, a
  spellcasting name the character has; anything else answers
  `invalid-argument`). The entry's source then reads `Additional Spell, {Name}
  ({Caster})`: still a DM grant by its prefix and removable, with the caster in
  a closing parenthesis that only counts when it is one of the character's
  casters. The spell then joins that caster's `knownSpells`, always prepared and
  outside the list and level limits it was granted past, and its attack row uses
  that caster's attack bonus and save DC. Without a caster it gathers in the
  "Additional Spells" block, as before. Removing the last grant removes the
  `<additional>` block it created.
- `<additional>` blocks are preserved and NOT rebuilt by prepared mutations
  (wizard XML keeps `<additional>`).
- Granted elements register through the existing registration + sum machinery.
  Each is one registration in `registered-count`, like a granted feat.
- DM ownership is deliberately narrow: only direct top-level grantable nodes
  and `<additional>` spells using the DM source convention are listed or
  removable. Nested class/selection feats and ASIs are not DM grants.
  Duplicate additions and multi-ASI requests are atomic: conflict or validation
  failure leaves the entire character unchanged.
- `registeredElements` entries in the character detail carry `isCustom` and
  `origin`, so the Build tab can badge custom content wherever it appears.

### Custom content

A custom element is made on a character without writing XML. The wire contract
is `packages/api/src/custom.ts`; the compiler, the catalogue a form offers and
the pure helpers are `@forge-cb/engine/custom` (`packages/engine/src/custom/`).

**Items.** A character pack also holds custom items (`CustomItemDraft`, same `schemaVersion`, told apart from a feature by `template`: `weapon`, `armor`, `worn`, `gear`). `base` (`{id, name, shield?}`) is the library weapon or armor a `weapon` or `armor` item sits on; `bonus` is the enhancement bonus (weapon) or the armor class bonus (armor); `weapon` holds `extraDamage` (dice and a damage type, up to four), `attackAbility`, `damage`, `versatile`, `range` and `properties`; a `worn` item has a `slot`; `rarity`, `attunement`, `uses` (sheet text about charges, not tracked), `weight` and `cost` (worn items and gear), `stackable` (gear) and `blocks` (modifiers and grants that apply while the item conveys its benefits: wielded or worn, and attuned when `attunement` is set; choices are refused, an item grants a custom feature that holds them). `weapon` and `armor` compile to a Magic Item whose `weapon`/`armor` setter names the base by element id, `worn` to a Magic Item, `gear` to an Item. Adding one to the inventory is the ordinary `addItem` with the base as `baseElementId`.

**Spells.** A character pack also holds custom spells (`CustomSpellDraft`, same `schemaVersion`, `template: "spell"`): `level` (0 is a cantrip), `school`, `castingTime`, `range`, `duration`, `components` (`verbal`, `somatic`, `material`, `materialText`), `concentration`, `ritual`, `description`, `higherLevels` (text for casting in a higher slot), `classes` (class list names) and `mechanics`. A spell compiles to an ordinary `Spell` element: the setters every book spell carries (`level`, `school`, `time`, `duration`, `range`, `hasVerbalComponent`, `hasSomaticComponent`, `hasMaterialComponent`, `materialComponent`, `isConcentration`, `isRitual`), each class in `classes` as a `<supports>` tag (so a class's list and spell pickers offer it, as they offer a book spell), and the shape tags a book spell carries (`Spell Attack` with `Ranged` or `Melee`, `Spell Saving Throw`, `Healing Spell`). `mechanics` compiles to the structured spell setters, which the attack rows read instead of the spell's text:
- `spell roll`: `ranged attack`, `melee attack`, `saving throw` or `none`. Its presence marks the spell as structured; `none` is a spell with no attack row whatever its text says. A spell without it is read from its text exactly as a book spell is.
- `spell save` (an ability name) and `spell save success` (`half`) for a saving throw; a save that deals no damage has no row, as in the text reading.
- `spell damage` (repeatable, `type` attribute): one damage term (`1d10`, `type="cold"`). The row prints the terms joined by ` + `.
- `spell cantrip scaling` (repeatable, `level` attribute): from that character level the first damage term's dice are the value. `spell slot scaling`: dice each slot level above the spell's own adds; the row carries the same "Higher-level slots add 1d6 per slot level above 2nd." warning the text reading gives.
- `spell modifier` (`true`): the spellcasting modifier joins the damage. `spell healing`: dice the spell restores; carried on the element for its text, never an attack row.
Validation names the field: a save needs its ability, a save field on another roll is refused, a cantrip scales by tier and a levelled spell by slot, tier levels are 2-20 and distinct, and dice are written `2d8`. The draft's `id` is the element id, so a spell made under the id a pack's grant names resolves that grant.

**Spell aliases.** `setSpellAlias(id, spellId, {name?, note?})` gives any spell the library has (book or custom) a display name (at most 80 characters) and a note (500) on one character, and returns `SpellcasterDto[]`. An omitted field is left alone; an empty name goes back to the spell's own; clearing both removes the entry. Aliases live in a second child of the builder block, `<spell-aliases schema="1"><![CDATA[{"ID_SPELL":{"name":"…","note":"…"}}]]></spell-aliases>`, so a file that uses none has no trace of them and keeps its bytes; a block that is not valid JSON answers `conflict` and is left alone. `KnownSpellDto.alias` (`{name, note}`) is present only on an aliased spell and `name` stays the real name. The Magic tab leads with the alias; the sheet's spell list prints the alias alone, the spell cards print `Alias (Real name)` and close with the note, and the spell's attack option and attack row read `Alias (Real name)`, the stored row text included. The character state carries `spellAliases`, so a character snapshot written before it fails the shape check and the character loads from its file.

**Trackers, switches and scale values.** A limited use is a tracker (`TrackerDef`): `id`, `label`, `max` (a number, or a value that follows the character: a value from the menu with an optional minimum, a class level, a scale value of the same draft, or an engine statistic), `unit` (uses, charges, minutes, points), `recharge` (`shortRest`, `longRest`, `dawn`, `day`, `never`, `diceRoll`), `regain` (a dice-roll tracker's text, "1d6+1 at dawn"), `pool` and `spendOnSwitch`. A feature draft carries `trackers` and `scales`; an item draft carries `trackers` whose maximums are fixed numbers. A scale value (`ScaleValue`) is a named per-level table, a count or a die; a modifier value, a tracker maximum and sheet text can read it (`{{scale:name}}`). The compiler writes a count as level-gated statistics under `scale:<name>` (each step adds the difference to the last, so the total is the table's value), a die as inline text from each level, and a tracker maximum that follows the character as `uses:<id>` base statistics (a minimum is a second base rule, the larger wins). The sheet usage line is written from the trackers unless the author wrote one, and an item states its charges in its text. Validation names the field of every mistake.

`getResources(id)` lists every tracker the character has, from four sources: a custom draft's trackers, the free cast of a spell a custom feature grants (`usage` on the grant, one tracker per spell), trackers added by hand, and book features whose sheet usage line states a count and a rest once its token is filled in (`2/Short Rest`, `{{proficiency}}/Long Rest`; shapes the engine does not read, such as `Channel Divinity` or `1/Turn`, are not tracked). Trackers naming one pool are one resource (`pool:<name>`), sized by the largest member. `TrackerDto` carries `max`, `used`, `remaining`, its sources (book, custom or manual) and `isCustom`. `setTrackerUsed` sets how many are spent, clamped to the maximum. `restCharacter` refills by recharge: a short rest the short-rest trackers; a long rest also long-rest, dawn and day ones (there is no separate new-day action); `never` and `diceRoll` trackers are left to the player. `saveManualTracker` and `deleteManualTracker` keep a tracker with a fixed maximum on the Resources page alone.

A switch is a name. A custom modifier gated "only while a switch is on" compiles to `condition="<name>"`; the statistics calculator applies a conditional rule while its switch is on, for elements made in the builder only: a book rule that shares the words ("while raging") is never switched on. `SwitchDto` lists each switch a granted feature or carried item names, its state and the tracker it spends; `setResourceSwitch` turns it on or off, spends one use of every linked tracker when turning on, and answers `conflict` (changing nothing) when one has none left. Turning a switch off gives nothing back. Grants gated by a switch are not supported.

Spent counts, the switches that are on and the trackers kept by hand are stored in a third child of the builder block, `<resources schema="1"><![CDATA[{"spent":{"id":1},"switches":["Name"],"manual":[…]}]]></resources>`. Every part is left out when empty and the child with it, so a file whose trackers are full, whose switches are off and which keeps none has no trace and keeps its bytes; a block that is not valid JSON answers `conflict` and is left alone. What the drafts declare is derived when the file is read, not stored. The character state carries `resources`, so a character snapshot written before it fails the shape check and the character loads from its file. The sheet closes the features text with a `Resources.` paragraph: a box (`[ ]`) per use up to six, `____ / N` beyond, and the recharge (`SR`, `LR`, `dawn`, `day`); it prints the trackers full, as a fresh sheet is.

**Draft.** One custom element as plain JSON (`CustomDraft`, `schemaVersion: 1`;
a draft without a version reads as 1, a newer one is refused):
`template` (feature, feat, racialTrait, classFeature, curse, boon), `name`,
`showsUnder` (race, class, feats, other), `description`, `sheet` (show, title,
action None/Action/Bonus Action/Reaction/Attack, usage, text, level tiers),
`blocks` (modifier, grant, choice, in order), `requirements` (an ALL/ANY/NONE
tree), `tags` (the element's `<supports>`), `ruleset` and `cameFrom` (free text
on where the entry came from, for lists; the compiler ignores it). A grant
target by id and a filter leaf by id may carry a `label` with the element's name
for summaries; the engine reads only the id. `id` is the element
id: `ID_CUSTOM_` plus random characters, generated once and never derived from
the name, so renaming, promoting and re-importing never re-id it.
- `showsUnder` picks the element type: race `Racial Trait`, class `Class
  Feature`, feats `Feat`, other `Custom Feature` (a type that lands in Build >
  Other and in the sheet's Features box).
- A **modifier** targets a catalogue entry (`CUSTOM_MODIFIER_TARGETS`: ability
  scores and maximums, saves, skills, passive scores, armor class bonus and
  calculation, hit points, speeds, initiative, attunement slots, attacks per
  Attack action, melee/ranged attack and damage, spell attack and DC) with a
  mode (`add`, `setBase`, `bestOf` with a named bucket, `raiseMax`), a number or
  reference value (`CUSTOM_VALUE_REFERENCES`), an optional cap, gates (level,
  equipment, requirements, a named switch) and a label. A switch-gated
  modifier stays out of the totals until switches are built.
- A **grant** names an element by id or by type and name, with a level, a
  requirements tree and, for a spell, a cast ability, an always-prepared caster
  and a free-cast usage. One feature casts all its spells with one ability.
- A **choice** offers N picks of a type, filtered by a tree over tags, spell
  level, school and ids, or an inline list of text items, with a level,
  requirements and optional flag. Its name, type, level, slot and (for spells)
  filter are the identity picks are remembered by.
- `compileCustomElement(draft, {id?, source?})` returns the `<element>` XML and
  `compileCustomPack(drafts, {source?})` an `<elements>` file; both throw
  `invalid-argument` naming the exact field (`blocks[2].value`) of every problem
  (`details.issues`). Requirements compile to the `requirements` expression and
  are checked with `requirementsSyntaxError`; filters compile to `supports`.
  The element source is `Custom` unless the caller names one (the engine
  matches sources by name).

**Character pack.** A character's drafts are stored in its own `.dnd5e`
document in one builder-owned root element:

```xml
<forge-builder version="1">
  <custom-pack schema="1"><![CDATA[[{ ...draft... }, ...]]]></custom-pack>
</forge-builder>
```

`forge-builder` is the single element name reserved for builder-only data;
later trackers become further children of it. The pack holds the drafts, not
compiled XML, so the elements are derived on every load. A file without the
block is never touched and the block is removed again when the last draft goes,
restoring the original bytes. Entries this version cannot read (a newer
schema) are kept through every edit and listed in `problems`. The block
travels in the character XML, so `.dnd5e` export/import and `.dnd5e-pkg`
carry it without any extra content file.

**Library overlay.** While a character is loaded (import, snapshot restore,
save) its compiled pack is installed in the library as an overlay keyed by
character id (`content/character-packs.ts`), so its ids resolve for grants,
picks and requirements. It never replaces a book element (an id the library
already defines is skipped and reported `installed: false`), is offered only to
the characters that carry it, survives library rebuilds and Fast Start boots,
and is excluded from every snapshot so library digests do not move. Deleting
the character or its last copy of an entry removes it.

**Methods.**
- `getCustomContent(id)` -> `{entries, problems}`; an entry is `{kind:
  "feature" | "item" | "spell", draft, elementId, type, section, granted,
  installed}` (`granted` is "in the inventory" for an item, and "known" for a
  spell: granted to a caster or picked from a list, not merely on a projected
  class list).
- `saveCustomDraft(id, {draft, grant?, amount?, notes?, caster?})` -> `{character,
  content, entry, diagnostics}`. Stores the draft, compiles and installs it, and
  grants a new feature (unless `grant: false`) or adds a new item to the
  inventory with `amount` copies and `notes` on its record. Editing a granted
  feature takes it off and puts it back on with the new definition and makes the
  picks again whose choice identity is unchanged. Editing a carried item brings
  its records up to date in place (registrations, names, attack row) and keeps
  equipped and attuned state; moving it onto another base answers `conflict`.
  `diagnostics` names grants to content that does not exist (`missing-grant`,
  with the missing id and `missingType`) and id collisions (`skipped`). A new
  spell is granted to `caster` (a class spellcasting name the character has,
  refused before anything is stored otherwise) or gathers under Additional
  Spells; `grant: false` keeps it for a class list alone. Editing a spell
  replaces its element, brings the name and level stored beside the character's
  spells up to date and keeps whoever knows it knowing it; deleting it takes
  back the grant and any pick made from a class list.
- `deleteCustomDraft(id, {draftId})` -> the same shape with `entry: null`.
  Removes the grant (or every inventory record of an item), the stored copy and
  the installed element.
- `promoteCustomDraft(id, {draftId, source})` -> `{id, xml, element}`. The
  homebrew collection store belongs to the client, so the engine does not write
  it: `element` is the entry in the homebrew editor's draft shape (`rawXml` is
  the compiled element with `source` as its source name, `id` is the stable id
  with `idLocked: true`, `customDraft` keeps the form data), ready to push onto a
  collection's `elements`. The id never changes, so characters that carry the
  entry keep resolving it once the collection is ingested.
- `previewCustomItem(id, {draft})` -> `{attack}`. Adds the item to a scratch copy
  of the character, wields and attunes it, and returns the weapon's attack row
  (`{name, range, bonus, damage, description}`, as `getAttacks` prints it); null
  for anything that is not a weapon. Nothing is saved and the scratch copy is
  discarded.
- `previewCustomSpell(id, {draft, caster?})` -> `{attack}`. Saves the spell to a
  scratch copy of the character, granted to `caster`, and returns its attack or
  save row (`{casterName, bonus, damage, range, warning}`, as the attack options
  print it); null when the spell is no attack. Nothing is saved.
- `getMissingGrants(id)` -> `MissingGrantDto[]`: `{elementId, elementName,
  missingId, missingType, message}` for each grant or choice default of the
  character's custom and homebrew elements that resolves to no element, and each
  DM-granted spell the library lacks. Book elements are never reported. Creating
  a spell under `missingId` resolves it. Content warnings carry the same
  `missingType` on a `missing-grant` finding.
- `getChoiceIdentityImpact(id, {draft})` -> `{changes, hasPicks}`. Compares a
  proposed draft with the stored draft of the same id. Each change is `{blockId,
  name, type, change: "removed" | "changed", fields, orphanedSlots, picks}` where
  `fields` lists what differs (name, type, level, count, supports for a spell
  choice), `orphanedSlots` the pick slots that stop matching any choice, and
  `picks` the picks currently made under them on every loaded character. The
  client warns before saving when `hasPicks` is true. Raising a count orphans
  nothing.

- `getPackChoiceImpact({before, after})` -> `{changes, hasPicks}`: the same
  report for an element a homebrew pack holds, from the two versions of its
  draft (`before` null for a new element, which has no earlier identity to
  lose). It counts the picks of every loaded character that carries the
  element; no character needs to be open. Features and catalogue entries can
  hold choices; spells, items, additions and replacements report nothing.
- `getElementSource(id)` -> `{id, name, type, source, xml, reason?}` or `null`:
  a loaded element as `<element>` XML, to start a house rule or a reflavour
  from. `xml` is null, with a `reason`, for an element a copy would lose
  structure from.
- `checkPackContent({path, xml, overrides?})` -> `PackFindingDto[]`: checks a
  pack's compiled file against the loaded library without loading it. Kinds:
  `missing-grant`, `duplicate-id`, `unattachable`, `append-target`,
  `invalid-requirements`, and `overrides` (a deliberate replacement, listed in
  `overrides`, which is a note and not a fault). Each finding names the pack
  element that carries it.

### Companion

- `getCompanion` returns `null` when there is no companion; otherwise → `CompanionDto {elementId,
  name, source, build, size, creatureType,
  alignment, challenge, proficiency, armorClass, armorClassText, maxHp,
  hitPointsText, initiative, speed, speedFly, speedClimb, speedSwim,
  speedBurrow, speedText, attackBonus, damageBonus, senses, languages, skills,
  savingThrows, damageVulnerabilities, damageResistances, damageImmunities,
  conditionVulnerabilities, conditionResistances, conditionImmunities,
  abilities: CompanionAbilityDto[], traits/actions/reactions: CompanionFeatureDto[]}`
- When an active Companion selection has a single default, it is registered in
  slot 1 during the same build stabilization pass (Battle Smith → Steel
  Defender). Selecting a different value into an occupied Companion slot uses
  the same numbered-slot replacement semantics as Spell selections.
- `setCompanionName({name})` → `CompanionDto`; whitespace-trimmed; empty name
  → reverts to the element's default name; rename without companion → 400
  `{"error":"Select a companion before renaming it."}`. XML: the companion
  block `<companion name="..."><attributes>...` serializes under the character


### Appearance suggestions

- `getAppearanceSuggestions(seed)` takes an int32 seed; an out-of-range seed is
  a validation error, and an empty result yields defaults with `height`/`weight`
  null. Returns `AppearanceSuggestionsDto {name, age,
  height, weight, eyes, skin, hair, nameFromRace, ageFromRace,
  heightWeightFromRace, raceName}`.
- Seeded with the documented subtractive generator (`SeededRandom`):
  `abs(seed)`, with the int32 minimum mapped to the maximum (seeds 0,
  2147483647, -2147483648 all produce the same suggestion stream — the
  generator's `MSEED - abs(seed)` congruence). Deterministic per seed and
  character state; invariant under repeated calls and unrelated mutations.
  Race/subrace lists drive name/age/height/weight; with no race, generic lists
  are used and `nameFromRace` and friends are false.

### Attack options (magic rows)

- `getAttackOptions` gains `casters: AttackCasterOptionDto[] {identifier,
  name, ability, attackModifier, computation}` and `spells:
  AttackSpellOptionDto[] {casterIdentifier, casterName, spellId, spellName,
  level, range, bonus ("+8 INT vs AC"), damage (level-scaled, e.g. "2d10
  fire"), description, warning, beamCount, computation}` for the character's
  supported attack-roll and damaging saving-throw spells. Save parsing requires
  a damage clause tied to the failed save, with a single save ability. Separate
  saves for dropping an object, delayed punishment, attack-triggered riders and
  multiple random effects do not become misleading save-damage rows. Complex
  spells can be entered using Manual; this is not a complete spell interpreter.
- A caster's spells are its chosen cantrips and spells plus the spells its
  features grant (`alwaysPreparedSets`, levelled grants only once the caster
  has a slot of that level); the first class caster also carries the DM grants.
- Attack modifiers and save DCs use the same resolver as the Magic tab:
  nonzero caster-specific statistics take precedence over ability-wide
  statistics, then the proficiency/ability fallback. A saving-throw row's
  `bonus` reads `"DC 13 INT"`, with the ability the target saves with. Its
  `computation` lists `Base 8`, ability, proficiency and any remaining
  spellcasting bonuses, and sets `isPerHit: false`. A spell with both an attack
  roll and a save projects as an attack row.
- Caster identifiers are stable UUIDs for one loaded-character session. The same
  identifier links a caster row to all of its spell attack-option rows; it is not
  a content element id and may differ after a new import/session.

## Snapshot DTOs

Seven declared snapshot methods are now implemented. Their requests, metadata,
and diagnostics are typed DTOs defined in `packages/api/src/methods.ts` and
exported from `@forge-cb/api`; the two buffer results remain `ArrayBuffer`, and the
character import retains the character-detail `WireObject` result. The 75-method
surface is unchanged.

### Manifest identity

`ManifestIdentityDto {client: string, schema: number, codec: string}` — fixed
identities: Fast Start = `{client: "dm-forge-fast-start", schema: 2,
codec: "gzip-json"}`; character load = `{client: "dm-forge-character-load",
schema: 1, codec: "gzip-json"}` (exported from `@forge-cb/engine` as
`FAST_START_MANIFEST` / `CHARACTER_LOAD_MANIFEST`).

### Fast Start

- `prepareFastStartSnapshot: [] -> FastStartSnapshotPreparedDto`
  `{client, schema, codec, libraryKind: "fcb-fast-start-library", schemaVersion: 1,
  elementCount, sourceCount, fileCount, typeCounts, orderedLibraryDigest,
  diagnosticsDigest, serializedBytes, compressedBytes, serializationMs,
  compressionMs}` — payload is the canonical-JSON content graph plus a reserved
  `diagnostics: null` area, gzip-compressed (64 MiB compressed / 128 MiB
  decompressed limits). `orderedLibraryDigest` = SHA-256 hex of
  `canonicalStringify(graph)`; `diagnosticsDigest` = SHA-256 hex of the canonical
  `diagnostics` value. All timings are non-negative.
- `getFastStartSnapshotBuffer: [] -> ArrayBuffer` — one-shot: consumes the pending
  buffer; `conflict` when none. A later `prepare` replaces an unconsumed buffer.
- `bootFromSnapshot: [request: BootFromSnapshotRequestDto] -> BootFromSnapshotResultDto`
  — `BootFromSnapshotRequestDto {manifest: ManifestIdentityDto,
  expectedIdentity: ManifestIdentityDto, body: ArrayBuffer}`;
  `BootFromSnapshotResultDto {elementCount, sourceCount, fileCount, typeCounts,
  hydrationMs, validationMs, totalMs}`. Validation order: gunzip -> canonical parse
  -> payload identity (identity-mismatch) -> libraryKind/schemaVersion/engineVersion/
  parserVersion (schema-mismatch) -> graph hydrate + canonical-form digest
  (invalid-structure) -> manifest/expectedIdentity (identity-mismatch). Every
  rejection maps to `engineError("snapshot-rejected", message, {reason})` and never
  touches the existing library; on success the hydrated fields are copied
  field-by-field into the existing library object (reference preserved).

### Character load

- `prepareCharacterLoadSnapshot: [id: string, identity: ManifestIdentityDto] -> CharacterSnapshotPreparedDto`
  `{client, schema, codec, libraryKind: "fcb-character-load", schemaVersion: 1,
  characterId, xmlHash, libraryDigest, engineVersion, parserVersion, selectionCount,
  elementCount, inventoryCount, attackCount, finalStateDigest, serializedBytes,
  compressedBytes, serializationMs, compressionMs}` — `conflict` when the character
  has load issues or the compressed payload exceeds the 4 MiB character limit.
  `finalStateDigest` is the SHA-256 of the canonical state with
  `selectionRuleIds`/`magicCasterIds` replaced by empty maps (session UUIDs are
  normalized so restore paths compare equal).
- `getCharacterLoadSnapshotBuffer: [] -> ArrayBuffer` — one-shot consume; `conflict`
  when none.
- `importCharacterXmlWithSnapshot: [id: string, base64: string, identity:
  ManifestIdentityDto, body: ArrayBuffer] -> WireObject` (character-detail result,
  same shape as `importCharacterXml`). Snapshot restore when the payload validates
  (identity, characterId, xmlHash vs the supplied xml, libraryDigest vs the current
  library, engine/parser versions, state shape); otherwise falls back to a plain xml
  import and records `restoreMode "xml-fallback"` with a
  `snapshot rejected: {reason}: {detail}` warning. Invalid xml throws
  `content-invalid` and records nothing.
- `getCharacterLoadDiagnostics: [] -> CharacterLoadDiagnosticsDto`
  `{characterId, restoreMode: "none"|"xml"|"snapshot"|"xml-fallback",
  snapshotAccepted, warning: string|null, loadIssueCount,
  issueKindCounts: Record<string, number>, selectionCount, elementCount,
  inventoryCount, attackCount, finalStateDigest, parseMs, validationMs, hydrationMs,
  totalMs}` — all timings non-negative; `totalMs` is the sum. `RestoreMode` is the
  union above.

### Buffer and fallback semantics

- Buffers are one-shot replace-and-consume on both controllers; prepared snapshots
  are gzip-compressed canonical JSON. A failed prepare clears any older pending
  buffer, so callers can never consume stale bytes after an error.
- The character snapshot caller identity must be the canonical character-load
  manifest even if a payload supplies the same noncanonical identity. The current
  content-library digest is recomputed when preparing or restoring, including after
  a successful Fast Start replacement.
- Reason mapping for rejected character snapshots: payload identity / characterId /
  state id / xmlHash -> `identity-mismatch`; libraryKind / schemaVersion /
  libraryDigest / engineVersion / parserVersion -> `schema-mismatch`; state shape ->
  `invalid-structure`; gunzip -> `corrupt`; JSON -> `invalid-json`; limits ->
  `oversized`.
- Limits: content 64 MiB compressed / 128 MiB decompressed; character 4 MiB
  compressed / 32 MiB decompressed.
- Digest definitions: everything digests the canonical JSON (`canonicalStringify`:
  sorted object keys, dropped `undefined`, nulled non-finite numbers, tagged
  Map/Set). `sha256Hex`/`sha256HexSync` are lowercase hex SHA-256. Both the prepared
  snapshot and diagnostics `finalStateDigest` use the session-map normalization
  described above.

### PDF display options

The client PDF render options and `CharacterSheetWriteOptions` accept optional
`emphasizeAbilityModifiers: boolean` (default `false`). The dedicated render
worker swaps the six character ability scores and modifiers in their visual
boxes, including the 2024 captions; model values and character exports are
unchanged. The browser preference uses `fcb-sheet-ability-emphasis`, applies to
full and split previews and PDF downloads, and participates in PDF cache identity.

Both template sets contain six blank exhaustion checkboxes. Spell-list sections
with slots draw one empty circle per slot; spell points and slotless sections do
not. Recognized free-cast allowances explicitly say “free cast” or “free casts”.
Generated spell attack descriptions stay on spell cards; attack cells retain
custom overrides and structured level, beam-count or warning information. Notes
that cannot fit an attack cell refer to an appended attack-notes continuation,
which preserves the complete text in attack-row order. Each overflow attack uses
a bordered card with the selected accent, line and text colours and sheet fonts.
Bodies stay at 8pt; cards repeat their attack title with “continued” when a note
spans pages.

`CharacterSheetWriteOptions` and the dedicated render-worker request also accept
`includeAttackNotes?: boolean` (default `true`). The client exposes it as
`include.attackNotes` in its shared page preference, strips that renderer-only
flag before `generateSheet`, and forwards it to the renderer. When disabled,
overflowing cells say “Long note omitted” and generate no attack-note pages;
character data is unchanged. Short single-line notes stay in their original
cells. This choice is included in the PDF cache key.

The client PDF render options and the dedicated render-worker request also
accept `layout?: { top?, split?, readable? }`, the character page's optional
layout switches; each is `true`, `false`, or `null`/absent for the template
set's own default (`SHEET_LAYOUT_DEFAULTS`: split is on for 2024 Hybrid, off
for 2014 and 2024; top is on for 2024 and 2024 Hybrid, off for 2014). The switches pick a variant of the set's character page
template, named for the switches that differ from the set's own page
(`details~split.pdf`, `details~unsplit.pdf`, `details~top.pdf`, `details~untop.pdf`,
`details~top.split.pdf`, `details~readable.pdf`,
`details~top.unsplit.readable.pdf`, …; see `sheetDetailsFile` in
`template-contract.ts`); every other template is shared. Every combination of
`top` (a compact top row), `split` and `readable` (a more readable body) has a
variant. A variant that cannot
be fetched, or that the set's `labels.json` does not describe, falls back to
the set's own `details.pdf`. The layout never reaches `generateSheet`. The
browser preferences are the `top`, `split` and `readable` members of
`fcb-sheet-layout-options`, and the
effective switches participate in the PDF cache key.

The readable 2014 page has six attack rows and the 2024 pages five. The sheet model's form values
always fill the four rows every template has and list later attacks in
`details_attack_description`; the details page also carries `attacks` (every
displayed attack) and `attackNotes` (the user's own notes), from which the
writer fills a template's further rows and rewords that note. With "Emphasize
ability modifiers" on, the writer swaps an ability's score and modifier only
where the template's score field is the larger; the 2024 panels and Hybrid
shields already make the modifier the large number. A score printed smaller
than its modifier takes the body face's regular weight.
