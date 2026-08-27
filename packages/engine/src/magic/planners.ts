import type { Dnd5eDocument, Dnd5eNode } from "../dnd5e/document.js";
import type { ElementLibrary } from "../content/library.js";
import type { CharacterState } from "../character/state.js";
import type { RawEdit } from "../selection/selection.js";
import { engineError } from "../errors.js";
import { alwaysPreparedSets, fullCasterList, spellInfo, canonicalSourceRank } from "./spelllist.js";
import type { MagicCasterBlock, MagicSpellEntry } from "./state.js";

/**
 * Magic region mutation planners.
 *
 * The entire `<magic>` region is edited through the planners below; each
 * planner returns byte-range edits over the document raw plus the resulting
 * state projection so the service can re-map and assert consistency.
 */

const INDENT = "\t\t\t\t\t";

function attrLine(spell: MagicSpellEntry): string {
  const parts = [`name="${spell.name}"`, `level="${spell.level}"`, `id="${spell.id}"`];
  if (spell.prepared) parts.push(`prepared="true"`);
  if (spell.alwaysPrepared) parts.push(`always-prepared="true"`);
  if (spell.known) parts.push(`known="true"`);
  return parts.join(" ");
}

/** Whether the caster projects the full class list (`<list known="true">`). */
export function isFullListCaster(library: ElementLibrary, block: MagicCasterBlock): boolean {
  return library.byId.get(block.source)?.spellcasting?.listKnown === true;
}

interface RebuildInput {
  block: MagicCasterBlock;
  library: ElementLibrary;
  preparedIds: string[];
}

/**
 * Renders the `<spells>` inner lines for the caster (pinned rebuild):
 * prepared spells first (level then name, attributes preserved, prepared
 * forced), then the caster's spell universe minus the prepared ids (level,
 * name, source; existing per-spell attributes preserved). Returns null when
 * the section must stay empty.
 */
export function renderSpellsLines(input: RebuildInput): MagicSpellEntry[] {
  const { block, library, preparedIds } = input;
  const preparedSet = new Set(preparedIds);
  const byId = new Map<string, MagicSpellEntry>();
  for (const spell of [...block.cantrips, ...block.spells]) byId.set(spell.id, spell);

  const existing = (id: string): MagicSpellEntry => byId.get(id) ?? {
    name: "",
    level: "",
    id,
    prepared: false,
    alwaysPrepared: false,
    known: false,
  };
  const nameOf = (id: string): string => {
    const info = spellInfo(library, id);
    return info?.name ?? existing(id).name;
  };
  const levelOf = (id: string): number => {
    const info = spellInfo(library, id);
    return info?.level ?? (Number.parseInt(existing(id).level, 10) || 0);
  };
  const sourceOf = (id: string): string => library.byId.get(id)?.identity.source ?? "";

  const prepared = preparedIds
    .map((id) => ({
      id,
      level: levelOf(id),
      name: nameOf(id),
      source: sourceOf(id),
      existing: existing(id),
    }))
    .sort((left, right) => {
      if (left.level !== right.level) return left.level - right.level;
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return canonicalSourceRank(left.source) - canonicalSourceRank(right.source);
    })
    .map(({ id, existing }) => ({ ...existing, name: nameOf(id), level: String(levelOf(id)), prepared: true }));

  const fullList = isFullListCaster(library, block);
  const universeIds: string[] = [];
  const universeSet = new Set<string>();
  const addToUniverse = (id: string): void => {
    if (preparedSet.has(id) || universeSet.has(id)) return;
    universeSet.add(id);
    universeIds.push(id);
  };
  if (fullList) {
    const maxLevel = maxSlotOf(block);
    for (const info of fullCasterList(library, block.name, maxLevel)) {
      addToUniverse(info.id);
    }
  } else {
    const cantripIds = new Set(block.cantrips.map((spell) => spell.id));
    for (const spell of block.spells) {
      if (!cantripIds.has(spell.id)) addToUniverse(spell.id);
    }
  }
  const rest = universeIds
    .map((id) => ({
      id,
      level: levelOf(id),
      name: nameOf(id),
      source: sourceOf(id),
    }))
    .sort((left, right) => {
      if (left.level !== right.level) return left.level - right.level;
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return canonicalSourceRank(left.source) - canonicalSourceRank(right.source);
    })
    .map(({ id }) => existing(id));

  return [...prepared, ...rest];
}

function maxSlotOf(block: MagicCasterBlock): number {
  for (let level = 9; level >= 1; level--) {
    const value = Number.parseInt(block.slots[`s${level}`] ?? "0", 10);
    if (Number.isFinite(value) && value > 0) return level;
  }
  return 0;
}

