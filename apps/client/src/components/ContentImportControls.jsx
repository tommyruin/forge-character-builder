import { useState } from 'react';
import MatchingPathsDisclosure from './MatchingPathsDisclosure';

function sourceKindLabel(kind) {
  switch (kind) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'folder':
      return 'Folder';
    case 'files':
      return 'Files';
    default:
      return 'Web';
  }
}

function importedAtLabel(value) {
  if (!value) return 'Not imported yet';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function DuplicateSourceReview({
  group,
  onKeepAll,
  onKeepSelected,
  resolving,
}) {
  const [selectedSourceId, setSelectedSourceId] = useState(group.sourceIds[0]);

  return (
    <article className="fcb-duplicate-group">
      <div>
        <strong>
          {group.sources.length} matching sources · {group.fileCount}{' '}
          {group.fileCount === 1 ? 'file' : 'files'}
        </strong>
        <p>Same filenames, folder paths, and exact file contents.</p>
      </div>
      <fieldset disabled={resolving}>
        <legend>Choose the source to keep</legend>
        {group.sources.map((source) => (
          <label key={source.id} className="fcb-duplicate-source">
            <input
              type="radio"
              name={`duplicate-${group.fingerprint}`}
              value={source.id}
              checked={selectedSourceId === source.id}
              onChange={() => setSelectedSourceId(source.id)}
            />
            <span>
              <strong>{source.label}</strong>
              <small>
                {sourceKindLabel(source.kind)} ·{' '}
                {importedAtLabel(source.importedAt)}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <MatchingPathsDisclosure paths={group.relativePaths} />
      <div className="fcb-import-actions">
        <button
          type="button"
          className="fcb-button fcb-button-primary"
          disabled={resolving}
          onClick={() => onKeepSelected(group, selectedSourceId)}
        >
          {resolving ? 'Resolving…' : 'Keep selected source'}
        </button>
        <button
          type="button"
          className="fcb-button"
          disabled={resolving}
          onClick={() => onKeepAll(group)}
        >
          Keep all
        </button>
      </div>
    </article>
  );
}

export default function ContentImportControls({
  fileInput,
  folderInput,
  upload,
  chooseFolder,
  importFolder,
  importWeb,
  webUrl,
  setWebUrl,
  uploading,
  importProgress,
  contentProgress,
  cancelImport,
  sources,
  refreshSource,
  removeSource,
  removingSourceId,
  duplicateGroups = [],
  resolvingDuplicateFingerprint,
  onKeepDuplicateSource,
  onKeepAllDuplicates,
}) {
  const [mode, setMode] = useState('device');
  const preparingFastStart =
    uploading &&
    contentProgress?.active &&
    contentProgress.phase === 'optimizing';
  const visibleProgress = preparingFastStart ? contentProgress : importProgress;

  return (
    <>
      <section
        className="fcb-file-manager-section"
        aria-labelledby="upload-files-title"
      >
        <div>
          <h3 id="upload-files-title" className="fcb-card-title">
            Import content
          </h3>
          <p className="fcb-card-subtitle">
            XML and index content from files, folders, or the web
          </p>
        </div>

        <div className="fcb-import-mode" aria-label="Import source">
          <button
            type="button"
            className={mode === 'device' ? 'is-active' : ''}
            aria-pressed={mode === 'device'}
            onClick={() => setMode('device')}
          >
            From device
          </button>
          <button
            type="button"
            className={mode === 'web' ? 'is-active' : ''}
            aria-pressed={mode === 'web'}
            onClick={() => setMode('web')}
          >
            From web
          </button>
        </div>

        {mode === 'device' && (
          <form onSubmit={upload} className="fcb-import-device-form">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".xml,.index"
              aria-label="Choose XML or index files"
              className="block w-full text-sm text-[var(--fcb-text-muted)] file:mr-3 file:rounded file:border-0 file:bg-[var(--fcb-surface-3)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--fcb-text)] hover:file:bg-[var(--fcb-primary)]"
              disabled={uploading}
            />
            <div className="fcb-import-actions">
              <button
                type="submit"
                disabled={uploading}
                className="fcb-button fcb-button-primary"
              >
                {preparingFastStart
                  ? 'Preparing Fast Start…'
                  : uploading
                    ? 'Importing…'
                    : 'Import selected files'}
              </button>
              <button
                type="button"
                disabled={uploading}
                className="fcb-button"
                onClick={chooseFolder}
              >
                Choose a folder
              </button>
            </div>
            <input
              ref={folderInput}
              type="file"
              multiple
              accept=".xml,.index"
              webkitdirectory=""
              directory=""
              hidden
              aria-label="Choose a content folder"
              data-testid="cm-folder-input"
              onChange={importFolder}
            />
            <p
              className="fcb-import-help"
              title="Index files pull in the content they reference, downloading only what the selection does not already contain."
            >
              Folders keep their structure and can be replaced later.
            </p>
          </form>
        )}

        {mode === 'web' && (
          <form onSubmit={importWeb} className="fcb-import-web-form">
            <label className="fcb-field-label">
              Public content URL
              <input
                className="fcb-input"
                type="url"
                inputMode="url"
                placeholder="https://github.com/owner/repository"
                value={webUrl}
                disabled={uploading}
                onChange={(event) => setWebUrl(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={uploading || !webUrl.trim()}
              className="fcb-button fcb-button-primary"
            >
              {preparingFastStart
                ? 'Preparing Fast Start…'
                : uploading
                  ? 'Importing…'
                  : 'Import from web'}
            </button>
            <p
              className="fcb-import-help"
              title="A repository URL imports everything; an index URL imports only that index and its active references, so supplements may still need core content."
            >
              Accepts XML, ZIP, GitHub, and GitLab locations.
            </p>
          </form>
        )}

        {visibleProgress && (
          <div
            className="fcb-content-import-progress"
            role="status"
            aria-live="polite"
          >
            <span>{visibleProgress.message}</span>
            {uploading &&
              !preparingFastStart &&
              visibleProgress.stage !== 'ingest' && (
                <button
                  type="button"
                  className="fcb-button"
                  onClick={cancelImport}
                >
                  Cancel
                </button>
              )}
          </div>
        )}
      </section>

      {duplicateGroups.length > 0 && (
        <section
          className="fcb-file-manager-section fcb-duplicate-review"
          aria-labelledby="duplicate-sources-title"
        >
          <div>
            <h3 id="duplicate-sources-title" className="fcb-card-title">
              Potential duplicate sources
            </h3>
            <p className="fcb-card-subtitle">
              Nothing has been removed. Review each exact match and decide
              whether to keep one source or all copies.
            </p>
          </div>
          <div className="fcb-duplicate-groups">
            {duplicateGroups.map((group) => (
              <DuplicateSourceReview
                key={group.fingerprint}
                group={group}
                onKeepAll={onKeepAllDuplicates}
                onKeepSelected={onKeepDuplicateSource}
                resolving={resolvingDuplicateFingerprint === group.fingerprint}
              />
            ))}
          </div>
        </section>
      )}

      <section
        className="fcb-file-manager-section"
        aria-labelledby="imported-sources-title"
      >
        <div className="fcb-file-list-heading">
          <div>
            <h3 id="imported-sources-title" className="fcb-card-title">
              Imported sources
            </h3>
            <p className="fcb-card-subtitle">
              File, folder, and web snapshots stored on this device
            </p>
          </div>
          <span className="fcb-stat-pill">
            <strong>{sources.length}</strong> tracked
          </span>
        </div>
        {sources.length === 0 && (
          <p className="fcb-empty-copy">No tracked imports yet.</p>
        )}
        {sources.length > 0 && (
          <ul className="fcb-file-list" data-testid="cm-source-list">
            {sources.map((source) => (
              <li key={source.id} className="fcb-file-row">
                <span className="fcb-file-row-copy" title={source.location}>
                  <strong>{source.label}</strong>
                  <span>
                    {sourceKindLabel(source.kind)} · {source.fileCount} files ·{' '}
                    {importedAtLabel(source.importedAt)}
                  </span>
                </span>
                <span className="fcb-source-actions">
                  {(source.kind === 'folder' || source.location) && (
                    <button
                      type="button"
                      className="fcb-button"
                      disabled={uploading || removingSourceId !== null}
                      onClick={() => refreshSource(source)}
                    >
                      Refresh
                    </button>
                  )}
                  <button
                    type="button"
                    className="fcb-button fcb-button-danger"
                    disabled={uploading || removingSourceId !== null}
                    onClick={() => removeSource(source)}
                  >
                    {removingSourceId === source.id ? 'Removing…' : 'Remove'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
