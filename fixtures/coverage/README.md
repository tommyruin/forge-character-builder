# Corpus coverage gate

`npm run coverage:gate` checks that every element id referenced by a real
character resolves in the vendored content corpus. It is how we find out that
the corpus has drifted or is missing content that real character files depend
on.

## `characters/`

Fourteen `.dnd5e` characters, one per class or multiclass shape. They exist
**only** for this gate. The unit tests do not read them — those build characters
through the engine API (see `CONTRIBUTING.md`), so nothing here is a test
fixture.

They are real builds because that is the point: a real character references a
far wider slice of the corpus (subclasses, feats, magic items, restricted
sources) than a synthetic one would. Coverage here is not code coverage.

They have been sanitised before being committed:

- embedded portrait images and portrait file paths removed;
- player and character names replaced with neutral `Test …` names;
- owner-authored prose (backstory, traits, bonds, notes, organisation details)
  blanked;
- the duplicated 2.3 MB restricted-source list kept on `cleric-7.dnd5e` only —
  the others carried the same list, so it is redundant for coverage.

Each still parses, imports, and round-trips byte-identically.

## `allowlist.json`

Element ids that are neither in the corpus nor engine-generated — unrecoverable
external homebrew these characters happen to reference. The gate fails when a
**new** unresolvable id appears. Re-baseline deliberately with
`node scripts/coverage-gate.mjs --init`.
