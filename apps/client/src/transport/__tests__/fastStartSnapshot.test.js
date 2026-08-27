import { describe, expect, it } from 'vitest';
import { stableHash } from '../../cloud/librarySnapshot.js';
import {
  FAST_START_BODY_CODEC,
  FAST_START_FORMAT,
  MAX_FAST_START_BODY_BYTES,
  FAST_START_PARSER_REVISION,
  FAST_START_SCHEMA_VERSION,
  createFastStartIdentity,
  createFastStartRecord,
  validateFastStartRecord,
} from '../fastStartSnapshot.js';

const options = {
  engineVersion: 'engine-sha256',
  publicContentProfile: 'public-base',
};
const engineMetadata = {
  libraryKind: 'fcb-fast-start-library',
  bodyCodec: FAST_START_BODY_CODEC,
  elementCount: 100,
  elementTypeCount: 10,
  orderedElementDigest: `sha256:${'a'.repeat(64)}`,
  diagnosticsDigest: `sha256:${'b'.repeat(64)}`,
};

describe('Local Fast Start snapshot identity', () => {
  it('locks the body contract to browser-supported GZip', () => {
    expect(FAST_START_BODY_CODEC).toBe('gzip-json');
  });

  it('invalidates cached v1 snapshots for the compact v2 wire format', async () => {
    const currentIdentity = await createFastStartIdentity({
      ...options,
      files: [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }],
    });
    const legacyKeyMaterial = {
      format: currentIdentity.format,
      schemaVersion: 1,
      parserRevision: 'finalized-library-v1',
      engineVersion: currentIdentity.engineVersion,
      publicContentProfile: currentIdentity.publicContentProfile,
      sourceDigest: currentIdentity.sourceDigest,
      fileCount: currentIdentity.fileCount,
    };
    const legacyIdentity = {
      ...currentIdentity,
      ...legacyKeyMaterial,
      key: await stableHash(legacyKeyMaterial),
    };
    const legacyRecord = await createFastStartRecord({
      identity: legacyIdentity,
      body: new Uint8Array([1, 2, 3]),
      engineMetadata,
    });

    expect(FAST_START_SCHEMA_VERSION).toBe(2);
    expect(FAST_START_PARSER_REVISION).toBe('finalized-library-v9');
    expect(currentIdentity.key).not.toBe(legacyIdentity.key);
    await expect(
      validateFastStartRecord(legacyRecord, currentIdentity),
    ).resolves.toMatchObject({
      valid: false,
      reason: 'manifest does not match the expected snapshot identity',
    });
  });

  it('is deterministic across content order and volatile timestamps', async () => {
    const first = await createFastStartIdentity({
      ...options,
      sources: [
        {
          id: 'volatile-source-id',
          kind: 'github',
          location: 'https://github.com/example/rules',
          revision: 'commit-abc',
          importedAt: 20,
        },
      ],
      files: [
        {
          path: 'imports/source-b/b.xml',
          base64: 'YmV0YQ==',
          uploadedAt: 20,
        },
        {
          path: 'homebrew/a.xml',
          base64: 'YWxwaGE=',
          uploadedAt: 10,
        },
      ],
    });
    const second = await createFastStartIdentity({
      ...options,
      sources: [
        {
          id: 'different-local-id',
          kind: 'github',
          location: 'https://github.com/example/rules',
          revision: 'commit-abc',
          importedAt: 999,
        },
      ],
      files: [
        {
          uploadedAt: 999,
          base64: 'YWxwaGE=',
          path: 'homebrew/a.xml',
        },
        {
          uploadedAt: 888,
          base64: 'YmV0YQ==',
          path: 'imports/source-b/b.xml',
        },
      ],
    });

    expect(first).toMatchObject({
      format: FAST_START_FORMAT,
      schemaVersion: FAST_START_SCHEMA_VERSION,
      parserRevision: FAST_START_PARSER_REVISION,
      engineVersion: options.engineVersion,
      publicContentProfile: options.publicContentProfile,
      fileCount: 2,
      sourcePointers: [
        {
          kind: 'github',
          location: 'https://github.com/example/rules',
          revision: 'commit-abc',
          licence: null,
          provenance: null,
        },
      ],
    });
    expect(first.orderedFileHashes).toEqual([
      {
        path: 'homebrew/a.xml',
        hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      {
        path: 'imports/source-b/b.xml',
        hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    ]);
    expect(first.key).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first).toEqual(second);
  });

  it('includes normalized source pointers in the exact snapshot key', async () => {
    const files = [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }];
    const first = await createFastStartIdentity({
      ...options,
      files,
      sources: [
        {
          kind: 'github',
          location: 'https://github.com/example/first',
          revision: 'commit-a',
        },
      ],
    });
    const second = await createFastStartIdentity({
      ...options,
      files,
      sources: [
        {
          kind: 'folder',
          location: null,
          revision: null,
        },
      ],
    });

    expect(first.key).not.toBe(second.key);
    expect(first.sourcePointers).not.toEqual(second.sourcePointers);
  });

  it.each([
    [
      'revision',
      {
        kind: 'github',
        location: 'https://github.com/example/rules',
        revision: 'commit-b',
        licence: 'OGL-1.0a',
        provenance: { publisher: 'Example Press', reviewed: true },
      },
    ],
    [
      'licence',
      {
        kind: 'github',
        location: 'https://github.com/example/rules',
        revision: 'commit-a',
        license: 'CC-BY-4.0',
        provenance: { publisher: 'Example Press', reviewed: true },
      },
    ],
    [
      'provenance',
      {
        kind: 'github',
        location: 'https://github.com/example/rules',
        revision: 'commit-a',
        licence: 'OGL-1.0a',
        provenance: { publisher: 'Other Press', reviewed: true },
      },
    ],
  ])(
    'rejects a same-content snapshot when its normalized source %s changes',
    async (_field, changedSource) => {
      const files = [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }];
      const originalIdentity = await createFastStartIdentity({
        ...options,
        files,
        sources: [
          {
            kind: 'github',
            location: 'https://github.com/example/rules',
            revision: 'commit-a',
            licence: 'OGL-1.0a',
            provenance: { reviewed: true, publisher: 'Example Press' },
          },
        ],
      });
      const changedIdentity = await createFastStartIdentity({
        ...options,
        files,
        sources: [changedSource],
      });
      const record = await createFastStartRecord({
        identity: originalIdentity,
        body: new Uint8Array([1, 2, 3]),
        engineMetadata,
      });

      expect(changedIdentity.key).not.toBe(originalIdentity.key);
      expect(record.manifest.sourcePointers).toEqual(
        originalIdentity.sourcePointers,
      );
      await expect(
        validateFastStartRecord(record, changedIdentity),
      ).resolves.toMatchObject({
        valid: false,
        reason: 'manifest does not match the expected snapshot identity',
      });
    },
  );

  it('can derive the same key from a validated raw-pack file index', async () => {
    const fromFiles = await createFastStartIdentity({
      ...options,
      files: [
        { path: 'rules/b.xml', base64: 'YmV0YQ==' },
        { path: 'rules/a.xml', base64: 'YWxwaGE=' },
      ],
    });
    const fromIndex = await createFastStartIdentity({
      ...options,
      orderedFileHashes: fromFiles.orderedFileHashes,
    });

    expect(fromIndex).toEqual(fromFiles);
  });

  it('changes for content, engine, parser, or profile changes', async () => {
    const baseline = await createFastStartIdentity({
      ...options,
      files: [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }],
    });
    const variants = await Promise.all([
      createFastStartIdentity({
        ...options,
        files: [{ path: 'homebrew/a.xml', base64: 'YmV0YQ==' }],
      }),
      createFastStartIdentity({
        ...options,
        files: [{ path: 'homebrew/b.xml', base64: 'YWxwaGE=' }],
      }),
      createFastStartIdentity({
        ...options,
        engineVersion: 'different-engine',
        files: [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }],
      }),
      createFastStartIdentity({
        ...options,
        parserRevision: 'different-parser',
        files: [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }],
      }),
      createFastStartIdentity({
        ...options,
        publicContentProfile: 'full',
        files: [{ path: 'homebrew/a.xml', base64: 'YWxwaGE=' }],
      }),
    ]);

    expect(variants.every(({ key }) => key !== baseline.key)).toBe(true);
  });

  it('disables snapshot reuse when the complete engine version is absent', async () => {
    await expect(
      createFastStartIdentity({
        engineVersion: '',
        publicContentProfile: 'public-base',
        files: [],
      })
    ).resolves.toBeNull();
  });
});

