import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '../api';
import {
  resolveFilesSource,
  resolveFolderSource,
  resolveWebSource,
} from '../contentImport';
import { driveSyncService } from '../cloud/driveSyncService';
import { findDuplicateContentGroups } from '../transport/contentDuplicates';
import { localStore } from '../transport/localStore';
import CustomSpellModal from './custom/CustomSpellModal';
import { makePackSpellServices } from './custom/customServices';
import { spellDraftFromMissing } from './custom/draftModel';
import PackImportPanel from './homebrew/PackImportPanel';
import { sniffPackFile } from './homebrew/packFile';
import usePackImport from './homebrew/usePackImport';
import { collectionStoragePath } from './homebrew/xmlBuilder';
import ContentImportControls from './ContentImportControls';
import DescriptionPanel from './DescriptionPanel';
import FilterSelect from './FilterSelect';
import { InformationButton } from './InspectableItemControls';
import LocalPerformanceCacheControl from './LocalPerformanceCacheControl';
import MatchingPathsDisclosure from './MatchingPathsDisclosure';
import Icon from './Icon';
import {
  describeContentRecord,
  filterUploadedFiles,
  retainVisibleSelection,
} from './contentBrowserState';
import { sourceLabel } from './sourceLabel';

const ACTIVE_IMPORT_STATUSES = new Set(['queued', 'running']);

// Type-filter sentinel: browse every element type at once. The engine already
// treats an omitted `type` as unfiltered, so this never reaches the wire.
export const ALL_TYPES = '*';

export function contentSourceOption(source) {
  // The builder's own rules can still be filtered to, under a name that is not a book's.
  if (typeof source === 'string') {
    return { key: source, value: source, label: sourceLabel(source, 'Built in') };
  }
  return {
    key: source.id,
    value: source.name,
    label: sourceLabel(source.name, 'Built in'),
  };
}

export function ContentSourceOption({ source }) {
  const option = contentSourceOption(source);
  return (
    <option key={option.key} value={option.value}>
      {option.label}
    </option>
  );
}

// Engine-side XML validation results ({kind, message, file, detail}) returned by
// upload/remove. Without this list "Accepted" can lie: a file that reached the store but
// failed to parse still reports accepted=true — the parse failure only shows up here.
const MAX_DIAGNOSTIC_ROWS = 100;

