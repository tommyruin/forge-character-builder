/**
 * Character lifecycle operations over an in-memory, multi-id character store.
 *
 * Every character keeps BOTH its mapped state and the parsed byte-faithful
 * document, so exporting an unmodified character returns the exact imported
 * bytes. Mutations replace text regions in the raw source (the document model
 * exposes node offsets for this) and re-map state from the fresh document,
 * keeping state and bytes consistent.
 */

import {
  ABILITIES,
  parseDnd5e,
  child,
  childElements,
  getAttr,
  type Dnd5eDocument,
  type Dnd5eNode,
} from "../dnd5e/document.js";
import { engineError } from "../errors.js";
import type { ElementLibrary } from "../content/library.js";
import { pointBuyRemaining } from "./point-buy.js";
import {
  applyRawEdits,
  pendingSelectionRules,
  planSelectionEdits,
  selectionOptions,
  selectionRuleFor,
  selectionRuleForSlot,
  type RawEdit,
  type SelectionRule,
} from "../selection/selection.js";
import { extractLegacyDmGrants, type LegacyDmGrants } from "./legacy-grants.js";
import { reconcileRegistrationRules } from "../selection/reconcile-rules.js";
import { mapToState } from "./mapping.js";
import {
  emptyCharacterState,
  type AbilityScores,
  type CharacterState,
  type Coinage,
  type DelevelSnapshot,
  type LevelHistoryEntry,
  type RegisteredElement,
} from "./state.js";
import {
  classElementForMulticlass,
  MAX_LEVEL,
  planClassRndhpEdit,
  planDelevelEdits,
  planHealDegenerateRollsEdits,
  planLevelUpEdits,
  planLevelUpMulticlassEdits,
  planNewMulticlassEdits,
  planOptionEdits,
  reconstructLevelRegistrations,
  planSetHitPointRollEdits,
  planStartMulticlassEdits,
  planUndoDelevelEdits,
  xpForLevel,
} from "../progression/leveling.js";
import {
  repickRules,
  resolveDelevelTarget,
  restoreSelections,
  wrapperSnapshots,
} from "../progression/delevel-replay.js";
import { buildProgression, type Progression } from "../progression/progression.js";
import { buildCharacterDetail, type CharacterDetail } from "../selection/detail.js";
import {
  computeRulesetChange,
  getCharacterAdjustments,
  getCharacterControls,
  getOptionalRules,
  getRulesetMode,
  isControlEnabled,
  planItemEdits,
  planRulesetModeEdits,
  planRulesetTagEdit,
  type CharacterAdjustmentDto,
  type CharacterControlDto,
  type OptionalRuleDto,
  type RulesetChangeResult,
  type RulesetModeDto,
} from "./options.js";
import {
  buildInventoryDto,
  itemBaseOptions,
  planAddItemEdits,
  planAttuneItemEdits,
  planEquipItemEdits,
  planExtractItemEdits,
  planRemoveItemEdits,
  planSetCoinsEdits,
  planSetItemStorageEdits,
  type AddItemOptions,
  type InventoryDto,
  type ItemBaseOptionsDto,
} from "../inventory/inventory.js";
import {
  buildAttackOptionsDto,
  buildAttacksDto,
  newCalculatedAttackRow,
  newManualAttackRow,
  newUnarmedAttackRow,
  newWeaponAttackRow,
  buildUnarmedPreview,
  newSpellAttackRow,
  weaponsWithoutRows,
  planAutoAttackInsertEdits,
  planInsertAttackEdits,
  planItemAttackRemovalEdits,
  planMoveAttackEdits,
  planRemoveAttackEdits,
  planRewriteAttackEdits,
  planRewriteAllAttackEdits,
  type AttackDto,
  type AttackOptionsDto,
} from "../attacks/attacks.js";
import { computeStatistics } from "../statistics/calculator.js";
import { randomUuid } from "../platform.js";
import {
  buildSpellcastingDto,
  buildSpellBrowseDto,
  hasUnprojectedGrants,
  GRANTED_CASTER_KEY,
  type SpellcasterDto,
  type SpellBrowseDto,
} from "../magic/dto.js";
import {
  planSetPrepared,
  planAddAdditionalSpell,
  planRemoveAdditionalSpell,
  planSetCompanionName,
} from "../magic/planners.js";
import { buildCompanionDto, buildMagicAttackOptions, reconcileMagic, type CompanionDto } from "../magic/reconcile.js";
import { featureSpellCasters } from "../magic/feature-casters.js";
import {
  planGrantedFeatEdits,
  planGrantedAbilityScoreEdits,
  buildDmGrantsDto,
  type DmGrantsDto,
} from "../extras/grants.js";
import { buildAppearanceSuggestions, type AppearanceSuggestionsDto } from "../extras/appearance.js";

export interface CharacterStore {
  get(id: string): CharacterState | undefined;
  set(state: CharacterState): void;
  delete(id: string): void;
}

export interface CharacterImportEvent {
  mode: "xml";
  id: string;
  state: CharacterState;
  parseMs: number;
  hydrationMs: number;
}

export interface CharacterServiceOptions {
  /** Random source for hit die rolls (inject a seeded RNG in tests). */
  rng?: () => number;
  /** Fired after an xml import installs (load-diagnostics wiring). */
  onImport?: (event: CharacterImportEvent) => void;
}

export interface DelevelOptions {
  mode: "last" | "class";
  classId?: string;
}

export interface DelevelResult {
  /** The character projected to the client-facing detail DTO. */
  character: CharacterDetail;
  progression: Progression;
  /** The removed level's history entry (with className), or null after an undo. */
  removedLevel: (Progression["levelHistory"][number] & { className: string }) | null;
  requiredRepicks: SelectionRule[];
  canUndo: boolean;
}

export interface SetHitPointRollOptions {
  classId: string;
  classLevel: number;
  value: number;
}

export interface SetCharacterOptionOptions {
  optionId: string;
  enabled: boolean;
}

export class InMemoryCharacterStore implements CharacterStore {
  private readonly states = new Map<string, CharacterState>();

  get(id: string): CharacterState | undefined {
    return this.states.get(id);
  }

  set(state: CharacterState): void {
    this.states.set(state.id, state);
  }

  delete(id: string): void {
    this.states.delete(id);
  }
}

