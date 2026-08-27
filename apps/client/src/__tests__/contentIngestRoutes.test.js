import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveFilesSource,
  resolveFolderSource,
  resolveWebSource,
} from '../contentImport.js';
import { createEngineApi } from '../transport/engineTransport.ts';

// The folder and web importers hand the transport already-read byte candidates,
// while the file picker hands it browser File handles. Both seams are exercised
// here end to end: a shape mismatch between the two layers would crash every
// tracked import with "file.arrayBuffer is not a function".

const elementsXml = (id) =>
  `<?xml version="1.0"?><elements><element name="${id}" type="Feat" source="Test" id="ID_${id.toUpperCase()}" /></elements>`;

const indexXml = (entries) =>
  `<?xml version="1.0"?><index><info><name>Test</name></info><files>${entries}</files></index>`;

function fakeFile(name, content, webkitRelativePath = name) {
  const bytes = typeof content === 'string' ? strToU8(content) : content;
  return {
    name,
    webkitRelativePath,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function response(body, url, contentType = 'application/octet-stream') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

/** Minimal engine + store pair that records what content actually reaches them. */
function ingestHarness() {
  const liveFiles = new Map();
  let records = [];
  const client = {
    boot: vi.fn(async () => ({ elementCount: liveFiles.size, fileCount: liveFiles.size })),
    contentStatus: vi.fn(async () => ({ elementCount: liveFiles.size, fileCount: liveFiles.size })),
    ingestUploaded: vi.fn(async ({ files }) => {
      for (const file of files) liveFiles.set(file.path, file.base64);
      return { elementCount: liveFiles.size };
    }),
    removeUploaded: vi.fn(async ({ paths }) => {
      for (const path of paths) liveFiles.delete(path);
      return { elementCount: liveFiles.size };
    }),
  };
  let sources = [];
  const store = {
    listContent: vi.fn(async () => records.map((record) => ({ ...record }))),
    putContentBatch: vi.fn(async (next) => {
      records = [...records, ...next];
    }),
    deleteContentBatch: vi.fn(async () => []),
    listContentSources: vi.fn(async () => sources.map((source) => ({ ...source }))),
    replaceContentSource: vi.fn(async (source, next) => {
      const previous = records.filter((record) => record.sourceId === source.id);
      records = [
        ...records.filter((record) => record.sourceId !== source.id),
        ...next.map((record) => ({ ...record, sourceId: source.id })),
      ];
      sources = [...sources.filter((tracked) => tracked.id !== source.id), { ...source }];
      return previous;
    }),
    removeContentSource: vi.fn(async () => []),
    removeContentSources: vi.fn(async () => []),
    getMeta: vi.fn(async () => []),
    listCharacters: vi.fn(async () => []),
  };
  return { api: createEngineApi({ client, store }), client, store, liveFiles };
}

function decode(base64) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
  );
}

