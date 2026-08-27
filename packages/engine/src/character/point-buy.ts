import type { AbilityScores } from "./state.js";

/** The point-buy budget every character starts with. */
export const POINT_BUY_BUDGET = 27;

/** The lowest and highest base score the point-buy table prices. */

/**
 * The cost of a base score on the continuous point-buy curve that .dnd5e files
 * are priced with: nothing up to 8, one point per step to 13, then two points
 * per step. Files routinely carry base scores above 15 (racial and ability
 * increases folded into the base), so the curve runs to the maximum base score
 * rather than stopping at the 15 the standard table lists.
 */
export function pointBuyCost(score: number): number {
  if (!Number.isFinite(score) || score <= 8) return 0;
  if (score <= 13) return score - 8;
  return 5 + 2 * (score - 13);
}

/** The points left after buying the six base scores; negative when over budget. */
export function pointBuyRemaining(scores: AbilityScores): number {
  const spent =
    pointBuyCost(scores.strength) +
    pointBuyCost(scores.dexterity) +
    pointBuyCost(scores.constitution) +
    pointBuyCost(scores.intelligence) +
    pointBuyCost(scores.wisdom) +
    pointBuyCost(scores.charisma);
  return POINT_BUY_BUDGET - spent;
}