export interface CharacterDetails {
  name?: string;
  playerName?: string;
  gender?: string;
  age?: string;
  height?: string;
  weight?: string;
  eyes?: string;
  skin?: string;
  hair?: string;
  experience?: number;
  backstory?: string;
  additionalFeatures?: string;
  allies?: string;
  organisationName?: string;
  notes1?: string;
  notes2?: string;
}

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const toCdata = (value: string): string => `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

interface TextEdit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Replaces the text region of each target node with the new value, keeping the
 * node's original form (CDATA regions stay CDATA, plain text is XML-escaped).
 * Edits are applied from the end of the string backwards so the source offsets
 * stay valid, then the result is re-parsed for a fresh offset map.
 */
function withTextEdits(
  document: Dnd5eDocument,
  edits: Array<{ node: Dnd5eNode; value: string }>,
): Dnd5eDocument {
  if (edits.length === 0) return document;
  const replacements: TextEdit[] = edits.map(({ node, value }) => {
    const end = node.closeStart ?? node.openEnd;
    const region = node.raw.slice(node.openEnd - node.start, end - node.start);
    const replacement = region.includes("<![CDATA[") ? toCdata(value) : escapeXml(value);
    return { start: node.openEnd, end, replacement };
  });
  let raw = document.raw;
  for (const edit of replacements.sort((a, b) => b.start - a.start)) {
    raw = raw.slice(0, edit.start) + edit.replacement + raw.slice(edit.end);
  }
  return parseDnd5e(raw);
}

/** Rewrites the <abilities> open tag's available-points attribute, adding it when absent. */
function withAvailablePoints(document: Dnd5eDocument, remaining: number): Dnd5eDocument {
  const node = document.root.build.abilities?.node;
  if (!node) return document;
  const openTag = document.raw.slice(node.start, node.openEnd);
  const attribute = `available-points="${remaining}"`;
  const replacement = /\savailable-points="[^"]*"/.test(openTag)
    ? openTag.replace(/\savailable-points="[^"]*"/, ` ${attribute}`)
    : openTag.replace(/^<abilities\b/, `<abilities ${attribute}`);
  if (replacement === openTag) return document;
  return parseDnd5e(document.raw.slice(0, node.start) + replacement + document.raw.slice(node.openEnd));
}

/** Adds a <generationOption> to the information block of a file that has none. */
function withGenerationOption(document: Dnd5eDocument, value: number): Dnd5eDocument {
  const information = document.root.information.node;
  if (!information || information.closeStart === null || child(information, "generationOption")) return document;
  const raw = document.raw;
  const line = raw.includes("\r\n") ? "\r\n" : "\n";
  let indentStart = information.closeStart;
  while (indentStart > 0 && (raw[indentStart - 1] === "\t" || raw[indentStart - 1] === " ")) indentStart--;
  const indent = raw.slice(indentStart, information.closeStart);
  const insertion = `\t<generationOption>${value}</generationOption>${line}${indent}`;
  return parseDnd5e(raw.slice(0, information.closeStart) + insertion + raw.slice(information.closeStart));
}

function noteByColumn(notes: Dnd5eNode, column: string): Dnd5eNode | null {
  for (const note of childElements(notes, "note")) {
    if (getAttr(note, "column") === column) return note;
  }
  return null;
}

/**
 * Emits the .dnd5e source for a fresh character, mirroring tst.dnd5e's layout
 * (CRLF, tab indentation, comment banners, node forms). Structure follows the
 * fixture template exactly.
 */
export function createDocument(state: CharacterState): string {
  const name = escapeXml(state.name);
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<character version="1.0.3" preview="false">',
    "\t<!-- Aurora - https://www.aurorabuilder.com -->",
    "\t<!-- information -->",
    "\t<information>",
    "\t\t<group>",
    "\t\t</group>",
    // The <generationOption> enum: 0 Roll3D6, 1 Roll4D6DiscardLowest, 2 Array, 3 Points.
    // Fresh characters start at 2 — the "scores assigned directly" bucket —
    // so the ability editor opens in Custom until a method is applied.
    "\t\t<generationOption>2</generationOption>",
    "\t</information>",
    "\t<!-- display data -->",
    '\t<display-properties favorite="false">',
    `\t\t<name>${name}</name>`,
    "\t\t<race>",
    "\t\t</race>",
    "\t\t<class>",
    "\t\t</class>",
    "\t\t<archetype>",
    "\t\t</archetype>",
    "\t\t<background>",
    "\t\t</background>",
    "\t\t<level>1</level>",
    "\t\t<portrait>",
    "\t\t\t<companion>",
    "\t\t\t</companion>",
    "\t\t\t<local>",
    "\t\t\t</local>",
    "\t\t\t<base64><![CDATA[]]></base64>",
    "\t\t</portrait>",
    "\t</display-properties>",
    '\t<ruleset mode="all" />',
    "\t<!-- build data -->",
    "\t<build>",
    "\t\t<input>",
    `\t\t\t<name>${name}</name>`,
    "\t\t\t<gender>Male</gender>",
    "\t\t\t<player-name>Player One</player-name>",
    "\t\t\t<experience>0</experience>",
    "\t\t\t<attacks>",
    "\t\t\t\t<description><![CDATA[]]></description>",
    "\t\t\t</attacks>",
    "\t\t\t<backstory><![CDATA[]]></backstory>",
    "\t\t\t<background-trinket>",
    "\t\t\t</background-trinket>",
    "\t\t\t<background-traits>",
    "\t\t\t</background-traits>",
    "\t\t\t<background-ideals>",
    "\t\t\t</background-ideals>",
    "\t\t\t<background-bonds>",
    "\t\t\t</background-bonds>",
    "\t\t\t<background-flaws>",
    "\t\t\t</background-flaws>",
    "\t\t\t<background>",
    '\t\t\t\t<feature name="">',
    "\t\t\t\t\t<description><![CDATA[]]></description>",
    "\t\t\t\t</feature>",
    "\t\t\t</background>",
    "\t\t\t<organization>",
    "\t\t\t\t<name>",
    "\t\t\t\t</name>",
    "\t\t\t\t<symbol>",
    "\t\t\t\t</symbol>",
    "\t\t\t\t<allies><![CDATA[]]></allies>",
    "\t\t\t</organization>",
    "\t\t\t<additional-features><![CDATA[]]></additional-features>",
    "\t\t\t<currency>",
    "\t\t\t\t<copper>0</copper>",
    "\t\t\t\t<silver>0</silver>",
    "\t\t\t\t<electrum>0</electrum>",
    "\t\t\t\t<gold>0</gold>",
    "\t\t\t\t<platinum>0</platinum>",
    "\t\t\t\t<equipment><![CDATA[]]></equipment>",
    "\t\t\t\t<treasure><![CDATA[]]></treasure>",
    "\t\t\t</currency>",
    "\t\t\t<notes>",
    '\t\t\t\t<note column="left">',
    "\t\t\t\t</note>",
    '\t\t\t\t<note column="right">',
    "\t\t\t\t</note>",
    "\t\t\t</notes>",
    "\t\t\t<quest>",
    "\t\t\t</quest>",
    "\t\t</input>",
    "\t\t<appearance>",
    "\t\t\t<portrait>",
    "\t\t\t</portrait>",
    "\t\t\t<age>",
    "\t\t\t</age>",
    "\t\t\t<height>",
    "\t\t\t</height>",
    "\t\t\t<weight>",
    "\t\t\t</weight>",
    "\t\t\t<eyes>",
    "\t\t\t</eyes>",
    "\t\t\t<skin>",
    "\t\t\t</skin>",
    "\t\t\t<hair>",
    "\t\t\t</hair>",
    "\t\t</appearance>",
    '\t\t<abilities available-points="15">',
    "\t\t\t<strength>10</strength>",
    "\t\t\t<dexterity>10</dexterity>",
    "\t\t\t<constitution>10</constitution>",
    "\t\t\t<intelligence>10</intelligence>",
    "\t\t\t<wisdom>10</wisdom>",
    "\t\t\t<charisma>10</charisma>",
    "\t\t</abilities>",
    '\t\t<elements level-count="1" registered-count="3">',
    '\t\t\t<element type="Option" name="Multiclassing" id="ID_INTERNAL_OPTION_ALLOW_MULTICLASSING" />',
    '\t\t\t<element type="Option" name="Feats" id="ID_INTERNAL_OPTION_ALLOW_FEATS" />',
    '\t\t\t<element type="Level" name="1" id="ID_LEVEL_1">',
    '\t\t\t\t<element type="Race" name="Race" requiredLevel="1" checksum="1597ef76" registered="" />',
    '\t\t\t\t<element type="Class" name="Class" requiredLevel="1" checksum="33a7b15b" registered="" />',
    '\t\t\t\t<element type="Background" name="Background" requiredLevel="1" checksum="6a621392" registered="" />',
    '\t\t\t\t<element type="Alignment" name="Alignment" requiredLevel="1" checksum="c9ac49d5" registered="" />',
    '\t\t\t\t<element type="Deity" name="Deity" requiredLevel="1" checksum="989cce4c" registered="" />',
    '\t\t\t\t<element type="Grants" name="Base" id="ID_INTERNAL_GRANTS_CHARACTER_BASE" />',
    '\t\t\t\t<element type="Grants" name="Spellcasting Base" id="ID_INTERNAL_GRANTS_SPELLCASTING_BASE" />',
    '\t\t\t\t<element type="Grants" name="Base Armor Class" id="ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE" />',
    '\t\t\t\t<element type="Grants" name="Dexterity Modifier" id="ID_INTERNAL_GRANTS_ARMOR_CLASS_DEXTERITY_MODIFIER" />',
    '\t\t\t\t<element type="Grants" name="Constitution Modifier" id="ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER" />',
    "\t\t\t</element>",
    "\t\t</elements>",
    "\t\t<defenses>",
    "\t\t\t<conditional>",
    "\t\t\t</conditional>",
    "\t\t</defenses>",
    '\t\t<companion name="">',
    "\t\t\t<attributes>",
    "\t\t\t\t<strength>10</strength>",
    "\t\t\t\t<dexterity>10</dexterity>",
    "\t\t\t\t<constitution>10</constitution>",
    "\t\t\t\t<intelligence>10</intelligence>",
    "\t\t\t\t<wisdom>10</wisdom>",
    "\t\t\t\t<charisma>10</charisma>",
    "\t\t\t</attributes>",
    "\t\t\t<saves>",
    '\t\t\t\t<save ability="strength">0</save>',
    '\t\t\t\t<save ability="dexterity">0</save>',
    '\t\t\t\t<save ability="constitution">0</save>',
    '\t\t\t\t<save ability="intelligence">0</save>',
    '\t\t\t\t<save ability="wisdom">0</save>',
    '\t\t\t\t<save ability="charisma">0</save>',
    "\t\t\t</saves>",
    "\t\t\t<skills>",
    '\t\t\t\t<skill name="Acrobatics">0</skill>',
    '\t\t\t\t<skill name="Animal Handling">0</skill>',
    '\t\t\t\t<skill name="Arcana">0</skill>',
    '\t\t\t\t<skill name="Athletics">0</skill>',
    '\t\t\t\t<skill name="Deception">0</skill>',
    '\t\t\t\t<skill name="History">0</skill>',
    '\t\t\t\t<skill name="Insight">0</skill>',
    '\t\t\t\t<skill name="Intimidation">0</skill>',
    '\t\t\t\t<skill name="Investigation">0</skill>',
    '\t\t\t\t<skill name="Medicine">0</skill>',
    '\t\t\t\t<skill name="Nature">0</skill>',
    '\t\t\t\t<skill name="Perception">0</skill>',
    '\t\t\t\t<skill name="Performance">0</skill>',
    '\t\t\t\t<skill name="Persuasion">0</skill>',
    '\t\t\t\t<skill name="Religion">0</skill>',
    '\t\t\t\t<skill name="Sleight of Hand">0</skill>',
    '\t\t\t\t<skill name="Stealth">0</skill>',
    '\t\t\t\t<skill name="Survival">0</skill>',
    "\t\t\t</skills>",
    '\t\t\t<portrait location="local">',
    "\t\t\t</portrait>",
    "\t\t</companion>",
    "\t\t<equipment>",
    '\t\t\t<storage name="#1" />',
    '\t\t\t<storage name="#2" />',
    "\t\t</equipment>",
    '\t\t<sum element-count="8">',
    '\t\t\t<element type="Level" id="ID_LEVEL_1" />',
    '\t\t\t<element type="Grants" id="ID_INTERNAL_GRANTS_CHARACTER_BASE" />',
    '\t\t\t<element type="Grants" id="ID_INTERNAL_GRANTS_SPELLCASTING_BASE" />',
    '\t\t\t<element type="Grants" id="ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE" />',
    '\t\t\t<element type="Grants" id="ID_INTERNAL_GRANTS_ARMOR_CLASS_DEXTERITY_MODIFIER" />',
    '\t\t\t<element type="Grants" id="ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER" />',
    '\t\t\t<element type="Option" id="ID_INTERNAL_OPTION_ALLOW_MULTICLASSING" />',
    '\t\t\t<element type="Option" id="ID_INTERNAL_OPTION_ALLOW_FEATS" />',
    "\t\t</sum>",
    "\t\t<magic />",
    "\t</build>",
    "\t<!-- restricted sources -->",
    "\t<sources>",
    "\t\t<restricted />",
    "\t</sources>",
    "</character>",
  ];
  return lines.join("\r\n");
}

/**
 * Requirement sweeps per mutation. Real content settles in one or two; the
 * bound only exists so mutually exclusive homebrew cannot spin.
 */
const MAX_RULE_RECONCILE_PASSES = 8;

/**
 * Every selection wrapper keyed by tree path, alongside a signature that
 * survives the tree shifting around it: the chain of elements it hangs under
 * plus the wrapper's own identity. Two wrappers that are the same rule before
 * and after a sweep share a signature even if their sibling index moved.
 */
function wrapperSignatures(state: CharacterState): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  const walk = (nodes: readonly RegisteredElement[], path: number[], trail: string): void => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      const own =
        node.checksum !== undefined && node.checksum !== ""
          ? node.checksum
          : `${node.type}|${node.name}|${node.requiredLevel ?? ""}`;
      if (node.requiredLevel !== undefined) {
        const base = `${trail}/${own}`;
        const ordinal = seen.get(base) ?? 0;
        seen.set(base, ordinal + 1);
        out.set(here.join("."), `${base}#${ordinal}`);
      }
      walk(node.children, here, `${trail}/${node.id || node.registered || own}`);
    });
  };
  walk(state.elements, [], "");
  return out;
}

