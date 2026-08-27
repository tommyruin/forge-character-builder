import { strFromU8, unzip } from 'fflate';

export const CONTENT_IMPORT_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxIndexDepth: 10,
});

const CONTENT_EXTENSIONS = new Set(['.xml', '.index']);
const ZIP_EXTENSIONS = new Set(['.zip']);
const GITHUB_API_RESPONSE_LIMIT = 10 * 1024 * 1024;
const GITHUB_DOWNLOAD_CONCURRENCY = 8;

export class ContentImportError extends Error {
  constructor(message, code = 'content-import-error') {
    super(message);
    this.name = 'ContentImportError';
    this.code = code;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('The import was cancelled.', 'AbortError');
  }
}

function extensionOf(path) {
  const clean = path.split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot).toLocaleLowerCase() : '';
}

function basename(path) {
  return path.split('/').filter(Boolean).pop() || 'content';
}

function dirname(path) {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

function joinPath(...parts) {
  return parts.filter(Boolean).join('/');
}

export function normalizeImportPath(path) {
  const normalized = String(path ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (
    normalized.startsWith('/') ||
    segments.some((segment) => segment === '..' || segment.includes('\0'))
  ) {
    throw new ContentImportError(`Unsafe content path: ${path}`, 'unsafe-path');
  }
  const safe = segments.filter((segment) => segment !== '.').join('/');
  if (!safe) {
    throw new ContentImportError('Content path is empty.', 'empty-path');
  }
  return safe;
}

function stripSharedRoot(paths) {
  const roots = paths.map((path) => path.split('/')[0]);
  if (!roots.length || !roots.every((root) => root === roots[0])) return paths;
  if (!paths.every((path) => path.includes('/'))) return paths;
  return paths.map((path) => path.slice(roots[0].length + 1));
}

function rootElementName(xml) {
  const source = xml
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^\s*<!--([\s\S]*?)-->/, '')
    .trimStart();
  return source.match(/^<([A-Za-z][\w:.-]*)\b/)?.[1]?.toLocaleLowerCase();
}

function decodeXmlAttribute(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function readAttribute(source, name) {
  const match = source.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  );
  return match ? decodeXmlAttribute(match[1] ?? match[2] ?? '') : '';
}

export function parseIndexEntries(xml) {
  if (rootElementName(xml) !== 'index') {
    throw new ContentImportError(
      'Index files must use an <index> root element.',
      'invalid-index'
    );
  }
  // Legacy manifests commonly comment out entries that should no longer be
  // downloaded. Parse the active XML only; matching tags in comments caused
  // the supplements index to chase deliberately disabled 404 URLs.
  const activeXml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const filesBlock = activeXml.match(/<files\b[^>]*>([\s\S]*?)<\/files>/i)?.[1];
  if (!filesBlock) return [];
  return Array.from(
    filesBlock.matchAll(/<(file|obsolete)\b([^>]*)\/?\s*>/gi),
    (match) => ({
      obsolete: match[1].toLocaleLowerCase() === 'obsolete',
      name: readAttribute(match[2], 'name'),
      url: readAttribute(match[2], 'url'),
    })
  ).filter((entry) => entry.name);
}

function contentKind(path, text) {
  const extension = extensionOf(path);
  const root = rootElementName(text);
  if (extension === '.xml' && root === 'elements') return 'xml';
  if (extension === '.index' && root === 'index') return 'index';
  return null;
}

function describeSize(bytes) {
  return `${Math.ceil(bytes / (1024 * 1024))} MiB`;
}

function enforceFileLimit(path, bytes) {
  if (bytes.length > CONTENT_IMPORT_LIMITS.maxFileBytes) {
    throw new ContentImportError(
      `${path} is ${describeSize(bytes.length)}; individual files must be 10 MiB or smaller.`,
      'file-too-large'
    );
  }
}

function enforceCollectionLimits(files) {
  if (!files.length) {
    throw new ContentImportError(
      'No DM Forge XML or index files were found.',
      'no-content'
    );
  }
  if (files.length > CONTENT_IMPORT_LIMITS.maxFiles) {
    throw new ContentImportError(
      `This source contains more than ${CONTENT_IMPORT_LIMITS.maxFiles} supported files.`,
      'too-many-files'
    );
  }
  const totalBytes = files.reduce(
    (total, file) => total + file.bytes.length,
    0
  );
  if (totalBytes > CONTENT_IMPORT_LIMITS.maxTotalBytes) {
    throw new ContentImportError(
      `Supported content totals ${describeSize(totalBytes)}; the limit is 50 MiB.`,
      'content-too-large'
    );
  }
}

async function fileToCandidate(file, relativePath, signal) {
  throwIfAborted(signal);
  const path = normalizeImportPath(relativePath || file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(signal);
  enforceFileLimit(path, bytes);
  return { name: basename(path), relativePath: path, bytes, originUrl: null };
}

function validateCandidate(candidate, { required = false } = {}) {
  const text = strFromU8(candidate.bytes);
  const kind = contentKind(candidate.relativePath, text);
  if (!kind && required) {
    throw new ContentImportError(
      `${candidate.name} is not a valid DM Forge XML or index file.`,
      'invalid-content'
    );
  }
  return kind ? { ...candidate, kind, text } : null;
}

function createSourceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `source-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sourceDescriptor({ existingSource, kind, label, location }) {
  return {
    id: existingSource?.id ?? createSourceId(),
    kind,
    label,
    location,
    importedAt: Date.now(),
    fileCount: 0,
  };
}

function notify(onProgress, stage, message) {
  onProgress?.({ stage, message });
}

async function readResponseBytes(response, limit, signal) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new ContentImportError(
      `The download is larger than ${describeSize(limit)}.`,
      'download-too-large'
    );
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) {
      throw new ContentImportError(
        `The download is larger than ${describeSize(limit)}.`,
        'download-too-large'
      );
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new ContentImportError(
        `The download is larger than ${describeSize(limit)}.`,
        'download-too-large'
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function fetchBytes(url, { fetchImpl, signal, limit }) {
  throwIfAborted(signal);
  let response;
  try {
    response = await fetchImpl(url, { signal, redirect: 'follow' });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ContentImportError(
      `DM Forge could not download ${url}. The host may block browser access (CORS).`,
      'download-failed'
    );
  }
  if (!response.ok) {
    const suffix =
      response.status === 429 ? ' The provider rate limit was reached.' : '';
    throw new ContentImportError(
      `Download of ${url} failed with HTTP ${response.status}.${suffix}`,
      'download-failed'
    );
  }
  return {
    bytes: await readResponseBytes(response, limit, signal),
    contentType: response.headers.get('content-type') ?? '',
    finalUrl: response.url || url,
  };
}

function unzipBytes(bytes, signal) {
  return new Promise((resolve, reject) => {
    const oversized = [];
    let relevantCount = 0;
    let declaredTotal = 0;
    let collectionLimitError = null;
    unzip(
      bytes,
      {
        filter(file) {
          const extension = extensionOf(file.name);
          if (!CONTENT_EXTENSIONS.has(extension)) return false;
          relevantCount += 1;
          declaredTotal += file.originalSize ?? 0;
          if (relevantCount > CONTENT_IMPORT_LIMITS.maxFiles) {
            collectionLimitError = new ContentImportError(
              `This source contains more than ${CONTENT_IMPORT_LIMITS.maxFiles} supported files.`,
              'too-many-files'
            );
            return false;
          }
          if (declaredTotal > CONTENT_IMPORT_LIMITS.maxTotalBytes) {
            collectionLimitError = new ContentImportError(
              'Supported archive content is larger than 50 MiB.',
              'content-too-large'
            );
            return false;
          }
          if (file.originalSize > CONTENT_IMPORT_LIMITS.maxFileBytes) {
            oversized.push(file.name);
            return false;
          }
          return true;
        },
      },
      (error, files) => {
        if (error) {
          reject(
            new ContentImportError(
              `The ZIP archive could not be read: ${error.message}`,
              'invalid-archive'
            )
          );
          return;
        }
        try {
          throwIfAborted(signal);
          if (collectionLimitError) throw collectionLimitError;
          if (oversized.length) {
            throw new ContentImportError(
              `${oversized[0]} is larger than the 10 MiB per-file limit.`,
              'file-too-large'
            );
          }
          const entries = Object.entries(files);
          const safePaths = entries.map(([path]) => normalizeImportPath(path));
          const stripped = stripSharedRoot(safePaths);
          resolve(
            entries.map(([, fileBytes], index) => ({
              name: basename(stripped[index]),
              relativePath: normalizeImportPath(stripped[index]),
              bytes: fileBytes,
              originUrl: null,
            }))
          );
        } catch (caught) {
          reject(caught);
        }
      }
    );
  });
}

function isZip(bytes, contentType, url) {
  return (
    ZIP_EXTENSIONS.has(extensionOf(url)) ||
    /application\/(?:x-)?zip/i.test(contentType) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b)
  );
}

function ensureAllowedRemoteUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ContentImportError('Enter a complete HTTPS URL.', 'invalid-url');
  }
  const local = new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new ContentImportError(
      'Remote imports must use HTTPS.',
      'insecure-url'
    );
  }
  return url;
}

function describeRawGitHubLocation(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'raw.githubusercontent.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 4) return null;
  try {
    return {
      owner: decodeURIComponent(segments[0]),
      repo: decodeURIComponent(segments[1]),
      relativePath: normalizeImportPath(
        segments.slice(3).map(decodeURIComponent).join('/')
      ),
    };
  } catch {
    return null;
  }
}

export function describeWebLocation(rawUrl) {
  const url = ensureAllowedRemoteUrl(rawUrl.trim());
  const github =
    url.hostname === 'github.com'
      ? url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
      : null;
  if (github) {
    const [, owner, repo] = github;
    return {
      kind: 'github',
      label: `${owner}/${repo}`,
      location: url.href,
      owner,
      repo,
      downloadUrl: null,
    };
  }
  if (url.hostname === 'gitlab.com' && !url.pathname.includes('/-/')) {
    const project = url.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/, '');
    if (project.split('/').length >= 2) {
      return {
        kind: 'gitlab',
        label: project,
        location: url.href,
        downloadUrl: `https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/repository/archive.zip?include_lfs_blobs=false`,
      };
    }
  }
  return {
    kind: 'url',
    label: basename(url.pathname) || url.hostname,
    location: url.href,
    downloadUrl: url.href,
  };
}

function parseJsonResponse(bytes, label) {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new ContentImportError(
      `GitHub returned an invalid ${label} response.`,
      'invalid-github-response'
    );
  }
}

function encodeUrlPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function resolveGitHubRepository(
  location,
  { fetchImpl, signal, onProgress }
) {
  const repositoryApi = `https://api.github.com/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`;
  notify(onProgress, 'download', `Reading ${location.label} repository…`);
  const repositoryResponse = await fetchBytes(repositoryApi, {
    fetchImpl,
    signal,
    limit: GITHUB_API_RESPONSE_LIMIT,
  });
  const repository = parseJsonResponse(
    repositoryResponse.bytes,
    'repository'
  );
  if (!repository.default_branch) {
    throw new ContentImportError(
      'GitHub did not report a default branch for this repository.',
      'invalid-github-response'
    );
  }

  const treeApi = `${repositoryApi}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`;
  const treeResponse = await fetchBytes(treeApi, {
    fetchImpl,
    signal,
    limit: GITHUB_API_RESPONSE_LIMIT,
  });
  const tree = parseJsonResponse(treeResponse.bytes, 'repository tree');
  if (tree.truncated) {
    throw new ContentImportError(
      'This GitHub repository is too large to list safely in the browser.',
      'github-tree-truncated'
    );
  }

  const entries = (tree.tree ?? []).filter(
    (entry) =>
      entry.type === 'blob' && CONTENT_EXTENSIONS.has(extensionOf(entry.path))
  );
  if (entries.length > CONTENT_IMPORT_LIMITS.maxFiles) {
    throw new ContentImportError(
      `This source contains more than ${CONTENT_IMPORT_LIMITS.maxFiles} supported files.`,
      'too-many-files'
    );
  }
  const declaredBytes = entries.reduce(
    (total, entry) => total + (Number(entry.size) || 0),
    0
  );
  const oversized = entries.find(
    (entry) => Number(entry.size) > CONTENT_IMPORT_LIMITS.maxFileBytes
  );
  if (oversized) {
    throw new ContentImportError(
      `${oversized.path} is larger than the 10 MiB per-file limit.`,
      'file-too-large'
    );
  }
  if (declaredBytes > CONTENT_IMPORT_LIMITS.maxTotalBytes) {
    throw new ContentImportError(
      'Supported repository content is larger than 50 MiB.',
      'content-too-large'
    );
  }
  if (!entries.length) {
    throw new ContentImportError(
      'No DM Forge XML or index files were found.',
      'no-content'
    );
  }

  const candidates = new Array(entries.length);
  let nextIndex = 0;
  let completed = 0;
  const downloadWorker = async () => {
    while (nextIndex < entries.length) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      const entry = entries[index];
      const relativePath = normalizeImportPath(entry.path);
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/${tree.sha}/${encodeUrlPath(entry.path)}`;
      const download = await fetchBytes(rawUrl, {
        fetchImpl,
        signal,
        limit: CONTENT_IMPORT_LIMITS.maxFileBytes,
      });
      candidates[index] = {
        name: basename(relativePath),
        relativePath,
        bytes: download.bytes,
        originUrl: download.finalUrl,
      };
      completed += 1;
      if (completed === entries.length || completed % 25 === 0) {
        notify(
          onProgress,
          'download',
          `Downloading ${location.label}: ${completed} of ${entries.length} files…`
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(GITHUB_DOWNLOAD_CONCURRENCY, entries.length) },
      downloadWorker
    )
  );
  enforceCollectionLimits(candidates);
  return candidates;
}

async function resolveIndexReferences(
  initialFiles,
  { fetchImpl, signal, onProgress, repository = null, flatSelection = false }
) {
  const resolved = new Map();
  const queue = [];
  const seenUrls = new Map();
  for (const candidate of initialFiles) {
    enforceFileLimit(candidate.relativePath, candidate.bytes);
    const validated = validateCandidate(candidate);
    if (!validated) continue;
    if (resolved.has(validated.relativePath)) {
      throw new ContentImportError(
        `More than one file resolves to ${validated.relativePath}.`,
        'path-conflict'
      );
    }
    resolved.set(validated.relativePath, validated);
    if (validated.kind === 'index') queue.push({ file: validated, depth: 0 });
  }

  while (queue.length) {
    throwIfAborted(signal);
    const { file, depth } = queue.shift();
    if (depth >= CONTENT_IMPORT_LIMITS.maxIndexDepth) {
      throw new ContentImportError(
        `Index nesting exceeds ${CONTENT_IMPORT_LIMITS.maxIndexDepth} levels.`,
        'index-too-deep'
      );
    }
    const folder = joinPath(
      dirname(file.relativePath),
      basename(file.relativePath).replace(/\.index$/i, '')
    );
    for (const entry of parseIndexEntries(file.text)) {
      if (entry.obsolete) continue;
      const targetPath = normalizeImportPath(joinPath(folder, entry.name));
      if (resolved.has(targetPath)) {
        if (extensionOf(targetPath) === '.index') {
          queue.push({ file: resolved.get(targetPath), depth: depth + 1 });
        }
        continue;
      }
      // A hand-picked selection is flat: the files that satisfy an index sit
      // beside it rather than inside the folder it names, so a top-level pick
      // with the entry's name is the entry.
      const flatMatch = flatSelection
        ? resolved.get(normalizeImportPath(entry.name))
        : null;
      if (flatMatch) {
        if (flatMatch.kind === 'index') {
          queue.push({ file: flatMatch, depth: depth + 1 });
        }
        continue;
      }
      // Published packs nest files in subfolders the index does not spell out
      // (players-handbook.index lists race-dragonborn.xml, stored under
      // players-handbook/races/). A unique already-loaded file under the
      // index's folder satisfies the entry without re-downloading content that
      // is already on disk — which also keeps local folder imports offline.
      const entrySuffix = `/${entry.name.toLocaleLowerCase()}`;
      const folderPrefix = `${folder.toLocaleLowerCase()}/`;
      const localMatches = [];
      for (const [path, candidate] of resolved) {
        const lower = path.toLocaleLowerCase();
        if (!lower.startsWith(folderPrefix)) continue;
        if (lower.endsWith(entrySuffix)) localMatches.push(candidate);
      }
      if (localMatches.length === 1) {
        if (localMatches[0].kind === 'index') {
          queue.push({ file: localMatches[0], depth: depth + 1 });
        }
        continue;
      }
      if (!entry.url) {
        throw new ContentImportError(
          `${file.name} references missing file ${entry.name}.`,
          'missing-index-file'
        );
      }
      let remoteUrl;
      try {
        remoteUrl = new URL(entry.url, file.originUrl || undefined).href;
      } catch {
        throw new ContentImportError(
          `${file.name} contains an invalid URL for ${entry.name}.`,
          'invalid-index-url'
        );
      }
      ensureAllowedRemoteUrl(remoteUrl);
      const rawGitHubLocation = describeRawGitHubLocation(remoteUrl);
      const repositoryFile = rawGitHubLocation
        ? resolved.get(rawGitHubLocation.relativePath)
        : null;
      if (repositoryFile) {
        if (repositoryFile.kind === 'index') {
          queue.push({ file: repositoryFile, depth: depth + 1 });
        }
        continue;
      }
      const belongsToRepository =
        repository &&
        rawGitHubLocation?.owner.toLocaleLowerCase() ===
          repository.owner.toLocaleLowerCase() &&
        rawGitHubLocation.repo.toLocaleLowerCase() ===
          repository.repo.toLocaleLowerCase();
      if (belongsToRepository) {
        notify(
          onProgress,
          'resolve',
          `Skipping unavailable repository file ${entry.name}…`
        );
        continue;
      }
      notify(onProgress, 'download', `Downloading ${entry.name}…`);
      let remote = seenUrls.get(remoteUrl);
      if (!remote) {
        remote = fetchBytes(remoteUrl, {
          fetchImpl,
          signal,
          limit: CONTENT_IMPORT_LIMITS.maxFileBytes,
        });
        seenUrls.set(remoteUrl, remote);
      }
      let download;
      try {
        download = await remote;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (error instanceof ContentImportError) {
          throw new ContentImportError(
            `Could not download ${entry.name}: ${error.message} Referenced by ${file.relativePath}.`,
            error.code
          );
        }
        throw error;
      }
      const { bytes, finalUrl } = download;
      const validated = validateCandidate(
        {
          name: basename(targetPath),
          relativePath: targetPath,
          bytes,
          originUrl: finalUrl,
        },
        { required: true }
      );
      resolved.set(targetPath, validated);
      if (validated.kind === 'index') {
        queue.push({ file: validated, depth: depth + 1 });
      }
      enforceCollectionLimits(Array.from(resolved.values()));
    }
  }
  const files = Array.from(resolved.values()).map((file) => ({
    name: file.name,
    relativePath: file.relativePath,
    bytes: file.bytes,
    originUrl: file.originUrl,
  }));
  enforceCollectionLimits(files);
  return files;
}

async function readCandidates(files, relativePaths, signal) {
  const candidates = [];
  for (let index = 0; index < files.length; index += 1) {
    candidates.push(await fileToCandidate(files[index], relativePaths[index], signal));
  }
  return candidates;
}

/**
 * Individually chosen files. Index manifests resolve exactly as they do for a
 * folder import — an index alone would otherwise store a file the rules engine
 * deliberately ignores, importing nothing. Files that are not DM Forge content
 * (a ZIP bundle, or XML the engine should report on itself) pass through
 * untouched so this route stays as permissive as it was.
 */
export async function resolveFilesSource(
  files,
  {
    existingSource = null,
    fetchImpl = globalThis.fetch,
    signal,
    onProgress,
  } = {}
) {
  throwIfAborted(signal);
  const selected = Array.from(files);
  if (!selected.length) {
    throw new ContentImportError('No files were selected.', 'no-content');
  }
  notify(
    onProgress,
    'read',
    `Reading ${selected.length} selected ${selected.length === 1 ? 'file' : 'files'}…`
  );
  const candidates = await readCandidates(
    selected,
    selected.map((file) =>
      normalizeImportPath(file.webkitRelativePath || file.name)
    ),
    signal
  );
  enforceCollectionLimits(candidates);

  const content = [];
  const passthrough = [];
  for (const candidate of candidates) {
    (validateCandidate(candidate) ? content : passthrough).push(candidate);
  }
  const resolved = content.length
    ? await resolveIndexReferences(content, {
        fetchImpl,
        signal,
        onProgress,
        flatSelection: true,
      })
    : [];
  const resolvedPaths = new Set(resolved.map((file) => file.relativePath));
  const imported = [
    ...resolved,
    ...passthrough.filter((file) => !resolvedPaths.has(file.relativePath)),
  ];
  enforceCollectionLimits(imported);
  const source = sourceDescriptor({
    existingSource,
    kind: 'files',
    label:
      existingSource?.label ??
      (imported.length === 1 ? imported[0].relativePath : `${imported.length} files`),
    location: null,
  });
  source.fileCount = imported.length;
  return { source, files: imported, skippedCount: 0 };
}

export async function resolveFolderSource(
  files,
  {
    existingSource = null,
    fetchImpl = globalThis.fetch,
    signal,
    onProgress,
  } = {}
) {
  throwIfAborted(signal);
  const selected = Array.from(files).filter((file) =>
    CONTENT_EXTENSIONS.has(extensionOf(file.name))
  );
  const originalPaths = selected.map((file) =>
    normalizeImportPath(file.webkitRelativePath || file.name)
  );
  const relativePaths = stripSharedRoot(originalPaths);
  notify(onProgress, 'read', `Reading ${selected.length} supported files…`);
  const candidates = await readCandidates(selected, relativePaths, signal);
  enforceCollectionLimits(candidates);
  const resolved = await resolveIndexReferences(candidates, {
    fetchImpl,
    signal,
    onProgress,
  });
  const rootLabel = originalPaths[0]?.split('/')[0] || 'Selected folder';
  const source = sourceDescriptor({
    existingSource,
    kind: 'folder',
    label: existingSource?.label ?? rootLabel,
    location: null,
  });
  source.fileCount = resolved.length;
  return {
    source,
    files: resolved,
    skippedCount: files.length - selected.length,
  };
}

export async function resolveWebSource(
  rawUrl,
  {
    existingSource = null,
    fetchImpl = globalThis.fetch,
    signal,
    onProgress,
  } = {}
) {
  const location = describeWebLocation(rawUrl);
  let candidates;
  let repository = null;
  if (location.kind === 'github') {
    candidates = await resolveGitHubRepository(location, {
      fetchImpl,
      signal,
      onProgress,
    });
    repository = { owner: location.owner, repo: location.repo };
  } else {
    notify(onProgress, 'download', `Downloading ${location.label}…`);
    const download = await fetchBytes(location.downloadUrl, {
      fetchImpl,
      signal,
      limit: CONTENT_IMPORT_LIMITS.maxTotalBytes,
    });
    if (isZip(download.bytes, download.contentType, download.finalUrl)) {
      notify(onProgress, 'extract', 'Reading repository or ZIP contents…');
      candidates = await unzipBytes(download.bytes, signal);
    } else {
      const finalName = basename(new URL(download.finalUrl).pathname);
      if (!CONTENT_EXTENSIONS.has(extensionOf(finalName))) {
        throw new ContentImportError(
          'That web location is not an XML, index, ZIP, GitHub, or GitLab source.',
          'unsupported-web-source'
        );
      }
      candidates = [
        {
          name: finalName,
          relativePath: finalName,
          bytes: download.bytes,
          originUrl: download.finalUrl,
        },
      ];
    }
  }
  enforceCollectionLimits(candidates);
  notify(onProgress, 'resolve', 'Resolving related content files…');
  const resolved = await resolveIndexReferences(candidates, {
    fetchImpl,
    signal,
    onProgress,
    repository,
  });
  const source = sourceDescriptor({
    existingSource,
    kind: location.kind,
    label: existingSource?.label ?? location.label,
    location: location.location,
  });
  source.fileCount = resolved.length;
  return {
    source,
    files: resolved,
    skippedCount: candidates.filter(
      (candidate) => !validateCandidate(candidate)
    ).length,
  };
}
