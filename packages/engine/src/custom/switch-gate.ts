/**
 * Whether a rule gated on a switch applies. The `condition` of a stat or grant
 * made in the builder names the switch that gates it; book content only
 * describes circumstances ("while raging") the engine does not model, so a
 * switch that happens to share its words never turns a book rule on.
 *
 * Kept apart from the statistics and selection modules because both read it.
 */

import type { CharacterState } from "../character/state.js";
import { isCustomElementId } from "./schema.js";

/** True when the switch named by `condition` is on. A book element's condition is never open. */
export function switchGateOpen(state: CharacterState, elementId: string, condition: string): boolean {
  if (!isCustomElementId(elementId)) return false;
  const name = condition.trim().toLowerCase();
  return state.resources.switchesOn.some((on) => on.trim().toLowerCase() === name);
}

/**
 * Whether a grant's switch lets it register. Content made in the builder is
 * held to its switch; a book grant that carries a `condition` registers as it
 * always did.
 */
export function grantSwitchOpen(
  state: CharacterState,
  ownerId: string,
  condition: string | undefined,
): boolean {
  if (condition === undefined || condition.trim() === "") return true;
  if (!isCustomElementId(ownerId)) return true;
  return switchGateOpen(state, ownerId, condition);
}
