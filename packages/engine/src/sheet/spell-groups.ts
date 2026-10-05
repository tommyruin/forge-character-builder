import type { SpellcasterDto } from "../magic/dto.js";

const sameStatistics = (left: SpellcasterDto, right: SpellcasterDto): boolean =>
  left.ability.toLowerCase() === right.ability.toLowerCase()
  && left.attackModifier === right.attackModifier
  && left.saveDc === right.saveDc;

/** "[Fey Touched - 1/Long Rest]": the granting feature, then its free casts. */
function originLabel(featureName: string, usage: string | null | undefined): string {
  return `[${featureName}${usage ? ` - ${usage}` : ""}]`;
}

/**
 * One printed spell list per set of casting statistics. A feat or trait
 * caster (Magic Initiate, Fey Touched) whose ability, attack bonus and save DC
 * match a class caster joins that class's list, each of its spells labelled
 * with the feature and any free casts. A feature caster with different
 * statistics, or with a spell at a level the class has no slots for, keeps its
 * own list so its spells still print. Class casters are never merged with each
 * other: their slot pools differ (Pact Magic, multiclass tables).
 */
export function mergeSheetSpellcasters(casters: readonly SpellcasterDto[]): SpellcasterDto[] {
  const copies = casters.map((caster) => ({ ...caster, knownSpells: [...caster.knownSpells] }));
  const merged = new Set<SpellcasterDto>();
  for (const caster of copies) {
    if (caster.kind !== "feature") continue;
    const host = copies.find((candidate) => candidate.kind === "class"
      && sameStatistics(candidate, caster)
      && caster.knownSpells.every((spell) => spell.level === 0 || (candidate.slotsPerLevel[spell.level - 1] ?? 0) > 0));
    if (host === undefined) continue;
    for (const spell of caster.knownSpells) {
      const label = originLabel(caster.name, spell.usage);
      const index = host.knownSpells.findIndex((existing) => existing.id === spell.id);
      if (index === -1) {
        host.knownSpells.push({ ...spell, usage: label });
      } else {
        const existing = host.knownSpells[index]!;
        host.knownSpells[index] = { ...existing, usage: existing.usage ? `${existing.usage} ${label}` : label };
      }
    }
    merged.add(caster);
  }
  return copies.filter((caster) => !merged.has(caster));
}
