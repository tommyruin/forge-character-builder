# Embedding the engine

This describes how a host application embeds `@forge-cb/engine`. The worked example
that the test suite keeps honest is
`packages/engine/src/public-api.test.ts` — it imports only from the package
root and drives a character end to end.

## Packages

| Import | What it gives you |
|---|---|
| `@forge-cb/engine` | The engine itself: content library, character lifecycle, derivation, `.dnd5e` serialization, snapshots. Node and browser. |
| `@forge-cb/engine/browser` | The same engine wrapped as a Web Worker (`startBrowserCharacterEngineWorker`, `startSheetRenderWorker`). |
| `@forge-cb/api` | The wire contract: RPC envelopes, error codes, the typed method map, and the dispatcher. Import this in the host to type both ends of the worker boundary. |

## Two ways to host it

**In-process.** Construct a `CharacterService` directly and call it. Simplest,
and what the tests do. The library build is CPU-bound (a few hundred
milliseconds for the full corpus), so on a UI thread you want the worker.

**In a worker (recommended for browsers).** The host posts
`{ id, method, args }` and receives `{ id, ok, result }` or
`{ id, ok: false, error }`. `@forge-cb/api` exports `createEngineDispatcher` and the
`EngineMethodMap` that types every method; `@forge-cb/engine/browser` starts the
worker side. The protocol is specified in [`contract.md`](contract.md).

## Lifecycle

```ts
import { CharacterService, buildLibrary, computeStatistics, pendingSelectionRules } from "@forge-cb/engine";

const library = await buildLibrary(corpusRoot);
const service = new CharacterService(undefined, library, { rng: seededRng });

const id = service.createCharacter("Ada").id;
service.setAbilities(id, { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 });

// Selections are resolved by identifier, which changes as the tree grows —
// re-read state after every mutation.
const rule = pendingSelectionRules(service.getCharacter(id)).find((r) => r.type === "Race")!;
service.setSelection(id, rule.identifier, "ID_SRD_RACE_DWARF");

service.levelUp(id);

const values = computeStatistics(service.getCharacter(id), library);
const xml = service.exportCharacterXml(id);
```

The canonical order is **abilities → Race → Sub Race → Class → level ups →
Archetype → per-level picks**. Numbered group slots (two cantrips, two ability
increases) take a 1-based `number` argument on `setSelection`.

## The content library

`buildLibrary(corpusRoot)` reads `<corpusRoot>/system` and
`<corpusRoot>/testdata`. The corpus is third-party data fetched and
byte-verified by `npm run corpus:fetch`; see
[`../third-party/elements/provenance.md`](../third-party/elements/provenance.md).

A host that ships its own content can hydrate a library in memory instead with
`createEmptyLibrary()` + `replaceLibraryFiles(library, files)`, or layer extra
content on top with `ingestContentFiles(library, [{ path, base64 }])`.

## Snapshots and the version lockstep

Two snapshot kinds exist, both gzip'd canonical JSON:

- **Fast Start** (`dm-forge-fast-start`, schema 2) caches the *finalized*
  content library so a returning user skips parsing.
- **Character load** (`dm-forge-character-load`, schema 1) caches a prepared
  character.

Because a Fast Start snapshot stores the finalized library, **any change to what
the library build produces** — parsing, proxies, normalization, generated
elements, ruleset classification — is invisible to a user holding a stored
snapshot unless the version is bumped. Three values move together:

1. `PARSER_VERSION` in `packages/engine/src/snapshot/codec.ts`
2. `FAST_START_PARSER_REVISION` in `apps/client/src/transport/fastStartSnapshot.js`
3. the pinned digest in `packages/engine/src/snapshot/finalization-revision.test.ts`

That test is the tripwire: if it fails, the library build changed and all three
need updating deliberately.

## The `.dnd5e` compatibility guarantee

`.dnd5e` is byte-exact. A document that goes in comes out identical: UTF-8 BOM,
CRLF line endings, tab indentation, no trailing newline, preserved attribute
order, and preserved empty-node forms (some nodes are self-closing, some are
written as an empty pair). `importCharacterXml` followed by
`exportCharacterXml` with no mutation in between returns the input unchanged.

A host must not normalise these files. Round-trip identity is covered by
`packages/engine/src/dnd5e/document.test.ts` against the authored samples in
`packages/engine/src/testing/dnd5e-samples.ts`.

## Errors

Every failure crosses the boundary as an `EngineError` with a stable `code`
(`not-found`, `invalid-argument`, `conflict`, `unsupported`,
`schema-mismatch`, `snapshot-rejected`, …) and a `details` object. Codes are
part of the contract; messages are not. See [`contract.md`](contract.md).
