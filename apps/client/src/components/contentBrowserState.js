export function retainVisibleSelection(currentId, items) {
  if (!currentId) return null;
  return items.some((item) => item.id === currentId) ? currentId : null;
}

export function filterUploadedFiles(paths, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return paths;
  return paths.filter((entry) => {
    const searchable =
      typeof entry === 'string'
        ? entry
        : `${entry.logicalPath ?? entry.path} ${entry.sourceLabel ?? ''}`;
    return searchable.toLocaleLowerCase().includes(normalizedQuery);
  });
}

export function describeContentPath(path) {
  const segments = path.split('/');
  return {
    fileName: segments.pop() || path,
    category: segments.join('/') || 'Uncategorised',
  };
}

export function describeContentRecord(record, sourcesById) {
  const logicalPath = record.relativePath || record.path;
  const source = record.sourceId ? sourcesById.get(record.sourceId) : null;
  return {
    path: record.path,
    fileName: logicalPath.split('/').pop() || logicalPath,
    logicalPath,
    sourceLabel: source?.label ?? 'Previous uploads',
  };
}
