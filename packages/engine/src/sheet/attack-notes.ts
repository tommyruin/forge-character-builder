/**
 * The character page's attack rows and the free-text note under them. The
 * sheet model fills as many rows as the plain templates have and lists the
 * rest ahead of the user's own notes; the writer does the same again for a
 * template with more rows, so both must word the note identically. This
 * module has no engine dependencies, so the render worker can share it.
 */

/** One displayed attack as the character page prints it. */
export interface SheetAttackRow {
  name: string;
  range: string;
  bonus: string;
  damage: string;
  /** The row's notes cell. */
  note: string;
}

/** The rows every character page template has. */
export const SHEET_BASE_ATTACK_ROWS = 4;

/** "Name: range, bonus, damage", leaving out the parts that are empty. */
function attackSummary(attack: SheetAttackRow): string {
  const details = [attack.range, attack.bonus, attack.damage].filter((part) => part !== "");
  return details.length > 0 ? `${attack.name}: ${details.join(", ")}` : attack.name;
}

/**
 * The free-text note under the attack rows: the attacks that did not get a
 * row, then the user's own notes on a line of their own.
 */
export function attackDescriptionNote(overflow: readonly SheetAttackRow[], notes: string): string {
  const more = overflow.map(attackSummary);
  return [more.length > 0 ? `More attacks: ${more.join("; ")}.` : "", notes]
    .filter((part) => part !== "")
    .join("\n");
}
