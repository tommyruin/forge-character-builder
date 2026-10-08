import type { CharacterState, RegisteredElement } from "./state.js";

/** The .dnd5e format counts registrations, not descriptive list answers or grant children. */
export function registrationCount(state: CharacterState): number {
  let choices = 0;
  const walk = (nodes: readonly RegisteredElement[]): void => {
    for (const node of nodes) {
      if (node.type !== "List" && node.requiredLevel !== undefined && node.registered) choices++;
      walk(node.children);
    }
  };
  walk(state.elements);
  const registered = new Set(state.sum.elements.map(entry => entry.id));
  const inventoryIds = new Set(state.items.flatMap(item => [item.itemId, ...item.adorners]));
  const items = state.items.reduce((count, item) => count + (!item.storage && registered.has(item.itemId)
    ? 1 + (item.adorners.length > 0 ? 1 : 0) : 0), 0);
  const standalone = state.elements.filter(node => node.requiredLevel === undefined
    && !inventoryIds.has(node.id) && ["Item", "Magic Item", "Feat", "Ability Score Improvement"].includes(node.type)).length;
  return state.levelCount + choices + state.options.size + items + standalone;
}
