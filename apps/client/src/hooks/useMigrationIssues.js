import { useCallback, useEffect, useRef, useState } from 'react';
import { localStore } from '../transport/localStore';

// Graceful content-update migration state.
//
// When uploaded content changes (edited/removed) and a character is opened, the
// engine reports stored choices it could not restore via `detail.loadIssues`.
// The engine re-saves the character shortly after load, which permanently erases
// the lost picks from the stored XML — so the loadIssues from the FIRST load
// after a content change are the only record. This hook persists them in
// IndexedDB (localStore meta, key `migration:{characterId}`) until the user
// re-picks every affected choice or explicitly dismisses the set.

// Issue kinds that correspond to a selection rule the user can simply re-pick.
export const SELECTION_ISSUE_KINDS = ['selectionInvalidated', 'selectionRuleMissing'];

export const isSelectionIssue = (issue) => SELECTION_ISSUE_KINDS.includes(issue?.kind);

// Issues carry no rule identifier (the rule may have been rebuilt), so they are
// matched to live selection rules by name + type.
export const issueMatchesRule = (issue, rule) =>
  issue?.ruleName != null && issue.ruleName === rule?.name && issue.ruleType === rule?.type;

// A rule needs a re-pick when the engine flagged it on this load (wasInvalidated)
// OR a persisted pending issue matches it (reloads after the engine's autosave
// report empty loadIssues, so the persisted set is the only source then).
export const ruleNeedsRepick = (rule, pendingIssues) =>
  !rule.hasSelection && (
    Boolean(rule.wasInvalidated) ||
    (pendingIssues ?? []).some((issue) => isSelectionIssue(issue) && issueMatchesRule(issue, rule))
  );

export const previousLabelFor = (issue) =>
  issue?.previousElementName ?? issue?.previousElementId ?? null;

// A grant can be reported missing during an intermediate engine load pass and then appear in
// the final registered-elements DTO after reprocessing. This also repairs migration records
// written by older builds, which may already be persisted in IndexedDB.
export function pruneResolvedGrantIssues(issues, registeredElements) {
  const restoredIds = new Set(
    (registeredElements ?? [])
      .map((element) => element?.id)
      .filter(Boolean),
  );
  return (issues ?? []).filter((issue) =>
    !(issue?.kind === 'elementMissing' && restoredIds.has(issue.previousElementId)),
  );
}

const issueKey = (issue) =>
  [issue.kind ?? '', issue.ruleType ?? '', issue.ruleName ?? '', issue.previousElementId ?? ''].join('|');

const metaKeyFor = (id) => `migration:${id}`;

export function useMigrationIssues({ id, detail, notify }) {
  const [pending, setPending] = useState([]);
  const [warning, setWarning] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Character ids whose drawer already auto-opened this session (ref, not
  // localStorage: a fresh session should re-surface unresolved issues once).
  const autoOpened = useRef(new Set());
  // Issue keys dismissed this session — the engine may still report the same
  // loadIssues on a refresh that races its autosave, and those must not
  // resurrect a set the user explicitly dismissed.
  const dismissedKeys = useRef(new Set());

  useEffect(() => {
    if (!id || !detail) return undefined;
    let alive = true;
    const rules = detail.selectionRules ?? [];
    const freshIssues = detail.loadIssues ?? [];
    const loadWarning = detail.loadWarning ?? null;

    (async () => {
      const stored = await localStore.getMeta(metaKeyFor(id)).catch(() => null);
      if (!alive) return;

      // Merge = union keyed by kind|ruleType|ruleName|previousElementId,
      // persisted entries first so first-seen records win. Later loads (after
      // the engine autosave) report EMPTY issues, which must NOT wipe the set.
      const byKey = new Map();
      for (const issue of stored?.issues ?? []) byKey.set(issueKey(issue), issue);
      for (const issue of freshIssues) {
        const key = issueKey(issue);
        if (!byKey.has(key) && !dismissedKeys.current.has(key)) byKey.set(key, issue);
      }

      const restoredIssuesPruned = pruneResolvedGrantIssues(
        [...byKey.values()],
        detail.registeredElements,
      );

      // Prune selection-type entries whose matching rule was re-picked.
      const merged = restoredIssuesPruned.filter((issue) => {
        if (!isSelectionIssue(issue)) return true;
        const rule = rules.find((r) => issueMatchesRule(issue, r));
        return !(rule && rule.hasSelection);
      });

      const hadStored = (stored?.issues?.length ?? 0) > 0;
      const nextWarning = loadWarning ?? stored?.warning ?? null;

      if (merged.length > 0) {
        await localStore.putMeta(metaKeyFor(id), {
          issues: merged,
          warning: nextWarning,
          detectedAt: stored?.detectedAt ?? Date.now(),
        }).catch(() => {});
        if (!alive) return;
        setPending(merged);
        setWarning(nextWarning);
        if (!autoOpened.current.has(id)) {
          autoOpened.current.add(id);
          setDrawerOpen(true);
        }
      } else {
        if (hadStored) {
          await localStore.deleteMeta(metaKeyFor(id)).catch(() => {});
          if (!alive) return;
          notify?.('All content changes resolved');
          setDrawerOpen(false);
        }
        if (!alive) return;
        setPending((current) => (current.length > 0 ? [] : current));
        setWarning(null);
      }
    })();

    return () => { alive = false; };
  }, [id, detail, notify]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // "Dismiss all": forget the persisted record (the losses stay applied — this
  // just stops tracking them). Confirmation happens in the drawer UI.
  const dismissAll = useCallback(() => {
    for (const issue of pending) dismissedKeys.current.add(issueKey(issue));
    setPending([]);
    setWarning(null);
    setDrawerOpen(false);
    return localStore.deleteMeta(metaKeyFor(id)).catch(() => {});
  }, [id, pending]);

  return { pending, warning, drawerOpen, openDrawer, closeDrawer, dismissAll };
}
