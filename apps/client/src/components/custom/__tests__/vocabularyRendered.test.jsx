// @vitest-environment happy-dom
// One vocabulary across the custom-content dialogs and the Homebrew screens, read from what they
// render rather than from their source: the words on the chips, buttons, section headings and
// shows-under choices a user actually sees.
//
// The conventions it pins:
// - Confirm buttons are "Add <thing>" or "Save changes"; the dismiss button of a dialog is "Cancel".
// - "Delete" ends something for good (a custom item or spell); "Remove" takes an entry off a list and
//   Undo brings it back. The dismiss button of either confirmation is "Keep it"; the one of a save
//   that would clear picks is "Keep editing".
// - Copying to a homebrew pack is "Copy to …"; "world pack" and "ids" never show.
// - The app says Species (the content's own type names stay "Race" in the XML).
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createCustomDraft } from '@forge-cb/engine/custom';
import { BUILD_SECTIONS } from '../../../api';
import CustomItemModal from '../CustomItemModal';
import FeatureFields from '../FeatureFields';
import { CustomRemovalDialog } from '../CustomRemoval';
import { makeCustomServices } from '../customServices';
import PromoteDialog from '../../homebrew/PromoteDialog';
import { $, mount, settle } from './harness';

const services = {
  lookup: async () => ({ items: [] }),
  casters: async () => ['Wizard'],
  list: async () => ({ entries: [] }),
  defaultCastAbility: async () => 'intelligence',
};

const texts = (selector, scope = document) => [...scope.querySelectorAll(selector)].map((node) => node.textContent.trim());
const chips = (scope = document) => texts('.fcb-effect-chip-add', scope);
const page = () => document.body.textContent;

function FeatureHost() {
  const [draft, setDraft] = useState(() => createCustomDraft('feature', 'Moon Gift'));
  return <FeatureFields draft={draft} setDraft={setDraft} services={services} />;
}

function ItemHost({ template }) {
  const api = useMemo(
    () => ({
      characters: { spellcasting: vi.fn(async () => []) },
      content: { elements: vi.fn(async () => ({ items: [] })), element: vi.fn(async () => undefined) },
    }),
    [],
  );
  const built = useMemo(() => {
    const made = makeCustomServices({ api, store: { listHomebrew: async () => [] }, id: 'ada', run: async (operation) => operation() });
    made.lookup.debounceMs = 0;
    return made;
  }, [api]);
  return <CustomItemModal services={built} characterName="Ada" initialTemplate={template} onClose={() => {}} />;
}

describe('the rendered vocabulary', () => {
  it('names the Build section and the shows-under choice Species', async () => {
    expect(BUILD_SECTIONS.find((section) => section.key === 'race').label).toBe('Species');
    await mount(<FeatureHost />);
    expect(texts('[role="radio"]')).toEqual(expect.arrayContaining(['Species', 'Class', 'Feats', 'Other']));
    expect(page()).not.toMatch(/\bRace\b/);
  });

  it('gives the feature dialog its plain effect names, common first and the rest under More effects', async () => {
    await mount(<FeatureHost />);
    await settle();
    expect(chips($('[aria-label="Add an effect"]'))).toEqual(['+ Ability score', '+ Spell', '+ Proficiency', '+ Language', '+ Player choice', '+ Uses per rest']);
    const more = $('details.fcb-effect-more');
    expect(more.querySelector('summary').textContent).toBe('More effects');
    expect(chips(more)).toEqual(['+ Bonus to another stat', '+ Grows with level', '+ Only while active']);
    expect(texts('details > summary')).toContain('More options');
    for (const old of ['Player picks', 'Other bonus', 'Limited uses', 'Scale value']) expect(page()).not.toContain(old);
  });

  it('gives the item dialog the item words: a stat bonus, damage resistance and charges', async () => {
    await mount(<ItemHost template="wondrous" />);
    await settle();
    expect(chips()).toEqual(expect.arrayContaining(['+ Bonus to a stat', '+ Damage resistance', '+ Spell', '+ Other feature', '+ Charges']));
    expect(chips()).not.toContain('+ Uses per rest');
    const footer = $('.fcb-dialog-footer');
    expect(texts('button', footer)).toEqual(['Cancel', 'Add item']);
    expect(page()).not.toMatch(/Condition|Internal|Charges or limited uses|Feature or other grant/);
  });

  it('asks before a Remove with Keep it, and names what the remove does', async () => {
    const removal = {
      pending: { entry: { draft: { name: 'Moon Gift' } }, changes: [{ blockId: 'c1', name: 'Skill', picks: [{ elementName: 'Arcana' }] }] },
      saving: false,
      error: null,
      cancel: () => {},
      confirm: async () => {},
    };
    await mount(<CustomRemovalDialog removal={removal} />);
    expect(texts('.fcb-dialog-footer button')).toEqual(['Keep it', 'Remove and clear those picks']);
  });

  it('copies to a pack with one verb and never says world pack or ids', async () => {
    const plan = { items: [{ id: 'ID_X', name: 'Moon Gift', linked: false }], notFound: [] };
    await mount(<PromoteDialog subject="Moon Gift" plan={plan} packs={[{ id: 'p1', name: 'Moonwell', elements: [], world: true }]} defaultPackId="p1" onConfirm={() => {}} onClose={() => {}} />);
    expect($('[role="dialog"]').getAttribute('aria-label')).toBe('Copy Moon Gift to a pack');
    expect(texts('.fcb-dialog-footer button')).toEqual(['Cancel', 'Copy to Moonwell']);
    expect(page()).not.toMatch(/world pack|shared pack|\bids?\b|Add to/i);
  });
});
