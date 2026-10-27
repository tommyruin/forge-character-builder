import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../../../api';
import { useWorkspace } from '../../WorkspaceContext';
import SectionNav from '../../SectionNav';
import DescriptionPanel from '../../DescriptionPanel';
import useMobileDescriptionNavigation from '../../../hooks/useMobileDescriptionNavigation';
import {
  InformationButton,
  InspectableItemButton,
} from '../../InspectableItemControls';
import Icon from '../../Icon';
import CustomFeatureModal from '../../custom/CustomFeatureModal';
import AdditionalFeatureCategories from '../../homebrew/AdditionalFeatureCategories';
import { makeCustomServices } from '../../custom/customServices';
import { localStore } from '../../../transport/localStore';
import { sourceLabel } from '../../sourceLabel';

// A feature of the character's own, the same capability as Build's [+] Custom feature.
const canCustom = typeof api.characters.saveCustomDraft === 'function';

/** The rail entry that gathers what is already on the character. */
export const ACTIVE_KEY = '__active';

/**
 * A feature counts as active when the character owns it or an inventory item
 * grants it: both are visible on the sheet, and both belong in the Active
 * view even though only an owned one can be removed.
 */
export function isFeatureActive(entry) {
  return entry.enabled || (entry.grantedBy ?? []).length > 0;
}

/**
 * The rail: Active, then every category the offering contains. The
 * adjustments DTO already arrives in category display order, so first
 * appearance is that order.
 */
export function featureCategories(entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  const active = entries.filter(isFeatureActive).length;
  return [
    { key: ACTIVE_KEY, label: `Active (${active})`, count: active },
    ...[...counts].map(([category, count]) => ({
      key: category,
      label: `${category} (${count})`,
      count,
    })),
  ];
}

/**
 * What the empty Active view says about getting something here: which uploaded items show up, and
 * the no-XML route when the Custom feature button is there.
 */
export function UploadedFeaturesHint({ offersCustomFeature }) {
  return (
    <div className="space-y-2" data-testid="additional-features-hint">
      <p className="fcb-muted-copy text-xs">
        An uploaded Item or Magic Item shows here when its category is one of
        the values below.
        {offersCustomFeature &&
          ' To add a feature without writing XML, use Custom feature.'}
      </p>
      <AdditionalFeatureCategories />
    </div>
  );
}

/** The offering narrowed to one rail entry and the search text. */
export function filterFeatures(entries, categoryKey, query) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    const inCategory =
      categoryKey === ACTIVE_KEY
        ? isFeatureActive(entry)
        : entry.category === categoryKey;
    if (!inCategory) return false;
    if (!needle) return true;
    return `${entry.name} ${entry.category} ${sourceLabel(entry.source)}`
      .toLocaleLowerCase()
      .includes(needle);
  });
}