function findSpellsNode(casting: Dnd5eNode): Dnd5eNode | null {
  for (const child of casting.children) {
    if (child.name === "spells") return child;
  }
  return null;
}

function replaceSpellsSection(
  document: Dnd5eDocument,
  casting: Dnd5eNode,
  lines: MagicSpellEntry[],
): RawEdit[] {
  const node = findSpellsNode(casting);
  const indent = "\t\t\t\t";
  const spellLines = lines.map((spell) => `${INDENT}<spell ${attrLine(spell)} />`);
  const rendered = spellLines.length === 0
    ? "\t\t\t\t<spells />"
    : `\t\t\t\t<spells>\n${spellLines.join("\n")}\n${indent}</spells>`;
  if (node !== null) {
    // Replace the whole <spells> node (open tag through close tag).
    return [{ start: node.start, end: node.end, replacement: rendered }];
  }
  // No spells node: insert before </spellcasting>.
  const end = document.raw.lastIndexOf("</spellcasting>", casting.end);
  return [{ start: end, end, replacement: `${rendered}\n${indent}` }];
}

function casterById(
  document: Dnd5eDocument,
  state: CharacterState,
  casterId: string,
): { block: MagicCasterBlock; node: Dnd5eNode; name: string } | null {
  const magicNode = document.root.build.magic;
  if (magicNode === null || state.magic === null) return null;
  const name = [...state.magicCasterIds.entries()].find(([, id]) => id === casterId)?.[0];
  const castings = magicNode.children.filter((child) => child.name === "spellcasting");
  const index = name !== undefined ? state.magic.casters.findIndex((block) => block.name === name) : -1;
  if (index === -1) return null;
  return { block: state.magic.casters[index]!, node: castings[index]!, name: name! };
}

export interface PreparedPlan {
  edits: RawEdit[];
  casterName: string;
  spellId: string;
  prepared: boolean;
}

/**
 * Plans a setPrepared mutation. Errors are 404 responses.
 */
export function planSetPrepared(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  casterId: string,
  spellId: string,
  prepared: boolean,
): PreparedPlan {
  const found = casterById(document, state, casterId);
  if (found === null) {
    throw engineError("not-found", `No spellcaster '${casterId}' on the loaded character.`);
  }
  const { block, node } = found;
  const always = alwaysPreparedSets(state, library).get(block.name) ?? new Set();
  const isAlways = always.has(spellId);
  const knownIds = new Set([...block.cantrips, ...block.spells].map((spell) => spell.id));
  const fullList = isFullListCaster(library, block);
  const universe = new Set(
    fullList
      ? fullCasterList(library, block.name, 9).map((info) => info.id)
      : knownIds,
  );
  if (!universe.has(spellId)) {
    throw engineError("not-found", `Spell '${spellId}' is not known by this caster.`);
  }
  if (isAlways) {
    throw engineError("not-found", `Spell '${spellId}' is not prepared by this caster.`);
  }
  const currentlyPrepared = [...block.spells].find((spell) => spell.id === spellId)?.prepared === true;
  if (prepared === false && !currentlyPrepared) {
    throw engineError("not-found", `Spell '${spellId}' is not prepared by this caster.`);
  }

  // A full-list caster may prepare any spell on its class list, including one
  // that is not yet an entry in <spells> (a freshly built character has none).
  // Update the entry when it exists, otherwise create it.
  const hasEntry = block.spells.some((spell) => spell.id === spellId);
  const entries: MagicSpellEntry[] = hasEntry
    ? block.spells.map((spell) => (spell.id === spellId ? { ...spell, prepared } : spell))
    : [
        ...block.spells,
        { name: "", level: "", id: spellId, prepared, alwaysPrepared: false, known: false },
      ];
  const nextBlock: MagicCasterBlock = { ...block, spells: entries };
  const preparedIds = entries.filter((spell) => spell.prepared).map((spell) => spell.id);
  const lines = renderSpellsLines({
    block: nextBlock,
    library,
    preparedIds,
  });
  const edits = replaceSpellsSection(document, node, lines);
  return { edits, casterName: block.name, spellId, prepared };
}

