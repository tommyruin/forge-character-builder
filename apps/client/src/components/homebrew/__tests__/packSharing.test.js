// A pack made on one device, promoted to a world pack, shared as one file and opened on another
// device: the same ids, the same numbers on a second character, editable there, and a newer copy
// updates it in place. The engine, the library and the characters are real; only the browser
// database and the upload call are stand-ins.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { computeStatistics, createEmptyLibrary, replaceLibraryFiles } from '@forge-cb/engine';
import { createCustomDraft, createCustomItemDraft, newCustomBlockId, packElementFor } from '@forge-cb/engine/custom';
import { buildFighter3 } from '../../../../../../packages/engine/src/testing/character-factory.ts';
import { baselineFiles, libraryWithHomebrew } from './homebrewHarness.js';
import { PACK_FILE_NAMESPACE, buildPackFile, isPackFile, packVersion, readPackFile } from '../packFile.js';
import { applyPackImport, planPackImport } from '../packTransfer.js';
import { planPromotion, promoteToPack, refsOfDraft } from '../promotion.js';
import { elementIdOf } from '../packModel.js';
import { buildCollectionXml, collectionStoragePath } from '../xmlBuilder.js';

const memoryStore = () => {
  const records = new Map();
  return {
    records,
    listHomebrew: async () => [...records.values()].map((record) => structuredClone(record)),
    getHomebrew: async (id) => structuredClone(records.get(id)),
    putHomebrew: async (record) => {
      records.set(record.id, { ...structuredClone(record), updatedAt: Date.now() });
    },
  };
};

const fakeApi = () => ({
  content: {
    upload: vi.fn(async () => ({ elementCountAfterReload: 9, diagnostics: [], files: [{ accepted: true }] })),
    consolidateHomebrew: vi.fn(async () => ({ removed: 0 })),
    clearCache: vi.fn(),
  },
});

const gift = {
  ...createCustomDraft('boon', 'Tide Gift'),
  description: 'The tide answers.',
  blocks: [{ kind: 'modifier', id: newCustomBlockId(), target: 'initiative', mode: 'add', value: { kind: 'number', value: 3 } }],
  trackers: [{ id: 'surge', label: 'Surge', max: { kind: 'number', value: 2 }, unit: 'uses', recharge: 'longRest' }],
};
const wand = {
  ...createCustomItemDraft('worn', 'Tide Wand'),
  slot: 'misc',
  description: 'A wand of the tide.',
  blocks: [{ kind: 'grant', id: newCustomBlockId(), target: { by: 'id', type: 'Custom Feature', id: gift.id, label: 'Tide Gift' } }],
};

let deviceA;
let sharedText;

beforeAll(async () => {
  await baselineFiles();
  deviceA = { store: memoryStore(), api: fakeApi() };
  // Device A: a character made both entries on itself; the wand is promoted into a new world pack.
  const library = await libraryWithHomebrew();
  const { service, id } = buildFighter3(library, 'Ada');
  service.saveCustomDraft(id, { draft: gift });
  service.saveCustomDraft(id, { draft: wand });
  const entries = service.getCustomContent(id).entries;
  const byId = new Map(entries.map((entry) => [entry.elementId, entry]));
  const plan = planPromotion({
    primary: { id: wand.id, name: wand.name, draft: wand, refs: refsOfDraft(wand) },
    find: (linked) => (byId.has(linked) ? { name: byId.get(linked).draft.name, draft: byId.get(linked).draft, refs: refsOfDraft(byId.get(linked).draft) } : null),
    target: null,
  });
  const promoted = await promoteToPack({ store: deviceA.store, target: { create: { name: 'Moon World', author: 'Dana' } }, items: plan.items });
  deviceA.plan = plan;
  deviceA.pack = promoted.pack;
  deviceA.adaStats = computeStatistics(service.getCharacter(id), library);
  sharedText = buildPackFile(deviceA.pack);
});

