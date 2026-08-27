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
derived from that map. The runtime list contains 75 unique methods: 74 are
implemented and dispatched, and `ensureHostFile` is intentionally test-only.
There are currently no public roadmap-unsupported methods. Groups:

- **Boot/content**: `boot`, `bootFromSnapshot`, `ingestSupplementBundle`,
  `ingestUploaded`, `removeUploaded`, `patchHomebrew`,
  `prepareFastStartSnapshot`, `getFastStartSnapshotBuffer`
- **Content reads**: `contentStatus`, `contentSources`, `equipmentCategories`,
  `contentElements`, `contentElement`
- **Characters**: `createCharacter`, `getCharacter`, `deleteCharacter`,
  `setCharacterSources`, `getCharacterSources`, `setPortrait`, `removePortrait`,
  `updateDetails`, `setAbilities`, `getSelectionOptions`, `setSelection`,
  `getOptionalRules`, `setCharacterOption`, `getRulesetMode`, `setRulesetMode`,
  `getCharacterAdjustments`, `setCharacterControl`, `getStatistics`,
  `getAppearanceSuggestions`, `exportCharacterXml`, `importCharacterXml`,
  `importCharacterXmlWithSnapshot`, `getCharacterLoadDiagnostics`,
  `prepareCharacterLoadSnapshot`, `getCharacterLoadSnapshotBuffer`
- **Progression**: `levelUp`, `levelDown`, `delevel`, `undoDelevel`,
  `setHitPointRoll`, `getProgression`
- **Magic**: `getSpellcasting`, `setPrepared`, `getSpellBrowse`,
  `addGrantedSpell`, `removeGrantedSpell`, `addGrantedFeat`, `removeGrantedFeat`,
  `addGrantedAbilityScore`, `removeGrantedAbilityScore`, `getDmGrants`,
  `getCompanion`, `setCompanionName`
- **Inventory**: `getInventory`, `getItemBaseOptions`, `addItem`, `removeItem`,
  `extractItem`, `equipItem`, `attuneItem`, `setCoins`
- **Attacks**: `getAttacks`, `getAttackOptions`, `createAttack`, `updateAttack`,
  `setAttackVisibility`, `moveAttack`, `deleteAttack`
- **Sheet**: `generateSheet` (lite flag), `getSheetBuffer`
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
The typed module-worker adapter preserves the persisted `aurora-local` IndexedDB
database name (schema/version 5; the name is a frozen storage contract), localStore/orchestration, homebrew
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
  fitting, and continuation pages for feature prose and card descriptions.
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
  `source`, `author`, `releaseDate`, `isPlaytest`, `hasElements`, and
  `canToggle`, sorted deterministically by display name and then ID.
- `getCharacterSources` and `setCharacterSources` return author-grouped
  `groups`, normalized `restrictedSourceIds`,
  `unavailableRestrictedSourceIds`, and a compatibility `sources` field for
  restricted records. Group `canToggle` is true when at least one member can be
  toggled.
- Source mutation input trims, removes empty IDs, and de-duplicates while
  retaining IDs absent from the currently loaded corpus. Such IDs are reported
  as unavailable instead of causing a not-found failure, so later content
  imports can restore them.
- After bundled boot, the client replays persisted uploaded files through
  `ingestUploaded` before publishing the supplements-ready state. A character
  source mutation returns the engine's source response and persists local state
  without an unnecessary character-detail refetch.

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
- `getCharacterAdjustments` → `[{key, elementId, name, source, category, description, enabled}]`
- `getCharacterControls` → `[{key, elementId, name, type, enabled}]`; `setCharacterControl({key, enabled})` accepts `option:`/`item:` prefixes
- `getRulesetMode` → `{mode, availableModes, rules2014Count, rules2024Count, sharedCount, incompatibleWith2014, incompatibleWith2024}`
- `setRulesetMode(mode)` → `{mode, repaired, removed, unresolved}` with `RulesetChangeItemDto {ruleName, ruleType, previousElementId, previousElementName, previousSource, newElementId, newElementName, newSource}`
- `LoadIssueDto` (in `getCharacter` detail): `{kind, ruleType, ruleName, requiredLevel, previousElementId, previousElementName, message}` (kinds: `elementMissing`, `equipmentMissing`, `selectionInvalidated`)
- `getInventory` → `InventoryDto {items: InventoryItemDto[], coins: Coinage, equipmentWeight: number, attunedItemCount: number, maxAttunedItemCount: number}`
- `InventoryItemDto`: `{identifier, itemId, name, type, amount, isEquippable, isEquipped, equippedLocation, isAttunable, isAttuned, displayPrice, source, equipLocations, weight, category, isPhysicalEquipment, description, rarity, attunement: {required, addition}, isExtractable, extractableContents: {itemId, name, amount}[]}`
- `getItemBaseOptions(itemId)` → `{slot: "weapon"|"armor"|null, options: {id, name}[]}`
- `addItem({itemId, amount, baseElementId})` / `removeItem(identifier, amount?)` / `equipItem(identifier, {location})` (keys `primary|secondary|armor|primary-twohanded|none`) / `attuneItem(identifier, {attuned})` / `setCoins(Coinage)` / `extractItem(identifier)` — all return `InventoryDto`

## Inventory and attack DTOs

