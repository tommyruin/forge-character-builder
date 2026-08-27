/**
 * Fast Start snapshots persist the FINALIZED library, so any change to what
 * the library build produces (parsing, proxies, normalization, generated
 * elements, ruleset classification) is invisible to users with a stored
 * snapshot unless PARSER_VERSION is bumped alongside it.
 *
 * This pin fails whenever the finalized output changes without a version
 * bump. On failure: bump PARSER_VERSION in codec.ts AND the client's
 * FAST_START_PARSER_REVISION in apps/client/src/transport/fastStartSnapshot.js,
 * then re-pin both values here.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { type ElementLibrary } from "../content/library.js";
import { serializeContentLibrary, contentLibraryDigest } from "./content-graph.js";
import { PARSER_VERSION } from "./codec.js";
import { buildCorpusLibrary } from "../testing/corpus.js";


let library: ElementLibrary;

beforeAll(async () => {
  library = await buildCorpusLibrary();
}, 120_000);

describe("finalization revision tripwire", () => {
  it("pins the finalized-library digest to the snapshot parser version", async () => {
    const digest = await contentLibraryDigest(serializeContentLibrary(library));
    expect(`${PARSER_VERSION}:${digest}`).toBe(
      "9:671e99c72133f15a9e82eea55df2e58d08a0b574e9105132ee62ebd5e224d666",
    );
  });
});
