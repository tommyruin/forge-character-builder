// Assembles a transport-agnostic "export model" for a character from the existing api surface.
// Both the Foundry and Roll20 builders consume this one plain object, so all engine access
// lives here. `api` is injectable so the builders and this collector can be unit-tested with
// fixtures instead of a live engine.
import { api as defaultApi } from "../api";
import {
  abilityMap,
  allSkills,
  allSaves,
  passivePerception,
  ABILITIES,
} from "./rules5e.js";

// Registered-element types that describe a character trait/feature worth exporting as its own
// document (Foundry feat item / Roll20 traits row). Structural types (Race/Class/Level/Spell/
// Alignment/Deity/Language/Proficiency/Vision) are handled separately or as summary strings.
const FEATURE_TYPES = new Set([
  "Racial Trait",
  "Class Feature",
  "Archetype Feature",
  "Feat",
  "Background Feature",
  "Feature",
]);

const byType = (elements, type) =>
  (elements || []).filter((e) => e.type === type);
const namesOfType = (elements, type) =>
  byType(elements, type).map((e) => e.name);

// Strip HTML to a plain-text fallback (used when a target has no rich-text field).
export function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function collectExportModel(id, { api = defaultApi } = {}) {
  const [detail, stats, inventory, attacks, spellcasting, progression] =
    await Promise.all([
      api.characters.get(id),
      api.characters.statistics(id),
      api.characters.inventory(id),
      api.characters.attacks(id),
      api.characters.spellcasting(id),
      api.characters.progression(id),
    ]);

  const abilities = abilityMap(detail.abilities);
  const proficiencyBonus = detail.proficiency ?? 0;
  const elements = detail.registeredElements || [];
  // StatisticsDto is { values: { "<key>": <sum> } }; the rules math works on the flat map.
  const statValues = stats?.values ?? {};

  // Resolve feature descriptions (best-effort; the api element cache dedupes these). Failures
  // degrade to name-only so a single missing element never fails the whole export.
  const featureElements = elements.filter((e) => FEATURE_TYPES.has(e.type));
  const features = await Promise.all(
    featureElements.map(async (e) => {
      let description = "";
      try {
        const full = await api.content.element(e.id);
        description = full?.description ?? "";
      } catch {
        /* name-only fallback */
      }
      return {
        id: e.id,
        name: e.name,
        type: e.type,
        source: e.source,
        description,
      };
    }),
  );

  const alignment = namesOfType(elements, "Alignment")[0] || "";
  const deity = namesOfType(elements, "Deity")[0] || "";
  const languages = namesOfType(elements, "Language");
  const senses = namesOfType(elements, "Vision");
  const proficiencies = namesOfType(elements, "Proficiency");

  const classes = (progression?.classes || []).map((c) => ({
    id: c.classId,
    name: c.className,
    level: c.level,
    isMulticlass: c.isMulticlass,
    hitDie: c.hitDie || "",
    // Subclass (Archetype) elements aren't linked to a class id in the DTO; attach the first as
    // a best-effort (single-class characters, the common case, are unambiguous).
    subclass: namesOfType(elements, "Archetype")[0] || "",
  }));

  const spellcasters = (spellcasting || []).map((sc) => ({
    id: sc.identifier,
    name: sc.name,
    ability: (sc.ability || "").slice(0, 3).toLowerCase(),
    attackModifier: sc.attackModifier,
    saveDc: sc.saveDc,
    requiresPreparation: sc.requiresPreparation,
    slots: sc.slotsPerLevel || [],
    spells: (sc.knownSpells || []).map((s) => ({
      id: s.id,
      name: s.name,
      level: s.level ?? 0,
      school: s.school || "",
      ritual: !!s.isRitual,
      concentration: !!s.isConcentration,
      prepared: !!s.isPrepared || !!s.isAlwaysPrepared,
      alwaysPrepared: !!s.isAlwaysPrepared,
      source: s.source || "",
    })),
  }));

  const items = (inventory?.items || []).map((it) => ({
    id: it.identifier,
    name: it.name,
    type: it.type,
    quantity: it.amount ?? 1,
    equipped: !!it.isEquipped,
    attunable: !!it.isAttunable,
    attuned: !!it.isAttuned,
    weight: it.weight || "",
    price: it.displayPrice || "",
    source: it.source || "",
  }));

  const coins = inventory?.coins || {};

  return {
    meta: {
      id: detail.id,
      name: detail.name || "",
      playerName: detail.playerName || "",
      ruleset: detail.rulesetMode || "all",
    },
    identity: {
      race: detail.race || "",
      background: detail.background || "",
      alignment,
      deity,
      gender: detail.gender || "",
      age: detail.age || "",
      height: detail.height || "",
      weight: detail.weight || "",
      eyes: detail.eyes || "",
      skin: detail.skin || "",
      hair: detail.hair || "",
    },
    abilities: Object.fromEntries(ABILITIES.map((a) => [a, abilities[a]])),
    saves: allSaves(statValues, abilities),
    skills: allSkills(statValues, abilities, proficiencyBonus),
    combat: {
      ac: detail.armorClass ?? 10,
      initiative: detail.initiative ?? 0,
      speed: detail.speed ?? 30,
      proficiencyBonus,
      // Max HP from the statistics rather than a cached detail field: it is
      // the engine's own formula (hp already includes hp:starting) and is
      // current at export time.
      maxHp: statValues.hp || 0,
      passivePerception: passivePerception(
        statValues,
        abilities,
        proficiencyBonus,
      ),
      level: detail.level ?? 1,
      experience: detail.experience ?? 0,
      senses,
    },
    classes,
    spellcasters,
    items,
    attacks: (attacks || []).map((a) => ({
      name: a.name,
      range: a.range,
      bonus: a.bonus,
      damage: a.damage,
      description: a.description,
    })),
    features,
    proficiencies,
    languages,
    personality: {
      traits: detail.personalityTraits || "",
      ideals: detail.ideals || "",
      bonds: detail.bonds || "",
      flaws: detail.flaws || "",
    },
    currency: {
      cp: coins.copper ?? 0,
      sp: coins.silver ?? 0,
      ep: coins.electrum ?? 0,
      gp: coins.gold ?? 0,
      pp: coins.platinum ?? 0,
    },
    biography: {
      backstory: detail.backstory || "",
      allies: detail.allies || "",
      notes: detail.notes1 || "",
    },
  };
}
