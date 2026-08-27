// The point-buy cost curve .dnd5e files are priced with. It mirrors the
// engine's table (packages/engine/src/character/point-buy.ts): nothing up to
// 8, one point per step to 13, then two per step, all the way to the maximum
// base score. Imported characters carry scores above 15 because racial and
// ability increases are folded into the base, so the curve must not stop at
// the standard table's 15.
export const POINT_BUY_BUDGET = 27;

// The range a score may be moved to by hand in Point Buy mode.
export const POINT_BUY_EDIT_MIN = 8;
export const POINT_BUY_EDIT_MAX = 15;

export function pointBuyCost(score) {
  if (!Number.isFinite(score) || score <= 8) return 0;
  if (score <= 13) return score - 8;
  return 5 + 2 * (score - 13);
}

export function pointBuyRemaining(scores) {
  const spent = Object.values(scores).reduce(
    (total, score) => total + pointBuyCost(score),
    0,
  );
  return POINT_BUY_BUDGET - spent;
}

// True when a score sits outside the range the editor lets you buy directly;
// such characters were priced on the extended curve by another tool.
export function isBeyondEditableRange(score) {
  return score < POINT_BUY_EDIT_MIN || score > POINT_BUY_EDIT_MAX;
}
