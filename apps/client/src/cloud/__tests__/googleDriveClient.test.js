import { describe, expect, it, vi } from 'vitest';
import {
  DM_FORGE_FOLDER_NAME,
  DM_FORGE_LIBRARY_NAME,
  GoogleDriveAuthError,
  createGoogleDriveClient,
} from '../googleDriveClient.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createClient(fetchImpl, options = {}) {
  return createGoogleDriveClient({
    fetchImpl,
    getAccessToken: () => 'access-token',
    ...options,
  });
}

describe('createGoogleDriveClient', () => {
  it('lists every Drive page with an authenticated drive-space query', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          files: [{ id: 'one', name: 'One' }],
          nextPageToken: 'next-page',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ files: [{ id: 'two', name: 'Two' }] })
      );
    const drive = createClient(fetchImpl);

    const files = await drive.listFiles({
      q: "appProperties has { key='kind' and value='character' }",
    });

    expect(files.map((file) => file.id)).toEqual(['one', 'two']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(new URL(url).searchParams.get('spaces')).toBe('drive');
      expect(init.headers.get('Authorization')).toBe('Bearer access-token');
    }
    expect(
      new URL(fetchImpl.mock.calls[1][0]).searchParams.get('pageToken')
    ).toBe('next-page');
  });

  it('finds or creates a visible DM Forge folder', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'folder-1',
          name: DM_FORGE_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
        })
      );
    const drive = createClient(fetchImpl);

    const folder = await drive.ensureFolder();

    expect(folder.id).toBe('folder-1');
    const [url, init] = fetchImpl.mock.calls[2];
    expect(new URL(url).pathname).toBe('/drive/v3/files');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      name: DM_FORGE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        dmForgeManaged: 'true',
        dmForgeType: 'folder',
      },
    });
  });

  it('finds the managed library by its private app properties', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        files: [
          {
            id: 'library-1',
            name: DM_FORGE_LIBRARY_NAME,
            version: '7',
          },
        ],
      })
    );
    const drive = createClient(fetchImpl);

    const library = await drive.findManagedLibrary('folder-1');

    expect(library.id).toBe('library-1');
    const query = new URL(fetchImpl.mock.calls[0][0]).searchParams.get('q');
    expect(query).toContain("'folder-1' in parents");
    expect(query).toContain(
      "appProperties has { key='dmForgeType' and value='library' }"
    );
    expect(query).toContain('trashed = false');
  });

  it('creates and updates library JSON with multipart uploads', async () => {
    const createdMetadata = {
      id: 'library-1',
      name: DM_FORGE_LIBRARY_NAME,
      modifiedTime: '2026-07-25T12:00:00Z',
      version: '1',
    };
    const updatedMetadata = { ...createdMetadata, version: '2' };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(createdMetadata))
      .mockResolvedValueOnce(jsonResponse(updatedMetadata));
    const drive = createClient(fetchImpl);
    const document = {
      format: 'dm-forge-drive-snapshot',
      version: 1,
      characters: [{ id: 'character-1' }],
    };

    await expect(
      drive.saveLibrary(document, null, { folderId: 'folder-1' })
    ).resolves.toEqual(createdMetadata);
    await expect(
      drive.saveLibrary(document, createdMetadata)
    ).resolves.toEqual(updatedMetadata);

    const [createUrl, createInit] = fetchImpl.mock.calls[0];
    expect(createInit.method).toBe('POST');
    expect(new URL(createUrl).pathname).toBe('/upload/drive/v3/files');
    expect(new URL(createUrl).searchParams.get('uploadType')).toBe('multipart');
    expect(createInit.headers.get('Content-Type')).toMatch(
      /^multipart\/related; boundary=/
    );
    expect(createInit.body).toContain(`"name":"${DM_FORGE_LIBRARY_NAME}"`);
    expect(createInit.body).toContain('"parents":["folder-1"]');
    expect(createInit.body).toContain(JSON.stringify(document));

    const [updateUrl, updateInit] = fetchImpl.mock.calls[1];
    expect(updateInit.method).toBe('PATCH');
    expect(new URL(updateUrl).pathname).toBe(
      '/upload/drive/v3/files/library-1'
    );
    expect(updateInit.body).toContain(JSON.stringify(document));
  });

  it('uses a resumable session above the safe multipart limit', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            Location:
              'https://www.googleapis.com/upload/drive/v3/files?upload_id=session-1',
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'library-1',
          name: DM_FORGE_LIBRARY_NAME,
          version: '1',
        })
      );
    const drive = createClient(fetchImpl, { multipartMaxBytes: 128 });
    const document = { content: 'x'.repeat(256) };

    await expect(
      drive.saveLibrary(document, null, { folderId: 'folder-1' })
    ).resolves.toMatchObject({ id: 'library-1', version: '1' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [sessionUrl, sessionInit] = fetchImpl.mock.calls[0];
    expect(new URL(sessionUrl).searchParams.get('uploadType')).toBe(
      'resumable'
    );
    expect(sessionInit.method).toBe('POST');
    expect(sessionInit.headers.get('X-Upload-Content-Type')).toBe(
      'application/json'
    );
    expect(
      Number(sessionInit.headers.get('X-Upload-Content-Length'))
    ).toBeGreaterThan(128);
    expect(JSON.parse(sessionInit.body)).toMatchObject({
      name: DM_FORGE_LIBRARY_NAME,
      parents: ['folder-1'],
    });

    const [uploadUrl, uploadInit] = fetchImpl.mock.calls[1];
    expect(uploadUrl).toContain('upload_id=session-1');
    expect(uploadInit.method).toBe('PUT');
    expect(uploadInit.headers.get('Content-Type')).toBe('application/json');
    expect(uploadInit.body).toBe(JSON.stringify(document));
  });

  it('downloads JSON and returns Drive user metadata', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ version: 1, characters: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            displayName: 'Ada Adventurer',
            emailAddress: 'ada@example.com',
            photoLink: 'https://example.com/ada.png',
          },
        })
      );
    const drive = createClient(fetchImpl);

    await expect(drive.downloadJson('library-1')).resolves.toEqual({
      version: 1,
      characters: [],
    });
    await expect(drive.getUserMetadata()).resolves.toMatchObject({
      displayName: 'Ada Adventurer',
      emailAddress: 'ada@example.com',
    });

    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('alt')).toBe(
      'media'
    );
    expect(new URL(fetchImpl.mock.calls[1][0]).pathname).toBe(
      '/drive/v3/about'
    );
  });

  it('surfaces 401 responses as reconnectable authorization errors', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 401,
            message: 'Invalid Credentials',
          },
        },
        401
      )
    );
    const drive = createClient(fetchImpl, { onUnauthorized });

    await expect(drive.getAbout()).rejects.toMatchObject({
      name: GoogleDriveAuthError.name,
      code: 'unauthorized',
      status: 401,
      message:
        'Google Drive authorization expired. Reconnect Google Drive and try again.',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('fails clearly before making a request when no token is available', async () => {
    const fetchImpl = vi.fn();
    const drive = createGoogleDriveClient({
      fetchImpl,
      getAccessToken: () => null,
    });

    await expect(drive.getAbout()).rejects.toMatchObject({
      name: GoogleDriveAuthError.name,
      code: 'not_connected',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
