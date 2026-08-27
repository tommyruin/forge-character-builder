export const GOOGLE_DRIVE_API_BASE_URL =
  'https://www.googleapis.com/drive/v3';
export const GOOGLE_DRIVE_UPLOAD_BASE_URL =
  'https://www.googleapis.com/upload/drive/v3';
export const GOOGLE_DRIVE_MULTIPART_MAX_BYTES = 5 * 1024 * 1024;
export const GOOGLE_DRIVE_FOLDER_MIME_TYPE =
  'application/vnd.google-apps.folder';
export const DM_FORGE_FOLDER_NAME = 'DM Forge';
export const DM_FORGE_LIBRARY_NAME = 'dm-forge-library.json';

export const DM_FORGE_APP_PROPERTIES = Object.freeze({
  managedKey: 'dmForgeManaged',
  managedValue: 'true',
  typeKey: 'dmForgeType',
  folderType: 'folder',
  libraryType: 'library',
  schemaKey: 'dmForgeSchema',
  schemaValue: '1',
});

const DEFAULT_FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'parents',
  'createdTime',
  'modifiedTime',
  'version',
  'size',
  'trashed',
  'appProperties',
].join(',');
const DEFAULT_ABOUT_FIELDS =
  'user(displayName,emailAddress,photoLink,permissionId)';

export class GoogleDriveError extends Error {
  constructor(
    message,
    {
      code = 'drive_error',
      status = null,
      details = null,
      cause,
    } = {}
  ) {
    super(message);
    this.name = 'GoogleDriveError';
    this.code = code;
    this.status = status;
    this.details = details;
    if (cause !== undefined) this.cause = cause;
  }
}

export class GoogleDriveAuthError extends GoogleDriveError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'GoogleDriveAuthError';
  }
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

function normalizeFields(fields) {
  return Array.isArray(fields) ? fields.join(',') : fields;
}

function escapeQueryValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function appPropertyQuery(key, value) {
  return `appProperties has { key='${escapeQueryValue(
    key
  )}' and value='${escapeQueryValue(value)}' }`;
}

function fileIdOf(fileOrId) {
  const fileId =
    typeof fileOrId === 'string' ? fileOrId : fileOrId?.id;
  if (!fileId) {
    throw new GoogleDriveError('A Google Drive file ID is required.', {
      code: 'file_id_missing',
    });
  }
  return fileId;
}

function serializeDocument(document) {
  try {
    const serialized = JSON.stringify(document);
    if (serialized === undefined) {
      throw new TypeError('The value is not JSON serializable.');
    }
    return serialized;
  } catch (error) {
    throw new GoogleDriveError(
      'The cloud library could not be converted to JSON.',
      { code: 'invalid_document', cause: error }
    );
  }
}

function utf8ByteLength(value) {
  if (globalThis.TextEncoder) {
    return new TextEncoder().encode(value).byteLength;
  }
  return new Blob([value]).size;
}

function createBoundary() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `dm-forge-${suffix}`;
}