export function UploadDiagnostics({ diagnostics, onCreateSpell }) {
  if (!diagnostics?.length) return null;
  const shown = diagnostics.slice(0, MAX_DIAGNOSTIC_ROWS);
  const hidden = diagnostics.length - shown.length;
  return (
    <div className="mt-3" data-testid="cm-upload-diagnostics">
      <p className="fcb-warning-note mb-1 text-xs uppercase tracking-wider">
        Content warnings
      </p>
      <ul className="fcb-upload-list">
        {shown.map((diag, index) => (
          <li key={index} className="is-rejected">
            [{diag.kind}] {diag.file ? `${diag.file}: ` : ''}
            {diag.message}
            {diag.detail && (
              <span className="text-[var(--fcb-text-faint)]">
                {' '}
                — {diag.detail}
              </span>
            )}
            {/* A grant to a spell nothing defines can be fixed by making the spell. */}
            {onCreateSpell &&
              diag.kind === 'missing-grant' &&
              diag.missingType === 'Spell' && (
                <button
                  type="button"
                  className="fcb-button ml-2"
                  onClick={() => onCreateSpell(diag)}
                >
                  Create spell
                </button>
              )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="fcb-import-help mt-2">{hidden} more warnings are not listed.</p>
      )}
    </div>
  );
}

function UploadFileResults({ files }) {
  const visible = files.slice(0, 100);
  const remaining = files.length - visible.length;
  return (
    <>
      <ul className="fcb-upload-list">
        {visible.map((file, index) => (
          <li
            key={`${file.fileName}-${index}`}
            className={file.accepted ? 'is-accepted' : 'is-rejected'}
          >
            {file.accepted ? 'Accepted' : 'Rejected'}: {file.fileName}
            {file.error && (
              <span className="text-[var(--fcb-text-faint)]">
                {' '}
                — {file.error}
              </span>
            )}
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <p className="fcb-import-help mt-2">
          {remaining} more accepted files are stored on this device.
        </p>
      )}
    </>
  );
}

function DuplicateImportPrompt({ duplicate, onImportAnother, onUseExisting }) {
  return (
    <section
      className="fcb-alert fcb-duplicate-import-prompt"
      role="alertdialog"
      aria-labelledby="duplicate-import-title"
      aria-describedby="duplicate-import-description"
    >
      <h3 id="duplicate-import-title">This content may already be imported</h3>
      <p id="duplicate-import-description">
        The same filenames, folder paths, and exact file contents already exist
        in {duplicate.matches.length}{' '}
        {duplicate.matches.length === 1 ? 'source' : 'sources'}. Nothing new has
        been stored yet.
      </p>
      <ul>
        {duplicate.matches.map((source) => (
          <li key={source.id}>{source.label}</li>
        ))}
      </ul>
      <MatchingPathsDisclosure paths={duplicate.relativePaths} />
      <div className="fcb-import-actions">
        <button
          type="button"
          className="fcb-button fcb-button-primary"
          onClick={onUseExisting}
        >
          Use existing copy
        </button>
        <button
          type="button"
          className="fcb-button"
          onClick={onImportAnother}
        >
          Import another copy
        </button>
      </div>
    </section>
  );
}

const DRAWER_FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function ContentFilesDrawer({
  open,
  onClose,
  returnFocusRef,
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
  importSources,
  refreshSource,
  removeSource,
  removingSourceId,
  importJob,
  uploadResult,
  error,
  uploadedFiles,
  visibleFiles,
  fileFilter,
  setFileFilter,
  canRemoveFiles,
  removingPath,
  removeUploaded,
  pendingDuplicate,
  useExistingDuplicate,
  importDuplicateAnyway,
  duplicateGroups,
  resolvingDuplicateFingerprint,
  keepDuplicateSource,
  keepAllDuplicates,
  onCreateSpell,
  importNeed,
  packImport,
}) {
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const returnFocusTarget = returnFocusRef.current;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll(DRAWER_FOCUSABLE) ?? [],
      ).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [onClose, open, returnFocusRef]);

  if (!open) return null;

  const fileCount = uploadedFiles?.length ?? 0;
  const activeImport =
    importJob && ACTIVE_IMPORT_STATUSES.has(importJob.status);

  return (
    <div
      className="fcb-file-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-files-title"
        aria-describedby="content-files-description"
        className="fcb-file-drawer"
        data-testid="cm-file-drawer"
      >
        <header className="fcb-file-drawer-header">
          <div>
            <h2 id="content-files-title" className="fcb-panel-title">
              Manage files
            </h2>
            <p id="content-files-description" className="fcb-panel-subtitle">
              {uploadedFiles
                ? `${fileCount} ${
                    fileCount === 1 ? 'file' : 'files'
                  } stored on this device`
                : 'Loading files stored on this device…'}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="fcb-icon-button"
            aria-label="Close file manager"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="fcb-file-drawer-body">
          {error && (
            <p className="fcb-alert" role="alert">
              {error}
            </p>
          )}

          {importNeed && (
            <section className="fcb-warning-note space-y-1" role="status" data-testid="cm-import-need">
              <p className="font-semibold">Looking for a source</p>
              <p className="text-sm">
                {importNeed.neededBy ? `${importNeed.neededBy} needs ` : 'A pack needs '}
                <strong data-testid="cm-import-need-label">{importNeed.label}</strong>
                {importNeed.type ? ` (${importNeed.type})` : ''}, which nothing in your library defines. Import the file that defines it below;
                this note goes away once the library has it.
              </p>
            </section>
          )}

          <PackImportPanel
            plan={packImport.plan}
            outcome={packImport.outcome}
            busy={packImport.busy}
            onApply={packImport.apply}
            onCancel={packImport.cancel}
            onDismiss={packImport.dismiss}
          />

          {pendingDuplicate && (
            <DuplicateImportPrompt
              duplicate={pendingDuplicate.duplicate}
              onUseExisting={useExistingDuplicate}
              onImportAnother={importDuplicateAnyway}
            />
          )}

          <ContentImportControls
            fileInput={fileInput}
            folderInput={folderInput}
            upload={upload}
            chooseFolder={chooseFolder}
            importFolder={importFolder}
            importWeb={importWeb}
            webUrl={webUrl}
            setWebUrl={setWebUrl}
            uploading={uploading}
            importProgress={importProgress}
            contentProgress={contentProgress}
            cancelImport={cancelImport}
            sources={importSources}
            refreshSource={refreshSource}
            removeSource={removeSource}
            removingSourceId={removingSourceId}
            duplicateGroups={duplicateGroups}
            resolvingDuplicateFingerprint={resolvingDuplicateFingerprint}
            onKeepDuplicateSource={keepDuplicateSource}
            onKeepAllDuplicates={keepAllDuplicates}
          />

          {(importJob || uploadResult) && (
            <section
              className="fcb-file-manager-section"
              aria-label="Latest import result"
            >
              {importJob && (
                <div
                  className="fcb-card p-3 text-sm"
                  role="status"
                  aria-live="polite"
                >
                  <p className="mb-2 text-[var(--fcb-text)]">
                    Import job {importJob.status}
                    {importJob.elementCountAfterReload != null && (
                      <>
                        {' '}
                        — library now holds {
                          importJob.elementCountAfterReload
                        }{' '}
                        elements
                      </>
                    )}
                  </p>
                  {activeImport && (
                    <p className="mb-2 text-xs uppercase tracking-wider text-[var(--fcb-text-faint)]">
                      DM Forge is reloading content in the background. You can
                      keep using the library.
                    </p>
                  )}
                  {importJob.error && (
                    <p className="fcb-danger-note mb-2">{importJob.error}</p>
                  )}
                  <UploadFileResults files={importJob.files} />
                  <UploadDiagnostics
                    diagnostics={importJob.diagnostics}
                    onCreateSpell={onCreateSpell}
                  />
                </div>
              )}

              {uploadResult && !importJob && (
                <div
                  className="fcb-card p-3 text-sm"
                  role="status"
                  aria-live="polite"
                >
                  {uploadResult.removedNote && (
                    <p className="mb-2 text-[var(--fcb-text)]">
                      {uploadResult.removedNote}
                    </p>
                  )}
                  <p className="mb-2 text-[var(--fcb-text)]">
                    Library now holds {uploadResult.elementCountAfterReload}{' '}
                    elements.
                  </p>
                  <UploadFileResults files={uploadResult.files} />
                  <UploadDiagnostics
                    diagnostics={uploadResult.diagnostics}
                    onCreateSpell={onCreateSpell}
                  />
                </div>
              )}
            </section>
          )}

          <section
            className="fcb-file-manager-section"
            aria-labelledby="uploaded-files-title"
          >
            <div className="fcb-file-list-heading">
              <div>
                <h3 id="uploaded-files-title" className="fcb-card-title">
                  Uploaded files
                </h3>
                <p className="fcb-card-subtitle">
                  Custom content available to the rules engine
                </p>
              </div>
              {uploadedFiles && (
                <span className="fcb-stat-pill">
                  <strong>{visibleFiles.length}</strong> shown
                </span>
              )}
            </div>

            {uploadedFiles?.length > 0 && (
              <label className="fcb-field-label">
                Filter files
                <input
                  className="fcb-input"
                  type="search"
                  placeholder="Filter uploaded files…"
                  value={fileFilter}
                  onChange={(event) => setFileFilter(event.target.value)}
                />
              </label>
            )}

            {!uploadedFiles && <p className="fcb-empty-copy">Loading…</p>}
            {uploadedFiles?.length === 0 && (
              <p className="fcb-empty-copy">
                No uploaded content files on this device.
              </p>
            )}
            {uploadedFiles?.length > 0 && visibleFiles.length === 0 && (
              <p className="fcb-empty-copy">
                No uploaded files match this filter.
              </p>
            )}
            {visibleFiles.length > 0 && (
              <ul className="fcb-file-list" data-testid="cm-uploaded-list">
                {visibleFiles.map((file) => {
                  const { path, fileName, logicalPath, sourceLabel } = file;
                  return (
                    <li key={path} className="fcb-file-row">
                      <span className="fcb-file-row-copy" title={path}>
                        <strong>{fileName}</strong>
                        <span>
                          {sourceLabel} · {logicalPath}
                        </span>
                      </span>
                      {canRemoveFiles && (
                        <button
                          type="button"
                          data-testid="cm-remove-file"
                          className="fcb-button fcb-button-danger shrink-0"
                          disabled={uploading || removingPath !== null}
                          onClick={() => removeUploaded(path)}
                          aria-label={`Remove ${path}`}
                        >
                          {removingPath === path ? 'Removing…' : 'Remove'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!canRemoveFiles && uploadedFiles?.length > 0 && (
              <p className="text-xs text-[var(--fcb-text-faint)]">
                Removing files requires the in-browser engine.
              </p>
            )}
          </section>

          <LocalPerformanceCacheControl />
        </div>
      </aside>
    </div>
  );
}

export default function ContentManager({
  active = true,
  beforeLibraryMutation,
  duplicateReviewRequested = false,
  libraryRevision = 0,
  onLibraryChanged,
  onLibraryMutationFinished,
  onDuplicateReviewHandled,
  importNeed = null,
  onDismissNeed,
  registerSectionDeactivate,
}) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [contentProgress, setContentProgress] = useState(
    () => api.content.getLoadState?.() ?? null,
  );
  const [uploadResult, setUploadResult] = useState(null);
  const [importJob, setImportJob] = useState(null);
  const [sources, setSources] = useState([]);
  const [browseType, setBrowseType] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(null);
  // Per-type counts for the current source/search scope (the engine computes
  // them ignoring the type filter itself). Falls back to the library-wide
  // counts until the first scoped page arrives.
  const [scopedTypeCounts, setScopedTypeCounts] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [skip, setSkip] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState(null);
  const [removingPath, setRemovingPath] = useState(null);
  const [importSources, setImportSources] = useState([]);
  const [webUrl, setWebUrl] = useState('');
  const [importProgress, setImportProgress] = useState(null);
  const [removingSourceId, setRemovingSourceId] = useState(null);
  const [pendingFolderSource, setPendingFolderSource] = useState(null);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [pendingDuplicate, setPendingDuplicate] = useState(null);
  // A spell being made for a pack that granted it without defining it: the warning it answers,
  // and the collection of the builder that wrote it (null when the file is not one of those).
  const [spellFix, setSpellFix] = useState(null);
  const [resolvingDuplicateFingerprint, setResolvingDuplicateFingerprint] =
    useState(null);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const importAbortController = useRef(null);
  const manageFilesButton = useRef(null);
  const observedLibraryRevision = useRef(libraryRevision);
  const deferredSearch = useDeferredValue(search);
  const deferredFileFilter = useDeferredValue(fileFilter);
  // In-browser engine only: the remote backend has no per-file remove.
  const canRemoveFiles = typeof api.content.remove === 'function';
  const canManageSources = typeof api.content.replaceSource === 'function';

  // Default the browse view to the first element type once content loads; the user
  // can still override via the type nav. Derived (not effect-set) so the initial
  // load doesn't trigger a cascading setState-in-effect.
  const effectiveBrowseType =
    browseType || Object.keys(status?.elementTypes ?? {})[0] || '';
  const visibleFiles = useMemo(
    () => filterUploadedFiles(uploadedFiles ?? [], deferredFileFilter),
    [deferredFileFilter, uploadedFiles],
  );
  const effectiveFileManagerOpen = fileManagerOpen || duplicateReviewRequested || importNeed !== null;
  const closeFileManager = useCallback(() => {
    setFileManagerOpen(false);
    onDuplicateReviewHandled?.();
    onDismissNeed?.();
  }, [onDuplicateReviewHandled, onDismissNeed]);

  // A pack file shared from the Homebrew page opens as a pack, editable, wherever it is added.
  const packImport = usePackImport({
    api,
    store: localStore,
    beforeLibraryMutation,
    onLibraryChanged,
    onLibraryMutationFinished,
  });

  // The note about what to import goes away once the library defines it.
  useEffect(() => {
    if (!importNeed || !/^ID_[A-Z0-9_]+$/.test(importNeed.label)) return undefined;
    let alive = true;
    Promise.resolve(api.content.element(importNeed.label))
      .then((found) => {
        if (alive && found) onDismissNeed?.();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [importNeed, libraryRevision, onDismissNeed]);

  const startSpellFix = useCallback(async (diag) => {
    const records = await localStore.listHomebrew();
    const collection = records.find((record) => collectionStoragePath(record) === diag.file) ?? null;
    setSpellFix({ diag, collection, pack: collection?.name ?? 'My homebrew' });
  }, []);

  // The pack was saved again with the spell in it, so the warning it answered is done with and the
  // library holds one more element.
  const finishSpellFix = useCallback(
    (saved) => {
      if (!saved) return;
      const { diag } = spellFix;
      const resolved = (entry) => entry.file === diag.file && entry.missingId === diag.missingId;
      const clean = (diagnostics) => (diagnostics ?? []).filter((entry) => !resolved(entry));
      setImportJob((job) => (job ? { ...job, diagnostics: clean(job.diagnostics) } : job));
      setUploadResult((result) => (result ? { ...result, diagnostics: clean(result.diagnostics) } : result));
      api.content.clearCache?.();
      void onLibraryChanged?.({ source: 'homebrew', result: saved.result });
    },
    [onLibraryChanged, spellFix],
  );

  const refresh = useCallback(() => {
    api.content
      .status()
      .then((next) => {
        setError(null);
        setStatus(next);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => api.content.onLoadProgress?.(setContentProgress), []);

  useEffect(() => {
    api.content
      .sources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);

  // Device-cached uploaded content files (IndexedDB). Under the HTTP transport the store is
  // simply empty, so the panel degrades to its empty message.
  const refreshUploadedFiles = useCallback(() => {
    Promise.all([localStore.listContent(), localStore.listContentSources()])
      .then(async ([records, contentSources]) => {
        const sourcesById = new Map(
          contentSources.map((source) => [source.id, source]),
        );
        setUploadedFiles(
          records
            .map((record) => describeContentRecord(record, sourcesById))
            .sort((left, right) =>
              left.logicalPath.localeCompare(right.logicalPath),
            ),
        );
        setDuplicateGroups(
          await findDuplicateContentGroups(contentSources, records),
        );
      })
      .catch(() => {
        setUploadedFiles([]);
        setDuplicateGroups([]);
      });
  }, []);

  useEffect(() => {
    refreshUploadedFiles();
  }, [refreshUploadedFiles]);

  const refreshImportSources = useCallback(() => {
    if (!canManageSources) return Promise.resolve();
    return api.content
      .listSources()
      .then(setImportSources)
      .catch(() => setImportSources([]));
  }, [canManageSources]);

  useEffect(() => {
    refreshImportSources();
  }, [refreshImportSources]);

  const refreshContentAfterImport = useCallback(() => {
    api.content.clearCache();
    refresh();
    refreshUploadedFiles();
    refreshImportSources();
    api.content
      .sources()
      .then(setSources)
      .catch(() => {});
  }, [refresh, refreshImportSources, refreshUploadedFiles]);

  useEffect(() => {
    if (observedLibraryRevision.current === libraryRevision) return;
    observedLibraryRevision.current = libraryRevision;
    refreshContentAfterImport();
  }, [libraryRevision, refreshContentAfterImport]);

  useEffect(
    () =>
      registerSectionDeactivate?.(() => {
        setFileManagerOpen(false);
      }),
    [registerSectionDeactivate],
  );

  useEffect(() => {
    if (!importJob || !ACTIVE_IMPORT_STATUSES.has(importJob.status))
      return undefined;

    const handle = window.setTimeout(async () => {
      try {
        const next = await api.content.importStatus(importJob.jobId);
        setImportJob(next);
        if (!ACTIVE_IMPORT_STATUSES.has(next.status)) {
          api.content.clearCache();
          refresh();
          refreshUploadedFiles();
          api.content
            .sources()
            .then(setSources)
            .catch(() => {});
          if (next.status === 'succeeded') {
            setUploadResult({
              files: next.files,
              elementCountAfterReload: next.elementCountAfterReload,
              diagnostics: next.diagnostics ?? [],
            });
            await onLibraryChanged?.({ source: 'content' });
          }
          onLibraryMutationFinished?.();
        }
      } catch (e) {
        setError(e.message);
      }
    }, 1000);

    return () => window.clearTimeout(handle);
  }, [
    importJob,
    onLibraryChanged,
    onLibraryMutationFinished,
    refresh,
    refreshUploadedFiles,
  ]);

  const uploadUntrackedFiles = async (files, options = {}) => {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    setImportJob(null);
    setImportProgress(null);
    let pendingImport = false;
    try {
      await beforeLibraryMutation?.();
      const result = await api.content.upload(files, null, options);
      if (result.status === 'duplicate') {
        setPendingDuplicate({
          duplicate: result.duplicate,
          retry: () => uploadUntrackedFiles(files, { allowDuplicate: true }),
        });
        return;
      }
      setImportJob(result);
      pendingImport = ACTIVE_IMPORT_STATUSES.has(result.status);
      if (!pendingImport) {
        refreshContentAfterImport();
        if (result.status === 'succeeded') {
          setUploadResult({
            files: result.files,
            elementCountAfterReload: result.elementCountAfterReload,
            diagnostics: result.diagnostics ?? [],
          });
          await onLibraryChanged?.({ source: 'content' });
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (!pendingImport) onLibraryMutationFinished?.();
    }
  };

  const useExistingDuplicate = () => {
    const matchCount = pendingDuplicate?.duplicate.matches.length ?? 0;
    setPendingDuplicate(null);
    setUploadResult({
      files: [],
      removedNote: `Used the existing ${
        matchCount === 1 ? 'source' : 'sources'
      }; no duplicate was imported.`,
      diagnostics: [],
    });
  };

  const importDuplicateAnyway = () => {
    const retry = pendingDuplicate?.retry;
    setPendingDuplicate(null);
    void retry?.();
  };

  const runTrackedImport = async (resolveSource, options = {}) => {
    if (!canManageSources) return;
    const controller = new AbortController();
    importAbortController.current = controller;
    setUploading(true);
    setError(null);
    setUploadResult(null);
    setPendingDuplicate(null);
    setImportJob(null);
    try {
      const resolved = await resolveSource({
        signal: controller.signal,
        onProgress: setImportProgress,
      });
      setImportProgress({
        stage: 'ingest',
        message: `Adding ${resolved.files.length} files to the rules library…`,
      });
      await beforeLibraryMutation?.();
      const result = await api.content.replaceSource(
        resolved.files,
        resolved.source,
        options,
      );
      if (result.status === 'duplicate') {
        setPendingDuplicate({
          duplicate: result.duplicate,
          retry: () =>
            runTrackedImport(async () => resolved, { allowDuplicate: true }),
        });
        setImportProgress(null);
        return;
      }
      setUploadResult({
        files: result.files,
        elementCountAfterReload: result.elementCountAfterReload,
        diagnostics: result.diagnostics ?? [],
        ...(result.status === 'unchanged'
          ? {
              removedNote: `${resolved.source.label} is already up to date.`,
            }
          : {}),
      });
      if (result.status === 'unchanged') {
        setImportProgress({
          stage: 'complete',
          message: `${resolved.source.label} is already up to date.`,
        });
        return;
      }
      refreshContentAfterImport();
      setImportProgress({
        stage: 'complete',
        message: `Imported ${resolved.files.length} files from ${resolved.source.label}.`,
      });
      await onLibraryChanged?.({ source: 'content' });
    } catch (caught) {
      if (caught.name === 'AbortError') {
        setImportProgress({
          stage: 'cancelled',
          message: 'Import cancelled. Existing content was not changed.',
        });
      } else {
        setImportProgress(null);
        setError(caught.message);
      }
    } finally {
      if (importAbortController.current === controller) {
        importAbortController.current = null;
      }
      setUploading(false);
      onLibraryMutationFinished?.();
    }
  };

  const upload = async (event) => {
    event.preventDefault();
    const picked = Array.from(fileInput.current?.files ?? []);
    if (!picked.length) return;
    fileInput.current.value = '';
    // Pack files the builder wrote go to the pack importer; everything else is content as before.
    const files = [];
    for (const file of picked) {
      if (await sniffPackFile(file)) await packImport.start(file).catch((e) => setError(e.message));
      else files.push(file);
    }
    if (!files.length) return;
    if (!canManageSources) {
      void uploadUntrackedFiles(files);
      return;
    }
    void runTrackedImport(({ signal, onProgress }) =>
      resolveFilesSource(files, { signal, onProgress }),
    );
  };

  const importFolder = (event) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!files.length) {
      setPendingFolderSource(null);
      return;
    }
    if (!canManageSources) {
      void uploadUntrackedFiles(files);
      return;
    }
    const existingSource = pendingFolderSource;
    setPendingFolderSource(null);
    void runTrackedImport(({ signal, onProgress }) =>
      resolveFolderSource(files, {
        existingSource,
        signal,
        onProgress,
      }),
    );
  };

  const chooseFolder = () => {
    setPendingFolderSource(null);
    folderInput.current?.click();
  };

  const importWeb = (event) => {
    event.preventDefault();
    const location = webUrl.trim();
    if (!location) return;
    void runTrackedImport(({ signal, onProgress }) =>
      resolveWebSource(location, {
        signal,
        onProgress,
      }),
    );
  };

  const refreshSource = (source) => {
    if (source.kind === 'folder') {
      setPendingFolderSource(source);
      folderInput.current?.click();
      return;
    }
    void runTrackedImport(({ signal, onProgress }) =>
      resolveWebSource(source.location, {
        existingSource: source,
        signal,
        onProgress,
      }),
    );
  };

  const cancelImport = () => importAbortController.current?.abort();

  const keepDuplicateSource = async (group, keepSourceId) => {
    setResolvingDuplicateFingerprint(group.fingerprint);
    setError(null);
    let removedLocally = false;
    try {
      await beforeLibraryMutation?.();
      const result = await api.content.resolveDuplicates({
        keepSourceId,
        sourceIds: group.sourceIds,
      });
      removedLocally = true;
      refreshContentAfterImport();
      await onLibraryChanged?.({
        source: 'content',
        message: `Removed ${result.removedSourceIds.length} duplicate ${
          result.removedSourceIds.length === 1 ? 'source' : 'sources'
        }.`,
      });
      if (driveSyncService.getSnapshot().connected) {
        await driveSyncService.sync();
      }
      setUploadResult({
        files: [],
        removedNote: `Kept ${
          group.sources.find((source) => source.id === keepSourceId)?.label ??
          'the selected source'
        } and removed the redundant copies${
          driveSyncService.getSnapshot().connected
            ? ' from this device and Drive'
            : ' from this device'
        }.`,
        diagnostics: result.diagnostics ?? [],
        elementCountAfterReload: result.elementCountAfterReload,
      });
    } catch (caught) {
      setError(
        removedLocally
          ? `The duplicate was removed locally, but Drive could not be updated: ${caught.message}`
          : caught.message,
      );
    } finally {
      setResolvingDuplicateFingerprint(null);
      onLibraryMutationFinished?.();
    }
  };

  const keepAllDuplicates = async (group) => {
    setResolvingDuplicateFingerprint(group.fingerprint);
    setError(null);
    try {
      await beforeLibraryMutation?.();
      await api.content.acknowledgeDuplicates({
        fingerprint: group.fingerprint,
        sourceIds: group.sourceIds,
      });
      refreshContentAfterImport();
      if (driveSyncService.getSnapshot().connected) {
        await driveSyncService.sync();
      }
      setUploadResult({
        files: [],
        removedNote:
          'Kept every copy and remembered this decision across synced devices.',
        diagnostics: [],
      });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setResolvingDuplicateFingerprint(null);
      onLibraryMutationFinished?.();
    }
  };

  const removeSource = async (source) => {
    if (
      !window.confirm(
        `Remove every file imported from "${source.label}" and reload the library? Characters using its elements will lose those picks.`,
      )
    )
      return;
    setRemovingSourceId(source.id);
    setError(null);
    try {
      await beforeLibraryMutation?.();
      const result = await api.content.removeSource(source.id);
      refreshContentAfterImport();
      setImportJob(null);
      setUploadResult({
        files: [],
        elementCountAfterReload: result.elementCountAfterReload,
        diagnostics: result.diagnostics ?? [],
        removedNote: `Removed ${source.label}.`,
      });
      setImportProgress(null);
      await onLibraryChanged?.({ source: 'content' });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setRemovingSourceId(null);
      onLibraryMutationFinished?.();
    }
  };

  // Remove one previously uploaded file: delete the IndexedDB copy + the engine's staged
  // copy and re-ingest without it (in-browser engine only; feature-detected above).
  const removeUploaded = async (path) => {
    if (!canRemoveFiles) return;
    if (
      !window.confirm(
        `Remove "${path}" and reload the library without it? Characters using its elements will lose those picks.`,
      )
    )
      return;
    setRemovingPath(path);
    setError(null);
    try {
      await beforeLibraryMutation?.();
      const result = await api.content.remove([path]);
      refreshContentAfterImport();
      setImportJob(null);
      setUploadResult({
        files: [],
        elementCountAfterReload: result.elementCountAfterReload,
        diagnostics: result.diagnostics ?? [],
        removedNote: `Removed ${path}.`,
      });
      await onLibraryChanged?.({ source: 'content' });
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingPath(null);
      onLibraryMutationFinished?.();
    }
  };

  useEffect(() => {
    if (!effectiveBrowseType) return undefined;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      const params = { skip, take: 100 };
      if (effectiveBrowseType !== ALL_TYPES) params.type = effectiveBrowseType;
      if (sourceFilter) params.source = sourceFilter;
      if (deferredSearch.trim()) params.search = deferredSearch.trim();
      api.content
        .elements(params, { signal: controller.signal })
        .then((next) => {
          setPage(next);
          if (next.typeCounts) setScopedTypeCounts(next.typeCounts);
          setSelectedElementId((current) =>
            retainVisibleSelection(current, next.items),
          );
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [effectiveBrowseType, deferredSearch, skip, sourceFilter]);

  // The dropdown always lists every library type (so the current pick can't
  // vanish under a narrow source), but the counts follow the active scope.
  const elementTypes = Object.entries(status?.elementTypes ?? {}).map(
    ([type, count]) => [
      type,
      scopedTypeCounts ? (scopedTypeCounts[type] ?? 0) : count,
    ],
  );
  const totalElementCount = scopedTypeCounts
    ? Object.values(scopedTypeCounts).reduce((sum, count) => sum + count, 0)
    : (status?.elementCount ??
      elementTypes.reduce((sum, [, count]) => sum + count, 0));
  const browseTypeLabel =
    effectiveBrowseType === ALL_TYPES ? 'All types' : effectiveBrowseType;

  return (
    <div>
      <div className="fcb-page-heading fcb-content-heading">
        <div>
          <h1>Content library</h1>
          <p>
            Browse parsed rules content and preview rich descriptions served by
            the engine.
          </p>
        </div>
        <div className="fcb-content-heading-actions">
          {status && (
            <span className="fcb-stat-pill">
              <strong>{status.elementCount}</strong> elements
            </span>
          )}
          <button
            ref={manageFilesButton}
            type="button"
            className="fcb-button fcb-button-primary"
            data-testid="cm-manage-files"
            onClick={() => setFileManagerOpen(true)}
          >
            Manage files{uploadedFiles ? ` (${uploadedFiles.length})` : ''}
          </button>
        </div>
      </div>

      {error && !fileManagerOpen && (
        <p className="fcb-alert mb-4" role="alert">
          {error}
        </p>
      )}
      {status?.currentImport &&
        ACTIVE_IMPORT_STATUSES.has(status.currentImport.status) && (
          <p
            className="fcb-content-reload-status"
            role="status"
            aria-live="polite"
          >
            Content reload {status.currentImport.status}
          </p>
        )}

      <div className="fcb-content-grid">
        <section className="fcb-panel">
          <header className="fcb-panel-header">
            <div>
              <h2 className="fcb-panel-title">Elements</h2>
              <p
                className="fcb-panel-subtitle"
                role="status"
                aria-live="polite"
              >
                {page
                  ? `${page.total} matching elements · ${browseTypeLabel}`
                  : effectiveBrowseType
                    ? `Loading ${browseTypeLabel}…`
                    : 'Loading parsed content…'}
              </p>
            </div>
          </header>
          <div className="fcb-panel-body">
            <div className="fcb-content-filters">
              <label className="fcb-field-label">
                Type
                <FilterSelect
                  testId="cm-type-filter"
                  value={effectiveBrowseType}
                  disabled={elementTypes.length === 0}
                  placeholder="Loading types…"
                  options={[
                    {
                      value: ALL_TYPES,
                      label: `All types (${totalElementCount})`,
                    },
                    ...elementTypes.map(([type, count]) => ({
                      value: type,
                      label: `${type} (${count})`,
                    })),
                  ]}
                  onChange={(type) => {
                    setBrowseType(type);
                    setSelectedElementId(null);
                    setPage(null);
                    setSkip(0);
                  }}
                />
              </label>
              <label className="fcb-field-label">
                Search
                <input
                  className="fcb-input"
                  placeholder="Search elements…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSkip(0);
                  }}
                />
              </label>
              <label className="fcb-field-label">
                Source
                <FilterSelect
                  testId="cm-source-filter"
                  value={sourceFilter}
                  placeholder="All sources"
                  options={[
                    { key: '', value: '', label: 'All sources' },
                    ...sources.map((source) => contentSourceOption(source)),
                  ]}
                  onChange={(source) => {
                    setSourceFilter(source);
                    setSkip(0);
                  }}
                />
              </label>
            </div>

            <div className="fcb-scroll-panel mt-4 rounded border border-[var(--fcb-border-soft)]">
              <table className="fcb-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.items.map((item) => (
                    <tr
                      key={item.id}
                      className={
                        selectedElementId === item.id
                          ? 'fcb-row-inspected'
                          : ''
                      }
                    >
                      <td>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold">{item.name}</span>
                            <div className="text-xs text-[var(--fcb-text-faint)]">
                              {item.type}
                            </div>
                          </div>
                          <InformationButton
                            elementId={item.id}
                            label={item.name}
                            onInspect={setSelectedElementId}
                          />
                        </div>
                      </td>
                      <td className="text-xs text-[var(--fcb-text-muted)]">
                        {sourceLabel(item.source)}
                      </td>
                    </tr>
                  ))}
                  {page?.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={2}
                        className="text-[var(--fcb-text-faint)]"
                      >
                        No elements match these filters.
                      </td>
                    </tr>
                  )}
                  {!page && (
                    <tr>
                      <td
                        colSpan={2}
                        className="text-[var(--fcb-text-faint)]"
                      >
                        Loading elements…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {page && page.total > 100 && (
              <div className="fcb-toolbar mt-3 text-sm text-[var(--fcb-text-muted)]">
                <button
                  disabled={skip === 0}
                  onClick={() => setSkip(Math.max(0, skip - 100))}
                  className="fcb-button"
                >
                  Prev
                </button>
                <span>
                  {skip + 1}-{Math.min(skip + 100, page.total)} of {page.total}
                </span>
                <button
                  disabled={skip + 100 >= page.total}
                  onClick={() => setSkip(skip + 100)}
                  className="fcb-button"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </section>

        <DescriptionPanel
          elementId={selectedElementId}
          placeholder="Select a content element to preview its rich description."
          hideEmptyOnMobile
        />
      </div>

      <ContentFilesDrawer
        open={active && effectiveFileManagerOpen}
        onClose={closeFileManager}
        returnFocusRef={manageFilesButton}
        fileInput={fileInput}
        folderInput={folderInput}
        upload={upload}
        chooseFolder={chooseFolder}
        importFolder={importFolder}
        importWeb={importWeb}
        webUrl={webUrl}
        setWebUrl={setWebUrl}
        uploading={uploading}
        importProgress={importProgress}
        contentProgress={contentProgress}
        cancelImport={cancelImport}
        importSources={importSources}
        refreshSource={refreshSource}
        removeSource={removeSource}
        removingSourceId={removingSourceId}
        importJob={importJob}
        uploadResult={uploadResult}
        error={error}
        uploadedFiles={uploadedFiles}
        visibleFiles={visibleFiles}
        fileFilter={fileFilter}
        setFileFilter={setFileFilter}
        canRemoveFiles={canRemoveFiles}
        removingPath={removingPath}
        removeUploaded={removeUploaded}
        pendingDuplicate={pendingDuplicate}
        useExistingDuplicate={useExistingDuplicate}
        importDuplicateAnyway={importDuplicateAnyway}
        duplicateGroups={duplicateGroups}
        resolvingDuplicateFingerprint={resolvingDuplicateFingerprint}
        keepDuplicateSource={keepDuplicateSource}
        keepAllDuplicates={keepAllDuplicates}
        onCreateSpell={startSpellFix}
        importNeed={importNeed}
        packImport={packImport}
      />

      {spellFix && (
        <CustomSpellModal
          key={spellFix.diag.missingId}
          services={makePackSpellServices({
            api,
            store: localStore,
            collection: spellFix.collection,
            beforeSave: beforeLibraryMutation,
          })}
          characterName={spellFix.pack}
          pack={{ name: spellFix.pack }}
          initialDraft={spellDraftFromMissing(spellFix.diag)}
          onClose={() => setSpellFix(null)}
          onSaved={finishSpellFix}
        />
      )}
    </div>
  );
}