- `getAttacks` → `AttackDto[]` (rows in stored order; sheet positions among displayed rows):
  `{id, name, range, bonus, damage, description, isDisplayed, isAutomatic, isCurrentlyEquipped, sheetPosition: number|null, kind: "weapon"|"manual"|"calculated"|"spell"|"unarmed", abilityMode: "default"|"explicit"|null, ability: string|null, defaultAbility: string|null, generated: {name, range, bonus, damage, description}|null, overriddenFields: string[], calculation: {source, ability, useProficiency, attackMiscBonus, damageDice, addAbilityToDamage, damageMiscBonus, damageType, casterIdentifier: string|null}|null, source: {casterIdentifier, spellId, warning, beamCount}|null, unarmed: {dice: string}|null, computation: {attackBonusContributions: {label, value}[], appliedModifiers: {id, name, field, effect}[], sourceNotes: string[], attackCount: number, isPerHit: boolean}|null}`
- `getAttackOptions` → `{abilities: {name, abbreviation}[] (STR/DEX/CON/INT/WIS/CHA), casters: [], spells: []}`
- `createAttack({mode: "manual", name, range, bonus, damage, description} | {mode: "calculated", name, range, description?, calculationSource, abilityName, useProficiency, attackMiscBonus, damageDice, addAbilityToDamage, damageMiscBonus, damageType} | {mode: "spell", casterIdentifier, spellId, name?, range?, bonus?, damage?, description?} | {mode: "unarmed"})` → `AttackDto[]`. Spell rows resolve generated fields and computation from the current known-spell option; non-null display fields are explicit overrides.
- `updateAttack(attackId, partial)` — display fields (name/range/bonus/damage/description), weapon and unarmed rows accept `abilityMode` + `abilityName` (explicit ability override), unarmed rows additionally accept `damageDice` (a manual damage-die override; `""` restores the derived die), calculated rows accept the calculation fields → `AttackDto[]`. For generated weapon display fields, explicit `null` or `undefined` clears the stored override and restores the generated value; the strings `"null"` and `"undefined"` are never serialized.
- Unarmed rows carry no inventory item. Their damage die, default ability, and bonuses resolve from the character's content statistics on every read: `martial arts:dice` (both rulesets), `unarmed fighting:size`, and `unarmed strike:dice` replace the die (largest wins, base `1`); `unarmed strike:attack|damage` and `unarmed:attack|damage` sum into the totals; the presence of `martial arts:attack|damage` or `martial arts:ability modifier` allows the higher of STR/DEX. Proficiency always applies, and the `melee:*` category keys never do. Only the die override is persisted, as `unarmed-dice` on the attack node.
- `content/system/system-unarmed-riders.xml` appends those keys to published items and feats that the upstream corpus ships as prose only (both Eldritch Claw Tattoo printings, Wraps of Unarmed Prowess, Tavern Brawler, the 2024 Unarmed Fighting feat). Appends are gathered across every ingested file and applied once all elements are known, so they patch bundled and user-imported content alike; an append whose target is absent records an `append-target` diagnostic and is otherwise inert. All `unarmed strike:dice` rules share one bonus bucket so the largest die wins instead of the values summing.
- Spell rows persist the stable caster name, spell id, and override-field names in the `.dnd5e` attack node. Session-only caster UUIDs are regenerated on load and are never used as durable identity.
- `setAttackVisibility(attackId, {isDisplayed})` / `moveAttack(attackId, {direction: "up"|"down"})` / `deleteAttack(attackId)` — all return `AttackDto[]`; deleting an equipped weapon's automatic row is rejected (conflict)

## Magic, grants, and companion DTOs

### Magic reads and mutations

- `getSpellcasting` → `SpellcasterDto[]` (order: caster block order in the
  document):
  `{identifier, name, ability, attackModifier, saveDc, requiresPreparation,
  allowReplace, prepareCount, currentPreparedCount, slotsPerLevel: number[9],
  knownSpells: KnownSpellDto[], maxSpellLevel, resource}`
- `KnownSpellDto`: `{id, name, source, isPrepared, isChosen, level, school,
  isRitual, isConcentration, isAlwaysPrepared, castingTime, components, range,
  duration, description}`
  - `isPrepared` excludes always-prepared spells (their count is not in
    `currentPreparedCount`); `isAlwaysPrepared`/`isChosen` derive from the
    character's spell rules (domain/oath/known-spell rules), NOT from XML
    attributes (a stale `always-prepared="true"` in the file shows as false).
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

`add/removeGrantedSpell|Feat|AbilityScore` and `getDmGrants` are engine-defined
methods with no counterpart elsewhere. Contract:
- Requests are exact: spell add/remove `{spellId}`; feat add/remove `{featId}`;
  ability-score add `{abilityElementIds}` and remove `{abilityElementId}`.
  `getDmGrants` returns `{spells, feats, abilityScores}` using those element
  identities and display metadata.
- Granted spells serialize as `<magic><additional><spell name level id
  source="Additional Spell, {Name}"/></additional></magic>`. Rule-granted spells
  additionally carry the granting feature's name as `source`, e.g.
  `source="Wind Caller"`.
- `<additional>` blocks are preserved and NOT rebuilt by prepared mutations
  (wizard XML keeps `<additional>`).
- Granted feats/ASIs register elements via the existing registration + sum
  machinery.
- DM ownership is deliberately narrow: only direct top-level Feat/Ability Score
  Improvement nodes and `<additional>` spells using the DM source convention are
  listed or removable. Nested class/selection feats and ASIs are not DM grants.
  Duplicate additions and multi-ASI requests are atomic: conflict or validation
  failure leaves the entire character unchanged.

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
  attack-roll spells.
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
  `{client, schema, codec, libraryKind: "tcb-fast-start-library", schemaVersion: 1,
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
  `{client, schema, codec, libraryKind: "tcb-character-load", schemaVersion: 1,
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
