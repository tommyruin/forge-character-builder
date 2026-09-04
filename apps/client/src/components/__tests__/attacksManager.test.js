import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manage = readFileSync(
  new URL('../tabs/ManageTab.jsx', import.meta.url),
  'utf8',
);
const editor = readFileSync(
  new URL('../tabs/manage/AttackEditorModal.jsx', import.meta.url),
  'utf8',
);
const modal = readFileSync(
  new URL('../Modal.jsx', import.meta.url),
  'utf8',
);
const transport = readFileSync(
  new URL('../../transport/engineTransport.ts', import.meta.url),
  'utf8',
);
const workspace = readFileSync(
  new URL('../CharacterWorkspace.jsx', import.meta.url),
  'utf8',
);
const exportMenu = readFileSync(
  new URL('../ExportMenu.jsx', import.meta.url),
  'utf8',
);
const calculations = readFileSync(
  new URL('../tabs/manage/attackEditorCalculations.js', import.meta.url),
  'utf8',
);
const equipment = readFileSync(
  new URL('../tabs/EquipmentTab.jsx', import.meta.url),
  'utf8',
);

describe('custom attacks manager', () => {
  it('offers manual, calculated, and known-spell creation modes', () => {
    expect(manage).toMatch(/<Icon name="add" \/>\s+Attack/);
    expect(editor).toContain("['manual', 'Manual']");
    expect(editor).toContain("['calculated', 'Calculated']");
    expect(editor).toContain("['spell', 'Known spell']");
  });

  it('offers an unarmed strike creation mode', () => {
    expect(editor).toContain("['unarmed', 'Unarmed strike']");
    // The name is generated, so the editor must not demand one.
    expect(editor).toMatch(
      /draft\.mode !== 'spell' &&\s+draft\.mode !== 'unarmed' &&\s+draft\.mode !== 'weapon' &&\s+!draft\.name\.trim\(\)/,
    );
  });

  it('offers an owned weapon as a creation mode', () => {
    expect(editor).toContain("['weapon', 'Owned weapon']");
    expect(editor).toContain("const isNewWeapon = draft.mode === 'weapon' && !attack");
    // The row is built entirely from the inventory record.
    expect(editor).toContain('options?.weapons?.map((weapon)');
    expect(editor).toContain("set('identifier', event.target.value)");
    expect(editor).toContain('Choose a weapon from your inventory.');
    expect(calculations).toContain(
      "return { mode: 'weapon', identifier: draft.identifier };",
    );
  });

  it('adds an owned weapon as an attack from the inventory row', () => {
    expect(equipment).toContain('item.type === "Weapon" && !item.hasAttackRow');
    expect(equipment).toContain('label="Add attack"');
    expect(equipment).toContain(
      'api.characters.createAttack(id, { mode: "weapon", identifier })',
    );
  });

  it('names a chosen weapon mastery below the attack details', () => {
    expect(manage).toContain('attack.mastery?.active');
    // The mastery is a labelled line in the card body, under the range /
    // bonus / damage line and the description.
    expect(manage).toContain('className="fcb-attack-mastery mt-2"');
    expect(manage).toContain('Weapon mastery');
    expect(manage).toContain(
      '<span className="fcb-attack-mastery-name">',
    );
    // It is no longer one of the compact icon pills in the heading row.
    expect(manage).not.toContain('Mastery: {attack.mastery.name}');
    expect(manage).not.toMatch(
      /fcb-attack-meta-item[\s\S]{0,200}attack\.mastery/,
    );
    // The engine still appends the clause for the sheet, so the card drops it
    // from the description it shows rather than printing it twice.
    expect(manage).toContain('function attackDescriptionText(attack)');
    expect(manage).toContain('const clause = `Mastery: ${name}`;');
    expect(manage).toContain('{attackDescriptionText(attack) && (');
  });

  it('suggests known attack spells that have no row yet', () => {
    expect(manage).toContain('const suggestedSpells =');
    expect(manage).toContain("attack.source?.spellId");
    expect(manage).toContain('{suggestedSpells.length > 0 && (');
    expect(manage).toContain("mode: 'spell',");
    // The sheet still prints four rows, so nothing is added automatically.
    expect(manage).toContain('The first four visible attacks fill the sheet rows.');
  });

  it('fills the unarmed strike form from the engine preview before it exists', () => {
    expect(editor).toContain("options?.unarmed");
    expect(editor).toContain('const derivedField =');
    // Bonus and damage are always derived, so they are shown, never edited.
    expect(editor).toContain("derivedField('bonus', 'Attack bonus')");
    expect(editor).toContain("derivedField('damage', 'Damage')");
  });

  it('offers the damage die as a die list rather than free text', () => {
    expect(editor).toContain(
      "const UNARMED_DICE = ['1d4', '1d6', '1d8', '1d10', '1d12']",
    );
    expect(editor).toContain('Damage die');
    expect(editor).toContain("set('unarmedDice', event.target.value)");
    expect(editor).toContain("`Automatic (${derivedUnarmedDie || '1'})`");
    expect(editor).toContain('Tavern Brawler');
    // Homebrew can grant any die, so the list is not the only way in.
    expect(editor).toContain('<option value="custom">Custom');
    expect(editor).toContain('aria-label="Custom damage die"');
    expect(editor).toContain('const showsAbilityChoice =');
    expect(editor).toContain("isUnarmed ? 'Automatic' : 'Weapon default'");
  });

  it('refreshes the attack rows after any mutation, such as a level-up', () => {
    // Attack rows recompute from the character, so a level-up changes the
    // proficiency bonus and a monk's Martial Arts die without touching a row.
    // LevelUpFlyout and OptionalRulesPanel use the same mutationTick refresh.
    expect(manage).toContain('mutationTick');
    expect(manage).toMatch(/\[refresh, mutationTick\]/);
  });

  it('points at the unarmed strike from the empty attacks panel', () => {
    expect(manage).toContain('an unarmed strike');
    expect(manage).toContain('Attack to add an owned weapon');
  });

  it('shows syntax examples in empty manual attack fields', () => {
    expect(editor).toContain("name: 'Fire Bolt'");
    expect(editor).toContain("range: '120 ft'");
    expect(editor).toContain("bonus: '+5 vs AC'");
    expect(editor).toContain("damage: '1d10 fire'");
    expect(editor).toContain(
      "'Make a ranged spell attack. On a hit, the target takes 1d10 fire damage.'",
    );
    expect(editor).toContain("draft.mode === 'manual'");
    expect(editor).toContain('placeholder,');
  });

  it('supports editing and restoring generated attack fields', () => {
    expect(manage).toContain('Edit');
    expect(editor).toContain('role="switch"');
    expect(editor).toContain('aria-checked={overridden}');
    expect(editor).not.toContain('Use calculated value');
    expect(editor).not.toContain('Override on');
    expect(editor).not.toContain('Override off');
    expect(editor).toContain('Weapon default');
  });

  it('marks edits to a newly generated spell as explicit overrides', () => {
    expect(editor).toContain("draft.mode === 'spell' && !attack");
    expect(editor).toContain('attack.source?.casterIdentifier');
    expect(editor).toContain(
      "overrideFields: [...new Set([...current.overrideFields, key])]",
    );
  });

  it('replaces a calculated preview with its custom value when enabled', () => {
    expect(editor).not.toContain('Calculated result');
    expect(editor).not.toContain('Override result');
    expect(editor).toContain('overrideSwitch(');
    expect(editor).not.toContain(
      'These values will appear in the attack row.',
    );
    expect(editor).toContain('aria-label="Calculated attack values"');
    expect(editor).toContain('damageAbility.abbreviation');
    expect(editor).not.toMatch(/will\s+not change the damage result/);
    expect(editor).not.toContain('Calculated value:');
    expect(editor).toContain('!overridden && (');
    expect(editor).toContain("{calculatedPreview[field] || '—'}");
  });

  it('places calculated attack identity before its calculation settings', () => {
    const calculatedForm = editor.indexOf(
      "{draft.mode === 'calculated' && (",
    );
    const name = editor.indexOf(
      "{generatedField('name', 'Name')}",
      calculatedForm,
    );
    const calculationSource = editor.indexOf(
      '\n                Source\n',
      calculatedForm,
    );

    expect(calculatedForm).toBeGreaterThanOrEqual(0);
    expect(name).toBeGreaterThanOrEqual(0);
    expect(name).toBeLessThan(calculationSource);
  });

  it('uses concise calculation labels and fixed damage types', () => {
    expect(editor).toContain('<option value="ability">Ability</option>');
    expect(editor).toContain(
      '<option value="caster">Spellcasting</option>',
    );
    expect(editor).not.toContain('Ability + proficiency');
    expect(editor).toContain('{ability.abbreviation}');
    expect(editor).not.toContain(
      '{ability.abbreviation} — {ability.name}',
    );
    expect(editor).toContain('Proficient');
    expect(editor).toContain('Attack modifier');
    expect(editor).toContain('Damage modifier');
    expect(editor).toContain('Add {damageAbility.abbreviation} to damage');
    expect(editor).toContain('DAMAGE_TYPES.map');
    expect(editor).not.toContain('Misc. attack bonus');
    expect(editor).not.toContain('Misc. damage bonus');
  });

  it('uses a wide, responsive two-column attack form without cramped cards', () => {
    expect(editor).toContain('size="wide"');
    expect(editor).toContain('md:grid-cols-2');
    expect(editor).toContain('min-w-0');
    expect(editor).toContain('flex-wrap');
    expect(modal).toContain("'max-w-3xl'");
    expect(editor).toContain('bg-white');
    expect(editor).toContain('bg-[var(--fcb-primary)]');
    expect(editor).not.toMatch(/--fcb-(?:accent|muted|panel)\b/);
    expect(editor).toContain(
      "overridden ? 'translate-x-5' : 'translate-x-0'",
    );
  });

  it('uses compact accessible icons for attack metadata and actions', () => {
    expect(manage).not.toContain('name="sheet"');
    expect(manage).not.toContain('name="ability"');
    expect(manage).toContain('<Icon name="edit" />');
    expect(manage).toContain('<Icon name="move-up" />');
    expect(manage).toContain('<Icon name="move-down" />');
    expect(manage).toContain(
      "name={attack.isDisplayed ? 'hide' : 'show'}",
    );
    expect(manage).toContain('<Icon name="delete" />');
    expect(manage).toContain('aria-label={`Edit ${attack.name}`}');
    expect(manage).toContain(
      'className="fcb-toolbar fcb-attack-actions absolute right-4 top-4"',
    );
    expect(manage).not.toContain('Attack type:');
    expect(manage).not.toMatch(/>\s*Move Up\s*</);
    expect(manage).not.toMatch(/>\s*Move Down\s*</);
  });

  it('exposes create, edit, and option APIs through the typed adapter', () => {
    expect(transport).toContain('attackOptions:');
    expect(transport).toContain('createAttack:');
    expect(transport).toContain('updateAttack:');
    expect(transport).toContain('"createAttack"');
    expect(transport).toContain('"updateAttack"');
    expect(transport).toContain('addGrantedSpell');
  });

  it('refreshes live calculation options whenever the editor opens', () => {
    expect(manage).toContain('const openEditor = async (attack)');
    expect(manage).toMatch(
      /const openEditor = async \(attack\)[\s\S]*?api\.characters\.attackOptions\(id\)[\s\S]*?setEditor\(attack\)/,
    );
    expect(manage).toContain('onClick={() => openEditor(null)}');
    expect(manage).toContain('onClick={() => openEditor(attack)}');
  });

  it('keeps the portaled export overlay above the sticky subbar and uses one native activation path', () => {
    expect(workspace).toContain('topbar.style.zIndex = "32"');
    expect(workspace).toContain("target.closest(\".fcb-export-menu\")");
    expect(exportMenu.match(/downloadBlob\(filename, blob\)/g)).toHaveLength(1);
    expect(exportMenu).toContain('role="menuitem"');
    expect(exportMenu).toContain('onClick={item.run}');
    expect(exportMenu).not.toContain('onKeyDown=');
  });
});
