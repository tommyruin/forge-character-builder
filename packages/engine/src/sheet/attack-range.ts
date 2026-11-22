/**
 * The character page's attack table gives Range a narrow one-line cell, so
 * the sheet prints a range in its short form: "60 feet" is "60 ft", a weapon's
 * "20/60 feet" is "20/60 ft", and a range from the caster ("Self (10-foot
 * Emanation)", "Self (15-foot cone)") is "Self (10 ft)". Only the printed
 * attack rows use it; the attacks list, the stored rows and the spell cards
 * keep the range as written. A range of any other shape ("Touch", "1 mile",
 * "Self (5-mile radius)", "80/320; Arrow") prints as it is. This module has no
 * engine dependencies.
 */
export function sheetAttackRange(range: string): string {
  const text = range.trim();
  // "60 feet", "5 foot", "10 ft", "20/60 feet".
  const distance = /^(\d+(?:\/\d+)?)\s*(?:feet|foot|ft\.?)$/i.exec(text);
  if (distance !== null) return `${distance[1]} ft`;
  // "Self (10-foot Emanation)", "Self (60 foot cone)", "Self (10-foot-radius sphere)".
  const area = /^self\s*\(\s*(\d+)[\s-]*(?:feet|foot|ft\.?)(?:[\s-]+[a-z]+)*\s*\)$/i.exec(text);
  if (area !== null) return `Self (${area[1]} ft)`;
  return range;
}