describe('content ingest routes reach the engine', () => {
  it('imports a chosen folder, keeping its structure', async () => {
    const { api, liveFiles } = ingestHarness();
    const files = [
      fakeFile('spells.xml', elementsXml('spell'), 'elements/core/spells.xml'),
      fakeFile('races.xml', elementsXml('race'), 'elements/core/races.xml'),
      fakeFile('notes.txt', 'ignored', 'elements/notes.txt'),
    ];

    const resolved = await resolveFolderSource(files, {
      fetchImpl: async () => {
        throw new Error('folder imports must not need the network');
      },
    });
    expect(resolved.skippedCount).toBe(1);

    const result = await api.content.replaceSource(resolved.files, resolved.source);

    expect(result.status).toBe('succeeded');
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'core/spells.xml',
      'core/races.xml',
    ]);
    expect(decode(liveFiles.get(`imports/${resolved.source.id}/core/spells.xml`))).toBe(
      elementsXml('spell'),
    );
  });

  it('imports index-driven folders together with their downloaded children', async () => {
    const { api, liveFiles } = ingestHarness();
    const childUrl = 'https://example.test/book/feat-lucky.xml';
    const fetchImpl = vi.fn(async (url) =>
      url === childUrl
        ? response(strToU8(elementsXml('lucky')), url)
        : Promise.reject(new Error(`unexpected fetch: ${url}`)),
    );
    const files = [
      fakeFile(
        'book.index',
        indexXml(`<file name="feat-lucky.xml" url="${childUrl}" />`),
        'elements/book.index',
      ),
      fakeFile('classes.xml', elementsXml('class'), 'elements/book/classes.xml'),
    ];

    const resolved = await resolveFolderSource(files, { fetchImpl });
    const result = await api.content.replaceSource(resolved.files, resolved.source);

    expect(fetchImpl).toHaveBeenCalledWith(childUrl, expect.anything());
    expect(result.files.map((file) => file.relativePath).sort()).toEqual([
      'book.index',
      'book/classes.xml',
      'book/feat-lucky.xml',
    ]);
    expect(decode(liveFiles.get(`imports/${resolved.source.id}/book/feat-lucky.xml`))).toBe(
      elementsXml('lucky'),
    );
  });

  it('imports a GitHub repository tree', async () => {
    const { api, liveFiles } = ingestHarness();
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'https://api.github.com/repos/example/elements') {
        return response(JSON.stringify({ default_branch: 'master' }), url, 'application/json');
      }
      if (url === 'https://api.github.com/repos/example/elements/git/trees/master?recursive=1') {
        return response(
          JSON.stringify({
            sha: 'treesha',
            truncated: false,
            tree: [
              { type: 'blob', path: 'core/spells.xml', size: 128 },
              { type: 'blob', path: 'README.md', size: 32 },
            ],
          }),
          url,
          'application/json',
        );
      }
      if (url === 'https://raw.githubusercontent.com/example/elements/treesha/core/spells.xml') {
        return response(strToU8(elementsXml('spell')), url);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const resolved = await resolveWebSource('https://github.com/example/elements', {
      fetchImpl,
    });
    const result = await api.content.replaceSource(resolved.files, resolved.source);

    expect(resolved.source).toMatchObject({ kind: 'github', label: 'example/elements' });
    expect(result.files.map((file) => file.relativePath)).toEqual(['core/spells.xml']);
    expect(decode(liveFiles.get(`imports/${resolved.source.id}/core/spells.xml`))).toBe(
      elementsXml('spell'),
    );
  });

  it('imports a downloaded ZIP archive', async () => {
    const { api, liveFiles } = ingestHarness();
    const archive = zipSync({
      'elements-master/core/spells.xml': strToU8(elementsXml('spell')),
      'elements-master/README.md': strToU8('ignored'),
    });
    const fetchImpl = vi.fn(async (url) =>
      response(archive, url, 'application/zip'),
    );

    const resolved = await resolveWebSource(
      'https://example.test/elements-master.zip',
      { fetchImpl },
    );
    const result = await api.content.replaceSource(resolved.files, resolved.source);

    expect(result.files.map((file) => file.relativePath)).toEqual(['core/spells.xml']);
    expect(decode(liveFiles.get(`imports/${resolved.source.id}/core/spells.xml`))).toBe(
      elementsXml('spell'),
    );
  });

  it('imports individually chosen files through the untracked route', async () => {
    const { api, liveFiles } = ingestHarness();

    const result = await api.content.upload(
      [fakeFile('feats.xml', elementsXml('feat'))],
      null,
      { sourceId: 'chosen' },
    );

    expect(result.status).toBe('succeeded');
    expect(decode(liveFiles.get('imports/chosen/feats.xml'))).toBe(elementsXml('feat'));
  });

  it('resolves the references of an individually chosen index file', async () => {
    const { api, liveFiles } = ingestHarness();
    const childUrl = 'https://example.test/pack/feat-lucky.xml';
    const fetchImpl = vi.fn(async (url) =>
      url === childUrl
        ? response(strToU8(elementsXml('lucky')), url)
        : Promise.reject(new Error(`unexpected fetch: ${url}`)),
    );

    const resolved = await resolveFilesSource(
      [fakeFile('pack.index', indexXml(`<file name="feat-lucky.xml" url="${childUrl}" />`))],
      { fetchImpl },
    );
    const result = await api.content.replaceSource(resolved.files, resolved.source);

    expect(resolved.source).toMatchObject({ kind: 'files', fileCount: 2 });
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'pack.index',
      'pack/feat-lucky.xml',
    ]);
    expect(decode(liveFiles.get(`imports/${resolved.source.id}/pack/feat-lucky.xml`))).toBe(
      elementsXml('lucky'),
    );
  });

  it('downloads only the index children the selection is missing', async () => {
    const { api, liveFiles } = ingestHarness();
    const base = 'https://example.test/pack';
    const fetchImpl = vi.fn(async (url) =>
      url === `${base}/feat-two.xml`
        ? response(strToU8(elementsXml('two')), url)
        : Promise.reject(new Error(`unexpected fetch: ${url}`)),
    );

    // A picked selection is flat, so feat-one.xml sits beside the index rather
    // than in the folder it names; it must satisfy the entry as-is.
    const resolved = await resolveFilesSource(
      [
        fakeFile(
          'pack.index',
          indexXml(
            `<file name="feat-one.xml" url="${base}/feat-one.xml" />` +
              `<file name="feat-two.xml" url="${base}/feat-two.xml" />`,
          ),
        ),
        fakeFile('feat-one.xml', elementsXml('one')),
      ],
      { fetchImpl },
    );
    await api.content.replaceSource(resolved.files, resolved.source);

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${base}/feat-two.xml`]);
    expect(resolved.files.map((file) => file.relativePath)).toEqual([
      'pack.index',
      'feat-one.xml',
      'pack/feat-two.xml',
    ]);
    expect([...liveFiles.keys()]).toEqual([
      `imports/${resolved.source.id}/pack.index`,
      `imports/${resolved.source.id}/feat-one.xml`,
      `imports/${resolved.source.id}/pack/feat-two.xml`,
    ]);
  });

  it('passes chosen files the importer does not recognize through to the engine', async () => {
    const { api, liveFiles } = ingestHarness();
    const archive = zipSync({ 'core/zipped.xml': strToU8(elementsXml('zipped')) });
    const homebrewLike = '<?xml version="1.0"?><collection><element /></collection>';

    // A ZIP bundle and a non-<elements> XML are both the engine's business to
    // accept or report on, so the files route must not quietly drop them.
    const resolved = await resolveFilesSource([
      fakeFile('feats.xml', elementsXml('feat')),
      fakeFile('bundle.zip', archive),
      fakeFile('odd.xml', homebrewLike),
    ]);
    const result = await api.content.replaceSource(resolved.files, resolved.source);

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'feats.xml',
      'bundle.zip',
      'odd.xml',
    ]);
    expect(decode(liveFiles.get(`imports/${resolved.source.id}/odd.xml`))).toBe(homebrewLike);
    expect(liveFiles.get(`imports/${resolved.source.id}/bundle.zip`)).toBe(
      btoa(String.fromCharCode(...archive)),
    );
  });

  it('reports a repeat import of the same content as a duplicate', async () => {
    const { api } = ingestHarness();
    const files = [fakeFile('feats.xml', elementsXml('feat'))];

    const first = await resolveFilesSource(files);
    expect((await api.content.replaceSource(first.files, first.source)).status).toBe('succeeded');

    const second = await resolveFilesSource(files);
    const repeat = await api.content.replaceSource(second.files, second.source);

    expect(repeat.status).toBe('duplicate');
    expect(repeat.duplicate.matches.map((source) => source.id)).toEqual([first.source.id]);
    expect(repeat.duplicate.relativePaths).toEqual(['feats.xml']);
  });
});
