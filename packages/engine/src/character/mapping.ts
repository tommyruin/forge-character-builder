/**
 * Document -> state mapping.
 *
 * Maps every section of the .dnd5e structured view (dnd5e/document.ts) into the
 * character state contract (state.ts). Pure and deterministic: same document,
 * same state. The state carries everything later engine phases (statistics,
 * spellcasting, inventory) need; byte fidelity for round-trips stays in the
 * document model.
 */

import {
  child,
  getAttr,
  textContent,
  childElements,
  type Dnd5eDocument,
  type Dnd5eNode,
  type SpellcastingView,
} from "../dnd5e/document.js";
import { md5Hex } from "../platform.js";
import { parseMagicState } from "../magic/state.js";
import { pointBuyRemaining } from "./point-buy.js";
import {
  emptyCharacterState,
  type AbilityScores,
  type AttackState,
  type CharacterState,
  type RegisteredElement,
  type SpellcastingState,
} from "./state.js";

const toInt = (value: string | null | undefined, fallback: number): number => {
  if (value === null || value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value: string | null): boolean => value === "true";

function mapAbilityScores(scores: Record<string, string | null | undefined>): AbilityScores {
  return {
    strength: toInt(scores.strength, 0),
    dexterity: toInt(scores.dexterity, 0),
    constitution: toInt(scores.constitution, 0),
    intelligence: toInt(scores.intelligence, 0),
    wisdom: toInt(scores.wisdom, 0),
    charisma: toInt(scores.charisma, 0),
  };
}

function mapElement(node: Dnd5eNode): RegisteredElement {
  const element: RegisteredElement = {
    type: getAttr(node, "type") ?? "",
    name: getAttr(node, "name") ?? "",
    id: getAttr(node, "id") ?? "",
    children: childElements(node, "element").map(mapElement),
  };
  const requiredLevel = getAttr(node, "requiredLevel");
  if (requiredLevel !== null) element.requiredLevel = toInt(requiredLevel, 0);
  const checksum = getAttr(node, "checksum");
  if (checksum !== null) element.checksum = checksum;
  const registered = getAttr(node, "registered");
  if (registered !== null) element.registered = registered;
  const multiclass = getAttr(node, "multiclass");
  if (multiclass !== null) element.multiclass = toBool(multiclass);
  const starting = getAttr(node, "starting");
  if (starting !== null) element.starting = toBool(starting);
  const classId = getAttr(node, "class");
  if (classId !== null) element.classId = classId;
  const isList = getAttr(node, "isList");
  if (isList !== null) element.isList = toBool(isList);
  if (element.isList === true) {
    const listText = textContent(node);
    if (listText !== "") element.listText = listText;
  }
  return element;
}

function parseRolls(value: string): number[] {
  return value.split(",").map((part) => Number.parseInt(part, 10)).filter((n) => !Number.isNaN(n));
}

/**
 * Derives the per-class hit point rolls from the starting level wrappers'
 * rndhp attributes: the main class rolls live on the Level 1 wrapper (keyed by
 * the class wrapper's registered id), multiclass rolls on each starting
 * multiclass wrapper (keyed by its class attribute).
 */
function mapHitPointRolls(elements: Dnd5eNode[], levels: RegisteredElement[]): Record<string, number[]> {
  const rolls: Record<string, number[]> = {};
  const first = elements[0];
  const rndhp = first ? getAttr(first, "rndhp") : null;
  if (first && rndhp !== null) {
    const main = levels[0]?.children.find((child) => child.type === "Class" && (child.registered ?? "") !== "");
    if (main && main.registered) rolls[main.registered] = parseRolls(rndhp);
  }
  for (let i = 1; i < elements.length; i++) {
    const node = elements[i]!;
    if (getAttr(node, "multiclass") === "true" && getAttr(node, "starting") === "true") {
      const classId = getAttr(node, "class");
      const values = getAttr(node, "rndhp");
      if (classId !== null && values !== null) rolls[classId] = parseRolls(values);
    }
  }
  return rolls;
}

/** One level history entry per level wrapper, in document order. */
function mapLevelHistory(levels: RegisteredElement[]): CharacterState["levelHistory"] {
  const counts = new Map<string, number>();
  const history: CharacterState["levelHistory"] = [];
  levels.forEach((node, index) => {
    const pendingMulticlass =
      node.multiclass !== true &&
      node.children.some(
        (child) => child.type === "Multiclass" && child.requiredLevel !== undefined && (child.registered ?? "") === "",
      );
    const isMulticlass = node.multiclass === true || pendingMulticlass;
    const classId = pendingMulticlass
      ? ""
      : isMulticlass
      ? node.classId ?? ""
      : index === 0
        ? levels[0]?.children.find((child) => child.type === "Class" && (child.registered ?? "") !== "")?.registered ?? ""
        : (history.find((entry) => !entry.isMulticlass)?.classId ?? "");
    const classLevel = pendingMulticlass ? 0 : (counts.get(classId) ?? 0) + 1;
    if (!pendingMulticlass) counts.set(classId, classLevel);
    history.push({
      totalLevel: index + 1,
      classId,
      classLevel,
      isMulticlass,
      isClassStart: pendingMulticlass ? false : isMulticlass ? node.starting === true : index === 0,
      isPending: pendingMulticlass,
      // Only the character's first total level is fixed; a multiclass start at
      // a later total level can be removed (observed).
      canRemove: index > 0,
    });
  });
  return history;
}

function mapSpellcasting(view: SpellcastingView): SpellcastingState {
  return {
    name: view.name() ?? "",
    ability: view.ability() ?? "",
    attack: view.attack() ?? "",
    dc: view.dc() ?? "",
    source: view.source() ?? "",
    slots: view.slots(),
    cantrips: view.cantrips().map((n) => getAttr(n, "id") ?? getAttr(n, "name") ?? ""),
    spells: view.spells().map((spell) => ({
      name: spell.name ?? "",
      level: spell.level ?? "",
      id: spell.id ?? "",
      prepared: toBool(spell.prepared),
      alwaysPrepared: toBool(spell.alwaysPrepared),
      known: toBool(spell.known),
    })),
  };
}

function mapAttacks(node: Dnd5eNode | null): AttackState[] {
  const attacks = node ? childElements(node, "attack") : [];
  return attacks.map((a) => {
    const calculationSource = getAttr(a, "calculation-source");
    const row: AttackState = {
      id: getAttr(a, "id") ?? "",
      identifier: getAttr(a, "identifier") ?? "",
      name: getAttr(a, "name") ?? "",
      range: getAttr(a, "range") ?? "",
      attack: getAttr(a, "attack") ?? "",
      damage: getAttr(a, "damage") ?? "",
      displayed: toBool(getAttr(a, "displayed")),
      ability: getAttr(a, "ability") ?? "",
      kind: getAttr(a, "kind") ?? (getAttr(a, "identifier") !== null && getAttr(a, "identifier") !== "" ? "weapon" : "manual"),
      abilityMode: getAttr(a, "ability-mode") ?? "default",
      description: textContent(child(a, "description") ?? a),
      calculation:
        calculationSource !== null
          ? {
              source: calculationSource,
              ability: getAttr(a, "ability") ?? "",
              useProficiency: toBool(getAttr(a, "proficient")),
              attackMiscBonus: toInt(getAttr(a, "attack-misc"), 0),
              damageDice: getAttr(a, "damage-dice") ?? "",
              addAbilityToDamage: toBool(getAttr(a, "ability-damage")),
              damageMiscBonus: toInt(getAttr(a, "damage-misc"), 0),
              damageType: getAttr(a, "damage-type") ?? "",
              casterIdentifier: getAttr(a, "caster-identifier") ?? "",
            }
          : null,
      spell:
        getAttr(a, "kind") === "spell"
          ? {
              casterName: getAttr(a, "caster-name") ?? "",
              spellId: getAttr(a, "spell-id") ?? "",
              overriddenFields: (getAttr(a, "overridden-fields") ?? "")
                .split(",")
                .filter((field) => field !== ""),
            }
          : undefined,
      unarmed:
        getAttr(a, "kind") === "unarmed"
          ? { dice: getAttr(a, "unarmed-dice") ?? "" }
          : undefined,
    };
    if (row.id === "") {
      row.id = attackDerivedId(row);
    }
    return row;
  });
}

/**
 * Deterministic session id for imported rows without an id attribute: opaque
 * ids are regenerated for such rows on load; ours is derived from
 * the row content so it stays stable across remaps.
 */
function attackDerivedId(row: AttackState): string {
  const payload = [
    row.identifier,
    row.name,
    row.range,
    row.attack,
    row.damage,
    row.displayed,
    row.ability,
    row.kind,
    row.abilityMode,
    row.description,
    row.calculation === null ? null : [row.calculation.source, row.calculation.ability, row.calculation.useProficiency, row.calculation.attackMiscBonus, row.calculation.damageDice, row.calculation.addAbilityToDamage, row.calculation.damageMiscBonus, row.calculation.damageType, row.calculation.casterIdentifier],
    row.spell === undefined ? null : [row.spell.casterName, row.spell.spellId, ...row.spell.overriddenFields],
    row.unarmed === undefined ? null : [row.unarmed.dice],
  ].join("\u0000");
  return md5Hex(payload);
}

/**
 * Maps the parsed document into the full character state.
 *
 * `id` is the engine slot id (storage key), carried verbatim into the state.
 */
export function mapToState(document: Dnd5eDocument, id: string): CharacterState {
  const state = emptyCharacterState(id);
  const { root } = document;

  const information = root.information;
  state.group = information.group() ?? "";
  // Files without the element were entered by hand: Custom (2), not a roll.
  state.generationOption = toInt(information.generationOption(), 2);

  const display = root.displayProperties;
  state.name = display.name() ?? "";
  state.race = display.race() ?? "";
  state.klass = display.class() ?? "";
  state.archetype = display.archetype() ?? "";
  state.background = display.background() ?? "";
  state.level = toInt(display.level(), 1);
  const portrait = display.portrait();
  if (portrait) {
    state.portrait = {
      companion: portrait.companion() ?? "",
      local: portrait.local() ?? "",
      base64: portrait.base64() ?? "",
    };
  }

  const build = root.build;
  const input = build.input;
  if (input) {
    state.playerName = input.playerName() ?? "";
    state.gender = input.gender() ?? "";
    state.experience = toInt(input.experience(), 0);
    const attacks = input.attacks();
    if (attacks) {
      state.attacksDescription = attacks.description() ?? "";
      state.attacks = mapAttacks(attacks.node);
    }
    state.backstory = input.backstory() ?? "";
    state.backgroundTraits = {
      trinket: input.backgroundTrinket() ?? "",
      traits: input.backgroundTraits() ?? "",
      ideals: input.backgroundIdeals() ?? "",
      bonds: input.backgroundBonds() ?? "",
      flaws: input.backgroundFlaws() ?? "",
    };
    const feature = input.backgroundFeature();
    if (feature) {
      state.backgroundFeature = {
        name: feature.name() ?? "",
        description: feature.description() ?? "",
      };
    }
    const organization = input.organization();
    if (organization) {
      state.organization = {
        name: organization.name() ?? "",
        symbol: organization.symbol() ?? "",
        allies: organization.allies() ?? "",
      };
    }
    state.additionalFeatures = input.additionalFeatures() ?? "";
    const currency = input.currency();
    if (currency) {
      state.coins = {
        copper: toInt(currency.copper(), 0),
        silver: toInt(currency.silver(), 0),
        electrum: toInt(currency.electrum(), 0),
        gold: toInt(currency.gold(), 0),
        platinum: toInt(currency.platinum(), 0),
      };
      state.equipmentNote = currency.equipment() ?? "";
      state.treasureNote = currency.treasure() ?? "";
    }
    const notes = input.notes();
    if (notes) {
      for (const note of notes.notes()) {
        if (note.column === "left") state.notes.left = note.text;
        else if (note.column === "right") state.notes.right = note.text;
      }
    }
    state.quest = input.quest() ?? "";
  }

  const appearance = build.appearance;
  if (appearance) {
    state.appearance = {
      portrait: appearance.portrait() ?? "",
      age: appearance.age() ?? "",
      height: appearance.height() ?? "",
      weight: appearance.weight() ?? "",
      eyes: appearance.eyes() ?? "",
      skin: appearance.skin() ?? "",
      hair: appearance.hair() ?? "",
    };
  }

  const abilities = build.abilities;
  if (abilities) {
    state.abilities = mapAbilityScores(abilities.scores());
  }
  // The file's available-points attribute is advisory: files written by other
  // tools (and older exports of our own) disagree with their scores, so the
  // remaining budget is always priced from the base scores.
  state.availablePoints = pointBuyRemaining(state.abilities);

  const elements = build.elements;
  if (elements) {
    state.levelCount = elements.levelCount() ?? 0;
    state.registeredCount = elements.registeredCount() ?? 0;
    state.elements = elements.elements().map(mapElement);
    const levelNodes = elements.elements().filter((node) => getAttr(node, "type") === "Level");
    const levels = state.elements.filter((node) => node.type === "Level");
    state.hitPointRolls = mapHitPointRolls(levelNodes, levels);
    state.levelHistory = mapLevelHistory(levels);
  }

  const defenses = build.defenses;
  const conditional = defenses?.conditional();
  if (conditional) {
    state.conditional = textContent(conditional)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  const companion = build.companion;
  if (companion) {
    state.companion = {
      name: companion.name() ?? "",
      attributes: mapAbilityScores(companion.attributeScores()),
      saves: companion
        .saves()
        .filter((s) => s.ability !== null)
        .map((s) => ({ ability: s.ability as keyof AbilityScores, value: toInt(s.value, 0) })),
      skills: companion
        .skills()
        .filter((s) => s.name !== null)
        .map((s) => ({ name: s.name as string, value: toInt(s.value, 0) })),
      portraitLocation: companion.portraitLocation() ?? "",
    };
  }

  const equipment = build.equipment;
  if (equipment) {
    state.storages = equipment.storage().map((s) => getAttr(s, "name") ?? "");
    state.items = equipment.items().map((item) => {
      const equipped = item.equipped();
      const details = item.details();
      return {
        identifier: item.identifier() ?? "",
        itemId: item.id() ?? "",
        name: item.name() ?? "",
        amount: toInt(getAttr(item.node, "amount"), 1),
        equipped: equipped ? equipped.value === "true" : false,
        location: equipped?.location ?? undefined,
        storage: item.storage() ?? undefined,
        attuned: item.attuned(),
        adorners: item.adorners().map((adorner) => getAttr(adorner, "id") ?? "").filter((id) => id !== ""),
        card: details?.card() === "true",
        sidebar: item.sidebar() === "true",
        detailsName: details?.name() ?? "",
        notes: details?.notes() ?? "",
      };
    });
  }

  const sum = build.sum;
  if (sum) {
    state.sum = {
      elementCount: sum.elementCount() ?? 0,
      elements: sum.elements().map((e) => ({ type: e.type ?? "", id: e.id ?? "" })),
    };
    for (const element of state.sum.elements) {
      if (element.type === "Option") state.options.add(element.id);
    }
  }

  const restricted = root.sources.restricted();
  if (restricted) {
    state.restrictedSources = restricted
      .sources()
      .map((s) => s.id)
      .filter((s): s is string => s !== null);
    state.restrictedElements = restricted
      .elements()
      .map((node) => getAttr(node, "id") ?? textContent(node))
      .filter((id) => id !== "");
  }

  state.spellcasting = build.spellcasting.map(mapSpellcasting);
  state.magic = parseMagicState(build.magic);
  state.controls = new Map();
  state.rulesetMode = root.rulesetMode() ?? "all";

  return state;
}
