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

  it('offers Familiar & Companion only for characters with companion rules or a Companion', () => {
    expect(source).toContain("key: 'companion'");
    expect(source).toContain("label: 'Familiar & Companion'");
    expect(source).toMatch(
      /groups\.companion\.length > 0 \|\|\s*detail\.registeredElements\.some\(\(e\) => e\.type === 'Companion'\)/,
    );
    expect(source).toContain(
      '<CompanionSection\n                  rules={active.rules}',
    );
  });
});

describe('companion rule types', () => {
  const api = readFileSync(new URL('../../api.js', import.meta.url), 'utf8');

  it('routes every companion-granted choice to the companion section, not Other', () => {
    // A rule type missing from this list falls into Build > Other: the Ancient
    // Companion spirit pick is authored as type "Companion Trait".
    const list = api.match(/COMPANION_RULE_TYPES = \[([^\]]*)\]/s)?.[1] ?? '';
    for (const type of ['Companion', 'Companion Feature', 'Companion Trait']) {
      expect(list).toContain(`'${type}'`);
    }
  });
});

describe('Magic tab no longer owns the companion', () => {
  const magic = readFileSync(new URL('../tabs/MagicTab.jsx', import.meta.url), 'utf8');

  it('does not count a companion as spellcasting content', () => {
    expect(magic).not.toMatch(/ompanion/);
    expect(magic).toContain(
      'const hasAnything = (casters?.length ?? 0) > 0 || spellRules.length > 0;',
    );
  });
});

describe('workspace tab badges', () => {
  const workspace = readFileSync(
    new URL('../CharacterWorkspace.jsx', import.meta.url),
    'utf8',
  );
  const nav = readFileSync(
    new URL('../WorkspaceNavigation.jsx', import.meta.url),
    'utf8',
  );

  it('flags the Magic tab while a required spell choice is open, on both strips', () => {
    expect(workspace).toContain('hasIncompleteRequiredSpellChoices(');
    expect(workspace).toMatch(/<DesktopWorkspaceNavigation[^>]*badges=\{tabBadges\}/s);
    expect(workspace).toMatch(/<MobileWorkspaceNavigation[^>]*badges=\{tabBadges\}/s);
    expect(nav.match(/badges\[key\] && <OpenChoicesDot \/>/g)).toHaveLength(2);
  });
});