/**
 * Carries selection-rule identifiers from `before` onto the equivalent rules in
 * `after`. A rule the sweep removed loses its identifier; one that merely
 * shifted position keeps it, so an identifier a caller is holding still names
 * the rule it named before.
 */
function rekeySelectionRuleIds(before: CharacterState, after: CharacterState): Map<string, string> {
  const identifiers = before.selectionRuleIds ?? new Map<string, string>();
  if (identifiers.size === 0) return new Map();
  const beforeSignatures = wrapperSignatures(before);
  const bySignature = new Map<string, string>();
  for (const [pathKey, identifier] of identifiers) {
    const signature = beforeSignatures.get(pathKey);
    if (signature !== undefined) bySignature.set(signature, identifier);
  }
  const out = new Map<string, string>();
  for (const [pathKey, signature] of wrapperSignatures(after)) {
    const identifier = bySignature.get(signature);
    if (identifier !== undefined) out.set(pathKey, identifier);
  }
  return out;
}

export class CharacterService {
  private readonly store: CharacterStore;
  private readonly documents = new Map<string, Dnd5eDocument>();
  private readonly library: ElementLibrary | undefined;
  private readonly rng: () => number;
  private readonly onImport: ((event: CharacterImportEvent) => void) | undefined;

  constructor(store?: CharacterStore, library?: ElementLibrary, options: CharacterServiceOptions = {}) {
    this.store = store ?? new InMemoryCharacterStore();
    this.library = library;
    this.rng = options.rng ?? Math.random;
    this.onImport = options.onImport;
  }

  /** Re-maps state from an edited document, carrying per-session state over. */
  private remap(document: Dnd5eDocument, previous: CharacterState, id: string): CharacterState {
    const state = mapToState(document, id);
    state.selectionRuleIds = new Map(previous.selectionRuleIds ?? []);
    state.magicCasterIds = new Map(previous.magicCasterIds ?? []);
    state.levelRegistrations = previous.levelRegistrations ?? [];
    state.delevelSnapshot = previous.delevelSnapshot ?? null;
    return state;
  }

  /** Applies region edits, re-maps state and merges session updates. */
  private applyPlan(
    id: string,
    state: CharacterState,
    document: Dnd5eDocument,
    edits: RawEdit[],
    mutate?: (next: CharacterState) => void,
  ): CharacterState {
    const updated = parseDnd5e(applyRawEdits(document.raw, edits));
    const next = this.remap(updated, state, id);
    if (mutate) mutate(next);
    this.store.set(next);
    this.documents.set(id, updated);
    return next;
  }

  /**
   * Applies region edits like applyPlan, then re-derives the magic region
   * (caster blocks, slots, spell attributes) from the character and edits it
   * again when the serialized block no longer matches. Magic-changing
   * mutations (spell selections, level-ups, delevels) share this path so the
   * exported <magic> region stays consistent after every mutation.
   */
  private applyWithMagicReconcile(
    id: string,
    state: CharacterState,
    document: Dnd5eDocument,
    edits: RawEdit[],
    mutate?: (next: CharacterState) => void,
  ): CharacterState {
    if (this.library === undefined) return this.applyPlan(id, state, document, edits, mutate);
    const updated = parseDnd5e(applyRawEdits(document.raw, edits));
    const next = this.remap(updated, state, id);
    if (mutate) mutate(next);
    // Rules settle first so the caster blocks are derived from the finished
    // element tree: a spell select can itself be requirement-gated.
    const settled = this.settleRegistrationRules(id, updated, next, state);
    return this.reconcileMagicRegion(id, settled.document, settled.state);
  }

  /**
   * Applies region edits like applyPlan, then settles requirement-gated rules.
   * Mutations that change the registered set without touching spellcasting ---
   * toggling an optional rule, equipping an optional-class-feature item, a DM
   * grant — run through here so a rule whose requirements just flipped (a
   * race's ability-score choice switched off by a 2024 background, a language
   * pick list switched on by an optional rule) appears or disappears in the same
   * operation. Spell-affecting mutations use applyWithMagicReconcile, which
   * settles rules too.
   */
  private applyWithRuleReconcile(
    id: string,
    state: CharacterState,
    document: Dnd5eDocument,
    edits: RawEdit[],
    mutate?: (next: CharacterState) => void,
  ): CharacterState {
    if (this.library === undefined) return this.applyPlan(id, state, document, edits, mutate);
    const updated = parseDnd5e(applyRawEdits(document.raw, edits));
    const next = this.remap(updated, state, id);
    if (mutate) mutate(next);
    const settled = this.settleRegistrationRules(id, updated, next, state);
    this.store.set(settled.state);
    this.documents.set(id, settled.document);
    return settled.state;
  }

  /**
   * Re-runs the requirement sweep until it stops changing anything. A sweep can
   * enable rules that the previous one’s removals unblocked, so one pass is not
   * always enough; the bound and the repeat check keep mutually exclusive
   * homebrew content from looping forever, leaving the last settled document in
   * place rather than throwing.
   */
  private settleRegistrationRules(
    id: string,
    document: Dnd5eDocument,
    state: CharacterState,
    /** The pre-mutation state, whose paths the caller's rule identifiers name. */
    before: CharacterState,
  ): { document: Dnd5eDocument; state: CharacterState } {
    const seen = new Set<string>();
    let currentDocument = document;
    let currentState = state;
    let settled = false;
    for (let pass = 0; pass < MAX_RULE_RECONCILE_PASSES; pass++) {
      const plan = reconcileRegistrationRules(currentDocument, currentState, this.library!);
      if (!plan.changed) break;
      const signature = plan.flips
        .map((flip) => `${flip.kind}|${flip.ownerId}|${flip.key}`)
        .sort()
        .join("\n");
      if (seen.has(signature)) break;
      seen.add(signature);
      currentDocument = parseDnd5e(applyRawEdits(currentDocument.raw, plan.edits));
      currentState = this.remap(currentDocument, currentState, id);
      settled = true;
    }
    // Selection-rule identifiers are keyed by tree path, so a sweep that adds or
    // removes a wrapper would otherwise rebind an identifier the caller is still
    // holding to a different rule. Re-key them onto the rules they still name;
    // identifiers for rules the sweep removed fall away.
    if (settled) currentState.selectionRuleIds = rekeySelectionRuleIds(before, currentState);
    return { document: currentDocument, state: currentState };
  }

  /** Stores the state, re-deriving the magic region when it drifted. */
  private reconcileMagicRegion(id: string, document: Dnd5eDocument, state: CharacterState): CharacterState {
    const magicPlan = reconcileMagic(document, state, this.library!, this.magicStatistics(state));
    if (!magicPlan.changed) return this.reconcileAttackRows(id, document, state);
    const reconciled = parseDnd5e(applyRawEdits(document.raw, magicPlan.edits));
    return this.reconcileAttackRows(id, reconciled, this.remap(reconciled, state, id));
  }

  /**
   * Stores the state, refreshing stored attack rows whose resolution drifted.
   * In-app views re-derive rows on read, but the exported file carries the
   * attributes as written, so a level-up that grows a cantrip's damage has to
   * land in the document too. Runs after the magic region settles because spell
   * rows resolve against the reconciled caster blocks.
   */
  private reconcileAttackRows(id: string, document: Dnd5eDocument, state: CharacterState): CharacterState {
    const edits = planRewriteAllAttackEdits(state, document, this.library!);
    if (edits.length === 0) {
      this.store.set(state);
      this.documents.set(id, document);
      return state;
    }
    const refreshed = parseDnd5e(applyRawEdits(document.raw, edits));
    const refreshedState = this.remap(refreshed, state, id);
    this.store.set(refreshedState);
    this.documents.set(id, refreshed);
    return refreshedState;
  }

