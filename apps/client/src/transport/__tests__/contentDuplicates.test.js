import { describe, expect, it } from 'vitest';
import {
  findDuplicateContentGroups,
  fingerprintContentSource,
  relativeContentPath,
} from '../contentDuplicates.js';

const source = (id, label = id, extra = {}) => ({
  id,
  kind: 'folder',
  label,
  fileCount: 2,
  ...extra,
});

const records = (sourceId, first = 'YWxwaGE=', second = 'YmV0YQ==') => [
  {
    path: `imports/${sourceId}/core/races.xml`,
    relativePath: 'core/races.xml',
    base64: first,
    sourceId,
    uploadedAt: 10,
  },
  {
    path: `imports/${sourceId}/rules.index`,
    relativePath: 'rules.index',
    base64: second,
    sourceId,
    uploadedAt: 20,
  },
];

describe('content source duplicate fingerprints', () => {
  it('matches exact paths, filenames, and bytes across different source IDs', async () => {
    const first = records('mobile-source');
    const second = records('desktop-source').reverse();

    await expect(fingerprintContentSource(first, 'mobile-source')).resolves.toBe(
      await fingerprintContentSource(second, 'desktop-source'),
    );
  });

  it('derives legacy relative paths from the private source namespace', () => {
    expect(
      relativeContentPath(
        {
          path: 'imports/legacy-elements/core/races.xml',
          base64: 'eA==',
          sourceId: 'legacy-elements',
        },
        'legacy-elements',
      ),
    ).toBe('core/races.xml');
  });

  it('does not match renamed files, rearranged paths, or changed bytes', async () => {
    const original = records('original');
    const renamed = records('renamed').map((record, index) =>
      index === 0
        ? {
            ...record,
            path: 'imports/renamed/core/species.xml',
            relativePath: 'core/species.xml',
          }
        : record,
    );
    const changed = records('changed', 'ZGlmZmVyZW50');

    const originalFingerprint = await fingerprintContentSource(
      original,
      'original',
    );
    await expect(
      fingerprintContentSource(renamed, 'renamed'),
    ).resolves.not.toBe(originalFingerprint);
    await expect(
      fingerprintContentSource(changed, 'changed'),
    ).resolves.not.toBe(originalFingerprint);
  });

  it('reports unacknowledged duplicate groups and honors Keep all', async () => {
    const allRecords = [
      ...records('mobile-source'),
      ...records('desktop-source'),
    ];
    const sources = [
      source('mobile-source', 'legacy-elements'),
      source('desktop-source', 'Legacy Elements'),
    ];

    const [group] = await findDuplicateContentGroups(sources, allRecords);

    expect(group).toMatchObject({
      sourceIds: ['desktop-source', 'mobile-source'],
      fileCount: 2,
      relativePaths: ['core/races.xml', 'rules.index'],
    });
    expect(group.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

    const acknowledged = sources.map((entry) => ({
      ...entry,
      duplicateAcknowledgedFingerprint: group.fingerprint,
    }));
    await expect(
      findDuplicateContentGroups(acknowledged, allRecords),
    ).resolves.toEqual([]);
  });
});
