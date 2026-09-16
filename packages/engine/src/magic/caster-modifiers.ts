/** Shared spell attack/save totals for the Magic tab and attack rows. */
export function casterModifier(
  statistics: Readonly<Record<string, number>>,
  casterName: string,
  abilityAbbreviation: string,
  kind: "attack" | "dc",
  fallback: number,
): number {
  const perCaster = statistics[`${casterName.toLowerCase()}:spellcasting:${kind}`];
  if (perCaster !== undefined && perCaster !== 0) return perCaster;
  return statistics[`spellcasting:${kind}:${abilityAbbreviation.toLowerCase()}`] ?? fallback;
}