describe('promoting to a world pack', () => {
  it('offers what the entry refers to, and keeps every id', () => {
    expect(deviceA.plan.items.map((item) => [item.name, item.linked])).toEqual([['Tide Wand', false], ['Tide Gift', true]]);
    expect(deviceA.plan.notFound).toEqual([]);
    const stored = [...deviceA.store.records.values()][0];
    expect(stored).toMatchObject({ name: 'Moon World', author: 'Dana', world: true });
    expect(stored.elements.map((element) => element.id).sort()).toEqual([gift.id, wand.id].sort());
  });

  it('replaces a copy the pack already holds instead of adding a second', async () => {
    const again = await promoteToPack({
      store: deviceA.store,
      target: { packId: deviceA.pack.id },
      items: [{ draft: { ...gift, name: 'Tide Gift' } }],
    });
    expect(again.replaced).toEqual(['Tide Gift']);
    expect(again.pack.elements).toHaveLength(2);
  });

  it('reports a reference nothing here defines', () => {
    const plan = planPromotion({ primary: { id: wand.id, name: 'Tide Wand', draft: wand, refs: [gift.id] }, find: () => null, target: null });
    expect(plan.notFound).toEqual([gift.id]);
  });
});

describe('the pack file', () => {
  it('is the loadable XML plus a namespaced block other readers ignore', async () => {
    expect(sharedText).toContain(PACK_FILE_NAMESPACE);
    expect(isPackFile(sharedText)).toBe(true);
    const files = new Map(await baselineFiles());
    files.set('imports/shared.xml', sharedText);
    const library = createEmptyLibrary();
    replaceLibraryFiles(library, files);
    expect((library.diagnostics ?? []).filter((entry) => entry.file === 'imports/shared.xml')).toEqual([]);
    expect(library.byId.get(gift.id).identity.source).toBe('Moon World');
    expect(library.byId.get(wand.id).identity.type).toBe('Magic Item');
  });

  it('reads back as the same pack, without anything about the device that wrote it', () => {
    const read = readPackFile(sharedText);
    expect(read.manifest).toMatchObject({ id: deviceA.pack.id, name: 'Moon World', author: 'Dana', elementCount: 2 });
    expect(read.pack.ingestedAt).toBeUndefined();
    expect(read.pack.elements.map((element) => element.customDraft?.id).sort()).toEqual([gift.id, wand.id].sort());
    expect(packVersion(read.pack)).toBe(packVersion(deviceA.pack));
  });

  it('survives text that looks like markup in a pack', () => {
    const pack = { ...deviceA.pack, description: 'Use <b> & </fcb:data> carefully "quoted"', elements: deviceA.pack.elements };
    expect(readPackFile(buildPackFile(pack)).pack.description).toBe(pack.description);
  });

  it('says why a damaged or newer file cannot be read, and leaves any other file alone', () => {
    expect(readPackFile(sharedText.replace(/<fcb:data>[\s\S]*<\/fcb:data>/, '<fcb:data>{oops</fcb:data>')).error).toMatch(/damaged/);
    expect(readPackFile(sharedText.replace('format="1"', 'format="9"')).error).toMatch(/newer/);
    expect(readPackFile('<elements></elements>')).toEqual({ notPack: true });
    expect(planPackImport('<elements></elements>', [])).toEqual({ kind: 'not-pack' });
  });
});

