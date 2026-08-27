import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isExplicitDevelopmentMode,
  isPublicRelease,
} from '../clientMode.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const characterList = read('../CharacterList.jsx');
const manage = read('../tabs/ManageTab.jsx');
const levelUp = read('../LevelUpFlyout.jsx');
const selectionCard = read('../SelectionRuleCard.jsx');
const asiModal = read('../tabs/feats/AddAsiModal.jsx');
const featModal = read('../tabs/feats/AddFeatModal.jsx');
const spellModal = read('../tabs/magic/AddSpellModal.jsx');
const app = read('../../App.jsx');
const main = read('../../main.jsx');

describe('frozen residual behavior decisions', () => {
  it('presents one unambiguous create-and-open action', () => {
    expect(characterList).toContain('data-testid="character-create-and-open"');
    expect(characterList).toContain('Create & Open');
    expect(characterList).not.toContain('data-testid="character-create"');
    expect(characterList).not.toContain('>{busy ? "Creating…" : "Create"}</button>');
  });

  it('exposes internal Manage controls only in explicit development mode', () => {
    expect(manage).toContain("isExplicitDevelopmentMode(import.meta.env)");
    const guardedSection = manage.match(
      /\{showInternalControls\s*&&\s*\(\s*(<section[\s\S]*?<\/section>)\s*\)\}/,
    )?.[1] ?? '';
    expect(guardedSection).not.toBe('');

    const internalTestIds = [
      'homebrew-patch',
      'homebrew-remove',
      'ruleset-control',
      'source-control',
      'migration',
    ];
    for (const testId of internalTestIds) {
      expect(guardedSection).toContain(`data-testid="${testId}"`);
    }
    expect(
      manage.match(/data-testid="(?:homebrew-patch|homebrew-remove|ruleset-control|source-control|migration)"/g),
    ).toHaveLength(internalTestIds.length);
  });

  it('keeps the useful disabled-multiclass prerequisite explanation', () => {
    expect(levelUp).toContain('data-testid="multiclass-prerequisite-message"');
    expect(levelUp).toContain(
      'Multiclassing is enabled. Meet your current class’s',
    );
    expect(levelUp).toContain(
      'ability-score prerequisite before starting another class.',
    );
  });

  it('keeps selected-choice Clear as a reversible client-only deviation', () => {
    // What is frozen is that a made choice can be cleared, not how the
    // control's label is composed.
    expect(selectionCard).toMatch(/title=\{`Clear \$\{\w+\}`\}/);
    expect(selectionCard).toContain('clearSlot(1)');
    expect(selectionCard).toContain('clearSlot(slot)');
  });

  it('offers DM feat grants across the whole feat library, like spells', () => {
    // The shipped baseline declares a single Feat element (Grappler), so
    // whitelisting grants to bundled content left the dialog empty for anyone
    // using uploaded sources. "+ Feat" now mirrors "+ Spell": the engine query
    // is the only filter, with no client-side narrowing after pagination.
    expect(featModal).toContain('setResults(page.items ?? [])');
    expect(featModal).not.toContain('isGrantableDmFeat');
    expect(featModal).not.toContain('CONTENT_PROFILES');
    expect(spellModal).toContain('setResults(page.items ?? [])');
  });

  it('records D-07 grant limitations without inventing replacement semantics', () => {
    expect(asiModal).toContain(
      "{ key: 'Intelligence', id: 'ID_PHB_FEAT_ASI_INTELLIGENCE' },",
    );
    expect(
      asiModal.match(/ID_[A-Z0-9_]*ASI_INTELLIGENCE/g),
    ).toEqual(['ID_PHB_FEAT_ASI_INTELLIGENCE']);
    expect(asiModal).toContain('ids.push(ability.id)');
    expect(asiModal).toContain('api.characters.addAbilityScore(id, ids)');
    expect(featModal).toContain('api.characters.addFeat');
    expect(featModal).toContain('ignoring prerequisites');
  });

  it('requires an explicit development flag and keeps release announcements opt-in', () => {
    expect(isExplicitDevelopmentMode({})).toBe(false);
    expect(
      isExplicitDevelopmentMode({ VITE_FCB_DEVELOPMENT_MODE: 'true' }),
    ).toBe(true);
    expect(
      isExplicitDevelopmentMode({ VITE_FCB_DEVELOPMENT_MODE: '1' }),
    ).toBe(false);
    expect(isPublicRelease({})).toBe(false);
    expect(isPublicRelease({ VITE_PUBLIC_RELEASE: 'true' })).toBe(true);
    expect(main).toContain(
      'announce={import.meta.env.VITE_PUBLIC_RELEASE === \'true\'}',
    );
    expect(app).toContain(
      "const isPublicRelease = import.meta.env.VITE_PUBLIC_RELEASE === 'true';",
    );
    expect(main).not.toContain('announce={true}');
  });
});
