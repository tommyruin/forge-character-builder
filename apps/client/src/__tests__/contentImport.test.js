import { strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ContentImportError,
  describeWebLocation,
  findGitHubUpdates,
  normalizeImportPath,
  parseIndexEntries,
  resolveFolderSource,
  resolveWebSource,
} from '../contentImport.js';

const elementsXml = (name = 'Test') =>
  `<?xml version="1.0"?><elements><element name="${name}" type="Feat" source="Test" id="ID_TEST_${name.toUpperCase()}" /></elements>`;

const indexXml = (entries) => `<?xml version="1.0"?><index>
  <info><name>Test</name><update version="1.0"><file name="test.index" url="https://example.test/test.index" /></update></info>
  <files>${entries}</files>
</index>`;

const supplementsCommentFixture = readFileSync(
  new URL('./fixtures/supplements-comment.index', import.meta.url),
  'utf8'
);

function fakeFile(name, content, webkitRelativePath = name) {
  const bytes = strToU8(content);
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

describe('content import paths and manifests', () => {
  it('normalizes safe paths and rejects traversal', () => {
    expect(normalizeImportPath('./book\\spells.xml')).toBe('book/spells.xml');
    expect(() => normalizeImportPath('../secrets.xml')).toThrow(
      ContentImportError
    );
    expect(() => normalizeImportPath('/absolute.xml')).toThrow(
      ContentImportError
    );
  });

  it('reads files and ignores obsolete manifest entries', () => {
    const entries = parseIndexEntries(
      indexXml(
        '<file name="spells.xml" url="https://example.test/spells.xml" />' +
          '<obsolete name="old.xml" url="https://example.test/old.xml" />'
      )
    );
    expect(entries).toEqual([
      {
        name: 'spells.xml',
        url: 'https://example.test/spells.xml',
        obsolete: false,
      },
      {
        name: 'old.xml',
        url: 'https://example.test/old.xml',
        obsolete: true,
      },
    ]);
  });

  it('ignores file and obsolete entries inside XML comments', () => {
    const entries = parseIndexEntries(supplementsCommentFixture);

    expect(entries).toEqual([
      {
        name: 'active-supplement.xml',
        url: 'https://example.test/active-supplement.xml',
        obsolete: false,
      },
    ]);
  });
});

describe('web location detection', () => {
  it('maps public GitHub and GitLab repository roots to ZIP APIs', () => {
    expect(
      describeWebLocation('https://github.com/example/rules')
    ).toMatchObject({
      kind: 'github',
      label: 'example/rules',
      owner: 'example',
      repo: 'rules',
      downloadUrl: null,
    });
    expect(
      describeWebLocation('https://gitlab.com/group/subgroup/rules.git')
    ).toMatchObject({
      kind: 'gitlab',
      label: 'group/subgroup/rules',
    });
  });

  it('rejects insecure and non-repository Git locations', () => {
    expect(() => describeWebLocation('http://example.com/rules.xml')).toThrow(
      /HTTPS/
    );
    expect(
      describeWebLocation('https://github.com/example/rules/tree/dev').kind
    ).toBe('url');
  });
});

describe('source resolution', () => {
  it('keeps folder structure and downloads missing index children', async () => {
    const fetchImpl = vi.fn(async (url) =>
      response(elementsXml('Spell'), url, 'application/xml')
    );
    const result = await resolveFolderSource(
      [
        fakeFile(
          'book.index',
          indexXml(
            '<file name="spells.xml" url="https://example.test/spells.xml" />'
          ),
          'collection/book.index'
        ),
        fakeFile('notes.txt', 'ignore me', 'collection/notes.txt'),
      ],
      { fetchImpl }
    );

    expect(result.source).toMatchObject({
      kind: 'folder',
      label: 'collection',
      fileCount: 2,
    });
    expect(result.source).not.toHaveProperty('category');
    expect(result.files.map((file) => file.relativePath).sort()).toEqual([
      'book.index',
      'book/spells.xml',
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('satisfies index entries from nested local folders without downloading', async () => {
    // Index-based packs store an index's files in deeper subfolders than the
    // index spells out (players-handbook.index -> races/race-dragonborn.xml).
    // A local folder import must resolve those files from disk, not the network.
    const fetchImpl = vi.fn();
    const result = await resolveFolderSource(
      [
        fakeFile(
          'players-handbook.index',
          indexXml(
            '<file name="race-dragonborn.xml" url="https://example.test/race-dragonborn.xml" />'
          ),
          'core/players-handbook.index'
        ),
        fakeFile(
          'race-dragonborn.xml',
          elementsXml('Race'),
          'core/players-handbook/races/race-dragonborn.xml'
        ),
      ],
      { fetchImpl }
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.files.map((file) => file.relativePath).sort()).toEqual([
      'players-handbook.index',
      'players-handbook/races/race-dragonborn.xml',
    ]);
  });

  it('reuses repository files referenced through their raw GitHub URL', async () => {
    const fetchImpl = vi.fn();
    const result = await resolveFolderSource(
      [
        fakeFile(
          'core.index',
          indexXml(
            '<file name="cleric-light.xml" url="https://raw.githubusercontent.com/example/rules/main/core/archetypes/cleric-light.xml" />'
          ),
          'collection/core.index'
        ),
        fakeFile(
          'cleric-light.xml',
          elementsXml('Light'),
          'collection/core/archetypes/cleric-light.xml'
        ),
      ],
      { fetchImpl }
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.files.map((file) => file.relativePath).sort()).toEqual([
      'core.index',
      'core/archetypes/cleric-light.xml',
    ]);
  });

  it('imports only valid DM Forge files from a GitHub repository tree', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/repos/example/rules')) {
        return response(
          JSON.stringify({ default_branch: 'main' }),
          url,
          'application/json'
        );
      }
      if (url.includes('/git/trees/main')) {
        return response(
          JSON.stringify({
            sha: 'abc123',
            truncated: false,
            tree: [
              { type: 'blob', path: 'feats.xml', size: 100 },
              { type: 'blob', path: 'unrelated.xml', size: 20 },
              { type: 'blob', path: 'readme.md', size: 10 },
            ],
          }),
          url,
          'application/json'
        );
      }
      if (url.endsWith('/feats.xml')) {
        return response(elementsXml('Feat'), url, 'application/xml');
      }
      return response('<project />', url, 'application/xml');
    });
    const existingSource = {
      id: 'source-1',
      label: 'example/rules',
    };
    const result = await resolveWebSource('https://github.com/example/rules', {
      existingSource,
      fetchImpl,
    });

    expect(result.source.id).toBe('source-1');
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'feats.xml',
    ]);
  });

  it('skips stale GitHub index entries that are absent from the repository', async () => {
    const missingUrl =
      'https://raw.githubusercontent.com/example/rules/main/removed.xml';
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/repos/example/rules')) {
        return response(
          JSON.stringify({ default_branch: 'main' }),
          url,
          'application/json'
        );
      }
      if (url.includes('/git/trees/main')) {
        return response(
          JSON.stringify({
            sha: 'abc123',
            truncated: false,
            tree: [{ type: 'blob', path: 'rules.index', size: 100 }],
          }),
          url,
          'application/json'
        );
      }
      if (url.endsWith('/rules.index')) {
        return response(
          indexXml(`<file name="removed.xml" url="${missingUrl}" />`),
          url,
          'application/xml'
        );
      }
      throw new Error(`Unexpected download: ${url}`);
    });

    const result = await resolveWebSource(
      'https://github.com/example/rules',
      { fetchImpl }
    );

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'rules.index',
    ]);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      missingUrl,
      expect.anything()
    );
  });

  it('leaves the previous source untouched when a download fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    await expect(
      resolveWebSource('https://example.test/rules.index', { fetchImpl })
    ).rejects.toMatchObject({ code: 'download-failed' });
  });

  it('never downloads a commented-out missing index child', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/rules.index')) {
        return response(
          indexXml(
            '<!-- <file name="missing.xml" url="https://example.test/missing.xml" /> -->' +
              '<file name="active.xml" url="https://example.test/active.xml" />'
          ),
          url,
          'application/xml'
        );
      }
      if (url.endsWith('/active.xml')) {
        return response(elementsXml('Active'), url, 'application/xml');
      }
      throw new Error(`Unexpected download: ${url}`);
    });

    const result = await resolveWebSource(
      'https://example.test/rules.index',
      { fetchImpl }
    );

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'rules.index',
      'rules/active.xml',
    ]);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      'https://example.test/missing.xml',
      expect.anything()
    );
  });

  it('continues resolving active nested indexes', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/root.index')) {
        return response(
          indexXml(
            '<file name="nested.index" url="https://example.test/nested.index" />'
          ),
          url,
          'application/xml'
        );
      }
      if (url.endsWith('/nested.index')) {
        return response(
          indexXml(
            '<file name="active.xml" url="https://example.test/active.xml" />'
          ),
          url,
          'application/xml'
        );
      }
      if (url.endsWith('/active.xml')) {
        return response(elementsXml('Nested'), url, 'application/xml');
      }
      throw new Error(`Unexpected download: ${url}`);
    });

    const result = await resolveWebSource(
      'https://example.test/root.index',
      { fetchImpl }
    );

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'root.index',
      'root/nested.index',
      'root/nested/active.xml',
    ]);
  });

  it('identifies the failed child and referring index in download errors', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/rules.index')) {
        return response(
          indexXml(
            '<file name="missing.xml" url="https://example.test/missing.xml" />'
          ),
          url,
          'application/xml'
        );
      }
      return new Response('', { status: 404 });
    });

    await expect(
      resolveWebSource('https://example.test/rules.index', { fetchImpl })
    ).rejects.toThrow(
      /missing\.xml.*HTTP 404.*rules\.index|rules\.index.*missing\.xml.*HTTP 404/i
    );
  });

  it('rejects unsafe paths before stripping an archive root', async () => {
    const archive = zipSync({
      'rules-main/../../escape.xml': strToU8(elementsXml('Escape')),
    });
    const fetchImpl = vi.fn(async (url) =>
      response(archive, url, 'application/zip')
    );
    await expect(
      resolveWebSource('https://example.test/rules.zip', { fetchImpl })
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });
  describe('GitHub update checks', () => {
    const githubFetch = (treeSha = 'tree-1') =>
      vi.fn(async (url) => {
        if (url.endsWith('/repos/example/rules')) {
          return response(JSON.stringify({ default_branch: 'main' }), url, 'application/json');
        }
        if (url.includes('/git/trees/main')) {
          return response(
            JSON.stringify({ sha: treeSha, truncated: false, tree: [{ type: 'blob', path: 'feats.xml', size: 100 }] }),
            url,
            'application/json'
          );
        }
        return response(elementsXml('Feat'), url, 'application/xml');
      });
    const headFetch = (status, treeSha) =>
      vi.fn(async () =>
        status === 200
          ? new Response(JSON.stringify({ commit: { commit: { tree: { sha: treeSha } } } }), { status })
          : new Response('{}', { status })
      );
    const stored = (extra = {}) => ({
      id: 's1',
      kind: 'github',
      label: 'example/rules',
      location: 'https://github.com/example/rules',
      branch: 'main',
      revision: 'tree-1',
      ...extra,
    });

    it('stores the branch and tree sha on a GitHub source, and none on other sources', async () => {
      const github = await resolveWebSource('https://github.com/example/rules', { fetchImpl: githubFetch('tree-9') });
      expect(github.source).toMatchObject({ kind: 'github', branch: 'main', revision: 'tree-9' });
      const plain = await resolveWebSource('https://example.test/feats.xml', {
        fetchImpl: vi.fn(async (url) => response(elementsXml('Feat'), url, 'application/xml')),
      });
      expect(plain.source).not.toHaveProperty('revision');
      expect(plain.source).not.toHaveProperty('branch');
    });

    it('flags a source whose branch head differs, and not one that matches', async () => {
      const changed = headFetch(200, 'tree-2');
      expect(await findGitHubUpdates([stored()], { fetchImpl: changed, cache: new Map() })).toEqual(['s1']);
      expect(changed.mock.calls[0][0]).toBe('https://api.github.com/repos/example/rules/branches/main');
      expect(await findGitHubUpdates([stored()], { fetchImpl: headFetch(200, 'tree-1'), cache: new Map() })).toEqual([]);
    });

    it('asks once per repository and branch, and once per session', async () => {
      const fetchImpl = headFetch(200, 'tree-2');
      const cache = new Map();
      const sources = [stored(), stored({ id: 's2' }), stored({ id: 's3', location: 'https://github.com/example/other' })];
      expect(await findGitHubUpdates(sources, { fetchImpl, cache })).toEqual(['s1', 's2', 's3']);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await findGitHubUpdates(sources, { fetchImpl, cache });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it.each([403, 404, 429, 500])('ignores an HTTP %i answer', async (status) => {
      expect(await findGitHubUpdates([stored()], { fetchImpl: headFetch(status), cache: new Map() })).toEqual([]);
    });

    it('ignores being offline, odd responses, sources without a revision and non-GitHub sources', async () => {
      const offline = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await findGitHubUpdates([stored()], { fetchImpl: offline, cache: new Map() })).toEqual([]);
      const odd = vi.fn(async () => new Response('not json', { status: 200 }));
      expect(await findGitHubUpdates([stored()], { fetchImpl: odd, cache: new Map() })).toEqual([]);
      const fetchImpl = headFetch(200, 'tree-2');
      const sources = [
        stored({ id: 'old', revision: undefined }),
        { id: 'url', kind: 'url', location: 'https://example.test/a.xml' },
        { id: 'folder', kind: 'folder', location: null },
      ];
      expect(await findGitHubUpdates(sources, { fetchImpl, cache: new Map() })).toEqual([]);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