describe('Local Fast Start snapshot validation', () => {
  it('accepts an exact manifest and body hash match', async () => {
    const identity = await createFastStartIdentity({
      ...options,
      files: [],
    });
    const record = await createFastStartRecord({
      identity,
      body: new Uint8Array([1, 2, 3, 4]),
      engineMetadata: {
        ...engineMetadata,
        key: 'engine-must-not-override-key',
        engineVersion: 'engine-must-not-override-version',
        unexpectedEngineField: 'must not be persisted',
      },
      now: 123,
    });

    expect(record).toMatchObject({
      key: identity.key,
      createdAt: 123,
      manifest: {
        ...identity,
        bodyBytes: 4,
        elementCount: 100,
        engineVersion: options.engineVersion,
      },
    });
    expect(record.manifest).not.toHaveProperty('unexpectedEngineField');
    await expect(
      validateFastStartRecord(record, identity)
    ).resolves.toEqual({
      valid: true,
      reason: null,
      body: expect.any(Uint8Array),
    });
  });

  it('rejects stale, truncated, and hash-tampered records', async () => {
    const identity = await createFastStartIdentity({
      ...options,
      files: [],
    });
    const record = await createFastStartRecord({
      identity,
      body: new Uint8Array([1, 2, 3, 4]),
      engineMetadata,
    });
    const stale = structuredClone(record);
    stale.manifest.engineVersion = 'old-engine';
    const truncated = structuredClone(record);
    truncated.body = new Uint8Array([1, 2]);
    const tampered = structuredClone(record);
    tampered.body = new Uint8Array([4, 3, 2, 1]);

    await expect(validateFastStartRecord(stale, identity)).resolves.toMatchObject({
      valid: false,
      reason: 'manifest does not match the expected snapshot identity',
    });
    await expect(
      validateFastStartRecord(truncated, identity)
    ).resolves.toMatchObject({
      valid: false,
      reason: 'snapshot body length does not match its manifest',
    });
    await expect(
      validateFastStartRecord(tampered, identity)
    ).resolves.toMatchObject({
      valid: false,
      reason: 'snapshot body hash does not match its manifest',
    });
  });

  it('rejects an oversized declared Blob before reading it into memory', async () => {
    const identity = await createFastStartIdentity({
      ...options,
      files: [],
    });
    let arrayBufferRead = false;
    const oversizedBody = {
      size: 65 * 1024 * 1024,
      arrayBuffer() {
        arrayBufferRead = true;
        throw new Error('must not allocate');
      },
      [Symbol.toStringTag]: 'Blob',
    };
    const record = {
      key: identity.key,
      manifest: {
        ...identity,
        ...engineMetadata,
        bodyBytes: oversizedBody.size,
        bodyHash: `sha256:${'c'.repeat(64)}`,
      },
      body: oversizedBody,
    };

    await expect(
      validateFastStartRecord(record, identity)
    ).resolves.toMatchObject({
      valid: false,
      reason: 'snapshot body exceeds the 64 MiB safety limit',
    });
    expect(arrayBufferRead).toBe(false);
  });

  it('rejects an oversized new snapshot before reading, hashing, or copying its body', async () => {
    const identity = await createFastStartIdentity({
      ...options,
      files: [],
    });
    let arrayBufferRead = false;
    class OversizedSnapshotBlob extends Blob {
      get size() {
        return MAX_FAST_START_BODY_BYTES + 1;
      }

      async arrayBuffer() {
        arrayBufferRead = true;
        return new ArrayBuffer(0);
      }
    }

    await expect(
      createFastStartRecord({
        identity,
        body: new OversizedSnapshotBlob(),
        engineMetadata,
      }),
    ).rejects.toThrow(/64 MiB safety limit/i);
    expect(arrayBufferRead).toBe(false);
  });

  it('rejects incomplete or tampered engine metadata', async () => {
    const identity = await createFastStartIdentity({
      ...options,
      files: [],
    });
    await expect(
      createFastStartRecord({
        identity,
        body: new Uint8Array([1, 2, 3]),
        engineMetadata: { elementCount: 100 },
      }),
    ).rejects.toThrow(/complete engine snapshot metadata/i);

    const record = await createFastStartRecord({
      identity,
      body: new Uint8Array([1, 2, 3]),
      engineMetadata,
    });
    record.manifest.bodyCodec = 'unreviewed-codec';
    await expect(
      validateFastStartRecord(record, identity),
    ).resolves.toMatchObject({
      valid: false,
      reason: 'manifest engine metadata is incomplete or unsupported',
    });
  });
});

