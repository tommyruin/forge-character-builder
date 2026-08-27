import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../tabs/BuildTab.jsx', import.meta.url), 'utf8');

describe('BuildTab panel header actions', () => {
  it('keeps both ASI and feat grant actions in the panel header', () => {
    const header = source.slice(
      source.indexOf('<header className="fcb-panel-header">'),
      source.indexOf('</header>') + '</header>'.length,
    );

    expect(header).toContain("active.key === 'abilities' && canGrant");
    expect(header).toContain('ASI');
    expect(header).toContain("active.key === 'feats' && canGrant");
    expect(header).toContain('Feat');
  });

  it('passes the section key into incomplete-reminder decisions and rule cards', () => {
    expect(source).toMatch(
      /hasIncompleteRequiredSelection\(s\.rules,\s*\{\s*sectionKey:\s*s\.key,\s*\}\)/s,
    );
    expect(source).toContain('sectionKey={active.key}');
    expect(source).not.toContain("s.key !== 'abilities'");
  });

  it('uses the Ability Scores tab dot rather than an ASI selection toast', () => {
    expect(source).toMatch(/onSelect=\{\(elementId, number = 1\) =>/);
    expect(source).not.toContain('isAbilityScoreImprovementChoice');
    expect(source).not.toContain('ASI selected — go to Ability Scores');
  });
});
