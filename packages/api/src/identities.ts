/**
 * Snapshot identities shared by the engine and its clients. These values are
 * persisted inside stored snapshots, so they are part of the storage contract:
 * a change strands every stored snapshot, and is made only with a schema bump.
 */

import type { ManifestIdentityDto } from "./methods.js";

/** The Fast Start snapshot manifest identity. */
export const FAST_START_MANIFEST: ManifestIdentityDto = {
  client: "dm-forge-fast-start",
  schema: 2,
  codec: "gzip-json",
};

/** The character-load snapshot manifest identity. */
export const CHARACTER_LOAD_MANIFEST: ManifestIdentityDto = {
  client: "dm-forge-character-load",
  schema: 1,
  codec: "gzip-json",
};

/** Payload kinds stamped into snapshot payloads. */
export const FAST_START_LIBRARY_KIND = "fcb-fast-start-library" as const;
export const CHARACTER_LOAD_KIND = "fcb-character-load" as const;

/**
 * Payload schema versions (bump on any breaking payload change). Fast Start
 * version 2: parsed elements carry `<sheet>` presentation blocks; schema-1
 * payloads hydrate elements without sheets and are rejected, not silently
 * loaded.
 */
export const FAST_START_SCHEMA_VERSION = 2;
export const CHARACTER_LOAD_SCHEMA_VERSION = 1;

/**
 * The content parser revision a Fast Start snapshot is keyed on. Bump whenever
 * content parsing or library finalization changes, so stored snapshots miss
 * instead of resurrecting the previous finalization's output. The engine's
 * finalization-revision test pins the library digest to this value.
 */
export const SNAPSHOT_PARSER_VERSION = "11";