export function FeatureList({
  features,
  busy,
  pendingKey,
  inspected,
  onInspect,
  onToggle,
  emptyCopy,
  emptyHint = null,
}) {
  if (!features.length) {
    return (
      <>
        <p className="fcb-empty-copy">{emptyCopy}</p>
        {emptyHint}
      </>
    );
  }
  return (
    <ul className="space-y-2">
      {features.map((entry) => {
        const grantedBy = entry.grantedBy ?? [];
        return (
          <li
            key={entry.key}
            className={`fcb-card flex flex-wrap items-center gap-3 p-3${
              inspected === entry.elementId ? ' fcb-row-inspected' : ''
            }`}
          >
            <InformationButton
              elementId={entry.elementId}
              label={entry.name}
              onInspect={onInspect}
            />
            <InspectableItemButton
              elementId={entry.elementId}
              onInspect={onInspect}
              className="min-w-0 flex-1 text-left"
            >
              <div className="font-semibold">{entry.name}</div>
              <div className="fcb-muted-copy text-xs">
                {[entry.category, sourceLabel(entry.source)].filter(Boolean).join(' · ')}
              </div>
              {grantedBy.length > 0 && (
                <div className="fcb-muted-copy text-xs">
                  Granted by {grantedBy.join(', ')}
                </div>
              )}
            </InspectableItemButton>
            {/* Only a registration of the character's own can be taken back,
                so an item-granted copy is offered as an addition instead. */}
            {entry.enabled ? (
              <button
                type="button"
                className="fcb-button fcb-button-danger"
                aria-label={`Remove ${entry.name}`}
                disabled={busy || pendingKey === entry.key}
                onClick={() => onToggle(entry, false)}
              >
                <Icon name="delete" />
                Remove
              </button>
            ) : (
              <button
                type="button"
                className="fcb-button fcb-button-primary"
                aria-label={`Add ${entry.name}`}
                disabled={busy || pendingKey === entry.key}
                onClick={() => onToggle(entry, true)}
              >
                <Icon name="add" />
                Add
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// MANAGE / Additional features: the browsing surface for Supernatural Gifts
// and the other character adjustments. The offering is small enough to arrive
// whole, so the rail and the search box narrow it here rather than through the
// engine.
export default function AdditionalFeaturesPanel() {
  const { id, busy, run, mutationTick, registerDetailsScroll, detail, notify } =
    useWorkspace();
  const [customOpen, setCustomOpen] = useState(false);
  const rulesetMode = detail?.rulesetMode;
  const customServices = useMemo(
    () => (canCustom ? makeCustomServices({ api, store: localStore, id, run, ruleset: rulesetMode }) : null),
    [id, run, rulesetMode],
  );
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);
  const [categoryKey, setCategoryKey] = useState(ACTIVE_KEY);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [inspected, setInspected] = useState(null);
  const { inspect: inspectItem, descriptionPanelProps } =
    useMobileDescriptionNavigation({
      onInspect: setInspected,
      registerDetailsScroll,
    });

  const refresh = useCallback(() => {
    return api.characters
      .adjustments(id)
      .then((result) => {
        setFeatures(result);
        setError(null);
      })
      .catch((caught) => setError(caught.message));
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh, mutationTick]);

  const rows = useMemo(() => features ?? [], [features]);
  const categories = useMemo(() => featureCategories(rows), [rows]);
  // A category empties as the offering changes, so the rail falls back to
  // Active rather than showing a selection that no longer exists.
  const selectedKey = categories.some((entry) => entry.key === categoryKey)
    ? categoryKey
    : ACTIVE_KEY;
  const visible = useMemo(
    () => filterFeatures(rows, selectedKey, deferredSearch),
    [rows, selectedKey, deferredSearch],
  );

  const setEnabled = async (entry, enabled) => {
    setPendingKey(entry.key);
    try {
      await run(() =>
        api.characters.setCharacterControl(id, entry.key, enabled),
      );
      await refresh();
    } catch {
      // The workspace banner owns mutation errors; the row stays truthful.
    } finally {
      setPendingKey(null);
    }
  };

  const nothingActive =
    selectedKey === ACTIVE_KEY && deferredSearch.trim() === '';
  const emptyCopy = nothingActive
    ? 'Nothing active yet.'
    : 'No features match this search.';

  return (
    <div className="fcb-two-panel-grid">
      <div className="space-y-4">
        {error && <p className="fcb-alert">{error}</p>}
        <section className="fcb-panel">
          <header className="fcb-panel-header">
            <div>
              <h2 className="fcb-panel-title">Additional features</h2>
              <p className="fcb-panel-subtitle">
                Supernatural gifts, extra features and the other adjustments
                this character can take on.
              </p>
            </div>
            {customServices && (
              <div className="fcb-panel-actions">
                <button
                  type="button"
                  className="fcb-button"
                  disabled={busy}
                  onClick={() => setCustomOpen(true)}
                  title="Make a feature of your own (a boon, a trait, a gift) without writing XML"
                >
                  <Icon name="add" />
                  Custom feature
                </button>
              </div>
            )}
          </header>
          <div className="fcb-panel-body space-y-3">
            <label className="fcb-field-label">
              Search features and adjustments
              <input
                type="search"
                className="fcb-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <SectionNav
              ariaLabel="Feature categories"
              className="fcb-feature-category-nav"
              items={categories}
              activeKey={selectedKey}
              onSelect={setCategoryKey}
            />
            {!features && !error && (
              <p className="fcb-empty-copy">Loading features…</p>
            )}
            {features && (
              <FeatureList
                features={visible}
                busy={busy}
                pendingKey={pendingKey}
                inspected={inspected}
                onInspect={inspectItem}
                onToggle={setEnabled}
                emptyCopy={emptyCopy}
                emptyHint={
                  nothingActive ? (
                    <UploadedFeaturesHint offersCustomFeature={Boolean(customServices)} />
                  ) : null
                }
              />
            )}
          </div>
        </section>
      </div>
      {customOpen && customServices && (
        <CustomFeatureModal
          services={customServices}
          characterName={detail?.name || 'your character'}
          initialShowsUnder="other"
          onClose={() => setCustomOpen(false)}
          onSaved={(saved) => {
            void refresh();
            if (saved) {
              notify(
                <>
                  Added <strong>{saved.draft.name}</strong>
                </>,
              );
            }
          }}
        />
      )}
      <DescriptionPanel
        {...descriptionPanelProps}
        elementId={inspected}
        placeholder="Select a feature to read its description."
        returnLabel="Back to features"
        detailsLabel="Feature details"
      />
    </div>
  );
}
