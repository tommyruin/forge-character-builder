// @vitest-environment happy-dom
// Fixing a spell a homebrew pack grants that nothing defines, from Content warnings: the spell is
// written into the pack that wrote the grant, under the id the grant names, and the pack is saved
// again so the warning resolves.
import { describe, expect, it, vi } from 'vitest';
import CustomSpellModal from '../CustomSpellModal';
import { MY_HOMEBREW_NAME, addSpellToCollection, makePackSpellServices } from '../customServices';
import { UploadDiagnostics } from '../../ContentManager';
import { collectionStoragePath, createCollection } from '../../homebrew/xmlBuilder';
import { buttonByText, byLabel, click, mount, settle, type } from './harness';

const MISSING = {
  kind: 'missing-grant',
  file: 'imports/homebrew-x/collection.xml',
  message: 'Moonwell Pact (ID_HB_MC_FEAT_MOONWELL_PACT) grants ID_HB_MC_SPELL_FROST_LANCE, which no loaded content defines',
  detail: 'the reference is skipped until a pack that defines it is loaded',
  elementId: 'ID_HB_MC_FEAT_MOONWELL_PACT',
  elementName: 'Moonwell Pact',
  missingId: 'ID_HB_MC_SPELL_FROST_LANCE',
  missingType: 'Spell',
};

function fakeStore(records = []) {
  const stored = new Map(records.map((record) => [record.id, record]));
  return {
    listHomebrew: vi.fn(async () => [...stored.values()]),
    putHomebrew: vi.fn(async (record) => {
      stored.set(record.id, record);
    }),
    stored,
  };
}

const fakeApi = () => ({
  content: {
    upload: vi.fn(async () => ({ elementCountAfterReload: 10, diagnostics: [], files: [{ accepted: true }] })),
    consolidateHomebrew: vi.fn(async () => ({ removed: 0 })),
    clearCache: vi.fn(),
  },
});

describe('the Create spell action on a content warning', () => {
  it('is offered for a missing spell only, and only when the page can act on it', async () => {
    const other = { ...MISSING, missingId: 'ID_HB_MC_TRAIT_X', missingType: 'Racial Trait', message: 'x' };
    const plain = await mount(<UploadDiagnostics diagnostics={[MISSING]} />);
    expect(plain.host.textContent).not.toContain('Create spell');

    const onCreateSpell = vi.fn();
    await mount(<UploadDiagnostics diagnostics={[MISSING, other]} onCreateSpell={onCreateSpell} />);
    const buttons = [...document.querySelectorAll('[data-testid="cm-upload-diagnostics"] button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Create spell']);
    await click(buttons[0]);
    expect(onCreateSpell).toHaveBeenCalledWith(MISSING);
  });
});

describe('writing a spell into a pack', () => {
  it('adds the compiled spell to the collection that wrote the grant and saves the collection again', async () => {
    const collection = { ...createCollection('Moonwell Campaign'), id: 'x' };
    expect(collectionStoragePath(collection)).toBe(MISSING.file);
    const store = fakeStore([collection]);
    const api = fakeApi();
    const draft = {
      schemaVersion: 1,
      id: 'ID_HB_MC_SPELL_FROST_LANCE',
      template: 'spell',
      name: 'Frost Lance',
      description: 'A lance of ice.',
      level: 1,
      school: 'Evocation',
      castingTime: '1 action',
      range: '120 feet',
      duration: 'Instantaneous',
      components: { verbal: true },
      mechanics: { roll: 'attackRanged', damage: [{ dice: '2d8', type: 'cold' }] },
    };
    const out = await addSpellToCollection({ api, store, collection, draft });

    expect(out.collection.elements).toHaveLength(1);
    expect(out.collection.elements[0]).toMatchObject({ id: 'ID_HB_MC_SPELL_FROST_LANCE', idLocked: true, type: 'Spell' });
    // The element is written under the pack's own source name, with the id the grant waits for.
    const xml = out.collection.elements[0].rawXml;
    expect(xml).toContain('type="Spell"');
    expect(xml).toContain('source="Moonwell Campaign"');
    expect(xml).toContain('id="ID_HB_MC_SPELL_FROST_LANCE"');
    expect(store.putHomebrew).toHaveBeenCalled();
    expect(api.content.upload).toHaveBeenCalledTimes(1);
    const file = api.content.upload.mock.calls[0][0][0];
    expect(await file.text()).toContain('ID_HB_MC_SPELL_FROST_LANCE');
  });

  it('replaces the spell on a second save instead of adding another', async () => {
    const collection = { ...createCollection('Moonwell Campaign'), id: 'x' };
    const store = fakeStore([collection]);
    const api = fakeApi();
    const draft = {
      schemaVersion: 1, id: 'ID_HB_MC_SPELL_FROST_LANCE', template: 'spell', name: 'Frost Lance', description: '',
      level: 1, school: 'Evocation', castingTime: '1 action', range: '60 feet', duration: 'Instantaneous', components: {}, mechanics: { roll: 'none' },
    };
    const first = await addSpellToCollection({ api, store, collection, draft });
    const second = await addSpellToCollection({ api, store, collection: first.collection, draft: { ...draft, name: 'Frost Lance II' } });
    expect(second.collection.elements).toHaveLength(1);
    expect(second.collection.elements[0].name).toBe('Frost Lance II');
  });

  it('lands in My homebrew when the file that wrote the grant is not a collection of the builder', async () => {
    const store = fakeStore([]);
    const api = fakeApi();
    const services = makePackSpellServices({ api, store, collection: null });
    const draft = {
      schemaVersion: 1, id: 'ID_HB_X_SPELL_ZAP', template: 'spell', name: 'Zap', description: '',
      level: 0, school: 'Evocation', castingTime: '1 action', range: '60 feet', duration: 'Instantaneous', components: {}, mechanics: { roll: 'none' },
    };
    const saved = await services.save(draft, {});
    expect(saved.entry.draft.id).toBe('ID_HB_X_SPELL_ZAP');
    const [record] = [...store.stored.values()];
    expect(record.name).toBe(MY_HOMEBREW_NAME);
    expect(record.elements.map((element) => element.id)).toEqual(['ID_HB_X_SPELL_ZAP']);
  });
});

describe('the spell form made for a pack', () => {
  it('says where the spell goes, asks for no caster, and saves under the missing id', async () => {
    const collection = { ...createCollection('Moonwell Campaign'), id: 'x' };
    const store = fakeStore([collection]);
    const api = fakeApi();
    const services = makePackSpellServices({ api, store, collection });
    const onSaved = vi.fn();
    await mount(
      <CustomSpellModal
        services={services}
        characterName="Ilyana"
        pack={{ name: 'Moonwell Campaign' }}
        initialDraft={{ name: 'Frost Lance', id: 'ID_HB_MC_SPELL_FROST_LANCE' }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    await settle();
    expect(document.body.textContent).toContain('Moonwell Campaign');
    expect(byLabel('Cast with')).toBeNull();
    expect(document.body.textContent).not.toContain('Also save to a homebrew pack');
    await type(byLabel('Text'), 'A lance of ice.');
    await click(buttonByText('Add spell'));
    await settle();
    expect(onSaved).toHaveBeenCalled();
    expect([...store.stored.values()][0].elements[0].id).toBe('ID_HB_MC_SPELL_FROST_LANCE');
  });
});
