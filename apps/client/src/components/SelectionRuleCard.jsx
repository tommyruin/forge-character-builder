import { useState } from 'react';
import { api } from '../api';
import {
  InformationButton,
  InspectableItemButton,
} from './InspectableItemControls';
import { useWorkspace } from './WorkspaceContext';
import { isSelectionIssue, issueMatchesRule, previousLabelFor } from '../hooks/useMigrationIssues';
import {
  getSelectionRulePresentation,
  suppressesIncompleteSelectionReminder,
  shouldShowSelectionOptionsLoading,
} from './selectionRulePresentation';
import { selectedElementLabel } from './selectionRuleLabels';
import Icon from './Icon';

// Inspect control for an already-made pick, shown inside the card trigger (a real
// <button>), so it must be a role="button" span — nested <button>s are invalid —
// and swallow its events so activating it never toggles the card or slot.
function SelectedElementInfoButton({ elementId, label, onInspect }) {
  if (!elementId || !onInspect) return null;
  const activate = (event) => {
    event.stopPropagation();
    onInspect(elementId, event.currentTarget);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className="fcb-icon-button"
      title="Read description"
      aria-label={`About ${label}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(event);
        }
      }}
    >
      <Icon name="info" />
    </span>
  );
}

export default function SelectionRuleCard({
  characterId,
  rule,
  disabled,
  onSelect,
  onClear,
  onInspect,
  sectionKey,
  sectionLabel,
  showRuleType = true,
}) {
  const workspace = useWorkspace();
  const [options, setOptions] = useState(null);
  const [optionsSlot, setOptionsSlot] = useState(null);
  const [open, setOpen] = useState(false);
  // Which pick slot's option list is showing (1-based). For single-pick rules the whole card
  // is one slot; for number>1 rules (a real ASI is number=2) each slot picks independently.
  const [activeSlot, setActiveSlot] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  const { count, isMulti, displayTitle, isPlaceholderTitle, metaParts } =
    getSelectionRulePresentation(rule, { sectionLabel, showRuleType });
  const selectedIds = rule.selectedElementIds ?? [];
  const selectedCount = selectedIds.filter(Boolean).length;
  const suppressIncompleteReminder =
    suppressesIncompleteSelectionReminder(rule, { sectionKey });
  // The chosen element name(s), surfaced in the collapsed header so you don't have to
  // expand and scroll the option grid to see what's picked. Populated by the engine DTO
  // (SelectedElementNames); absent on older engine builds, in which case nothing extra shows.
  const selectedNames = (rule.selectedElementNames ?? []).filter(Boolean);
  const selectedSummary = selectedNames.length
    ? (selectedNames.length > 2
        ? `${selectedNames.slice(0, 2).join(', ')} +${selectedNames.length - 2} more`
        : selectedNames.join(', '))
    : null;
  // A placeholder title is the instruction "Choose one", which the answer
  // replaces: once something is picked the card leads with the pick. A real
  // rule name stays — it says which choice this is, and the rail may not.
  const showTitle = !isPlaceholderTitle || !selectedSummary;
  // Whatever the card leads with is also what the icon-only controls name.
  const controlLabel = showTitle ? displayTitle : selectedSummary;

  // A content update invalidated this rule's stored pick: the engine flags it as
  // `wasInvalidated` on the first load after the change; on later loads (after the
  // engine's autosave erased the record) the workspace's persisted migration set
  // is the only source, matched by rule name + type. (Single-pick rules only.)
  const pendingEntry = (workspace?.pendingMigration ?? []).find(
    (issue) => isSelectionIssue(issue) && issueMatchesRule(issue, rule),
  );
  const needsRepick = !isMulti && !rule.hasSelection && (Boolean(rule.wasInvalidated) || Boolean(pendingEntry));
  const previousLabel = rule.previousElementName ?? rule.previousElementId
    ?? previousLabelFor(pendingEntry);

  const ensureOptions = async (slot = 1) => {
    const requestedSlot = isMulti ? slot : null;
    if (options && optionsSlot === requestedSlot) return;
    try {
      const key = `selection-options:${characterId}:${rule.identifier}:${requestedSlot ?? 'single'}`;
      const load = () => api.characters.selectionOptions(characterId, rule.identifier, requestedSlot);
      const next = await (workspace?.getCachedResource ? workspace.getCachedResource(key, load) : load());
      setOptions(next);
      setOptionsSlot(requestedSlot);
    } catch (e) {
      setError(e.message);
    }
  };

  const toggle = async () => {
    if (open) {
      setOpen(false);
      setActiveSlot(null);
      return;
    }
    setOpen(true);
    if (!isMulti) setActiveSlot(1); // single-pick: options show immediately
    if (!isMulti) await ensureOptions(1);
  };

  const openSlot = async (slot) => {
    setActiveSlot((current) => (current === slot ? null : slot));
    setFilter('');
    await ensureOptions(slot);
  };

  const filtered = options?.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase()));

  const selectOption = (option, slot) => {
    onSelect(option.id, slot);
    if (isMulti) setActiveSlot(null); // collapse the slot's picker after choosing
  };

  const clearSlot = (slot) => {
    onClear?.(slot);
    if (isMulti) setActiveSlot(null);
  };

  const optionName = (elementId, slotIndex) =>
    selectedElementLabel({
      elementId,
      slotIndex,
      options,
      selectedElementNames: selectedNames,
    });

  const renderOptionGrid = (slot) => (
    <>
      {options.length > 8 && (
        <input
          className="fcb-input mb-3"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="fcb-option-grid md:grid-cols-2">
        {filtered.map((option) => (
          <div
            key={option.id}
            className={`fcb-option-row ${selectedIds[slot - 1] === option.id ? 'is-selected' : ''}`}
          >
            <InspectableItemButton
              elementId={option.canInspect ? option.id : null}
              onInspect={onInspect}
              onActivate={() => selectOption(option, slot)}
              activationDisabled={disabled}
              className="fcb-option-main"
            >
              <div className="fcb-option-title">{option.name}</div>
              {option.detail && <div className="fcb-option-subtitle">{option.detail}</div>}
              {option.source && <div className="fcb-option-subtitle">{option.source}</div>}
            </InspectableItemButton>
            {option.canInspect && onInspect && (
              <InformationButton
                elementId={option.id}
                label={option.name}
                onInspect={onInspect}
              />
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="fcb-empty-copy">
            {options.length === 0 ? 'No options available.' : 'No options match.'}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="fcb-rule-card">
      <button
        onClick={toggle}
        className="fcb-rule-trigger"
        aria-expanded={open}
      >
        <div className="fcb-rule-trigger-main">
          {showTitle && <div className="fcb-rule-title">{displayTitle}</div>}
          {metaParts.length > 0 && (
            <div className="fcb-rule-subtitle">{metaParts.join(' · ')}</div>
          )}
          {selectedSummary && (
            <div className="fcb-rule-selected flex items-center gap-2" title={selectedNames.join(', ')}>
              <span>{selectedSummary}</span>
              {!isMulti && (
                <SelectedElementInfoButton
                  elementId={selectedIds[0]}
                  label={selectedNames[0] ?? selectedSummary}
                  onInspect={onInspect}
                />
              )}
              {!isMulti && onClear && (
                <span
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  className="fcb-button fcb-button-danger px-2 py-0.5 text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!disabled) clearSlot(1);
                  }}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      event.stopPropagation();
                      clearSlot(1);
                    }
                  }}
                  title={`Clear ${controlLabel}`}
                  aria-label={`Clear ${controlLabel}`}
                >
                  <Icon name="clear" className="fcb-icon-sm" />
                </span>
              )}
            </div>
          )}
        </div>
        <div className="fcb-rule-trigger-actions">
          {needsRepick ? (
            <span
              data-testid="repick-badge"
              className="fcb-status-badge fcb-status-repick fcb-repick-badge"
            >
              Re-pick needed
            </span>
          ) : isMulti &&
            (!suppressIncompleteReminder || selectedCount >= count) ? (
            <span className={`fcb-status-badge ${selectedCount >= count ? 'fcb-status-complete' : 'fcb-status-needed'}`}>
              {selectedCount}/{count} selected
            </span>
          ) : rule.hasSelection ? (
            <span className="fcb-status-badge fcb-status-complete" aria-label="Selected" title="Selected">✓</span>
          ) : !suppressIncompleteReminder ? (
            <span className="fcb-status-badge fcb-status-needed">Choose</span>
          ) : null}
          <span className="fcb-muted-copy" aria-hidden="true">{open ? '−' : '+'}</span>
        </div>
      </button>

      {open && (
        <div className="fcb-rule-options">
          {needsRepick && previousLabel && (
            <p className="fcb-warning-note mb-3 text-xs">Previously: {previousLabel}</p>
          )}
          {error && <p className="fcb-alert">{error}</p>}
          {shouldShowSelectionOptionsLoading({ isMulti, options, error }) && (
            <p className="fcb-empty-copy">Loading options…</p>
          )}
          {options && !isMulti && renderOptionGrid(1)}
          {isMulti && (
            <div className="fcb-rule-slots space-y-2">
              {Array.from({ length: count }, (_, i) => i + 1).map((slot) => {
                const filledId = selectedIds[slot - 1];
                const slotOpen = activeSlot === slot;
                return (
                  <div key={slot} className="fcb-rule-slot rounded border border-[var(--fcb-border)]">
                    <button
                      className="fcb-rule-slot-trigger flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      aria-expanded={slotOpen}
                      onClick={() => openSlot(slot)}
                    >
                      <span className="fcb-rule-slot-label text-sm">
                        <span className="fcb-muted-copy">Pick {slot}: </span>
                        <span className={filledId ? 'font-semibold' : 'fcb-muted-copy'}>
                          {filledId ? optionName(filledId, slot - 1) : 'Choose…'}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {filledId && (
                          <SelectedElementInfoButton
                            elementId={filledId}
                            label={optionName(filledId, slot - 1)}
                            onInspect={onInspect}
                          />
                        )}
                        {filledId && onClear && (
                          <span
                            role="button"
                            tabIndex={disabled ? -1 : 0}
                            className="fcb-button fcb-button-danger px-2 py-0.5 text-xs"
                            aria-label={`Clear ${displayTitle} pick ${slot}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!disabled) clearSlot(slot);
                            }}
                            onKeyDown={(event) => {
                              if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                                event.preventDefault();
                                event.stopPropagation();
                                clearSlot(slot);
                              }
                            }}
                            title={`Clear ${displayTitle} pick ${slot}`}
                          >
                            <Icon name="clear" className="fcb-icon-sm" />
                          </span>
                        )}
                        <Icon
                          name={slotOpen ? 'remove' : 'add'}
                          className="fcb-icon-sm fcb-muted-copy"
                        />
                      </span>
                    </button>
                    {slotOpen && (
                      <div className="px-3 pb-3">
                        {!options && !error && <p className="fcb-empty-copy">Loading options…</p>}
                        {options && renderOptionGrid(slot)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
