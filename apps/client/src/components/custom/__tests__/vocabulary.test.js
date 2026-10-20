// One vocabulary across the custom-content dialogs and the Homebrew templates. The terms are pinned
// from the sources so a new dialog that drifts (a "Save", an "Add to inventory", "Player picks") fails here.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dir = new URL('../', import.meta.url);
const sources = Object.fromEntries(readdirSync(dir).filter((name) => name.endsWith('.jsx') || name.endsWith('.js')).map((name) => [name, read(`../${name}`)]));
const homebrew = (name) => read(`../../homebrew/${name}`);

describe('dialog vocabulary', () => {
  it('names each confirm button Add <thing> or Save changes', () => {
    expect(sources['CustomFeatureModal.jsx']).toContain("'Add feature'");
    expect(sources['CustomItemModal.jsx']).toContain("'Add item'");
    expect(sources['CustomSpellModal.jsx']).toContain("'Add spell'");
    for (const name of ['CustomFeatureModal.jsx', 'CustomItemModal.jsx', 'CustomSpellModal.jsx', 'SpellAliasModal.jsx', 'ItemDetailsModal.jsx']) {
      expect(sources[name], name).toContain("'Save changes'");
      expect(sources[name], name).not.toMatch(/'Add to (inventory|\$\{)/);
      expect(sources[name], name).not.toMatch(/: 'Save'\}/);
    }
  });

  it('titles the dialogs Custom feature, Custom item and Custom spell', () => {
    expect(sources['CustomFeatureModal.jsx']).toContain("'Custom feature'");
    expect(sources['CustomItemModal.jsx']).toContain("'Custom item'");
    expect(sources['CustomSpellModal.jsx']).toContain("'Custom spell'");
  });

  it('uses the same effect terms in the feature and item dialogs, and the old ones nowhere', () => {
    const effects = sources['EffectsEditor.jsx'] + sources['CustomItemModal.jsx'];
    for (const term of ['Bonus to another stat', 'Uses per rest', 'Grows with level', 'Player choice']) {
      expect(sources['EffectsEditor.jsx'], term).toContain(term);
    }
    // An item's own words: its bonus has no ability chip beside it, and its pool is charges.
    for (const term of ['Bonus to a stat', 'Damage resistance', "label: 'Charges'"]) {
      expect(sources['CustomItemModal.jsx'], term).toContain(term);
    }
    expect(effects).not.toContain("label: 'Uses per rest',\n      hint: 'A pool of charges");
    const all = Object.values(sources).join('\n');
    // The preview sentences may still say "Player picks 2 skills"; a label, chip or group name never does.
    for (const old of ["label: 'Other bonus'", "label: 'Limited uses'", "label: 'Scale value'", "label: 'Player picks'", "ariaLabel = 'Player picks'", 'Charges or limited uses', 'Feature or other grant', "label: 'Bonus'"]) {
      expect(all, old).not.toContain(old);
    }
  });

  it('writes rests in sentence case and the pack tick in one wording', () => {
    const model = sources['draftModel.js'];
    expect(model).toContain("label: 'Short rest'");
    expect(model).toContain("label: 'Long rest'");
    expect(model).not.toContain("label: 'Short Rest'");
    expect(model).toContain('PROMOTE_LABEL');
    for (const name of ['CustomFeatureModal.jsx', 'CustomItemModal.jsx', 'CustomSpellModal.jsx']) expect(sources[name]).not.toContain('Also save to a homebrew pack');
  });

  it('copies to a pack with one verb, and keeps "world pack" and "ids" out of the copy', () => {
    const text = ['PromoteDialog.jsx', 'CharacterPackView.jsx', 'ElementEditor.jsx', 'HomebrewEditor.jsx'].map(homebrew).join('\n');
    expect(text).toContain('Copy to a pack…');
    for (const gone of ['Add to a pack', 'Copy to another pack', 'world pack', 'World pack', 'ids unchanged', 'same ids']) expect(text, gone).not.toContain(gone);
  });

  it('says Species wherever the app names the race section, keeping the XML type names', () => {
    expect(read('../../../api.js')).toContain("label: 'Species'");
    expect(read('../../../api.js')).toContain("types: ['Race', 'Race Variant', 'Sub Race', 'Racial Trait'");
    expect(sources['draftModel.js']).toContain("'Racial Trait': 'Species trait'");
    expect(homebrew('packModel.js')).toContain("racialTrait: 'Species trait'");
  });

  it('spells Reflavour the British way, matching Colours on the sheet settings', () => {
    expect(homebrew('packModel.js')).toContain("label: 'Reflavour'");
    expect(read('../../tabs/manage/SheetSettingsPanel.jsx')).toContain('Colours the sheet');
  });
});