export interface AdditionalSpellPlan {
  edits: RawEdit[];
  spell: { name: string; level: string; id: string; source: string };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Plans adding a granted spell to `<magic><additional>`. The mutation never
 * touches caster blocks. Source defaults to "Additional Spell, {Name}"
 * (fixture-pinned); the caller may pass the granting feature name.
 */
export function planAddAdditionalSpell(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  spellId: string,
  source: string | null,
): AdditionalSpellPlan {
  const info = spellInfo(library, spellId);
  if (info === null) {
    throw engineError("invalid-argument", `Unknown spell '${spellId}'.`);
  }
  const magicNode = document.root.build.magic;
  const additionalSource = source ?? `Additional Spell, ${info.name}`;
  const line = `\t\t\t\t<spell name="${escapeXml(info.name)}" level="${info.level}" id="${spellId}" source="${escapeXml(additionalSource)}" />`;
  let edits: RawEdit[];
  if (magicNode === null || magicNode.children.every((child) => child.name !== "additional")) {
    // No magic or no additional block: expand <magic /> or append before </magic>.
    const node = magicNode ?? null;
    if (node !== null && node.selfClosing) {
      edits = [{
        start: node.start,
        end: node.end,
        replacement: `<magic${node.attrs.map((attr) => ` ${attr[0]}="${attr[1]}"`).join("")}>\n\t\t\t<additional>\n${line}\n\t\t\t</additional>\n\t\t</magic>`,
      }];
    } else if (node !== null) {
      const end = document.raw.lastIndexOf("</magic>", node.end);
      edits = [{ start: end, end: end + "</magic>".length, replacement: `\t\t\t<additional>\n${line}\n\t\t\t</additional>\n\t\t</magic>` }];
    } else {
      const end = document.raw.indexOf("</build>");
      edits = [{ start: end, end, replacement: `\t\t<magic>\n\t\t\t<additional>\n${line}\n\t\t\t</additional>\n\t\t</magic>\n\t</build>` }];
    }
  } else {
    const additional = magicNode.children.find((child) => child.name === "additional")!;
    const insertAt = additional.end - "</additional>".length;
    edits = [{ start: insertAt, end: insertAt, replacement: `${line}\n${INDENT}` }];
  }
  return {
    edits,
    spell: { name: info.name, level: String(info.level), id: spellId, source: additionalSource },
  };
}

/**
 * Plans removing a granted spell from `<magic><additional>` (by id). Only
 * entries with the DM-grant source convention ("Additional Spell, {name}")
 * are removable; feature-granted additional spells (e.g. a dragonmark's)
 * are not DM grants (Samurai2 fixture evidence).
 */
export function planRemoveAdditionalSpell(
  document: Dnd5eDocument,
  state: CharacterState,
  spellId: string,
): AdditionalSpellPlan {
  const magicNode = document.root.build.magic;
  if (magicNode === null || state.magic === null) {
    throw engineError("not-found", `Spell '${spellId}' is not granted.`);
  }
  const additional = magicNode.children.find((child) => child.name === "additional");
  if (additional === undefined) {
    throw engineError("not-found", `Spell '${spellId}' is not granted.`);
  }
  const entry = state.magic.additional.find(
    (spell) => spell.id === spellId && spell.source.startsWith("Additional Spell"),
  );
  if (entry === undefined) {
    throw engineError("not-found", `Spell '${spellId}' is not granted.`);
  }
  const target = additional.children.find((child) => {
    const attrs = new Map(child.attrs);
    return child.name === "spell" && attrs.get("id") === spellId;
  });
  const edits: RawEdit[] = target === undefined
    ? []
    : [{ start: target.start, end: target.end, replacement: "" }];
  return { edits, spell: { ...entry } };
}

export interface CompanionNamePlan {
  edits: RawEdit[];
  name: string;
}

/**
 * Plans a companion rename: trims the name; an empty result reverts to the
 * element's default name. Errors are 400 responses.
 */
export function planSetCompanionName(
  document: Dnd5eDocument,
  state: CharacterState,
  library: ElementLibrary,
  name: string,
): CompanionNamePlan {
  const companionView = document.root.build.companion;
  const companionNode = companionView?.node ?? null;
  const companionElement = state.sum.elements.find((element) => element.type === "Companion");
  if (companionElement === undefined || companionNode === null) {
    throw engineError("invalid-argument", "Select a companion before renaming it.");
  }
  const trimmed = name.trim();
  const defaultName = library.byId.get(companionElement.id)?.identity.name ?? "Companion";
  const next = trimmed === "" ? defaultName : trimmed;
  const attr = companionNode.attrs.find(([key]) => key === "name");
  let edits: RawEdit[];
  if (attr !== undefined) {
    const open = document.raw.slice(companionNode.start, companionNode.openEnd);
    const marker = `name="`;
    const valueStart = open.indexOf(marker);
    if (valueStart === -1) {
      edits = [{ start: companionNode.openEnd - 1, end: companionNode.openEnd - 1, replacement: ` name="${escapeXml(next)}"` }];
    } else {
      edits = [{
        start: companionNode.start + valueStart + marker.length,
        end: companionNode.start + valueStart + marker.length + attr[1].length,
        replacement: escapeXml(next),
      }];
    }
  } else {
    edits = [{ start: companionNode.openEnd - 1, end: companionNode.openEnd - 1, replacement: ` name="${escapeXml(next)}"` }];
  }
  return { edits, name: next };
}