describe('fast start engine identity policy', () => {
  it('appends the build fingerprint to the engine version', async () => {
    const { resolveFastStartEngineVersion } = await import('../fastStartSnapshot.js');
    expect(resolveFastStartEngineVersion({ dev: false, fingerprint: 'abc123' }, '0.0.1')).toBe('0.0.1+abc123');
    expect(resolveFastStartEngineVersion({ dev: true, fingerprint: 'abc123' }, '0.0.1')).toBe('0.0.1+abc123');
  });

  it('disables snapshots in dev without a fingerprint unless explicitly enabled', async () => {
    const { resolveFastStartEngineVersion } = await import('../fastStartSnapshot.js');
    expect(resolveFastStartEngineVersion({ dev: true }, '0.0.1')).toBeNull();
    expect(resolveFastStartEngineVersion({ dev: true, override: '1' }, '0.0.1')).toBe('0.0.1');
    expect(resolveFastStartEngineVersion({ dev: false }, '0.0.1')).toBe('0.0.1');
  });

  it('honors the kill switch and requires an engine version', async () => {
    const { resolveFastStartEngineVersion } = await import('../fastStartSnapshot.js');
    expect(resolveFastStartEngineVersion({ dev: false, fingerprint: 'abc', override: '0' }, '0.0.1')).toBeNull();
    expect(resolveFastStartEngineVersion({ dev: false, fingerprint: 'abc' }, null)).toBeNull();
  });
});
