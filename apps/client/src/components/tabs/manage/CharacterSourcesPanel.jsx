import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import Modal from "../../Modal";
import {
  normalizeRestrictedSourceIds,
  readDefaultRestrictedSourceIds,
  writeDefaultRestrictedSourceIds,
} from "../../../sourcePreferences.js";
import { useWorkspace } from "../../WorkspaceContext";
import {
  formatSourceReleaseDate,
  getNewlyDisabledOverrideSources,
  getSourceGroupState,
  getToggleableSourceIds,
  getVisibleSourceGroups,
  isSourceEnabled,
} from "./characterSources.js";

function sameIds(left, right) {
  const a = normalizeRestrictedSourceIds(left);
  const b = normalizeRestrictedSourceIds(right);
  return a.length === b.length && a.every((id) => b.includes(id));
}

function setCheckboxIndeterminate(node, mixed) {
  if (node) node.indeterminate = mixed;
}

function sourceGroupContentId(name) {
  const slug = String(name ?? "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `source-group-${slug || "group"}-content`;
}

/** The System Reference Document a built-in book stub carries, from its information setter. */
function builtInDocument(source) {
  return /5\.2/.test(source.information ?? "")
    ? "System Reference Document 5.2.1"
    : "System Reference Document 5.1";
}

/**
 * An (i) beside a group whose books ship as built-in stubs: only their System
 * Reference Document content is included, and importing the book fills in the
 * rest in place. Rendered as a native disclosure so it needs no state. An
 * imported copy keeps the note (and says so) because disabling it still hides
 * the bundled copy it replaced.
 */
export function BuiltInSourcesNote({ groupName, sources }) {
  const stubs = sources.filter((source) => source.isIncomplete);
  const overrides = sources.filter((source) => source.overridesBundledCore);
  if (stubs.length === 0 && overrides.length === 0) return null;
  const documents = [...new Set(stubs.map(builtInDocument))];
  return (
    <details className="fcb-source-group-info">
      <summary
        className="fcb-source-group-info-summary"
        aria-label={`About the built-in ${groupName} sources`}
        title="What is built in"
      >
        <span aria-hidden="true">i</span>
      </summary>
      <p className="fcb-source-group-note fcb-muted-copy text-xs">
        {stubs.length > 0 && (
          <>
            Built in: {stubs.map((source) => source.name).join(", ")}. The
            built-in copy of each contains only the content published in{" "}
            {documents.join(" and ")}.
          </>
        )}
        {stubs.length > 0 && overrides.length > 0 ? " " : null}
        {overrides.length > 0 && (
          <>
            Imported: {overrides.map((source) => source.name).join(", ")}. Each
            imported copy replaces the built-in one in place, so disabling it
            also hides the bundled content.
          </>
        )}
      </p>
    </details>
  );
}

export function SourceGroupList({
  groups,
  restrictedSourceIds,
  search,
  disabled,
  onToggleGroup,
  onToggleSource,
}) {
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const visibleGroups = getVisibleSourceGroups(groups, search);

  if (!visibleGroups.length) return null;

  return (
    <div className="space-y-3" data-testid="source-group-list">
      {visibleGroups.map(({ group, sources }) => {
        const visibleGroup = { ...group, sources };
        const state = getSourceGroupState(visibleGroup, restrictedSourceIds);
        const canToggle =
          group.canToggle && sources.some((source) => source.canToggle);
        const collapsed = collapsedGroups.has(group.name);
        const contentId = sourceGroupContentId(group.name);
        return (
          <section
            className="fcb-card fcb-source-group overflow-hidden"
            key={group.name}
            data-testid={`source-group-${group.name}`}
            data-collapsed={collapsed}
          >
            <header className="fcb-source-group-header flex flex-wrap items-center justify-between gap-3 border-b border-[var(--fcb-border-soft)] px-4 py-3">
              <div className="fcb-source-group-heading min-w-0">
                <div className="fcb-source-group-title-row">
                  <h3 id={`${contentId}-title`} className="m-0 font-semibold">
                    {group.name}
                  </h3>
                  <button
                    type="button"
                    className="fcb-source-group-toggle"
                    aria-expanded={!collapsed}
                    aria-controls={contentId}
                    aria-label={`${collapsed ? "Expand" : "Minimize"} ${group.name} sources`}
                    onClick={() =>
                      setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.name)) next.delete(group.name);
                        else next.add(group.name);
                        return next;
                      })
                    }
                  >
                    <span aria-hidden="true">{collapsed ? "+" : "−"}</span>
                  </button>
                  <BuiltInSourcesNote
                    groupName={group.name}
                    sources={sources}
                  />
                </div>
                <p className="fcb-muted-copy text-xs">
                  {state.enabledCount} of {state.totalCount} included
                  {search.trim() && ` · ${sources.length} shown`}
                </p>
              </div>
              <label className="inline-flex shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.allEnabled}
                  ref={(node) => setCheckboxIndeterminate(node, state.mixed)}
                  aria-checked={state.mixed ? "mixed" : state.allEnabled}
                  aria-label={`Toggle all ${group.name} sources`}
                  disabled={disabled || !canToggle}
                  onChange={() => onToggleGroup(visibleGroup, state)}
                />
                <span>{state.allEnabled ? "All included" : "Include all"}</span>
              </label>
            </header>
            <div
              id={contentId}
              aria-labelledby={`${contentId}-title`}
              hidden={collapsed}
              className="divide-y divide-[var(--fcb-border-soft)]"
            >
              {sources.map((source) => {
                const enabled = isSourceEnabled(source, restrictedSourceIds);
                const releaseDate = formatSourceReleaseDate(source.releaseDate);
                return (
                  <label
                    className="flex min-w-0 cursor-pointer items-start gap-3 px-4 py-3 text-sm has-[:disabled]:cursor-default"
                    key={source.id}
                    data-testid={`source-row-${source.id}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={enabled}
                      disabled={disabled || !source.canToggle}
                      onChange={() => onToggleSource(source)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                        <span className="break-words">{source.name}</span>
                        {!source.canToggle && (
                          <span className="fcb-badge">Required</span>
                        )}
                        {source.isPlaytest && (
                          <span className="fcb-badge">Playtest</span>
                        )}
                        {source.overridesBundledCore && (
                          <span
                            className="fcb-badge fcb-badge-override"
                            title="The imported copy replaces the built-in book in place; disabling it also hides the bundled content."
                          >
                            Replaces bundled content
                          </span>
                        )}
                      </span>
                      <span className="fcb-muted-copy block break-words text-xs">
                        {source.author || "Unknown author"}
                        {releaseDate ? ` · ${releaseDate}` : ""}
                        {source.hasElements ? "" : " · No rules loaded"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Confirmation before a draft change disables a book whose imported files
 * replaced the bundled copy: turning it off also hides that bundled content,
 * so the user says yes or no before the draft changes.
 */
export function OverrideDisableDialog({ pending, onCancel, onConfirm }) {
  const sources = pending?.sources ?? [];
  const names = sources.map((source) => source.name).join(", ");
  const pronoun = sources.length === 1 ? "its" : "their";
  return (
    <Modal
      open={Boolean(pending)}
      title="Disable bundled content?"
      onClose={onCancel}
    >
      <p>
        Disabling <strong>{names}</strong> also hides the built-in System
        Reference Document content {pronoun} imported files replace.
      </p>
      <div className="fcb-toolbar mt-4 justify-end">
        <button type="button" className="fcb-button" onClick={onCancel}>
          No, keep enabled
        </button>
        <button
          type="button"
          className="fcb-button fcb-button-primary"
          onClick={onConfirm}
        >
          Yes, disable
        </button>
      </div>
    </Modal>
  );
}

export function SourceActionsFooter({
  busy,
  saving,
  savingDefault,
  dirty,
  onApply,
  onDiscard,
  onSaveDefault,
}) {
  const disabled = busy || saving || savingDefault;
  return (
    <footer
      className="fcb-source-actions-footer"
      data-testid="source-actions-footer"
    >
      <div className="fcb-source-footer-actions">
        <button
          type="button"
          className="fcb-button fcb-button-primary"
          aria-label={saving ? "Applying source changes" : "Apply changes"}
          disabled={disabled || !dirty}
          onClick={onApply}
        >
          <span className="fcb-source-action-label--full" aria-hidden="true">
            {saving ? "Applying…" : "Apply changes"}
          </span>
          <span className="fcb-source-action-label--compact" aria-hidden="true">
            {saving ? "Applying…" : "Apply"}
          </span>
        </button>
        <button
          type="button"
          className="fcb-button"
          aria-label="Discard source changes"
          disabled={disabled || !dirty}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          type="button"
          className="fcb-button fcb-source-save-default"
          aria-label={
            savingDefault
              ? "Saving default sources"
              : "Save as default for new characters"
          }
          disabled={disabled || dirty}
          onClick={onSaveDefault}
        >
          <span className="fcb-source-action-label--full" aria-hidden="true">
            {savingDefault
              ? "Saving default…"
              : "Save as default for new characters"}
          </span>
          <span className="fcb-source-action-label--compact" aria-hidden="true">
            {savingDefault ? "Saving…" : "Save default"}
          </span>
        </button>
      </div>
      <p className="fcb-muted-copy fcb-source-actions-help text-xs">
        Required core sources cannot be disabled. Saving a default applies these
        sources to every new character you create; it does not alter this
        character or imported characters.
      </p>
    </footer>
  );
}

function normalizeSourceResponse(response) {
  return {
    groups: Array.isArray(response?.groups) ? response.groups : [],
    restrictedSourceIds: normalizeRestrictedSourceIds(
      response?.restrictedSourceIds,
    ),
    unavailableRestrictedSourceIds: normalizeRestrictedSourceIds(
      response?.unavailableRestrictedSourceIds,
    ),
  };
}

export default function CharacterSourcesPanel() {
  const { id, busy, run, notify } = useWorkspace();
  const [sources, setSources] = useState(null);
  const [appliedSourceIds, setAppliedSourceIds] = useState([]);
  const [draftSourceIds, setDraftSourceIds] = useState([]);
  const [defaultSourceIds, setDefaultSourceIds] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [error, setError] = useState(null);
  const [pendingOverride, setPendingOverride] = useState(null);
  const requestNumber = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    setError(null);
    try {
      const [response, defaults] = await Promise.all([
        api.characters.sources(id),
        readDefaultRestrictedSourceIds(),
      ]);
      if (request !== requestNumber.current) return;
      const next = normalizeSourceResponse(response);
      setSources(next);
      setAppliedSourceIds(next.restrictedSourceIds);
      setDraftSourceIds(next.restrictedSourceIds);
      setDefaultSourceIds(defaults);
    } catch (caught) {
      if (request === requestNumber.current) setError(caught.message);
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      requestNumber.current += 1;
    };
  }, [refresh]);

  const dirty = !sameIds(draftSourceIds, appliedSourceIds);

  // A draft change that disables an importing source asks first: turning it
  // off also hides the bundled content its imported files replace.
  const requestDraftChange = (nextIds) => {
    const newlyDisabled = getNewlyDisabledOverrideSources(
      sources?.groups,
      draftSourceIds,
      nextIds,
    );
    if (newlyDisabled.length > 0) {
      setPendingOverride({ nextIds, sources: newlyDisabled });
      return;
    }
    setDraftSourceIds(nextIds);
  };

  const toggleSource = (source) => {
    if (!source.canToggle) return;
    const ids = new Set(draftSourceIds);
    if (ids.has(source.id)) ids.delete(source.id);
    else ids.add(source.id);
    requestDraftChange([...ids]);
  };

  const toggleGroup = (group, state) => {
    const toggleableIds = group.sources
      .filter((source) => source.canToggle)
      .map((source) => source.id);
    if (!toggleableIds.length) return;
    const ids = new Set(draftSourceIds);
    if (state.allEnabled || state.mixed) {
      toggleableIds.forEach((id) => ids.add(id));
    } else {
      toggleableIds.forEach((id) => ids.delete(id));
    }
    requestDraftChange([...ids]);
  };

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await run(() =>
        api.characters.setSources(id, draftSourceIds),
      );
      const next = normalizeSourceResponse(response);
      setSources(next);
      setAppliedSourceIds(next.restrictedSourceIds);
      setDraftSourceIds(next.restrictedSourceIds);
      notify("Source restrictions applied to this character.");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  };

  // Drops the saved restrictions whose sources are not in the loaded library.
  // Applied immediately (its own action, not part of the draft): the notice
  // offers it as the explicit way to stop carrying settings for content that
  // is not imported on this device.
  const forgetUnavailable = async () => {
    const unavailable = new Set(sources?.unavailableRestrictedSourceIds ?? []);
    if (unavailable.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const kept = appliedSourceIds.filter(
        (sourceId) => !unavailable.has(sourceId),
      );
      const response = await run(() => api.characters.setSources(id, kept));
      const next = normalizeSourceResponse(response);
      setSources(next);
      setAppliedSourceIds(next.restrictedSourceIds);
      setDraftSourceIds(next.restrictedSourceIds);
      notify("Forgot restrictions for content that is not imported.");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  };

  const saveDefault = async () => {
    if (dirty) return;
    setSavingDefault(true);
    setError(null);
    try {
      const next = await writeDefaultRestrictedSourceIds(appliedSourceIds);
      setDefaultSourceIds(next);
      notify("Saved as the default for new characters.");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSavingDefault(false);
    }
  };

  if (loading && !sources) {
    return (
      <section className="fcb-panel" aria-busy="true">
        <div className="fcb-panel-body">
          <p className="fcb-empty-copy" role="status">
            Loading sources…
          </p>
        </div>
      </section>
    );
  }

  if (error && !sources) {
    return (
      <section className="fcb-panel fcb-sources-panel">
        <div className="fcb-panel-body space-y-3">
          <p className="fcb-alert" role="alert">
            {error}
          </p>
          <button type="button" className="fcb-button" onClick={refresh}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  const groupCount = sources?.groups?.length ?? 0;
  const sourceCount =
    sources?.groups?.reduce(
      (count, group) => count + (group.sources?.length ?? 0),
      0,
    ) ?? 0;
  const unavailableCount = sources?.unavailableRestrictedSourceIds?.length ?? 0;
  const visibleGroupCount = getVisibleSourceGroups(
    sources?.groups,
    search,
  ).length;

  return (
    <div
      className="fcb-character-sources-panel"
      data-testid="character-sources-panel"
      aria-busy={loading || saving || savingDefault}
    >
      <section className="fcb-panel fcb-sources-panel-top">
        <header className="fcb-panel-header fcb-sources-header">
          <div className="min-w-0">
            <h2 className="fcb-panel-title">Sources</h2>
            <p className="fcb-panel-subtitle fcb-sources-intro">
              Choose which source books and content this character can use.
              Changes are saved to this character only after you apply them.
            </p>
          </div>
          <span className="fcb-muted-copy fcb-sources-count text-xs">
            {groupCount} groups · {sourceCount} sources
          </span>
        </header>
        <div className="fcb-panel-body fcb-sources-controls">
          {error && (
            <p className="fcb-alert" role="alert">
              {error}
            </p>
          )}
          <div className="fcb-sources-controls-row">
            <label className="fcb-field-label fcb-sources-search">
              <span className="fcb-sources-search-label">Search sources</span>
              <input
                type="search"
                className="fcb-input normal-case"
                aria-label="Search sources"
                placeholder="Name, author, or ID"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="fcb-sources-bulk-actions">
              <button
                type="button"
                className="fcb-button"
                disabled={busy || saving || savingDefault}
                onClick={() => setDraftSourceIds([])}
              >
                Enable all
              </button>
              <button
                type="button"
                className="fcb-button"
                disabled={busy || saving || savingDefault}
                onClick={() =>
                  requestDraftChange(getToggleableSourceIds(sources?.groups))
                }
              >
                Disable all
              </button>
              <button
                type="button"
                className="fcb-button"
                disabled={busy || saving || savingDefault}
                onClick={() => requestDraftChange(defaultSourceIds)}
              >
                Use default
              </button>
            </div>
          </div>
          {unavailableCount > 0 && (
            <div
              className="fcb-sources-unavailable"
              role="status"
              data-testid="unavailable-sources-notice"
            >
              <p className="fcb-sources-unavailable--full">
                {unavailableCount === 1
                  ? "1 disabled source isn’t imported on this device. It stays saved and re-applies automatically if that content is imported later."
                  : `${unavailableCount} disabled sources aren’t imported on this device. They stay saved and re-apply automatically if that content is imported later.`}
              </p>
              <p
                className="fcb-sources-unavailable--compact"
                aria-hidden="true"
              >
                {unavailableCount} disabled source
                {unavailableCount === 1 ? "" : "s"} not imported here; setting
                kept.
              </p>
              <button
                type="button"
                className="fcb-button"
                data-testid="forget-unavailable-sources"
                disabled={busy || saving || savingDefault || dirty}
                onClick={forgetUnavailable}
                aria-label="Forget the restrictions for content that is not imported"
              >
                Forget them
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="fcb-panel fcb-sources-panel">
        <div className="fcb-source-groups-scroll">
          <SourceGroupList
            groups={sources?.groups}
            restrictedSourceIds={draftSourceIds}
            search={search}
            disabled={busy || saving || savingDefault}
            onToggleGroup={toggleGroup}
            onToggleSource={toggleSource}
          />
          {sourceCount === 0 && (
            <p className="fcb-empty-copy">
              No source catalogue is loaded yet. Add content and try again.
            </p>
          )}
          {search.trim() && sourceCount > 0 && visibleGroupCount === 0 && (
            <p className="fcb-empty-copy">No sources match this search.</p>
          )}
        </div>
      </section>
      <SourceActionsFooter
        busy={busy}
        saving={saving}
        savingDefault={savingDefault}
        dirty={dirty}
        onApply={apply}
        onDiscard={() => setDraftSourceIds(appliedSourceIds)}
        onSaveDefault={saveDefault}
      />
      <OverrideDisableDialog
        pending={pendingOverride}
        onCancel={() => setPendingOverride(null)}
        onConfirm={() => {
          if (pendingOverride) setDraftSourceIds(pendingOverride.nextIds);
          setPendingOverride(null);
        }}
      />
    </div>
  );
}
