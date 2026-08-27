import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RAW_CONTENT_PACK_FORMAT,
  RAW_CONTENT_PACK_SCHEMA_VERSION,
  createRawContentPack,
  extractRawContentPack,
  inspectRawContentPack,
  validateRawContentPack,
} from '../rawContentPack.js';

const files = [
  {
    path: 'rules/z-last.xml',
    base64: btoa('<elements><element name="Last" /></elements>'),
    uploadedAt: 200,
  },
  {
    path: 'rules/a-first.index',
    base64: btoa('<index />'),
    uploadedAt: 100,
  },
];

describe('local raw content packs', () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTimezone;
  });

  it('creates deterministic ZIP bytes and ordered hashes', async () => {
    const first = await createRawContentPack(files, { now: 10 });
    const second = await createRawContentPack(
      [
        { ...files[1], uploadedAt: 999 },
        { ...files[0], uploadedAt: 888 },
      ],
      { now: 20 },
    );

    expect(first).toMatchObject({
      key: 'current',
      createdAt: 10,
      manifest: {
        format: RAW_CONTENT_PACK_FORMAT,
        schemaVersion: RAW_CONTENT_PACK_SCHEMA_VERSION,
        fileCount: 2,
        orderedFileHashes: [
          {
            path: 'rules/a-first.index',
            hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
          {
            path: 'rules/z-last.xml',
            hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        ],
        bodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        bodyBytes: expect.any(Number),
      },
      body: expect.any(Blob),
    });
    expect(
      new Uint8Array(await first.body.arrayBuffer()),
    ).toEqual(new Uint8Array(await second.body.arrayBuffer()));
    expect(first.manifest).toEqual(second.manifest);
  });

  it.each(['America/Los_Angeles', 'Pacific/Honolulu'])(
    'uses a valid deterministic ZIP timestamp in %s',
    async (timezone) => {
      process.env.TZ = timezone;

      await expect(createRawContentPack(files)).resolves.toMatchObject({
        manifest: {
          bodyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      });
    },
  );

  it('round-trips supported content in deterministic path order', async () => {
    const record = await createRawContentPack(files);
    const inspection = await inspectRawContentPack(record);

    expect(inspection).toMatchObject({
      valid: true,
      reason: null,
      fileCount: 2,
      orderedFileHashes: record.manifest.orderedFileHashes,
      sourceDigest: record.manifest.sourceDigest,
      body: expect.any(Uint8Array),
    });
    await expect(extractRawContentPack(inspection)).resolves.toEqual({
      valid: true,
      reason: null,
      files: [
        {
          path: 'rules/a-first.index',
          base64: files[1].base64,
        },
        {
          path: 'rules/z-last.xml',
          base64: files[0].base64,
        },
      ],
    });
    await expect(validateRawContentPack(record)).resolves.toEqual({
      valid: true,
      reason: null,
      files: expect.any(Array),
    });
  });

  it('rejects duplicate, unsafe, and unsupported paths before packing', async () => {
    await expect(
      createRawContentPack([
        { path: '../escape.xml', base64: btoa('<elements />') },
      ]),
    ).rejects.toThrow(/unsafe content path/i);
    await expect(
      createRawContentPack([
        { path: 'same.xml', base64: btoa('<elements />') },
        { path: 'same.xml', base64: btoa('<elements />') },
      ]),
    ).rejects.toThrow(/duplicate content path/i);
    await expect(
      createRawContentPack([
        { path: 'notes.txt', base64: btoa('not rules') },
      ]),
    ).rejects.toThrow(/unsupported content path/i);
  });

  it('rejects truncated and hash-tampered packs without returning files', async () => {
    const record = await createRawContentPack(files);
    const truncated = structuredClone(record);
    const bytes = new Uint8Array(await truncated.body.arrayBuffer());
    truncated.body = new Blob([bytes.subarray(0, bytes.length - 2)]);
    const tampered = structuredClone(record);
    const changed = new Uint8Array(await tampered.body.arrayBuffer());
    changed[changed.length - 1] ^= 0xff;
    tampered.body = new Blob([changed]);

    await expect(validateRawContentPack(truncated)).resolves.toMatchObject({
      valid: false,
      reason: 'raw content pack length does not match its manifest',
    });
    await expect(validateRawContentPack(tampered)).resolves.toMatchObject({
      valid: false,
      reason: 'raw content pack hash does not match its manifest',
    });
  });
});