  private require(id: string): { state: CharacterState; document: Dnd5eDocument } {
    const state = this.store.get(id);
    const document = this.documents.get(id);
    if (state === undefined || document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    return { state, document };
  }

  /** The character's current document (magic region planners consume it). */
  documentOf(id: string): Dnd5eDocument {
    return this.require(id).document;
  }

  /** The content library (magic projections consume it). */
  get libraryOf(): ElementLibrary | undefined {
    return this.library;
  }

  /**
   * Creates a fresh level-1 character. The storage id is the character name
   * (the client keeps a single slot; the harness keys by name).
   */
  createCharacter(name: string): CharacterState {
    const id = name;
    const template = emptyCharacterState(id);
    template.name = name;
    const document = parseDnd5e(createDocument(template));
    const state = mapToState(document, id);
    this.store.set(state);
    this.documents.set(id, document);
    return state;
  }

  importCharacterXml(id: string, xmlText: string): CharacterState {
    const parseStart = performance.now();
    // Characters saved before the current grant model carry a <dm-grants>
    // block plus synthesized registrations; migrate them into the current
    // representation and replay the grants after the import lands.
    const legacy = this.library !== undefined ? extractLegacyDmGrants(xmlText) : null;
    let document: Dnd5eDocument;
    try {
      document = parseDnd5e(legacy?.cleanedXml ?? xmlText);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw engineError("content-invalid", `invalid character xml for '${id}': ${message}`);
    }
    const parseMs = Math.max(0, performance.now() - parseStart);
    const hydrationStart = performance.now();
    const state = mapToState(document, id);
    if (this.library !== undefined) {
      state.levelRegistrations = reconstructLevelRegistrations(state, document, this.library);
    }
    const hydrationMs = Math.max(0, performance.now() - hydrationStart);
    this.store.set(state);
    this.documents.set(id, document);
    if (legacy !== null) this.replayLegacyDmGrants(id, legacy);
    const imported = this.getCharacter(id);
    this.onImport?.({ mode: "xml", id, state: imported, parseMs, hydrationMs });
    return imported;
  }

  /**
   * Replays migrated legacy DM grants through the current planners. Each
   * grant is best-effort: content packs can change between sessions, and a
   * grant whose element no longer resolves must not fail the whole import.
   */
  private replayLegacyDmGrants(id: string, legacy: LegacyDmGrants): void {
    for (const featId of legacy.feats) {
      try {
        this.addGrantedFeat(id, { featId });
        const choice = legacy.featChoices.get(featId);
        if (choice !== undefined) {
          const state = this.getCharacter(id);
          const featIndex = state.elements.findIndex((node) => node.id === featId);
          if (featIndex >= 0) {
            for (const rule of pendingSelectionRules(state)) {
              if (rule.path[0] !== featIndex) continue;
              try {
                this.setSelection(id, rule.identifier, choice);
                break;
              } catch {
                // The recorded choice does not fit this rule; leave it pending.
              }
            }
          }
        }
      } catch {
        // Unresolvable grant (content changed); the import itself stands.
      }
    }
    if (legacy.asis.length > 0) {
      try {
        this.addGrantedAbilityScore(id, { abilityElementIds: legacy.asis });
      } catch {
        // Unresolvable grant (content changed); the import itself stands.
      }
    }
    for (const spell of legacy.spells) {
      try {
        this.addGrantedSpell(id, { spellId: spell.id });
      } catch {
        // Unresolvable grant (content changed); the import itself stands.
      }
    }
  }

  /**
   * Installs a snapshot-restored document+state pair atomically. The state is
   * authoritative: no re-mapping and no level-registration reconstruction.
   */
  installSnapshot(id: string, document: Dnd5eDocument, state: CharacterState): void {
    if (state.id !== id) {
      throw engineError("invalid-argument", `snapshot state id '${state.id}' does not match '${id}'`);
    }
    this.store.set(state);
    this.documents.set(id, document);
  }

  getCharacter(id: string): CharacterState {
    const state = this.store.get(id);
    if (state === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    return state;
  }

  /** The client-facing detail projection of the character. */
  getCharacterDetail(id: string): CharacterDetail {
    const { state } = this.require(id);
    return buildCharacterDetail(state, this.library);
  }

  /** The optional rules DTO list (pinned shape). */
  getOptionalRules(id: string): OptionalRuleDto[] {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for optional rules");
    }
    return getOptionalRules(state, this.library);
  }

  /** The character adjustments DTO list (pinned shape). */
  getCharacterAdjustments(id: string): CharacterAdjustmentDto[] {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for adjustments");
    }
    return getCharacterAdjustments(state, this.library);
  }

