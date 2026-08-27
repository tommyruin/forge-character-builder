/**
 * Snapshot identities and payload kinds. They live in the wire contract
 * (`@forge-cb/api`) so the client and the engine read one definition; this
 * module re-exports them for the engine's own modules.
 */

export {
  CHARACTER_LOAD_KIND,
  CHARACTER_LOAD_MANIFEST,
  CHARACTER_LOAD_SCHEMA_VERSION,
  FAST_START_LIBRARY_KIND,
  FAST_START_MANIFEST,
  FAST_START_SCHEMA_VERSION,
} from "@forge-cb/api";
