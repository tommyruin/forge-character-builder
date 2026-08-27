/**
 * DM-grant DTO contract between the engine and the tabs that render grants.
 *
 * `getDmGrants` returns `{ kind: 'spell' | 'feat' | 'ability', id, name,
 * source }`. Reading a different field name (or a different kind spelling)
 * silently yields an empty ownership set, which shows the granted element
 * with no way to remove it — the failure this pins.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const buildSource = readFileSync(
  new URL('../tabs/BuildTab.jsx', import.meta.url),
  'utf8',
);
const magicSource = readFileSync(
  new URL('../tabs/MagicTab.jsx', import.meta.url),
  'utf8',
);

describe('DM grant ownership', () => {
  it('identifies granted feats by the engine field name', () => {
    expect(buildSource).toMatch(
      /dmGrants\s*\.filter\(\(g\) => g\.kind === 'feat'\)\s*\.map\(\(g\) => g\.id\)/s,
    );
    expect(buildSource).not.toContain('g.elementId');
  });

  it("identifies granted ability scores by the engine's 'ability' kind", () => {
    expect(buildSource).toContain("g.kind !== 'ability'");
    expect(buildSource).not.toContain("g.kind !== 'asi'");
  });

  it('gates the feat remove control on grant ownership', () => {
    expect(buildSource).toMatch(
      /dmFeatIds\.has\(feat\.id\) && \([\s\S]{0,400}removeFeat\(feat\.id\)/,
    );
  });

  it('identifies granted spells by id alone and offers removal', () => {
    // Granted spells live in <additional> and carry no caster, so a
    // caster-qualified key never matches.
    expect(magicSource).toMatch(
      /dmGrants\s*\.filter\(\(g\) => g\.kind === 'spell'\)\s*\.map\(\(g\) => g\.id\)/s,
    );
    expect(magicSource).toContain('dmSpellIds.has(spell.id)');
    expect(magicSource).not.toContain('g.casterName');
    expect(magicSource).toMatch(/isDmGranted[\s\S]{0,800}removeGrantedSpell\(/);
  });
});
