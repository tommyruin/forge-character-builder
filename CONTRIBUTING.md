# Contributing

## What this is

A standalone TypeScript character builder for D&D 5e: import and export
`.dnd5e` character files, ingest content XML, and produce the full character
experience (build, leveling, magic, inventory, attacks, statistics, sheet PDFs,
VTT export). The wire contract — RPC methods, envelopes, DTOs — is defined in
`packages/api` and nowhere else.

## Data sources

- `apps/client/public/content/` — the shipped baseline: `core` and `system`
  are authored; the SRD subsets are generated (`npm run content:build-srd`).
  To change an SRD subset, change the reviewed maps under
  `third-party/srd-5.1` and `third-party/srd-5.2` and regenerate rather than
  editing the output.
- `third-party/elements/` — the optional development corpus the generator and
  the corpus-backed engine tests read (fetched at a pinned commit and
  byte-verified; see its `provenance.md`). Data, not code — never committed
  and never edited.
- `apps/client/public/sheets/` — generated sheet templates
  (`npm run sheets:build`); change `scripts/build-sheet-templates.mjs` or the
  contract in `packages/engine/src/sheet/template-contract.ts` and regenerate.

## Commands

```bash
npm install
npm run corpus:fetch      # fetch + byte-verify the pinned public corpus (needed by the corpus-backed tests)
npm run build             # tsc -b (all packages)
npm test                  # vitest run (the corpus-backed files are skipped until the corpus is fetched)
npm run test:corpus       # the same run, failing if the corpus is absent
npm run test:coverage     # vitest with coverage thresholds (CI-enforced)
npm run coverage:gate     # corpus coverage gate (--init to re-baseline)
npm run lint
npm run audit:public      # the publication audit CI runs on every push
```

## Test characters

Tests build the characters they need through the engine's own API — there are
no `.dnd5e` character files checked into the test suite. The shared factory
lives in `packages/engine/src/testing/character-factory.ts` and exposes
archetype builders (`buildRogue5`, `buildWizard4`, `buildPaladin3`,
`buildFighter3`, `buildRangerRogue8`, `buildMulticlassCaster`,
`buildFullSheetCharacter`) plus a memoised library. Building a character on the
way to an assertion means the creation flow is exercised by every test that
needs one.

Where a test genuinely needs a *file* — the byte-exact `.dnd5e` parser and
serializer — use the authored documents in
`packages/engine/src/testing/dnd5e-samples.ts`. They are written line-by-line so
the BOM, CRLF endings, tab indentation and empty-node forms are explicit. Add a
case there rather than checking in a character file.

The one place real character files live is `fixtures/coverage/characters/`, and
they belong to the corpus coverage gate, not to the test suite — a real build
references far more of the corpus than a synthetic one. See
`fixtures/coverage/README.md`.

## Test-driven changes

Every engine feature and bug fix follows red-green-refactor — test first, code
second:

1. **Red** — write the failing test first (`describe`/`it` naming the
   behaviour, arrange/act/assert, one behaviour per test). Run it and confirm it
   fails for the expected reason. If you cannot write a test, you do not yet
   understand the requirement.
2. **Green** — write the minimum code to pass. No extra features, no premature
   optimisation.
3. **Refactor** — improve structure while all tests stay green.
4. **Gates** — run `npm test`, `npm run build` and `npm run coverage:gate`
   before opening a change. CI enforces lint, build, unit tests, coverage
   thresholds, the corpus gate, the content and template drift checks and the
   publication audit on every push and pull request; a red suite or a coverage
   regression blocks merge.
5. A bug fix ships as a failing regression test first, then the fix.

### Pinned values

Corpus-derived counts (element counts, per-type counts), the finalized-library
digest, and the bundled-content manifest digest are pinned in tests as
regression guards. A pin changing means the content library or the shipped
bundle changed: confirm that was intended, then re-pin deliberately.

Two pins are coupled and must move together. Fast Start snapshots persist the
*finalized* library, so any change to what the library build produces (parsing,
proxies, normalization, generated elements, ruleset classification) is invisible
to users holding a stored snapshot unless the version is bumped. If
`packages/engine/src/snapshot/finalization-revision.test.ts` fails, bump
`PARSER_VERSION` in `packages/engine/src/snapshot/codec.ts` **and**
`FAST_START_PARSER_REVISION` in
`apps/client/src/transport/fastStartSnapshot.js`, then re-pin the digest.

## Conventions

- Node >= 22, npm workspaces, TypeScript strict, vitest. ESM only
  (`"type": "module"`).
- Packages: `@forge-cb/api` (protocol, errors, methods), `@forge-cb/engine` (engine
  domains).
- Comments explain **why**, not what. No emojis.
- Comments state the rule that makes a value correct, not when or how someone
  observed it. Avoid dates, references to working sessions, and appeals to
  other implementations.
- Tests construct characters through the engine API rather than loading
  pre-made character files.

## Releases

`npm run release -- patch|minor|major` bumps every manifest, stamps
`CHANGELOG.md` and tags the commit. Keep the `[Unreleased]` section of the
changelog current as you go.
