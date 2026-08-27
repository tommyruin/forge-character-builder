import { describe, expect, it } from 'vitest';

import {
  CHARACTER_LOAD_BODY_CODEC,
  CHARACTER_LOAD_FORMAT,
  CHARACTER_LOAD_SCHEMA_VERSION,
  MAX_CHARACTER_LOAD_BODY_BYTES,
  createCharacterLoadIdentity,
  createCharacterLoadRecord,
  validateCharacterLoadRecord,
} from '../characterLoadSnapshot.js';

const libraryIdentity = {
  key: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  engineVersion: 'engine-v1',
  publicContentProfile: 'public-base',
  parserRevision: 'finalized-library-v2',
  sourceDigest:
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

describe('local character-load snapshots', () => {
  it('keys an exact character XML document to the complete rules identity', async () => {
    const identity = await createCharacterLoadIdentity({
      characterId: 'aria',
      xml: '<character id="aria" />',
      libraryIdentity,
    });

    expect(identity).toMatchObject({
      format: CHARACTER_LOAD_FORMAT,
      schemaVersion: CHARACTER_LOAD_SCHEMA_VERSION,
      bodyCodec: CHARACTER_LOAD_BODY_CODEC,
      characterId: 'aria',
      engineVersion: 'engine-v1',
      publicContentProfile: 'public-base',
      libraryKey: libraryIdentity.key,
    });
    expect(identity.characterXmlHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(identity.key).toMatch(/^sha256:[a-f0-9]{64}$/);

    const changed = await createCharacterLoadIdentity({
      characterId: 'aria',
      xml: '<character id="aria" changed="true" />',
      libraryIdentity,
    });
    expect(changed.key).not.toBe(identity.key);
  });

  it('round-trips a bounded binary body and rejects corruption', async () => {
    const identity = await createCharacterLoadIdentity({
      characterId: 'aria',
      xml: '<character id="aria" />',
      libraryIdentity,
    });
    const record = await createCharacterLoadRecord({
      identity,
      body: new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
      engineMetadata: {
        selectionCount: 17,
        elementCount: 149,
        inventoryCount: 30,
        attackCount: 8,
        finalStateDigest:
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      now: 123,
    });

    await expect(
      validateCharacterLoadRecord(record, identity),
    ).resolves.toMatchObject({
      valid: true,
      body: new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
    });

    const corrupt = {
      ...record,
      body: new Blob([new Uint8Array([31, 139, 8, 0, 9, 9, 9])]),
    };
    await expect(
      validateCharacterLoadRecord(corrupt, identity),
    ).resolves.toEqual({
      valid: false,
      reason: 'character snapshot body hash does not match its manifest',
    });
  });

  it('rejects oversized bodies before copying or hashing them', async () => {
    const identity = await createCharacterLoadIdentity({
      characterId: 'aria',
      xml: '<character id="aria" />',
      libraryIdentity,
    });
    await expect(
      createCharacterLoadRecord({
        identity,
        body: new Blob([
          new Uint8Array(MAX_CHARACTER_LOAD_BODY_BYTES + 1),
        ]),
        engineMetadata: {
          selectionCount: 1,
          elementCount: 1,
          inventoryCount: 0,
          attackCount: 0,
          finalStateDigest:
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
      }),
    ).rejects.toThrow(/exceeds the 4 MiB safety limit/i);
  });
});
