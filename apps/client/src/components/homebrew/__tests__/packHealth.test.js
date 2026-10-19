import { describe, expect, it, vi } from 'vitest';
import { checkPackHealth, findingTitle, fixFor, problemsIn } from '../packHealth.js';
import { appendElement, convertToFeature, elementForDraft, overrideElement, rawElement } from '../packModel.js';
import { buildCollectionXml, collectionStoragePath, createCollection } from '../xmlBuilder.js';
import { libraryWithHomebrew } from './homebrewHarness.js';
import { checkContentFile } from '../../../../../../packages/engine/src/content/pack-check.ts';

const pack = { ...createCollection('Moonwell Campaign'), id: 'pack-1' };

// The real engine check against a library built from the shipped content, so each problem kind is
// found the way the app finds it.
async function realApi(library) {
  return { content: { checkPack: async (request) => checkContentFile(library, request) } };
}

describe('pack health', () => {
  it('sends the pack file, its path and the ids it replaces on purpose', async () => {
    const checkPack = vi.fn(async () => []);
    const override = overrideElement(
      { id: 'ID_BOOK_X', name: 'Shield', type: 'Spell', xml: '<element name="Shield" type="Spell" source="B" id="ID_BOOK_X"><description><p>x</p></description></element>' },
      pack,
    );
    const full = { ...pack, elements: [override] };
    await checkPackHealth({ content: { checkPack } }, full);
    expect(checkPack).toHaveBeenCalledWith({ path: collectionStoragePath(full), xml: buildCollectionXml(full), overrides: ['ID_BOOK_X'] });
  });

  it('lists each kind of problem with the element that carries it, and a fix where there is one', async () => {
    const baseLibrary = await libraryWithHomebrew();
    const grantsMissingSpell = elementForDraft(
      {
        ...elementForDraft({ schemaVersion: 1, id: 'ID_CUSTOM_PACTTEST0001', template: 'boon', name: 'Moonwell Pact', showsUnder: 'other', description: 'A pact.', blocks: [
          { kind: 'grant', id: 'g1', target: { by: 'id', type: 'Spell', id: 'ID_HB_MC_SPELL_FROST_LANCE', label: 'Frost Lance' } },
        ] }, pack).customDraft,
      },
      pack,
    );
    const hermit = rawElement({ type: 'Background Feature', name: "Hermit's Retreat", pack });
    const wand1 = rawElement({ type: 'Magic Item', name: 'Wand of Embers', pack });
    const wand2 = { ...wand1, localId: 'second', name: 'Wand of Embers Again' };
    const badAppend = {
      ...appendElement({ id: 'ID_NOT_LOADED_ANYWHERE', name: 'Missing Thing' }, pack),
    };
    const addition = elementForDraft(
      { ...badAppend.customDraft, tags: ['Wizard'] },
      pack,
    );
    const badRequirements = rawElement({ type: 'Feat', name: 'Bad Gate', pack });
    badRequirements.rawXml = badRequirements.rawXml.replace('<description>', '<requirements>ID_(((</requirements>\n  <description>');
    const full = { ...pack, elements: [grantsMissingSpell, hermit, wand1, wand2, addition, badRequirements] };

    const findings = await checkPackHealth(await realApi(baseLibrary), full);
    const kinds = new Set(problemsIn(findings).map((finding) => finding.kind));
    expect(kinds).toEqual(new Set(['missing-grant', 'unattachable', 'duplicate-id', 'append-target', 'invalid-requirements']));

    const grant = findings.find((finding) => finding.kind === 'missing-grant');
    expect(grant).toMatchObject({ elementName: 'Moonwell Pact', missingId: 'ID_HB_MC_SPELL_FROST_LANCE', missingType: 'Spell' });
    expect(fixFor(grant, full)).toMatchObject({ action: 'create-spell', label: 'Create spell' });

    const unattachable = findings.find((finding) => finding.kind === 'unattachable');
    expect(unattachable.elementName).toBe("Hermit's Retreat");
    expect(fixFor(unattachable, full)).toMatchObject({ action: 'convert', label: 'Convert to feature' });

    const duplicate = findings.find((finding) => finding.kind === 'duplicate-id');
    expect(fixFor(duplicate, full)).toMatchObject({ action: 'open' });
    expect(findings.find((finding) => finding.kind === 'append-target')).toBeTruthy();
    expect(fixFor(findings.find((finding) => finding.kind === 'invalid-requirements'), full)).toMatchObject({ action: 'open' });

    expect(findingTitle(grant)).toMatch(/not in your library/);
  });

  it('is clear once the unattachable element is converted', async () => {
    const baseLibrary = await libraryWithHomebrew();
    const hermit = rawElement({ type: 'Background Feature', name: "Hermit's Retreat", pack });
    const before = await checkPackHealth(await realApi(baseLibrary), { ...pack, elements: [hermit] });
    expect(problemsIn(before).map((finding) => finding.kind)).toEqual(['unattachable']);
    const after = await checkPackHealth(await realApi(baseLibrary), { ...pack, elements: [convertToFeature(hermit, pack)] });
    expect(problemsIn(after)).toEqual([]);
  });

  it('does not count a deliberate replacement of a book element as a problem', async () => {
    const baseLibrary = await libraryWithHomebrew();
    const shield = baseLibrary.byId.get('ID_PHB_SPELL_SHIELD') ?? [...baseLibrary.byId.values()].find((element) => element.identity.type === 'Spell');
    const source = { id: shield.identity.id, name: shield.identity.name, type: 'Spell', xml: `<element name="${shield.identity.name}" type="Spell" source="Test" id="${shield.identity.id}"><description><p>House rule.</p></description></element>` };
    const full = { ...pack, elements: [overrideElement(source, pack)] };
    const findings = await checkPackHealth(await realApi(baseLibrary), full);
    expect(problemsIn(findings)).toEqual([]);
  });
});