  /** The character controls list (option:/item: keys with enabled state). */
  getCharacterControls(id: string): CharacterControlDto[] {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for controls");
    }
    return getCharacterControls(state, this.library);
  }

  /**
   * Toggles a character control: keys start with "option:" (optional rules)
   * or "item:" (adjustments), matching the controls surface.
   */
  setCharacterControl(id: string, control: { key: string; enabled: boolean }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for controls");
    }
    if (control.key.startsWith("option:")) {
      return this.setCharacterOption(id, { optionId: control.key.slice("option:".length), enabled: control.enabled });
    }
    if (control.key.startsWith("item:")) {
      const itemId = control.key.slice("item:".length);
      // A control item is on by either representation — registered in the
      // elements tree, or carried as an equipment record — so the no-op check
      // has to consider both, or switching a carried one off does nothing.
      if (control.enabled === isControlEnabled(state, this.library, itemId)) return state;
      const edits = planItemEdits(state, document, this.library, itemId, control.enabled);
      return this.applyWithRuleReconcile(id, state, document, edits);
    }
    throw engineError("invalid-argument", "character control keys must start with option: or item:");
  }

  /** The ruleset-mode view (classification counts, incompatible wrappers). */
  getRulesetMode(id: string): RulesetModeDto {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for ruleset modes");
    }
    return getRulesetMode(state, this.library);
  }

  /** Switches the ruleset mode, repairing/removing incompatible selections. */
  setRulesetMode(id: string, mode: string): RulesetChangeResult {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for ruleset modes");
    }
    if (mode !== "2014" && mode !== "2024" && mode !== "all") {
      throw engineError("invalid-argument", `unsupported ruleset mode '${mode}'`);
    }
    if (state.rulesetMode === mode) {
      return { mode, repaired: [], removed: [], unresolved: [] };
    }
    if (mode === "all") {
      const edits = planRulesetTagEdit(document, "all");
      return this.applyRulesetPlan(id, state, document, edits, "all");
    }
    const change = computeRulesetChange(state, this.library, mode as "2014" | "2024");
    const edits = planRulesetModeEdits(state, document, this.library, mode as "2014" | "2024");
    return this.applyRulesetPlan(id, state, document, edits, mode, change);
  }

  private applyRulesetPlan(
    id: string,
    state: CharacterState,
    document: Dnd5eDocument,
    edits: RawEdit[],
    mode: string,
    change?: RulesetChangeResult,
  ): RulesetChangeResult {
    const updated = parseDnd5e(applyRawEdits(document.raw, edits));
    const next = this.remap(updated, state, id);
    next.rulesetMode = mode;
    this.store.set(next);
    this.documents.set(id, updated);
    return change ?? { mode, repaired: [], removed: [], unresolved: [] };
  }

  deleteCharacter(id: string): void {
    this.store.delete(id);
    this.documents.delete(id);
  }

  exportCharacterXml(id: string): string {
    const document = this.documents.get(id);
    if (document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    return document.serialize();
  }

  updateDetails(id: string, details: CharacterDetails): CharacterState {
    const state = this.store.get(id);
    const document = this.documents.get(id);
    if (state === undefined || document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    const edits: Array<{ node: Dnd5eNode; value: string }> = [];
    const add = (node: Dnd5eNode | null, value: string | undefined): void => {
      if (node !== null && value !== undefined) edits.push({ node, value });
    };

    const input = document.root.build.input?.node ?? null;
    const inputName = input ? child(input, "name") : null;
    const displayNode = document.root.displayProperties.node;
    const displayName = displayNode ? child(displayNode, "name") : null;
    if (details.name !== undefined) {
      add(inputName, details.name);
      add(displayName, details.name);
    }
    if (input) {
      add(child(input, "player-name"), details.playerName);
      add(child(input, "gender"), details.gender);
      add(child(input, "experience"), details.experience === undefined ? undefined : String(details.experience));
      add(child(input, "backstory"), details.backstory);
      add(child(input, "additional-features"), details.additionalFeatures);
      const organization = child(input, "organization");
      if (organization) {
        add(child(organization, "name"), details.organisationName);
        add(child(organization, "allies"), details.allies);
      }
      const notes = child(input, "notes");
      if (notes) {
        add(noteByColumn(notes, "left"), details.notes1);
        add(noteByColumn(notes, "right"), details.notes2);
      }
    }
    const appearance = document.root.build.appearance?.node ?? null;
    if (appearance) {
      add(child(appearance, "age"), details.age);
      add(child(appearance, "height"), details.height);
      add(child(appearance, "weight"), details.weight);
      add(child(appearance, "eyes"), details.eyes);
      add(child(appearance, "skin"), details.skin);
      add(child(appearance, "hair"), details.hair);
    }

    const updated = withTextEdits(document, edits);
    const updatedState = this.remap(updated, state, id);
    this.store.set(updatedState);
    this.documents.set(id, updated);
    return updatedState;
  }

  /**
   * The format only carries <base64> when a portrait was stored, so imported
   * documents routinely carry <portrait> without it (or omit the block
   * entirely); whatever is missing is created before the write.
   */
  private ensurePortraitNodes(document: Dnd5eDocument): Dnd5eDocument {
    const display = document.root.displayProperties;
    if (display.node === null) {
      throw engineError("invalid-argument", "character has no display-properties region");
    }
    const expanded =
      "<portrait>\r\n\t\t\t<companion><![CDATA[]]></companion>\r\n\t\t\t<local>\r\n\t\t\t</local>\r\n\t\t\t<base64><![CDATA[]]></base64>\r\n\t\t</portrait>";
    let portrait = display.portrait();
    if (portrait === null) {
      const insertAt = display.node.closeStart ?? display.node.end;
      document = parseDnd5e(document.raw.slice(0, insertAt) + `\t${expanded}\r\n\t` + document.raw.slice(insertAt));
      portrait = document.root.displayProperties.portrait()!;
    } else if (portrait.node.closeStart == null) {
      // A self-closing <portrait /> has no interior to insert into.
      document = parseDnd5e(document.raw.slice(0, portrait.node.start) + expanded + document.raw.slice(portrait.node.end));
      portrait = document.root.displayProperties.portrait()!;
    }
    const NODES = {
      companion: "\t<companion><![CDATA[]]></companion>\r\n\t\t",
      local: "\t<local>\r\n\t\t\t</local>\r\n\t\t",
      base64: "\t<base64><![CDATA[]]></base64>\r\n\t\t",
    } as const;
    for (const name of ["companion", "local", "base64"] as const) {
      if (child(portrait.node, name) !== null) continue;
      const insertAt = portrait.node.closeStart!;
      document = parseDnd5e(document.raw.slice(0, insertAt) + NODES[name] + document.raw.slice(insertAt));
      portrait = document.root.displayProperties.portrait()!;
    }
    return document;
  }

  setPortrait(id: string, base64: string): CharacterState {
    const state = this.store.get(id);
    const stored = this.documents.get(id);
    if (state === undefined || stored === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    const document = this.ensurePortraitNodes(stored);
    const portrait = document.root.displayProperties.portrait()!;
    const base64Node = child(portrait.node, "base64")!;
    const localNode = child(portrait.node, "local")!;
    // Readers of the format rehydrate the portrait only when BOTH <local> and
    // <base64> are non-blank, so a filename is stamped alongside the bytes.
    const local = base64 === "" ? "" : `${id}-portrait.png`;
    const updated = withTextEdits(document, [
      { node: base64Node, value: base64 },
      { node: localNode, value: local },
    ]);
    const updatedState = this.remap(updated, state, id);
    this.store.set(updatedState);
    this.documents.set(id, updated);
    return updatedState;
  }

  removePortrait(id: string): CharacterState {
    return this.setPortrait(id, "");
  }

  /**
   * The companion portrait rides in the portrait region's own <companion>
   * slot, so it travels with the character through export, import, and cloud
   * sync exactly as the character's own portrait does.
   */
  setCompanionPortrait(id: string, base64: string): CharacterState {
    const state = this.store.get(id);
    const stored = this.documents.get(id);
    if (state === undefined || stored === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    const document = this.ensurePortraitNodes(stored);
    const portrait = document.root.displayProperties.portrait()!;
    const companionNode = child(portrait.node, "companion")!;
    const updated = withTextEdits(document, [{ node: companionNode, value: base64 }]);
    const updatedState = this.remap(updated, state, id);
    this.store.set(updatedState);
    this.documents.set(id, updated);
    return updatedState;
  }

  removeCompanionPortrait(id: string): CharacterState {
    return this.setCompanionPortrait(id, "");
  }

  setAbilities(id: string, scores: AbilityScores, generationOption?: number): CharacterState {
    const state = this.store.get(id);
    const document = this.documents.get(id);
    if (state === undefined || document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    if (generationOption !== undefined && (!Number.isInteger(generationOption) || generationOption < 0)) {
      throw engineError("invalid-argument", `generation option '${generationOption}' must be a non-negative integer`);
    }
    const abilities = document.root.build.abilities?.node ?? null;
    const edits: Array<{ node: Dnd5eNode; value: string }> = [];
    for (const ability of ABILITIES) {
      const node = abilities ? child(abilities, ability) : null;
      if (node) edits.push({ node, value: String(scores[ability]) });
    }
    if (generationOption !== undefined) {
      const information = document.root.information.node;
      const node = information ? child(information, "generationOption") : null;
      if (node) edits.push({ node, value: String(generationOption) });
    }
    let updated = withAvailablePoints(withTextEdits(document, edits), pointBuyRemaining(scores));
    if (generationOption !== undefined) updated = withGenerationOption(updated, generationOption);
    const updatedState = this.remap(updated, state, id);
    this.store.set(updatedState);
    this.documents.set(id, updated);
    return updatedState;
  }

  /**
   * Registers a selection into the pending rule identified by its
   * session-stable identifier, editing the document and re-mapping state.
   * Requires a content library (constructor-injected).
   */
  setSelection(id: string, ruleIdentifier: string, selectionId: string, number?: number): CharacterState {
    const state = this.store.get(id);
    const document = this.documents.get(id);
    if (state === undefined || document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for selections");
    }
    const rule = selectionRuleFor(state, ruleIdentifier);
    if (!rule) throw engineError("not-found", `selection rule '${ruleIdentifier}' not found`);
    if (rule.type === "Multiclass" && state.levelHistory[state.levelHistory.length - 1]?.isPending === true) {
      if (!selectionOptions(state, this.library, rule).some((option) => option.id === selectionId)) {
        throw engineError("invalid-argument", `element '${selectionId}' is not eligible for rule 'Multiclass'`);
      }
      const plan = planStartMulticlassEdits(state, document, this.library, selectionId, this.rng);
      const pendingRecord = state.levelRegistrations[state.levelRegistrations.length - 1];
      return this.applyWithMagicReconcile(id, state, document, plan.edits, (next) => {
        const addedElementIds = [
          ...(pendingRecord?.addedElementIds ?? []),
          ...plan.record.addedElementIds,
        ].filter((elementId, index, ids) => ids.indexOf(elementId) === index);
        next.levelRegistrations = [
          ...state.levelRegistrations.slice(0, -1),
          { ...plan.record, addedElementIds },
        ];
      });
    }
    // Re-picking an already-resolved multiclass: the generic wrapper-edit path
    // (below) only rewrites the Multiclass wrapper's own `registered` id, but
    // the ancestor Level wrapper's `class` attribute — which drives every
    // downstream read of "what class is this level" — lives outside that
    // wrapper's byte region and never gets touched, so the class silently
    // never changes. Route through the same delevel+restart
    // primitives a fresh pick uses so both attributes update atomically.
    if (rule.type === "Multiclass" && rule.hasSelection) {
      return this.changeMulticlassSelection(id, state, document, rule, selectionId);
    }
    // Adjacent same-name wrappers form one numbered selection group.
    const targetRule = selectionRuleForSlot(state, ruleIdentifier, number);
    if (!targetRule) throw engineError("not-found", `selection rule '${ruleIdentifier}' not found`);
    const edits = planSelectionEdits(document, state, this.library, targetRule, selectionId, number);
    const rndhpEdit =
      rule.type === "Class" && this.library.byId.get(selectionId)
        ? planClassRndhpEdit(document, state, this.library.byId.get(selectionId)!, this.rng)
        : null;
    const selectionEdits = rndhpEdit ? [...edits, rndhpEdit] : edits;
    // Companion selections write the default name into the build <companion>
    // node (captured: the export after companion select carries
    // name="Steel Defender"), so the second pass runs after the selection
    // registers the companion element.
    if (rule.type === "Companion" && this.library.byId.get(selectionId) !== undefined) {
      const updated = parseDnd5e(applyRawEdits(document.raw, selectionEdits));
      const afterSelect = this.remap(updated, state, id);
      const namePlan = planSetCompanionName(
        updated,
        afterSelect,
        this.library,
        this.library.byId.get(selectionId)!.identity.name,
      );
      const withName = parseDnd5e(applyRawEdits(updated.raw, namePlan.edits));
      const withNameState = this.remap(withName, afterSelect, id);
      withNameState.companion.name = namePlan.name;
      return this.reconcileMagicRegion(id, withName, withNameState);
    }
    // Spell-rule selections build the caster blocks on a fresh build; the
    // shared path also re-derives them for replacements.
    return this.applyWithMagicReconcile(id, state, document, selectionEdits);
  }

  /** Clears one selection slot and reconciles dependent grants in the same edit. */
  clearSelection(id: string, ruleIdentifier: string, number?: number): CharacterState {
    const state = this.store.get(id);
    const document = this.documents.get(id);
    if (state === undefined || document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for selections");
    }
    const rule = selectionRuleForSlot(state, ruleIdentifier, number);
    if (!rule) throw engineError("not-found", `selection rule '${ruleIdentifier}' not found`);
    if (!rule.hasSelection) return state;
    if (rule.type === "Multiclass") {
      return this.removeMulticlassSelection(id, state, document, rule);
    }
    const edits = planSelectionEdits(document, state, this.library, rule, null, number);
    return this.applyWithMagicReconcile(id, state, document, edits);
  }

  /**
   * Swaps an already-resolved multiclass start for a different class variant.
   * Composed from the well-tested delevel and start-multiclass primitives
   * (remove the starting level, then start it again with the new class)
   * rather than the generic selection-edit path, which only patches the
   * Multiclass wrapper itself and both corrupts overlapping regions and
   * leaves the ancestor Level wrapper's `class` attribute stale.
   */
  private changeMulticlassSelection(
    id: string,
    state: CharacterState,
    document: Dnd5eDocument,
    rule: SelectionRule,
    selectionId: string,
  ): CharacterState {
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for selections");
    }
    const fromClassId = rule.selectedElementIds[0];
    if (!fromClassId) throw engineError("not-found", "selection rule 'Multiclass' has no current selection");
    if (fromClassId === selectionId) return state;
    if (!selectionOptions(state, this.library, rule).some((option) => option.id === selectionId)) {
      throw engineError("invalid-argument", `element '${selectionId}' is not eligible for rule 'Multiclass'`);
    }
    this.requireRemovableMulticlassStart(state, fromClassId);
    // planStartMulticlassEdits converts whichever level wrapper is currently
    // last into a multiclass start, so it's only safe to call on a freshly
    // appended pending wrapper (planNewMulticlassEdits's job) — never
    // directly on the state straight out of delevel, or it would clobber
    // whatever real level content is now last instead.
    const delevelPlan = planDelevelEdits(state, document, this.library, { mode: "last" });
    const afterRemove = parseDnd5e(applyRawEdits(document.raw, delevelPlan.edits));
    const stateAfterRemove = this.remap(afterRemove, state, id);
    stateAfterRemove.levelRegistrations = state.levelRegistrations.slice(0, -1);
    const newPlan = planNewMulticlassEdits(stateAfterRemove, afterRemove, this.library);
    const afterNew = parseDnd5e(applyRawEdits(afterRemove.raw, newPlan.edits));
    const stateAfterNew = this.remap(afterNew, stateAfterRemove, id);
    stateAfterNew.levelRegistrations = [...stateAfterRemove.levelRegistrations, newPlan.record];
    const startPlan = planStartMulticlassEdits(stateAfterNew, afterNew, this.library, selectionId, this.rng);
    const updated = parseDnd5e(applyRawEdits(afterNew.raw, startPlan.edits));
    const next = this.remap(updated, stateAfterNew, id);
    next.levelRegistrations = [...stateAfterRemove.levelRegistrations, startPlan.record];
    return this.reconcileMagicRegion(id, updated, next);
  }

  /** Removes an already-resolved multiclass start (the delevel equivalent of "unpick"). */
  private removeMulticlassSelection(
    id: string,
    state: CharacterState,
    document: Dnd5eDocument,
    rule: SelectionRule,
  ): CharacterState {
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for selections");
    }
    const classId = rule.selectedElementIds[0];
    if (!classId) return state;
    this.requireRemovableMulticlassStart(state, classId);
    const plan = planDelevelEdits(state, document, this.library, { mode: "last" });
    return this.applyWithMagicReconcile(id, state, document, plan.edits, (mapped) => {
      mapped.levelRegistrations = plan.snapshot.levelRegistrations.slice(0, -1);
      mapped.delevelSnapshot = plan.snapshot;
    });
  }

  /**
   * A multiclass start can only be changed or removed while it is still the
   * character's most recent level: the delevel primitive it's composed from
   * only ever removes the last level wrapper.
   */
  private requireRemovableMulticlassStart(state: CharacterState, classId: string): void {
    const lastEntry = state.levelHistory[state.levelHistory.length - 1];
    const record = state.levelRegistrations[state.levelRegistrations.length - 1];
    const matches = (entry: { classId: string; isMulticlass: boolean; isClassStart: boolean } | undefined): boolean =>
      entry !== undefined && entry.classId === classId && entry.isMulticlass && entry.isClassStart;
    if (!matches(lastEntry) || !matches(record)) {
      throw engineError(
        "invalid-argument",
        "changing or removing this multiclass selection requires it to still be the character's most recent level — level up or remove later levels first",
      );
    }
  }

  /** Applies raw byte-range edits to the document and re-maps state. */
  applyRegionEdits(id: string, edits: RawEdit[]): CharacterState {
    const state = this.store.get(id);
    const document = this.documents.get(id);
    if (state === undefined || document === undefined) {
      throw engineError("not-found", `character '${id}' not found`);
    }
    const updated = parseDnd5e(applyRawEdits(document.raw, edits));
    const updatedState = this.remap(updated, state, id);
    this.store.set(updatedState);
    this.documents.set(id, updated);
    return updatedState;
  }

  /** Levels up the main class. */
  levelUp(id: string): CharacterState {
    return this.levelUpMode(id, { mode: "main" });
  }

  /** Adds a main level, creates a multiclass choice, or advances an existing multiclass. */
  levelUpMode(
    id: string,
    opts: { mode: "main" | "new-multiclass" | "multiclass"; classId?: string },
  ): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for leveling");
    }
    const multiclassId = opts.classId ?? "";
    const plan =
      opts.mode === "main"
        ? planLevelUpEdits(state, document, this.library)
        : opts.mode === "new-multiclass"
          ? planNewMulticlassEdits(state, document, this.library)
          : planLevelUpMulticlassEdits(state, document, this.library, multiclassId);
    const healEdits = planHealDegenerateRollsEdits(state, document, this.library, this.rng);
    return this.applyWithMagicReconcile(id, state, document, [...plan.edits, ...healEdits], (next) => {
      next.levelRegistrations = [...(state.levelRegistrations ?? []), plan.record];
    });
  }

  /**
   * Advances the main class repeatedly until the character stands at `level`.
   *
   * One call so the transport records a single undo step; a failure part-way
   * puts the pre-operation document back rather than storing a character that
   * is half-way up the ladder.
   */
  levelUpTo(id: string, opts: { level: number }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for leveling");
    }
    const target = opts.level;
    if (!Number.isInteger(target)) {
      throw engineError("invalid-argument", "target level must be a whole number");
    }
    if (target > MAX_LEVEL) {
      throw engineError("invalid-argument", `target level ${target} is above the maximum character level of ${MAX_LEVEL}`);
    }
    if (target <= state.level) {
      throw engineError("invalid-argument", `target level ${target} must be above the current level ${state.level}`);
    }
    if (!buildProgression(state, this.library).hasMainClass) {
      throw engineError("conflict", "choose a class before levelling up to a target level");
    }
    const documentRaw = document.raw;
    const levelRegistrations = [...(state.levelRegistrations ?? [])];
    try {
      for (let remaining = target - state.level; remaining > 0; remaining -= 1) {
        const before = this.require(id).state.level;
        this.levelUpMode(id, { mode: "main" });
        if (this.require(id).state.level <= before) {
          throw engineError("conflict", `levelling up stalled at level ${before}`);
        }
      }
    } catch (cause) {
      const restored = parseDnd5e(documentRaw);
      const rolled = this.remap(restored, state, id);
      rolled.levelRegistrations = levelRegistrations;
      this.store.set(rolled);
      this.documents.set(id, restored);
      throw cause;
    }
    return this.require(id).state;
  }

  /** Removes the last level (convenience form of delevel). */
  levelDown(id: string): CharacterDetail {
    return this.delevel(id, { mode: "last" }).character;
  }

  /** Removes a level and reports invalidated selections for re-picking. */
  delevel(id: string, opts: DelevelOptions): DelevelResult {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for leveling");
    }
    const target = resolveDelevelTarget(state, this.library, opts);
    if (target.totalLevel <= 1) throw engineError("invalid-argument", "cannot delevel below level 1");
    if (target.totalLevel < state.level) return this.delevelWithReplay(id, target);
    const plan = planDelevelEdits(state, document, this.library, { mode: "last" });
    const next = this.applyWithMagicReconcile(id, state, document, plan.edits, (mapped) => {
      mapped.levelRegistrations = plan.snapshot.levelRegistrations.slice(0, -1);
      mapped.delevelSnapshot = plan.snapshot;
    });
    return this.delevelResult(next, target, plan.requiredRepicks);
  }

  /**
   * Removes a level with levels above it: unwinds down to it, replays the rest
   * and puts back the choices and hit point rolls that survive. The document
   * only ever grows at its end, so this is the only way to reach an earlier
   * level — and it is what makes "lower this class" work while another class
   * holds the newest level.
   */
  private delevelWithReplay(id: string, target: LevelHistoryEntry): DelevelResult {
    const library = this.library!;
    const { state, document } = this.require(id);
    const snapshot: DelevelSnapshot = {
      documentRaw: document.raw,
      levelRegistrations: state.levelRegistrations,
      removedLevel: target.totalLevel,
      invalidatedWrappers: [],
    };
    const laterLevels = state.levelHistory.filter((entry) => entry.totalLevel > target.totalLevel);
    const choices = wrapperSnapshots(state);
    const rolls = state.hitPointRolls;
    const experience = state.experience;
    try {
      while (this.require(id).state.level >= target.totalLevel) this.popLastLevel(id);
      for (const level of laterLevels) this.replayLevel(id, level);
      const unrestored = restoreSelections(
        choices,
        library,
        () => this.getCharacter(id),
        (ruleIdentifier, selectionId) => {
          this.setSelection(id, ruleIdentifier, selectionId);
        },
      );
      this.restoreHitPointRolls(id, rolls);
      // The removed level's threshold minus the level-up increment: experience
      // is capped only when it was high enough to have earned the level back.
      const capped = Math.max(0, xpForLevel(target.totalLevel) - 50);
      if (experience > capped) this.updateDetails(id, { experience: capped });
      const next = this.require(id).state;
      next.delevelSnapshot = snapshot;
      this.store.set(next);
      return this.delevelResult(next, target, repickRules(next, unrestored));
    } catch (cause) {
      // A half-unwound character must never be stored, so the pre-operation
      // document goes back exactly as it was before the failure is reported.
      const restored = parseDnd5e(snapshot.documentRaw);
      const rolled = this.remap(restored, state, id);
      rolled.levelRegistrations = snapshot.levelRegistrations;
      this.store.set(rolled);
      this.documents.set(id, restored);
      throw cause;
    }
  }

  /** Takes back the newest level, dropping its registration record with it. */
  private popLastLevel(id: string): void {
    const { state, document } = this.require(id);
    const plan = planDelevelEdits(state, document, this.library!, { mode: "last" });
    this.applyWithMagicReconcile(id, state, document, plan.edits, (mapped) => {
      mapped.levelRegistrations = plan.snapshot.levelRegistrations.slice(0, -1);
      mapped.delevelSnapshot = null;
    });
  }

  /** Adds back one level of the history, in the form it was originally taken. */
  private replayLevel(id: string, level: LevelHistoryEntry): void {
    if (level.isPending) {
      this.levelUpMode(id, { mode: "new-multiclass" });
      return;
    }
    if (!level.isMulticlass) {
      this.levelUpMode(id, { mode: "main" });
      return;
    }
    if (!level.isClassStart) {
      this.levelUpMode(id, { mode: "multiclass", classId: level.classId });
      return;
    }
    this.levelUpMode(id, { mode: "new-multiclass" });
    const rule = pendingSelectionRules(this.getCharacter(id)).find((candidate) => candidate.type === "Multiclass");
    if (rule === undefined) {
      throw engineError("conflict", `the multiclass choice for level ${level.totalLevel} was not created`);
    }
    this.setSelection(id, rule.identifier, level.classId);
  }

  /** Puts back the pre-rolled hit points a replayed class start re-rolled. */
  private restoreHitPointRolls(id: string, rolls: Record<string, number[]>): void {
    for (const [classId, values] of Object.entries(rolls)) {
      values.forEach((value, index) => {
        if (this.require(id).state.hitPointRolls[classId]?.[index] === value) return;
        try {
          this.setHitPointRoll(id, { classId, classLevel: index + 1, value });
        } catch {
          // The class no longer reaches that level, or the roll is not editable.
        }
      });
    }
  }

  private delevelResult(
    state: CharacterState,
    removed: LevelHistoryEntry,
    requiredRepicks: SelectionRule[],
  ): DelevelResult {
    const library = this.library!;
    return {
      character: buildCharacterDetail(state, library),
      progression: buildProgression(state, library),
      removedLevel: {
        ...removed,
        className:
          library.byId.get(removed.classId)?.identity.name ??
          classElementForMulticlass(library, removed.classId)?.identity.name ??
          "",
      },
      requiredRepicks,
      canUndo: true,
    };
  }

  /** Restores the character to its pre-delevel state (undo response shape). */
  undoDelevel(id: string): DelevelResult {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for leveling");
    }
    const edits = planUndoDelevelEdits(state, document);
    const snapshot = state.delevelSnapshot!;
    const next = this.applyWithMagicReconcile(id, state, document, edits, (mapped) => {
      mapped.levelRegistrations = snapshot.levelRegistrations;
      mapped.delevelSnapshot = null;
    });
    return {
      character: buildCharacterDetail(next, this.library),
      progression: buildProgression(next, this.library),
      removedLevel: null,
      requiredRepicks: [],
      canUndo: false,
    };
  }

  /** Replaces the pre-rolled hit point value of (class, classLevel). */
  setHitPointRoll(id: string, opts: SetHitPointRollOptions): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for hit point rolls");
    }
    const edits = planSetHitPointRollEdits(state, document, this.library, opts.classId, opts.classLevel, opts.value);
    return this.applyPlan(id, state, document, edits);
  }

  /** The derived progression view of the character. */
  getProgression(id: string): Progression {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for progression");
    }
    return buildProgression(state, this.library);
  }

  /** Starts multiclassing into the variant at the current total level. */
  startMulticlass(id: string, multiclassId: string): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for multiclassing");
    }
    const plan = planStartMulticlassEdits(state, document, this.library, multiclassId, this.rng);
    // The plan rewrites whichever level wrapper is currently last, so that
    // level's registration record is replaced rather than added to — the level
    // belongs to the new class now, and two records for one level leave the
    // history and the records disagreeing about what the newest level is.
    const records = state.levelRegistrations ?? [];
    const previous = records[records.length - 1];
    return this.applyWithMagicReconcile(id, state, document, plan.edits, (next) => {
      if (previous === undefined || previous.totalLevel !== plan.record.totalLevel) {
        next.levelRegistrations = [...records, plan.record];
        return;
      }
      const addedElementIds = [...previous.addedElementIds, ...plan.record.addedElementIds].filter(
        (elementId, index, ids) => ids.indexOf(elementId) === index,
      );
      next.levelRegistrations = [...records.slice(0, -1), { ...plan.record, addedElementIds }];
    });
  }

  /** Enables/disables an optional rule (registers/unregisters its Option element). */
  setCharacterOption(id: string, opts: SetCharacterOptionOptions): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for options");
    }
    const option = this.library.byId.get(opts.optionId);
    if (!option || option.identity.type !== "Option") {
      throw engineError("not-found", `option '${opts.optionId}' not found`);
    }
    const has = state.options.has(opts.optionId);
    if (opts.enabled === has) return state;
    const edits = planOptionEdits(state, document, opts.optionId, option.identity.name, opts.enabled);
    return this.applyWithRuleReconcile(id, state, document, edits);
  }

  /** The computed "attunement:max" statistic (base 3, raised by content stat rules). */
  private attunementMax(state: CharacterState, library: ElementLibrary): number {
    return computeStatistics(state, library)["attunement:max"] ?? 3;
  }

  /** The inventory DTO, its attunement ceiling sourced from computed statistics. */
  private inventoryDto(state: CharacterState, library: ElementLibrary): InventoryDto {
    return buildInventoryDto(state, library, this.attunementMax(state, library));
  }

  /** The inventory DTO (pinned shape). */
  getInventory(id: string): InventoryDto {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    return this.inventoryDto(state, this.library);
  }

  /** Adds an item (auto-adorned and auto-equipped per the item rules). */
  addItem(id: string, options: AddItemOptions): InventoryDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    const plan = planAddItemEdits(state, document, this.library, options);
    const edits = [...plan.edits];
    if (plan.equippedLocation !== null) {
      edits.push(
        ...planAutoAttackInsertEdits(state, document, this.library, {
          identifier: plan.identifier,
          itemId: plan.baseId,
          adorners: plan.adornerId !== null ? [plan.adornerId] : [],
        }),
      );
    }
    const next = this.applyPlan(id, state, document, edits);
    return this.inventoryDto(next, this.library);
  }

  /** Removes an item (partial amounts decrement the stored amount). */
  removeItem(id: string, identifier: string, amount?: number): InventoryDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    const edits = [...planRemoveItemEdits(state, document, this.library, identifier, amount), ...planItemAttackRemovalEdits(document, identifier)];
    const next = this.applyPlan(id, state, document, edits);
    return this.inventoryDto(next, this.library);
  }

  /** Equips/unequips an item at a location key ("none" unequips). */
  equipItem(id: string, identifier: string, location: string): InventoryDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    const edits = [...planEquipItemEdits(state, document, this.library, identifier, location)];
    if (location !== "none") {
      const item = state.items.find((i) => i.identifier === identifier);
      if (item) {
        edits.push(...planAutoAttackInsertEdits(state, document, this.library, item));
      }
    }
    const next = this.applyPlan(id, state, document, edits);
    return this.inventoryDto(next, this.library);
  }

  /** Assigns/clears an item's storage container ("" or null carries it on the character again). */
  setItemStorage(id: string, identifier: string, storage: string | null): InventoryDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    const edits = planSetItemStorageEdits(state, document, this.library, identifier, storage);
    const next = this.applyPlan(id, state, document, edits);
    return this.inventoryDto(next, this.library);
  }

  /** Attunes/un-attunes an item (bounded by the computed attunement:max). */
  attuneItem(id: string, identifier: string, attuned: boolean): InventoryDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    const maxAttunedItemCount = this.attunementMax(state, this.library);
    const edits = planAttuneItemEdits(state, document, this.library, identifier, attuned, maxAttunedItemCount);
    const next = this.applyPlan(id, state, document, edits);
    return buildInventoryDto(next, this.library, maxAttunedItemCount);
  }

  /** Replaces the character's coinage. */
  setCoins(id: string, coins: Coinage): InventoryDto {
    const { state, document } = this.require(id);
    const edits = planSetCoinsEdits(document, coins);
    const next = this.applyPlan(id, state, document, edits);
    return this.inventoryDto(next, this.library!);
  }

  /** Extracts an item's contents (packs) into new inventory items. */
  extractItem(id: string, identifier: string): InventoryDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    const edits = planExtractItemEdits(state, document, this.library, identifier);
    const next = this.applyPlan(id, state, document, edits);
    return this.inventoryDto(next, this.library);
  }

  /** The base-item options of a magic item (weapon/armor setter targets). */
  getItemBaseOptions(id: string, itemId: string): ItemBaseOptionsDto {
    this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for inventory");
    }
    return itemBaseOptions(this.library, itemId);
  }

  /** The attacks DTO: automatic weapon rows plus manual/calculated/spell rows. */
  getAttacks(id: string): AttackDto[] {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for attacks");
    }
    this.ensureMagicCasterIds(state);
    return buildAttacksDto(state, this.library);
  }

  // ---- magic --------------------------------------------------------------

  private magicStatistics(state: CharacterState): Record<string, number> {
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for spellcasting");
    }
    return computeStatistics(state, this.library) as unknown as Record<string, number>;
  }

  private ensureMagicCasterIds(state: CharacterState): void {
    for (const caster of state.magic?.casters ?? []) {
      if (!state.magicCasterIds.has(caster.name)) {
        state.magicCasterIds.set(caster.name, randomUuid());
      }
    }
    // DM grants with no class caster to ride on project their own block, which
    // likewise has no caster name to key an id by.
    if (hasUnprojectedGrants(state) && !state.magicCasterIds.has(GRANTED_CASTER_KEY)) {
      state.magicCasterIds.set(GRANTED_CASTER_KEY, randomUuid());
    }
    // Feature casters (Magic Initiate and friends) exist without a `<magic>`
    // region, so their ids are seeded outside the block above.
    if (this.library === undefined) return;
    for (const caster of featureSpellCasters(state, this.library)) {
      if (!state.magicCasterIds.has(caster.key)) {
        state.magicCasterIds.set(caster.key, randomUuid());
      }
    }
  }

  /** The spellcasting DTO (casters in document order). */
  getSpellcasting(id: string): SpellcasterDto[] {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for spellcasting");
    }
    this.ensureMagicCasterIds(state);
    return buildSpellcastingDto(state, this.library, this.magicStatistics(state), state.magicCasterIds);
  }

  /** Toggles a spell's prepared flag (plans the raw edit, re-maps, returns the DTO). */
  setPrepared(id: string, casterId: string, request: { spellId: string; prepared: boolean }): SpellcasterDto[] {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for spellcasting");
    }
    if (request.spellId === undefined || request.spellId === null) {
      throw engineError("invalid-argument", "The SpellId field is required.");
    }
    const plan = planSetPrepared(document, state, this.library, casterId, request.spellId, request.prepared);
    const next = this.applyPlan(id, state, document, plan.edits);
    this.ensureMagicCasterIds(next);
    return buildSpellcastingDto(next, this.library, this.magicStatistics(next), next.magicCasterIds);
  }

  /** The spell-browse DTO for a Spell rule. */
  getSpellBrowse(id: string, ruleId: string): SpellBrowseDto {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for spellcasting");
    }
    return buildSpellBrowseDto(state, this.library, ruleId);
  }

  /** Grants a spell into `<magic><additional>` (matching fixture serialization). */
  addGrantedSpell(id: string, request: { spellId: string }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for spellcasting");
    }
    const existing = state.magic?.additional.some((spell) => spell.id === request.spellId) ?? false;
    if (existing) {
      throw engineError("conflict", `Spell '${request.spellId}' is already granted.`);
    }
    const plan = planAddAdditionalSpell(document, state, this.library, request.spellId, null);
    return this.applyPlan(id, state, document, plan.edits);
  }

  /** Removes a granted spell from `<magic><additional>` (DM-grant source only). */
  removeGrantedSpell(id: string, request: { spellId: string }): CharacterState {
    const { state, document } = this.require(id);
    const plan = planRemoveAdditionalSpell(document, state, request.spellId);
    return this.applyPlan(id, state, document, plan.edits);
  }

  /** The companion projection; null when the character has no companion. */
  getCompanion(id: string): CompanionDto | null {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for companions");
    }
    return buildCompanionDto(state, this.library, this.magicStatistics(state));
  }

  /** Renames the companion (trimmed; empty reverts to the default name). */
  setCompanionName(id: string, request: { name: string }): CompanionDto {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for companions");
    }
    const plan = planSetCompanionName(document, state, this.library, request.name);
    const next = this.applyPlan(id, state, document, plan.edits, (updated) => {
      updated.companion.name = plan.name;
    });
    return buildCompanionDto(next, this.library, this.magicStatistics(next))!;
  }

  // ---- DM grants + appearance -------------------------------------------------

  /** Grants a feat element into the character's registrations. */
  addGrantedFeat(id: string, request: { featId: string }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for grants");
    }
    const edits = planGrantedFeatEdits(document, state, this.library, request.featId, "add");
    return this.applyWithRuleReconcile(id, state, document, edits);
  }

  /** Removes a granted feat element. */
  removeGrantedFeat(id: string, request: { featId: string }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for grants");
    }
    const edits = planGrantedFeatEdits(document, state, this.library, request.featId, "remove");
    return this.applyWithRuleReconcile(id, state, document, edits);
  }

  /** Grants ability-score elements (all-or-nothing). */
  addGrantedAbilityScore(id: string, request: { abilityElementIds: string[] }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for grants");
    }
    const edits = planGrantedAbilityScoreEdits(document, state, this.library, request.abilityElementIds, "add");
    return this.applyWithRuleReconcile(id, state, document, edits);
  }

  /** Removes a granted ability-score element. */
  removeGrantedAbilityScore(id: string, request: { abilityElementId: string }): CharacterState {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for grants");
    }
    const edits = planGrantedAbilityScoreEdits(document, state, this.library, [request.abilityElementId], "remove");
    return this.applyWithRuleReconcile(id, state, document, edits);
  }

  /** The DM grants list (granted spells, feats, and ability scores). */
  getDmGrants(id: string): DmGrantsDto {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for grants");
    }
    return buildDmGrantsDto(state, this.library);
  }

  /** The seeded appearance suggestions (int32 seed; null for defaults). */
  getAppearanceSuggestions(id: string, seed: number | null | undefined): AppearanceSuggestionsDto {
    const { state } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for appearance suggestions");
    }
    return buildAppearanceSuggestions(state, this.library, seed);
  }

  /** The attack options DTO (ability list; casters/spells land with spellcasting). */
  getAttackOptions(id: string): AttackOptionsDto {
    const { state } = this.require(id);
    const base = buildAttackOptionsDto();
    if (this.library === undefined) return base;
    base.unarmed = buildUnarmedPreview(state, this.library);
    base.weapons = weaponsWithoutRows(state, this.library);
    const statistics = computeStatistics(state, this.library);
    // The magic rows carry per-caster session identifiers; assign them here
    // too so a fresh import projects UUIDs before getSpellcasting ever runs.
    this.ensureMagicCasterIds(state);
    const magic = buildMagicAttackOptions(
      state,
      this.library,
      statistics as unknown as Record<string, number>,
      state.magicCasterIds,
    );
    return { ...base, casters: magic.casters, spells: magic.spells };
  }

  /** Creates a weapon, unarmed, manual, calculated, or linked spell attack row. */
  createAttack(id: string, body: Record<string, unknown>): AttackDto[] {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for attacks");
    }
    if (
      body.mode !== "manual" &&
      body.mode !== "calculated" &&
      body.mode !== "spell" &&
      body.mode !== "unarmed" &&
      body.mode !== "weapon"
    ) {
      throw engineError("invalid-argument", `Unsupported attack mode '${String(body.mode)}'.`);
    }
    let row;
    if (body.mode === "weapon") {
      // An owned weapon that has never been equipped has no automatic row.
      // The duplicate guard matches the equip path's, so the two cannot
      // disagree about whether a row already exists for the item.
      const identifier = String(body.identifier ?? "");
      const item = state.items.find((candidate) => candidate.identifier === identifier);
      if (item === undefined) throw engineError("not-found", `item '${identifier}' not found`);
      const base = this.library.byId.get(item.itemId);
      if (base === undefined || base.identity.type !== "Weapon") {
        throw engineError("invalid-argument", "Only a weapon can be added as an attack.");
      }
      if (state.attacks.some((candidate) => candidate.identifier === item.identifier)) {
        throw engineError("conflict", "This weapon already has an attack row.");
      }
      row = newWeaponAttackRow(state, this.library, item);
    } else if (body.mode === "unarmed") {
      // The name, range, bonus, and damage are all resolved from the character;
      // the editor's display overrides arrive through updateAttack.
      row = newUnarmedAttackRow(
        body.damageDice === undefined || body.damageDice === null ? "" : String(body.damageDice),
      );
    } else if (body.mode === "spell") {
      this.ensureMagicCasterIds(state);
      const options = buildMagicAttackOptions(
        state,
        this.library,
        computeStatistics(state, this.library) as unknown as Record<string, number>,
        state.magicCasterIds,
      );
      const option = options.spells.find(
        (candidate) =>
          candidate.casterIdentifier === String(body.casterIdentifier ?? "") &&
          candidate.spellId === String(body.spellId ?? ""),
      );
      if (option === undefined) {
        throw engineError("invalid-argument", "Choose a known attack spell.");
      }
      row = newSpellAttackRow(body, option);
    } else {
      const name = body.name;
      if (name === undefined || String(name).trim() === "") {
        throw engineError("invalid-argument", "Attack name is required.");
      }
      row = body.mode === "manual" ? newManualAttackRow(body) : newCalculatedAttackRow(body);
    }
    const edits = planInsertAttackEdits(state, document, this.library, row, false);
    const next = this.applyPlan(id, state, document, edits);
    return buildAttacksDto(next, this.library);
  }

  /** Partially updates an attack row (display fields, ability override, calculation). */
  updateAttack(id: string, attackId: string, body: Record<string, unknown>): AttackDto[] {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for attacks");
    }
    const row = state.attacks.find((a) => a.id === attackId);
    if (!row) throw engineError("not-found", `attack '${attackId}' not found`);
    const updated: typeof row = {
      ...row,
      calculation: row.calculation === null ? null : { ...row.calculation },
      spell: row.spell === undefined
        ? undefined
        : { ...row.spell, overriddenFields: [...row.spell.overriddenFields] },
    };
    if (row.kind === "spell" && updated.spell !== undefined) {
      const resetFields = new Set(
        Array.isArray(body.resetFields)
          ? body.resetFields.map((field) => String(field))
          : [],
      );
      const fields = [
        ["name", "name"],
        ["range", "range"],
        ["bonus", "attack"],
        ["damage", "damage"],
        ["description", "description"],
      ] as const;
      for (const [requestField, stateField] of fields) {
        const shouldReset = resetFields.has(requestField) || body[requestField] === null;
        if (shouldReset) {
          updated.spell.overriddenFields = updated.spell.overriddenFields.filter(
            (field) => field !== requestField,
          );
        } else if (body[requestField] !== undefined) {
          updated[stateField] = String(body[requestField]);
          if (!updated.spell.overriddenFields.includes(requestField)) {
            updated.spell.overriddenFields.push(requestField);
          }
        }
      }
    } else if (row.kind === "weapon" || row.kind === "unarmed") {
      const hasField = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);
      const updateDisplayOverride = (requestField: "name" | "range" | "description"): void => {
        if (!hasField(requestField)) return;
        const value = body[requestField];
        // Nullable values are control data from the editor: clear the stored
        // override so the attack resolver supplies the current generated value.
        if (value === null || value === undefined) {
          updated[requestField] = "";
        } else {
          updated[requestField] = String(value);
        }
      };
      updateDisplayOverride("name");
      updateDisplayOverride("range");
      updateDisplayOverride("description");
      if (body.abilityMode !== undefined) {
        updated.abilityMode = String(body.abilityMode);
        if (String(body.abilityMode) === "default") updated.ability = "";
      }
      if (body.abilityName !== undefined) {
        updated.ability = String(body.abilityName);
        updated.abilityMode = "explicit";
      }
      // The unarmed damage die is stored on its own so the ability modifier
      // keeps recomputing; clearing it restores the content-derived die.
      if (row.kind === "unarmed" && hasField("damageDice")) {
        const dice = body.damageDice;
        updated.unarmed = { dice: dice === null || dice === undefined ? "" : String(dice) };
      }
    } else if (row.calculation !== null) {
      if (body.name !== undefined) updated.name = String(body.name);
      if (body.range !== undefined) updated.range = String(body.range);
      if (body.description !== undefined) updated.description = String(body.description);
      const calc = updated.calculation!;
      if (body.calculationSource !== undefined) calc.source = String(body.calculationSource);
      if (body.abilityName !== undefined) {
        calc.ability = String(body.abilityName);
        updated.ability = String(body.abilityName);
      }
      if (body.useProficiency !== undefined) calc.useProficiency = body.useProficiency === true;
      if (body.attackMiscBonus !== undefined) calc.attackMiscBonus = Number(body.attackMiscBonus);
      if (body.damageDice !== undefined) calc.damageDice = String(body.damageDice);
      if (body.addAbilityToDamage !== undefined) calc.addAbilityToDamage = body.addAbilityToDamage === true;
      if (body.damageMiscBonus !== undefined) calc.damageMiscBonus = Number(body.damageMiscBonus);
      if (body.damageType !== undefined) calc.damageType = String(body.damageType);
      if (body.casterIdentifier !== undefined) calc.casterIdentifier = String(body.casterIdentifier);
    } else {
      if (body.name !== undefined) updated.name = String(body.name);
      if (body.range !== undefined) updated.range = String(body.range);
      if (body.bonus !== undefined) updated.attack = String(body.bonus);
      if (body.damage !== undefined) updated.damage = String(body.damage);
      if (body.description !== undefined) updated.description = String(body.description);
    }
    const edits = planRewriteAttackEdits(state, document, this.library, updated);
    const next = this.applyPlan(id, state, document, edits);
    return buildAttacksDto(next, this.library);
  }

  /** Hides/shows an attack row (sheet positions renumber around hidden rows). */
  setAttackVisibility(id: string, attackId: string, isDisplayed: boolean): AttackDto[] {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for attacks");
    }
    const row = state.attacks.find((a) => a.id === attackId);
    if (!row) throw engineError("not-found", `attack '${attackId}' not found`);
    const updated = { ...row, displayed: isDisplayed };
    const edits = planRewriteAttackEdits(state, document, this.library, updated);
    const next = this.applyPlan(id, state, document, edits);
    return buildAttacksDto(next, this.library);
  }

  /** Moves an attack row up/down in the stored list (edge moves are no-ops). */
  moveAttack(id: string, attackId: string, direction: "up" | "down"): AttackDto[] {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for attacks");
    }
    const edits = planMoveAttackEdits(document, attackId, direction);
    const next = this.applyPlan(id, state, document, edits);
    return buildAttacksDto(next, this.library);
  }

  /** Deletes an attack row (an equipped weapon's automatic row is rejected). */
  deleteAttack(id: string, attackId: string): AttackDto[] {
    const { state, document } = this.require(id);
    if (this.library === undefined) {
      throw engineError("invalid-argument", "character service requires a content library for attacks");
    }
    const row = state.attacks.find((a) => a.id === attackId);
    if (!row) throw engineError("not-found", `attack '${attackId}' not found`);
    if (row.kind === "weapon") {
      const item = state.items.find((i) => i.identifier === row.identifier);
      if (item !== undefined && item.equipped) {
        throw engineError("conflict", "An automatic attack cannot be deleted while its weapon is equipped.");
      }
    }
    const edits = planRemoveAttackEdits(document, attackId);
    const next = this.applyPlan(id, state, document, edits);
    return buildAttacksDto(next, this.library);
  }
}