function createMultipartBody(metadata, serializedDocument, boundary) {
  return [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    `${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    `${serializedDocument}\r\n`,
    `--${boundary}--`,
  ].join('');
}

async function readErrorDetails(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function apiErrorCode(details) {
  return (
    details?.error?.errors?.[0]?.reason ||
    details?.error?.status ||
    'api_error'
  );
}

function apiErrorMessage(details, status) {
  return (
    details?.error?.message ||
    (typeof details === 'string' ? details : null) ||
    `Google Drive request failed with status ${status}.`
  );
}

export function createGoogleDriveClient({
  getAccessToken,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  onUnauthorized,
  apiBaseUrl = GOOGLE_DRIVE_API_BASE_URL,
  uploadBaseUrl = GOOGLE_DRIVE_UPLOAD_BASE_URL,
  multipartMaxBytes = GOOGLE_DRIVE_MULTIPART_MAX_BYTES,
} = {}) {
  if (typeof getAccessToken !== 'function') {
    throw new GoogleDriveError(
      'Google Drive requires an access-token provider.',
      { code: 'token_provider_missing' }
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new GoogleDriveError('Google Drive requires browser fetch support.', {
      code: 'fetch_unavailable',
    });
  }
  if (!(multipartMaxBytes > 0)) {
    throw new GoogleDriveError(
      'The Google Drive multipart size limit must be greater than zero.',
      { code: 'invalid_size_limit' }
    );
  }

  const apiRoot = trimTrailingSlash(apiBaseUrl);
  const uploadRoot = trimTrailingSlash(uploadBaseUrl);

  async function authorizedFetch(url, init = {}) {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new GoogleDriveAuthError(
        'Connect Google Drive before accessing cloud files.',
        { code: 'not_connected', status: 401 }
      );
    }

    const headers = new Headers(init.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);

    let response;
    try {
      response = await fetchImpl(url, { ...init, headers });
    } catch (error) {
      throw new GoogleDriveError(
        'Google Drive could not be reached. Check your connection and try again.',
        { code: 'network_error', cause: error }
      );
    }

    if (response.ok) return response;

    const details = await readErrorDetails(response);
    if (response.status === 401) {
      const error = new GoogleDriveAuthError(
        'Google Drive authorization expired. Reconnect Google Drive and try again.',
        { code: 'unauthorized', status: 401, details }
      );
      try {
        await onUnauthorized?.(error);
      } catch {
        // Clearing stale local authorization must not hide the Drive error.
      }
      throw error;
    }

    throw new GoogleDriveError(
      `Google Drive request failed (${response.status}): ${apiErrorMessage(
        details,
        response.status
      )}`,
      {
        code: apiErrorCode(details),
        status: response.status,
        details,
      }
    );
  }

  async function requestJson(url, init) {
    const response = await authorizedFetch(url, init);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new GoogleDriveError(
        'Google Drive returned a response the app could not read.',
        {
          code: 'invalid_response',
          status: response.status,
          cause: error,
        }
      );
    }
  }

  async function listFiles({
    q,
    spaces = 'drive',
    pageSize = 100,
    pageToken,
    orderBy,
    fields = DEFAULT_FILE_FIELDS,
    signal,
  } = {}) {
    const files = [];
    const seenPageTokens = new Set();
    let nextPageToken = pageToken || null;

    do {
      if (nextPageToken && seenPageTokens.has(nextPageToken)) {
        throw new GoogleDriveError(
          'Google Drive returned a repeated page token.',
          { code: 'pagination_cycle' }
        );
      }
      if (nextPageToken) seenPageTokens.add(nextPageToken);

      const params = new URLSearchParams({
        pageSize: String(pageSize),
        fields: `nextPageToken,files(${normalizeFields(fields)})`,
      });
      if (q) params.set('q', q);
      if (spaces) params.set('spaces', spaces);
      if (nextPageToken) params.set('pageToken', nextPageToken);
      if (orderBy) params.set('orderBy', orderBy);

      const page = await requestJson(`${apiRoot}/files?${params}`, {
        method: 'GET',
        signal,
      });
      files.push(...(page?.files || []));
      nextPageToken = page?.nextPageToken || null;
    } while (nextPageToken);

    return files;
  }

  async function getFileMetadata(
    fileOrId,
    { fields = DEFAULT_FILE_FIELDS, signal } = {}
  ) {
    const fileId = fileIdOf(fileOrId);
    const params = new URLSearchParams({
      fields: normalizeFields(fields),
    });
    return requestJson(
      `${apiRoot}/files/${encodeURIComponent(fileId)}?${params}`,
      { method: 'GET', signal }
    );
  }

  async function createFileMetadata(
    metadata,
    { fields = DEFAULT_FILE_FIELDS, signal } = {}
  ) {
    const params = new URLSearchParams({
      fields: normalizeFields(fields),
    });
    return requestJson(`${apiRoot}/files?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
      signal,
    });
  }

  async function updateFileMetadata(
    fileOrId,
    metadata,
    { fields = DEFAULT_FILE_FIELDS, signal } = {}
  ) {
    const fileId = fileIdOf(fileOrId);
    const params = new URLSearchParams({
      fields: normalizeFields(fields),
    });
    return requestJson(
      `${apiRoot}/files/${encodeURIComponent(fileId)}?${params}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(metadata),
        signal,
      }
    );
  }

  async function uploadJson({
    document,
    metadata,
    fileId,
    fields = DEFAULT_FILE_FIELDS,
    signal,
  }) {
    const serializedDocument = serializeDocument(document);
    const boundary = createBoundary();
    const body = createMultipartBody(
      metadata,
      serializedDocument,
      boundary
    );
    const actualBytes = utf8ByteLength(body);
    const path = fileId
      ? `/files/${encodeURIComponent(fileId)}`
      : '/files';

    if (actualBytes <= multipartMaxBytes) {
      const params = new URLSearchParams({
        uploadType: 'multipart',
        fields: normalizeFields(fields),
      });
      return requestJson(`${uploadRoot}${path}?${params}`, {
        method: fileId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
        signal,
      });
    }

    const documentBytes = utf8ByteLength(serializedDocument);
    const sessionParams = new URLSearchParams({
      uploadType: 'resumable',
      fields: normalizeFields(fields),
    });
    const sessionResponse = await authorizedFetch(
      `${uploadRoot}${path}?${sessionParams}`,
      {
        method: fileId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(documentBytes),
          'X-Upload-Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
        signal,
      }
    );
    const sessionUrl = sessionResponse.headers.get('Location');
    if (!sessionUrl) {
      throw new GoogleDriveError(
        'Google Drive did not provide a resumable upload session.',
        {
          code: 'resumable_session_missing',
          status: sessionResponse.status,
        }
      );
    }

    return requestJson(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: serializedDocument,
      signal,
    });
  }

  function createJsonFile(
    document,
    {
      name = 'data.json',
      parents,
      appProperties,
      fields = DEFAULT_FILE_FIELDS,
      signal,
    } = {}
  ) {
    const metadata = {
      name,
      mimeType: 'application/json',
    };
    if (parents?.length) metadata.parents = [...parents];
    if (appProperties) metadata.appProperties = { ...appProperties };

    return uploadJson({ document, metadata, fields, signal });
  }

  function updateJsonFile(
    fileOrId,
    document,
    {
      name,
      appProperties,
      fields = DEFAULT_FILE_FIELDS,
      signal,
    } = {}
  ) {
    const existingFile =
      typeof fileOrId === 'object' && fileOrId ? fileOrId : {};
    const metadata = {
      name: name || existingFile.name || 'data.json',
      mimeType: 'application/json',
    };
    const properties = appProperties || existingFile.appProperties;
    if (properties) metadata.appProperties = { ...properties };

    return uploadJson({
      document,
      metadata,
      fileId: fileIdOf(fileOrId),
      fields,
      signal,
    });
  }

  async function findFolder({ name = DM_FORGE_FOLDER_NAME } = {}) {
    const folderTypeQuery = appPropertyQuery(
      DM_FORGE_APP_PROPERTIES.typeKey,
      DM_FORGE_APP_PROPERTIES.folderType
    );
    const baseQuery = [
      `mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}'`,
      'trashed = false',
    ];
    const managedFolders = await listFiles({
      q: [...baseQuery, folderTypeQuery].join(' and '),
      orderBy: 'modifiedTime desc',
    });
    if (managedFolders.length) return managedFolders[0];

    const namedFolders = await listFiles({
      q: [
        ...baseQuery,
        `name = '${escapeQueryValue(name)}'`,
      ].join(' and '),
      orderBy: 'modifiedTime desc',
    });
    return namedFolders[0] || null;
  }

  async function ensureFolder({ name = DM_FORGE_FOLDER_NAME } = {}) {
    const existingFolder = await findFolder({ name });
    if (existingFolder) return existingFolder;

    return createFileMetadata({
      name,
      mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
      appProperties: {
        [DM_FORGE_APP_PROPERTIES.managedKey]:
          DM_FORGE_APP_PROPERTIES.managedValue,
        [DM_FORGE_APP_PROPERTIES.typeKey]:
          DM_FORGE_APP_PROPERTIES.folderType,
        [DM_FORGE_APP_PROPERTIES.schemaKey]:
          DM_FORGE_APP_PROPERTIES.schemaValue,
      },
    });
  }

  async function findManagedLibrary(folderOrId) {
    const query = [
      'trashed = false',
      appPropertyQuery(
        DM_FORGE_APP_PROPERTIES.managedKey,
        DM_FORGE_APP_PROPERTIES.managedValue
      ),
      appPropertyQuery(
        DM_FORGE_APP_PROPERTIES.typeKey,
        DM_FORGE_APP_PROPERTIES.libraryType
      ),
    ];
    if (folderOrId) {
      query.push(`'${escapeQueryValue(fileIdOf(folderOrId))}' in parents`);
    }

    const files = await listFiles({
      q: query.join(' and '),
      orderBy: 'modifiedTime desc',
    });
    return files[0] || null;
  }

  async function saveLibrary(
    document,
    existingFile = null,
    {
      folderId,
      name = DM_FORGE_LIBRARY_NAME,
      appProperties,
      fields = DEFAULT_FILE_FIELDS,
      signal,
    } = {}
  ) {
    const managedProperties = {
      ...(existingFile?.appProperties || {}),
      ...(appProperties || {}),
      [DM_FORGE_APP_PROPERTIES.managedKey]:
        DM_FORGE_APP_PROPERTIES.managedValue,
      [DM_FORGE_APP_PROPERTIES.typeKey]:
        DM_FORGE_APP_PROPERTIES.libraryType,
      [DM_FORGE_APP_PROPERTIES.schemaKey]:
        DM_FORGE_APP_PROPERTIES.schemaValue,
    };

    if (existingFile) {
      return updateJsonFile(existingFile, document, {
        name: existingFile.name || name,
        appProperties: managedProperties,
        fields,
        signal,
      });
    }

    let parentId = folderId;
    if (!parentId) {
      parentId = (await ensureFolder()).id;
    }
    if (!parentId) {
      throw new GoogleDriveError(
        'Google Drive did not return an ID for the DM Forge folder.',
        { code: 'folder_id_missing' }
      );
    }

    return createJsonFile(document, {
      name,
      parents: [parentId],
      appProperties: managedProperties,
      fields,
      signal,
    });
  }

  async function downloadJson(fileOrId, { signal } = {}) {
    const fileId = fileIdOf(fileOrId);
    const params = new URLSearchParams({ alt: 'media' });
    const response = await authorizedFetch(
      `${apiRoot}/files/${encodeURIComponent(fileId)}?${params}`,
      { method: 'GET', signal }
    );
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new GoogleDriveError(
        'The selected Google Drive file does not contain valid JSON.',
        {
          code: 'invalid_json',
          status: response.status,
          cause: error,
        }
      );
    }
  }

  function getAbout({ fields = DEFAULT_ABOUT_FIELDS, signal } = {}) {
    const params = new URLSearchParams({
      fields: normalizeFields(fields),
    });
    return requestJson(`${apiRoot}/about?${params}`, {
      method: 'GET',
      signal,
    });
  }

  async function getUserMetadata(options) {
    return (await getAbout(options))?.user || null;
  }

  return {
    createFileMetadata,
    createJsonFile,
    downloadJson,
    ensureFolder,
    findFolder,
    findManagedLibrary,
    getAbout,
    getFileMetadata,
    getUserMetadata,
    listFiles,
    saveLibrary,
    updateFileMetadata,
    updateJsonFile,
  };
}
