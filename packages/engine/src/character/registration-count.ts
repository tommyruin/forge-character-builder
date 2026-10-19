import { CUSTOM_OTHER_TYPE } from "../custom/schema.js";
import type { CharacterState, RegisteredElement } from "./state.js";

/**
 * The feature types a top-level node of the elements tree can be: an element
 * granted in its own right rather than picked through a rule. Each is one
 * registration, like a granted feat. The grant planner (`extras/grants.ts`)
 * offers exactly these.
 */
export const STANDALONE_FEATURE_TYPES: ReadonlySet<string> = new Set([
  "Feat",
  "Feat Feature",
  "Ability Score Improvement",
  "Racial Trait",
  "Class Feature",
  "Archetype Feature",
  "Background Feature",
  "Dragonmark Feature",
  "Language Feature",
  CUSTOM_OTHER_TYPE,
  "Language",
  "Proficiency",
  "Vision",
]);

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
    && !inventoryIds.has(node.id) && (node.type === "Item" || node.type === "Magic Item" || STANDALONE_FEATURE_TYPES.has(node.type))).length;
  return state.levelCount + choices + state.options.size + items + standalone;
}
