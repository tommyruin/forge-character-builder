import { useDriveSyncState } from '../../hooks/useDriveSyncState.js';

function syncTimeLabel(value) {
  if (!value) return 'Not synced yet';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'Previously synced';
  }
}

function statusCopy(state) {
  if (state.busy) {
    if (state.status === 'connecting') return 'Connecting to Google…';
    if (state.status === 'disconnecting') return 'Disconnecting…';
    return 'Syncing library…';
  }
  if (state.connected) return 'Connected';
  if (state.status === 'reconnect') return 'Reconnect required';
  if (!state.configured) return 'Not configured';
  return 'Not connected';
}

function count(value) {
  return Number.isFinite(value) ? value : 0;
}

export default function DriveSyncPanel({
  beforeSync,
  compact = false,
  onLibraryChanged,
  onReviewDuplicates,
  onSyncFinished,
}) {
  const drive = useDriveSyncState();
  const summary = drive.summary ?? {};
  const run = (action, { syncsLibrary = false } = {}) => {
    void (async () => {
      try {
        if (syncsLibrary) await beforeSync?.();
        await action();
        if (syncsLibrary) {
          await onLibraryChanged?.({
            source: 'cloud',
            message: 'Drive sync updated your local library.',
          });
        }
      } catch {
        // The service already exposes the user-safe error through observable state.
      } finally {
        if (syncsLibrary) onSyncFinished?.();
      }
    })();
  };
  const statusClass = drive.busy
    ? 'is-busy'
    : drive.connected
      ? 'is-connected'
      : '';

  return (
    <div className="fcb-cloud-sync">
      <div className={`fcb-cloud-heading ${compact ? 'is-compact' : ''}`}>
        <div>
          {!compact && <h1>Storage & sync</h1>}
          <p>Manage your local library and optional Google Drive sync.</p>
        </div>
        <span
          className={`fcb-cloud-status ${statusClass}`}
          role="status"
          aria-live="polite"
        >
          <span className="fcb-cloud-status-dot" aria-hidden="true" />
          {statusCopy(drive)}
        </span>
      </div>

      {drive.error && (
        <p className="fcb-alert" role="alert">
          {drive.error}
        </p>
      )}

      {count(summary.duplicateGroups) > 0 && (
        <div className="fcb-alert fcb-cloud-duplicate-alert" role="alert">
          <p>
            Drive sync found {count(summary.duplicateSources)} sources in{' '}
            {count(summary.duplicateGroups)} exact duplicate{' '}
            {count(summary.duplicateGroups) === 1 ? 'group' : 'groups'}.
            Nothing was removed.
          </p>
          <button
            type="button"
            className="fcb-button"
            onClick={onReviewDuplicates}
          >
            Review duplicates
          </button>
        </div>
      )}

      <div className="fcb-cloud-layout">
        <section className="fcb-card fcb-cloud-card">
          <h2 className="fcb-card-title">Your library</h2>

          <div
            className="fcb-cloud-summary-grid"
            aria-label="Library summary"
          >
            <div className="fcb-cloud-summary-item">
              <strong>{count(summary.characters)}</strong>
              <span>Characters</span>
            </div>
            <div className="fcb-cloud-summary-item">
              <strong>{count(summary.content)}</strong>
              <span>Content files</span>
            </div>
            <div className="fcb-cloud-summary-item">
              <strong>{count(summary.homebrew)}</strong>
              <span>Homebrew drafts</span>
            </div>
          </div>

          {!drive.configured && (
            <p className="fcb-cloud-card-copy">
              Google Drive is unavailable in this build.
            </p>
          )}

          {drive.connected && (
            <dl className="fcb-cloud-detail-list">
              <div>
                <dt>Google account</dt>
                <dd>
                  {drive.account?.emailAddress ||
                    drive.account?.displayName ||
                    'Connected account'}
                </dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{syncTimeLabel(drive.lastSyncedAt)}</dd>
              </div>
              <div>
                <dt>Merge conflicts</dt>
                <dd>
                  {count(summary.conflicts) === 0
                    ? 'None'
                    : `${count(summary.conflicts)} safely retained in history`}
                </dd>
              </div>
            </dl>
          )}

          <div className="fcb-cloud-actions">
            {drive.configured && !drive.connected && (
              <button
                type="button"
                className="fcb-button fcb-button-primary"
                disabled={drive.busy}
                onClick={() =>
                  run(drive.connect, { syncsLibrary: true })
                }
              >
                {drive.status === 'reconnect'
                  ? 'Reconnect Google Drive'
                  : 'Connect Google Drive'}
              </button>
            )}
            {drive.connected && (
              <>
                <button
                  type="button"
                  className="fcb-button fcb-button-primary"
                  disabled={drive.busy}
                  onClick={() =>
                    run(drive.sync, { syncsLibrary: true })
                  }
                >
                  {drive.busy ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  type="button"
                  className="fcb-button"
                  disabled={drive.busy}
                  onClick={() => run(drive.disconnect)}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>

          <details className="fcb-cloud-info">
            <summary>How Google Drive sync works</summary>
            <div>
              <p>
                Connect the same Google account on each device. DM Forge finds
                its library document, merges changes, and keeps a local offline
                copy.
              </p>
              <p>
                Your files travel directly between this browser and Google
                Drive. The temporary access token is not stored in your
                library.
              </p>
              <p>
                Google may occasionally ask you to reconnect. Your local work
                remains available while disconnected.
              </p>
              {!drive.configured && (
                <p>
                  This deployment needs a public Google OAuth client ID before
                  Drive can be connected. No client secret is required.
                </p>
              )}
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
