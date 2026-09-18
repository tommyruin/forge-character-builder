/**
 * The public surface of `@forge-cb/engine`.
 *
 * A host embeds the engine through this entry point: build a content library,
 * create or import a character, apply selections and levels, then derive the
 * sheet. `@forge-cb/engine/browser` wraps the same surface in a Web Worker.
 */

// Content library — build one before anything else.
export * from "./content/library.js";
export * from "./elements/types.js";

// Character lifecycle: create, import, mutate, export.
export * from "./character/state.js";
export * from "./character/mapping.js";
export * from "./character/service.js";
export * from "./character/options.js";

// The `.dnd5e` document format (byte-exact parse and serialize).
export * from "./dnd5e/document.js";

// Selections, progression and leveling.
export * from "./selection/expr.js";
export * from "./selection/selection.js";
export * from "./selection/detail.js";
export * from "./progression/leveling.js";
export * from "./progression/progression.js";

// Derived values.
export * from "./statistics/calculator.js";
export * from "./attacks/attacks.js";
// `RawEdit` is structurally identical in both modules; selection's is canonical.
export {
  equipLocationsFor,
  parseWeight,
  itemWeightPounds,
  itemBenefitsActive,
  buildInventoryDto,
  itemBaseOptions,
  planAddItemEdits,
  planRemoveItemEdits,
  planEquipItemEdits,
  planSetItemStorageEdits,
  planAttuneItemEdits,
  planSetCoinsEdits,
  planAddCoinsEdits,
  planExtractItemEdits,
  LOCATION_DISPLAY,
  type InventoryItemDto,
  type InventoryDto,
  type ItemBaseOptionsDto,
  type AddItemOptions,
  type AddItemPlan,
  type ExtractEntryDto,
  type PackChoiceDto,
  type PackExtrasDto,
} from "./inventory/inventory.js";
export * from "./magic/dto.js";

// Character sheet model and rendering.
export * from "./sheet/model.js";
export * from "./sheet/canonical.js";

// Snapshots: fast start and character load.
export * from "./snapshot/codec.js";
export * from "./snapshot/content-graph.js";
export * from "./snapshot/identities.js";
export * from "./snapshot/fast-start.js";
export * from "./snapshot/character-snapshot.js";

// Errors and the worker dispatch surface.
export * from "./errors.js";
export * from "./worker-handlers.js";

export { ENGINE_VERSION } from "@forge-cb/api";
