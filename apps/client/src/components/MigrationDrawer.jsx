import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useWorkspace } from './WorkspaceContext';
import Icon from './Icon';
import useDismissableOverlay from '../hooks/useDismissableOverlay';
import {
  isSelectionIssue,
  issueMatchesRule,
  previousLabelFor,
} from '../hooks/useMigrationIssues';

// Human-readable framing per engine load-issue kind.
const KIND_LABELS = {
  selectionInvalidated: 'Previous pick is no longer a legal option',
  selectionRuleMissing:
    'The choice this pick belonged to changed or was removed',
  optionMissing: 'A stored option is missing from the content',
  levelMissing: 'A stored level entry could not be restored',
  equipmentMissing: 'An equipment entry could not be restored',
  elementMissing: 'A granted feature is missing from the content',
};

// The content-update migration drawer: lists everything the engine could not
// restore after a content change. Re-pickable selection rules get an inline
// "Fix now" option list; purely informational losses are listed for review.
// Pending state lives in useMigrationIssues (persisted in IndexedDB) and is
// pruned automatically after each re-pick, so items disappear as they are fixed.
export default function MigrationDrawer({ onClose, onDismissAll }) {
  const {
    id,
    detail,
    busy,
    run,
    getCachedResource,
    pendingMigration,
    migrationWarning,
    libraryRevision,
    active,
    createLibraryPickerRefreshController,
    ensureLibraryRevisionReady,
  } = useWorkspace();
  const pending = pendingMigration ?? [];
  const rules = useMemo(() => detail?.selectionRules ?? [], [detail]);
  // Which fixable rule's option list is expanded (rule identifier), plus a
  // per-rule option cache so a slow fetch can never render under the wrong rule.
  const [expanded, setExpanded] = useState(null);
  const [optionsByRule, setOptionsByRule] = useState({});
  const [filter, setFilter] = useState('');
  const [optionsRefreshing, setOptionsRefreshing] = useState(false);
  const [optionsRefreshError, setOptionsRefreshError] = useState(null);
  const [optionsRefreshAttempt, setOptionsRefreshAttempt] = useState(0);
  const [optionsRefreshController] = useState(() =>
    createLibraryPickerRefreshController(libraryRevision),
  );
  const optionRequestGeneration = useRef(0);
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);

  useDismissableOverlay({
    panelRef,
    initialFocusRef: closeButtonRef,
    onDismiss: onClose,
  });

  const fixable = [];
  const informational = [];
  for (const issue of pending) {
    if (isSelectionIssue(issue)) {
      const rule = rules.find((r) => issueMatchesRule(issue, r));
      // Already re-picked: the persisted prune is in flight, don't show it at all.
      if (rule?.hasSelection) continue;
      if (rule) {
        fixable.push({ issue, rule });
        continue;
      }
    }
    // Unmatched selection issues and equipment/option/level/element losses are
    // informational — there is nothing to re-pick.
    informational.push(issue);
  }

  const warning = detail?.loadWarning ?? migrationWarning;

  const loadRuleOptions = async (rule, { force = false } = {}) => {
    const generation = ++optionRequestGeneration.current;
    setOptionsByRule((current) => ({
      ...current,
      [rule.identifier]: {
        ...current[rule.identifier],
        error: null,
      },
    }));
    try {
      const cacheKey = `selection-options:${id}:${rule.identifier}`;
      const load = () => api.characters.selectionOptions(id, rule.identifier);
      const data = await (getCachedResource
        ? getCachedResource(cacheKey, load, { force })
        : load());
      if (generation !== optionRequestGeneration.current) return;
      setOptionsByRule((current) => ({
        ...current,
        [rule.identifier]: { data },
      }));
    } catch (e) {
      if (generation !== optionRequestGeneration.current) return;
      setOptionsByRule((current) => ({
        ...current,
        [rule.identifier]: { error: e.message },
      }));
    }
  };

  const toggleFix = (rule) => {
    if (expanded === rule.identifier) {
      optionRequestGeneration.current += 1;
      setExpanded(null);
      return;
    }
    setExpanded(rule.identifier);
    setFilter('');
    if (optionsByRule[rule.identifier]?.data) return;
    void loadRuleOptions(rule);
  };

  useEffect(() => {
    if (!active || !expanded || libraryRevision === 0) {
      return undefined;
    }
    const rule = rules.find((candidate) => candidate.identifier === expanded);
    if (!rule) return undefined;
    const request = optionsRefreshController.request(
      libraryRevision,
      active,
      () => {
        const generation = ++optionRequestGeneration.current;
        return ensureLibraryRevisionReady(libraryRevision, active)
          .then(() =>
            getCachedResource(
              `selection-options:${id}:${rule.identifier}`,
              () => api.characters.selectionOptions(id, rule.identifier),
              { force: true },
            ),
          )
          .then((data) => ({ data, generation }));
      },
      rule.identifier,
    );
    if (!request) return undefined;
    let alive = true;
    setOptionsRefreshing(true);
    setOptionsRefreshError(null);
    request
      .then((result) => {
        if (
          !alive ||
          result.stale ||
          result.value.generation !== optionRequestGeneration.current
        ) {
          return;
        }
        setOptionsByRule((current) => ({
          ...current,
          [rule.identifier]: { data: result.value.data },
        }));
        setOptionsRefreshing(false);
      })
      .catch((caught) => {
        if (!alive) return;
        setOptionsRefreshing(false);
        setOptionsRefreshError(caught.message);
        setOptionsByRule((current) => ({
          ...current,
          [rule.identifier]: {
            ...current[rule.identifier],
            error: caught.message,
          },
        }));
      });
    return () => {
      alive = false;
    };
  }, [
    active,
    ensureLibraryRevisionReady,
    expanded,
    getCachedResource,
    id,
    optionsRefreshAttempt,
    libraryRevision,
    optionsRefreshController,
    rules,
  ]);

  const pickOption = async (rule, option) => {
    try {
      await run(() =>
        api.characters.setSelection(id, rule.identifier, option.id),
      );
      // The refresh re-prunes the persisted set; the fixed item disappears.
      setExpanded(null);
    } catch {
      /* surfaced by the workspace error banner */
    }
  };

  const confirmDismissAll = () => {
    const ok = window.confirm(
      'Dismiss all pending content changes? The lost picks stay lost and will no longer be tracked.',
    );
    if (ok) onDismissAll();
  };

  const renderPrevious = (issue) => {
    const label = previousLabelFor(issue);
    return label ? (
      <p className="fcb-warning-note mt-1 text-xs">Previously: {label}</p>
    ) : null;
  };

  return (
    <div
      className="fcb-scrim-overlay fcb-side-drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="migration-drawer"
        aria-labelledby="fcb-migration-drawer-title"
        aria-modal="true"
        className="fcb-side-drawer"
        ref={panelRef}
        role="dialog"
      >
        <div className="fcb-side-drawer-header">
          <h3 className="fcb-panel-title" id="fcb-migration-drawer-title">
            Content changes
          </h3>
          <button
            onClick={onClose}
            className="fcb-icon-button"
            aria-label="Close"
            ref={closeButtonRef}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="fcb-side-drawer-body">
        {warning && (
          <p className="fcb-alert fcb-warning-banner mb-3">
            {warning}
          </p>
        )}
        <p className="mb-4 text-xs text-[var(--fcb-text-faint)]">
          Your uploaded content changed since this character was last opened,
          and some stored choices could not be restored. Re-pick what you can
          below — this list is the only record of what was lost.
        </p>

        <div className="space-y-5 text-sm">
          {fixable.length > 0 && (
            <section className="space-y-2">
              <h4 className="fcb-card-title text-sm">Needs a new pick</h4>
              {fixable.map(({ issue, rule }) => (
                <div
                  key={rule.identifier}
                  data-testid="migration-item"
                  className="fcb-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="fcb-strong-text font-semibold">
                        {rule.name || rule.type}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--fcb-text-faint)]">
                        {KIND_LABELS[issue.kind] ?? issue.message}
                      </div>
                      {renderPrevious(issue)}
                    </div>
                    <button
                      data-testid="migration-fix"
                      className="fcb-button shrink-0"
                      disabled={busy}
                      onClick={() => toggleFix(rule)}
                      aria-expanded={expanded === rule.identifier}
                    >
                      {expanded === rule.identifier ? 'Hide' : 'Fix now'}
                    </button>
                  </div>

                  {expanded === rule.identifier && (
                    <div className="mt-3 border-t border-[var(--fcb-border-soft)] pt-3">
                      {optionsRefreshing && (
                        <p
                          className="fcb-muted-copy mb-2"
                          role="status"
                          aria-live="polite"
                        >
                          Refreshing options…
                        </p>
                      )}
                      {optionsRefreshError && (
                        <p className="fcb-alert mb-2" role="alert">
                          Could not refresh options: {optionsRefreshError}{' '}
                          <button
                            type="button"
                            className="fcb-button"
                            onClick={() =>
                              setOptionsRefreshAttempt((attempt) => attempt + 1)
                            }
                          >
                            Retry
                          </button>
                        </p>
                      )}
                      {optionsByRule[rule.identifier]?.error && (
                        <p className="fcb-alert">
                          {optionsByRule[rule.identifier].error}{' '}
                          <button
                            type="button"
                            className="fcb-button"
                            onClick={() =>
                              void loadRuleOptions(rule, { force: true })
                            }
                          >
                            Retry
                          </button>
                        </p>
                      )}
                      {!optionsByRule[rule.identifier] && (
                        <p className="fcb-empty-copy">Loading options…</p>
                      )}
                      {optionsByRule[rule.identifier]?.data && (
                        <>
                          {optionsByRule[rule.identifier].data.length > 8 && (
                            <input
                              className="fcb-input mb-2"
                              placeholder="Filter…"
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                            />
                          )}
                          <div className="max-h-56 space-y-1 overflow-y-auto">
                            {optionsByRule[rule.identifier].data
                              .filter((o) =>
                                o.name
                                  .toLowerCase()
                                  .includes(filter.toLowerCase()),
                              )
                              .map((option) => (
                                <button
                                  key={option.id}
                                  data-testid="migration-option"
                                  disabled={busy}
                                  onClick={() => pickOption(rule, option)}
                                  className="block w-full rounded border border-[var(--fcb-border-soft)] fcb-inset-panel px-3 py-1.5 text-left hover:border-[var(--fcb-warning-border)] disabled:opacity-50"
                                >
                                  <span className="block">{option.name}</span>
                                  {option.source && (
                                    <span className="block text-xs text-[var(--fcb-text-faint)]">
                                      {option.source}
                                    </span>
                                  )}
                                </button>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {informational.length > 0 && (
            <section className="space-y-2">
              <h4 className="fcb-card-title text-sm">
                Lost with the content update
              </h4>
              {informational.map((issue, index) => (
                <div
                  key={`${issue.kind}|${issue.ruleType}|${issue.ruleName}|${issue.previousElementId}|${index}`}
                  data-testid="migration-item"
                  className="fcb-card p-3"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fcb-text-faint)]">
                    {KIND_LABELS[issue.kind] ?? 'Could not be restored'}
                  </div>
                  <div className="mt-1">{issue.message}</div>
                  {renderPrevious(issue)}
                </div>
              ))}
            </section>
          )}

          {fixable.length === 0 && informational.length === 0 && (
            <p className="fcb-empty-copy">No pending content changes.</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-[var(--fcb-border-soft)] pt-4">
          <button
            data-testid="migration-dismiss-all"
            className="fcb-button fcb-button-danger"
            disabled={busy || pending.length === 0}
            onClick={confirmDismissAll}
          >
            Dismiss all
          </button>
          <button className="fcb-button" onClick={onClose}>
            Close
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
