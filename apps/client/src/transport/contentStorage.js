export function safeContentSourceId(sourceId) {
  return String(sourceId || 'source').replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function contentStoragePath(sourceId, relativePath) {
  const safePath = String(relativePath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  return `imports/${safeContentSourceId(sourceId)}/${safePath}`;
}

export function createContentSourceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `source-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