describe('a second device', () => {
  const deviceB = { store: memoryStore(), api: fakeApi() };
  const hooks = { onLibraryChanged: vi.fn(async () => {}), onLibraryMutationFinished: vi.fn(), beforeLibraryMutation: vi.fn(async () => {}) };

  it('opens the pack editable with the same ids and loads it into the library', async () => {
    const plan = planPackImport(sharedText, await deviceB.store.listHomebrew());
    expect(plan.kind).toBe('new');
    const outcome = await applyPackImport(plan, { api: deviceB.api, store: deviceB.store, ...hooks });
    expect(outcome).toMatchObject({ ok: true, count: 9 });
    const stored = await deviceB.store.getHomebrew(deviceA.pack.id);
    expect(stored.elements.map((element) => elementIdOf(element, stored)).sort()).toEqual([gift.id, wand.id].sort());
    expect(stored.elements.every((element) => element.customDraft && element.idLocked)).toBe(true);
    expect(stored.ingestedAt).toBeGreaterThan(0);
    // The file went to the same stored path on every device.
    const [files, , options] = deviceB.api.content.upload.mock.calls[0];
    expect(files[0].name).toBe('collection.xml');
    expect(collectionStoragePath(stored)).toContain(deviceA.pack.id);
    expect(options.sourceId).toBe(`homebrew-${deviceA.pack.id}`);
    expect(hooks.onLibraryChanged).toHaveBeenCalledWith(expect.objectContaining({ source: 'homebrew' }));
    expect(hooks.onLibraryMutationFinished).toHaveBeenCalled();
  });

  it('gives a second character the stats the first has, from the pack alone', async () => {
    const stored = await deviceB.store.getHomebrew(deviceA.pack.id);
    const library = await libraryWithHomebrew(stored);
    const { service, id } = buildFighter3(library, 'Bea');
    service.addGrantedElement(id, { elementId: gift.id });
    const stats = computeStatistics(service.getCharacter(id), library);
    expect(stats.initiative).toBe(deviceA.adaStats.initiative);
    expect(service.getResources(id).trackers.map((entry) => entry.label)).toContain('Surge');
  });

  it('updates the pack in place when a newer copy arrives, after naming what changes', async () => {
    // Device A raises the gift to +4, drops the wand and shares again, later than before.
    const bigger = { ...gift, blocks: [{ ...gift.blocks[0], value: { kind: 'number', value: 4 } }] };
    const newer = {
      ...deviceA.pack,
      version: packVersion(deviceA.pack) + 60_000,
      elements: [{ ...packElementFor(bigger, deviceA.pack.name), idLocked: true }],
    };
    const text = buildPackFile(newer);
    const plan = planPackImport(text, await deviceB.store.listHomebrew());
    expect(plan).toMatchObject({ kind: 'update', relation: 'newer', removed: ['Tide Wand'], added: [] });
    expect(plan.existing.id).toBe(deviceA.pack.id);
    await applyPackImport(plan, { api: deviceB.api, store: deviceB.store, ...hooks });
    const records = await deviceB.store.listHomebrew();
    expect(records).toHaveLength(1);
    expect(records[0].elements).toHaveLength(1);
    const library = await libraryWithHomebrew(records[0]);
    const { service, id } = buildFighter3(library, 'Cy');
    service.addGrantedElement(id, { elementId: gift.id });
    expect(computeStatistics(service.getCharacter(id), library).initiative).toBe(deviceA.adaStats.initiative + 1);
  });

  it('names an older copy as older, and a copy of the same age as the same', async () => {
    const records = await deviceB.store.listHomebrew();
    const older = planPackImport(sharedText, records);
    expect(older).toMatchObject({ kind: 'update', relation: 'older' });
    const same = planPackImport(buildPackFile(records[0]), records);
    expect(same).toMatchObject({ kind: 'update', relation: 'same' });
  });

  it('stores a pack that does not validate unloaded, so it can be opened and fixed', async () => {
    const nameless = { ...deviceA.pack, id: 'nameless-pack', name: '' };
    const plan = planPackImport(buildPackFile(nameless), []);
    const outcome = await applyPackImport(plan, { api: fakeApi(), store: memoryStore(), ...hooks });
    expect(outcome).toMatchObject({ ok: false, stored: true });
    expect(outcome.errors.length).toBeGreaterThan(0);
  });
});

describe('the share file keeps the pack loadable on its own', () => {
  it('lists the same elements as the pack loads from', () => {
    const plain = buildCollectionXml(deviceA.pack);
    expect(sharedText.startsWith(plain.slice(0, plain.lastIndexOf('</elements>')))).toBe(true);
  });
});
