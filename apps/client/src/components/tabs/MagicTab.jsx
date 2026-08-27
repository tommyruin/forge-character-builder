import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, MAGIC_RULE_TYPES, COMPANION_RULE_TYPES } from '../../api';
import { useWorkspace } from '../WorkspaceContext';
import DescriptionPanel from '../DescriptionPanel';
import Modal from '../Modal';
import SectionNav from '../SectionNav';
import WorkspaceTabLayout, { WorkspaceBand } from '../WorkspaceTabLayout';
import Icon from '../Icon';
import useMobileDescriptionNavigation from '../../hooks/useMobileDescriptionNavigation';
import {
  InformationButton,
  InspectableItemButton,
} from '../InspectableItemControls';
import SpellBrowser from './magic/SpellBrowser';
import SpellDetails from './magic/SpellDetails';
import CompanionSection from './magic/CompanionSection';
import AddSpellModal from './magic/AddSpellModal';
import { spellLevelLabel } from './magic/spellLevels';
import { castingTimeBadge } from './magic/castingTime';
import { spellResourceDisplay } from './magic/spellResource';
import {
  buildMagicTabs,
  hasIncompleteRequiredSpellChoices,
  resolveMagicTabKey,
} from './magic/magicTabNavigation';

// DM/homebrew "add a spell" is a local-engine-only capability (needs api.characters.addSpell).
const canAddSpell = typeof api.characters.addSpell === 'function';
const ABILITY_ABBREVIATIONS = {
  Strength: 'STR',
  Dexterity: 'DEX',
  Constitution: 'CON',
  Intelligence: 'INT',
  Wisdom: 'WIS',
  Charisma: 'CHA',
};

function CasterSummary({ caster }) {
  const resourceDisplay = spellResourceDisplay(caster);

  return (
    <div
      className="fcb-caster-summary"
      role="group"
      aria-label={`${caster.name} spellcasting`}
    >
      <span
        className="fcb-stat-pill"
        title={`Spellcasting ability: ${caster.ability}`}
        aria-label={`Spellcasting ability: ${caster.ability}`}
      >
        <strong>
          {ABILITY_ABBREVIATIONS[caster.ability] ?? caster.ability}
        </strong>
      </span>
      <span className="fcb-stat-pill" title="Spell attack modifier">
        ATK{' '}
        <strong>
          {caster.attackModifier >= 0 ? '+' : ''}
          {caster.attackModifier}
        </strong>
      </span>
      <span className="fcb-stat-pill" title="Spell save DC">
        DC <strong>{caster.saveDc}</strong>
      </span>
      <span
        className="fcb-stat-pill fcb-caster-stat--slots"
        title={resourceDisplay.title}
        aria-label={`${resourceDisplay.label} ${resourceDisplay.value}`}
      >
        <span className="fcb-stat-pill-label--full" aria-hidden="true">
          {resourceDisplay.label}
        </span>
        <span className="fcb-stat-pill-label--compact" aria-hidden="true">
          {resourceDisplay.compactLabel ?? resourceDisplay.label}
        </span>{' '}
        <strong aria-hidden="true">{resourceDisplay.value}</strong>
      </span>
      {caster.requiresPreparation && (
        <span
          className="fcb-stat-pill"
          data-testid="prepared-count"
          aria-live="polite"
        >
          PREP{' '}
          <strong>
            {caster.currentPreparedCount}/{caster.prepareCount}
          </strong>
        </span>
      )}
    </div>
  );
}

function SpellPointsPanel({ resource }) {
  return (
    <section className="fcb-panel" data-testid="spell-points-option">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold uppercase tracking-wide">
            Spell points
            <span className="fcb-muted-copy ml-1 font-normal normal-case tracking-normal">
              Optional rule
            </span>
          </h2>
          <p className="fcb-muted-copy mt-0.5 text-xs">
            Enabled under Manage / Optional rules. Pact Magic remains
            slot-based.
          </p>
        </div>
      </div>
      <div className="space-y-2 border-t border-[var(--fcb-border)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <strong className="text-sm" data-testid="spell-point-maximum">
            {resource?.maximumPoints ?? '—'} spell points
          </strong>
          <span className="fcb-muted-copy text-xs">
            maximum · long rest
            {resource?.shared ? ' · shared pool' : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table
            className="w-full table-fixed border-collapse text-center text-[0.68rem] leading-tight"
            data-testid="spell-point-cost-table"
          >
            <caption className="sr-only">
              Spell point cost to create a spell slot
            </caption>
            <thead>
              <tr className="text-[var(--fcb-text-muted)]">
                <th scope="col" className="px-0.5 py-1 font-semibold">
                  Level
                </th>
                {(resource?.costs ?? []).map((cost) => (
                  <th
                    key={cost.spellLevel}
                    scope="col"
                    className="px-0.5 py-1 font-semibold"
                  >
                    {cost.spellLevel}
                    {cost.oncePerLongRest ? '*' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--fcb-border)]">
                <th scope="row">Cost</th>
                {(resource?.costs ?? []).map((cost) => (
                  <td key={cost.spellLevel} className="px-0.5 py-1 font-bold">
                    {cost.points}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="fcb-muted-copy text-[0.68rem] leading-tight">
          * Levels 6–9: one slot of each level per long rest.
        </p>
      </div>
    </section>
  );
}

// MAGIC keeps spell choices and each caster's prepared/known list in separate
// destinations. The Choose surface owns selection-rule browsers; caster tabs own
// spell resources and preparation without stacking both workflows in one scroll.
export default function MagicTab() {
  const {
    id,
    detail,
    busy,
    run,
    getCachedResource,
    setCachedResource,
    registerPrimaryScroll,
    registerDetailsScroll,
    resetPrimaryScroll,
    libraryRevision,
    active,
    createLibraryPickerRefreshController,
    ensureLibraryRevisionReady,
  } = useWorkspace();
  const [casters, setCasters] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [inspectedSpell, setInspectedSpell] = useState(null);
  const [flashSpells, setFlashSpells] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState(() => {
    const initialSpellRules = detail.selectionRules.filter((rule) =>
      MAGIC_RULE_TYPES.includes(rule.type),
    );
    return hasIncompleteRequiredSpellChoices(initialSpellRules)
      ? 'choose'
      : null;
  });
  // undefined = auto-open the default rule; null = user closed them all.
  const [openRule, setOpenRule] = useState(undefined);
  const [preparePopup, setPreparePopup] = useState(null); // { caster, spell, kind }
  const [addSpellOpen, setAddSpellOpen] = useState(false);
  const [spellLevelTab, setSpellLevelTab] = useState(null); // active spell-level tab in the caster list
  const [dmGrants, setDmGrants] = useState([]); // DM/homebrew grants (local engine only), for per-spell Remove
  const [libraryRefreshing, setLibraryRefreshing] = useState(false);
  const [libraryRefreshError, setLibraryRefreshError] = useState(null);
  const [libraryRefreshAttempt, setLibraryRefreshAttempt] = useState(0);
  const [libraryRefreshController] = useState(() =>
    createLibraryPickerRefreshController(libraryRevision),
  );
  const casterRequestGeneration = useRef(0);
  const knownIds = useRef(null);
  const {
    inspect: inspectSpell,
    dismiss: dismissMobileDescription,
    descriptionPanelProps,
  } = useMobileDescriptionNavigation({
    onInspect: setInspected,
    registerDetailsScroll,
  });

  const inspectKnownSpell = useCallback(
    (spell) => (elementId, source) => {
      setInspectedSpell(spell);
      inspectSpell(elementId, source);
    },
    [inspectSpell],
  );

  // Applies fresh spellcasting data; newly known spells (vs. the previous payload)
  // are flashed and announced so learning a spell has visible confirmation.
  const applyCasters = useCallback((data) => {
    const nextIds = new Set(
      (data ?? []).flatMap((caster) => caster.knownSpells.map((s) => s.id)),
    );
    if (knownIds.current) {
      const learned = (data ?? [])
        .flatMap((caster) => caster.knownSpells)
        .filter((spell) => !knownIds.current.has(spell.id));
      if (learned.length) {
        setFlashSpells(new Set(learned.map((s) => s.id)));
        window.setTimeout(() => setFlashSpells(new Set()), 2000);
      }
    }
    knownIds.current = nextIds;
    setCasters(data);
  }, []);

  const refresh = useCallback(
    (force = false) => {
      const generation = ++casterRequestGeneration.current;
      return getCachedResource(
        `spellcasting:${id}`,
        () => api.characters.spellcasting(id),
        { force },
      )
        .then((data) => {
          if (generation !== casterRequestGeneration.current) return data;
          setError(null);
          applyCasters(data);
          setLibraryRefreshing(false);
          return data;
        })
        .catch((e) => {
          if (generation === casterRequestGeneration.current) {
            setError(e.message);
            setLibraryRefreshing(false);
          }
          return null;
        });
    },
    [applyCasters, getCachedResource, id],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshForLibraryRevision = useCallback(() => {
    const generation = ++casterRequestGeneration.current;
    return ensureLibraryRevisionReady(libraryRevision, active)
      .then(() =>
        getCachedResource(
          `spellcasting:${id}`,
          () => api.characters.spellcasting(id),
          { force: true },
        ),
      )
      .then((data) => ({ data, generation }));
  }, [
    active,
    ensureLibraryRevisionReady,
    getCachedResource,
    id,
    libraryRevision,
  ]);

  useEffect(() => {
    if (!active || libraryRevision === 0) {
      return undefined;
    }
    const request = libraryRefreshController.request(
      libraryRevision,
      active,
      refreshForLibraryRevision,
    );
    if (!request) return undefined;
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      setLibraryRefreshing(true);
      setLibraryRefreshError(null);
    });
    request
      .then((result) => {
        if (
          !alive ||
          result.stale ||
          result.value.generation !== casterRequestGeneration.current
        ) {
          return;
        }
        setError(null);
        applyCasters(result.value.data);
        setLibraryRefreshing(false);
      })
      .catch((caught) => {
        if (!alive) return;
        setLibraryRefreshing(false);
        setLibraryRefreshError(caught.message);
      });
    return () => {
      alive = false;
    };
  }, [
    active,
    libraryRefreshAttempt,
    libraryRevision,
    libraryRefreshController,
    refreshForLibraryRevision,
    applyCasters,
  ]);

  // DM/homebrew spell grants on this character — refetched when the caster list changes so
  // add/remove reflect immediately; drives the per-spell Remove control (local engine only).
  useEffect(() => {
    if (!canAddSpell) return undefined;
    let alive = true;
    api.characters
      .dmGrants(id)
      .then((g) => {
        if (alive) setDmGrants(g || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, casters]);
  // Granted spells belong to no single caster (they ride in <additional>), so
  // ownership is keyed by spell id alone.
  const dmSpellIds = new Set(
    dmGrants.filter((g) => g.kind === 'spell').map((g) => g.id),
  );

  const removeGrantedSpell = async (caster, spell) => {
    const updated = await run(
      () => api.characters.removeSpell(id, spell.id, caster.name),
      { invalidateSelectionOptions: false },
    );
    if (Array.isArray(updated)) {
      setCachedResource(`spellcasting:${id}`, updated);
      casterRequestGeneration.current += 1;
      applyCasters(updated);
    } else refresh(true);
  };

  const spellRules = detail.selectionRules.filter((r) =>
    MAGIC_RULE_TYPES.includes(r.type),
  );
  const companionRules = detail.selectionRules.filter((r) =>
    COMPANION_RULE_TYPES.includes(r.type),
  );
  const hasCompanion =
    companionRules.length > 0 ||
    detail.registeredElements.some((e) => e.type === 'Companion');
  const spellPointCasters = (casters ?? []).filter(
    (caster) => caster.resource?.canUseSpellPoints,
  );
  const spellPointsEnabled = spellPointCasters.some(
    (caster) => caster.resource?.mode === 'spellPoints',
  );
  const spellPointResource =
    spellPointCasters.find((caster) => caster.resource?.mode === 'spellPoints')
      ?.resource ?? spellPointCasters[0]?.resource;

  // Learn-surface rules grouped by their caster (spellcastingName).
  const ruleGroups = useMemo(() => {
    const groups = new Map();
    for (const rule of spellRules) {
      const key = rule.spellcastingName || 'Other spells';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rule);
    }
    return [...groups.entries()].map(([label, rules]) => ({
      label,
      rules: rules.sort(
        (a, b) =>
          a.requiredLevel - b.requiredLevel ||
          (a.name || '').localeCompare(b.name || ''),
      ),
    }));
  }, [spellRules]);

  const liveCasters = casters ?? [];
  const tabs = buildMagicTabs({
    spellRules,
    casters: liveCasters,
    hasCompanion,
  });

  // Active sub-tab / open browser are derived: the user's pick when still valid,
  // else Choose while required choices remain, then the first caster destination.
  const activeTab = resolveMagicTabKey({
    requestedKey: subTab,
    tabs,
    spellRules,
    casters: liveCasters,
  });

  useEffect(() => {
    if (activeTab === 'companion') setInspectedSpell(null);
  }, [activeTab]);
  const defaultRule =
    spellRules.find(
      (r) => r.selectedElementIds.filter(Boolean).length < r.selectionCount,
    ) ?? spellRules[0];
  const activeRule =
    openRule === null
      ? null
      : openRule && spellRules.some((r) => r.identifier === openRule)
        ? openRule
        : defaultRule?.identifier;

  const togglePrepared = async (caster, spell) => {
    if (spell.level === 0) {
      setPreparePopup({ caster, spell, kind: 'cantrip' });
      return;
    }
    if (spell.isAlwaysPrepared) {
      setPreparePopup({ caster, spell, kind: 'always' });
      return;
    }
    // The engine never refuses over-preparing; the prepared limit is enforced
    // here, with an explanation popup.
    if (
      !spell.isPrepared &&
      caster.prepareCount > 0 &&
      caster.currentPreparedCount >= caster.prepareCount
    ) {
      setPreparePopup({ caster, spell, kind: 'limit' });
      return;
    }
    const updated = await run(
      () =>
        api.characters.setPrepared(
          id,
          caster.identifier,
          spell.id,
          !spell.isPrepared,
        ),
      { refreshDetail: false, invalidateSelectionOptions: false },
    );
    if (Array.isArray(updated)) {
      setCachedResource(`spellcasting:${id}`, updated);
      casterRequestGeneration.current += 1;
      applyCasters(updated);
    } else refresh(true);
  };

  if (!casters && !error)
    return <p className="fcb-empty-copy">Loading spellcasting…</p>;

  const hasAnything =
    (casters?.length ?? 0) > 0 || spellRules.length > 0 || hasCompanion;
  const activeCaster = casters?.find((c) => c.identifier === activeTab);

  const addSpellAction = () =>
    canAddSpell ? (
      <button
        type="button"
        className="fcb-button"
        onClick={() => setAddSpellOpen(true)}
        title="Grant any spell (DM / homebrew) — off the class list, over the cap"
      >
        <Icon name="add" />
        Spell
      </button>
    ) : null;

  const casterLevels = (caster) =>
    [...new Set(caster.knownSpells.map((s) => s.level))].sort((a, b) => a - b);

  // Active spell-level tab for a caster's spell list: the user's pick when that level still
  // exists for this caster, else the lowest level present (so switching casters never lands
  // on an empty tab).
  const activeSpellLevel = (caster) => {
    const levels = casterLevels(caster);
    return spellLevelTab != null && levels.includes(spellLevelTab)
      ? spellLevelTab
      : (levels[0] ?? 0);
  };

  // The left rail navigates within the active view, mirroring Equipment's
  // category rail: spell-choice rules on Choose spells, spell levels on a
  // caster's list. Views without rail entries render a single column.
  const chooseNavItems =
    activeTab === 'choose'
      ? ruleGroups.flatMap((group) =>
          group.rules.map((rule) => {
            const used = rule.selectedElementIds.filter(Boolean).length;
            const detail = [
              `${used} of ${rule.selectionCount}`,
              rule.requiredLevel > 1 ? `level ${rule.requiredLevel}` : null,
              ruleGroups.length > 1 ? group.label : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return {
              key: rule.identifier,
              label: rule.name || 'Spell choice',
              detail,
              badge: !rule.isOptional && used < rule.selectionCount && (
                <span className="fcb-tab-dot" />
              ),
            };
          }),
        )
      : [];
  const casterNavItems = activeCaster
    ? casterLevels(activeCaster).map((level) => ({
        key: `level-${level}`,
        label: spellLevelLabel(level),
        detail: `${
          activeCaster.knownSpells.filter((s) => s.level === level).length
        } spells`,
      }))
    : [];
  const sectionItems =
    activeTab === 'choose' ? chooseNavItems : casterNavItems;
  const selectSection = (key) => {
    if (activeTab === 'choose') {
      setOpenRule(key);
      resetPrimaryScroll();
      return;
    }
    const level = Number(key.slice('level-'.length));
    setSpellLevelTab(level);
  };
  const sectionLabel = activeTab === 'choose' ? 'Spell choice' : 'Spell level';
  // The collapsed rail hides each item's detail line, and a caster's spell
  // rules are all named for the class --- eight entries reading "Spellbook
  // (Wizard)" with nothing to tell them apart. The phone-width select keeps
  // the detail, which is where the level lives.
  const sectionOptionLabel = (item) =>
    item.detail ? `${item.label} — ${item.detail}` : item.label;
  const summaryCaster = activeCaster ?? liveCasters[0];
  const sectionActiveKey =
    activeTab === 'choose'
      ? activeRule
      : activeCaster
        ? `level-${activeSpellLevel(activeCaster)}`
        : undefined;

  return (
    <WorkspaceTabLayout
      className="fcb-magic-layout"
      bands={
        tabs.length > 0 ? (
          <WorkspaceBand className="fcb-magic-subbar">
            <nav
              className="fcb-secondary-tabs fcb-segmented-tabs fcb-magic-tabs"
              aria-label="Magic sections"
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-label={t.ariaLabel}
                  aria-current={activeTab === t.key ? 'page' : undefined}
                  className={`fcb-tab ${activeTab === t.key ? 'is-active' : ''}`}
                  onClick={() => {
                    setSubTab(t.key);
                    dismissMobileDescription();
                    resetPrimaryScroll();
                  }}
                >
                  <span className="fcb-tab-label--full">{t.label}</span>
                  <span className="fcb-tab-label--compact" aria-hidden="true">
                    {t.compactLabel ?? t.label}
                  </span>
                </button>
              ))}
            </nav>
            {/* The caster summary stays pinned top-right, directly under the
                character stat pills in the workspace bar. Views without their
                own caster (Choose spells) show the first caster's numbers. */}
            {summaryCaster && <CasterSummary caster={summaryCaster} />}
          </WorkspaceBand>
        ) : null
      }
      rail={
        sectionItems.length > 0 ? (
          <>
            {/* The rail in both its forms, as Equipment does it: the select
                replaces the pill strip on a narrow viewport, and the rule that
                hides the strip keys on the two being adjacent siblings. */}
            <label className="fcb-mobile-category-select">
              <span>{sectionLabel}</span>
              <select
                className="fcb-select"
                value={sectionActiveKey ?? ''}
                onChange={(event) => selectSection(event.target.value)}
              >
                {sectionItems.map((item) => (
                  <option key={item.key} value={item.key}>
                    {sectionOptionLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <SectionNav
              ariaLabel={
                activeTab === 'choose' ? 'Spell choices' : 'Spell levels'
              }
              items={sectionItems}
              activeKey={sectionActiveKey}
              onSelect={selectSection}
            />
          </>
        ) : null
      }
    >
      <div
        id={activeTab ? `magic-panel-${activeTab}` : undefined}
        role={activeTab ? 'region' : undefined}
        aria-label={
          activeTab
            ? tabs.find((t) => t.key === activeTab)?.label
            : undefined
        }
        className="fcb-two-panel-grid"
      >
        <div
          className="fcb-magic-stack fcb-editor-primary space-y-4"
          ref={registerPrimaryScroll}
        >
          {error && <p className="fcb-alert mb-4">{error}</p>}
          {libraryRefreshing && (
            <p
              className="fcb-muted-copy mb-3"
              role="status"
              aria-live="polite"
            >
              Refreshing spells…
            </p>
          )}
          {libraryRefreshError && (
            <p className="fcb-alert mb-4" role="alert">
              Could not refresh spells: {libraryRefreshError}{' '}
              <button
                type="button"
                className="fcb-button"
                onClick={() =>
                  setLibraryRefreshAttempt((attempt) => attempt + 1)
                }
              >
                Retry
              </button>
            </p>
          )}
          {!hasAnything && (
            <section className="fcb-panel mb-4">
              <header className="fcb-panel-header">
                <div>
                  <h2 className="fcb-panel-title">No spellcasting</h2>
                  <p className="fcb-rule-subtitle">
                    Gaining a spellcasting class or feature will populate this
                    tab.
                  </p>
                </div>
                {addSpellAction()}
              </header>
            </section>
          )}

          {activeCaster &&
            activeCaster.resource?.canUseSpellPoints &&
            spellPointsEnabled &&
            spellPointCasters.length > 0 && (
              <SpellPointsPanel resource={spellPointResource} />
            )}

          {activeTab === 'choose' && (() => {
            // The rail owns rule selection, so the panel renders the active
            // rule's browser directly — no group heading or accordion card.
            const group = ruleGroups.find((g) =>
              g.rules.some((r) => r.identifier === activeRule),
            );
            const rule = group?.rules.find(
              (r) => r.identifier === activeRule,
            );
            const used = rule
              ? rule.selectedElementIds.filter(Boolean).length
              : 0;
            return (
              <section
                className="fcb-panel fcb-magic-choices"
                data-testid="choose-spells-view"
              >
                {/* No heading: the rail already names the choice and the level
                    it unlocks at. Only the pick count and the grant action
                    belong here, above the spells they apply to. */}
                <div className="fcb-panel-body">
                  {rule ? (
                    <SpellBrowser
                      rule={rule}
                      onInspect={inspectSpell}
                      onSpellDetails={setInspectedSpell}
                      onLearned={() => refresh(true)}
                      status={
                        <span
                          className={`fcb-status-badge ${
                            used >= rule.selectionCount
                              ? 'fcb-status-complete'
                              : 'fcb-status-needed'
                          }`}
                          data-testid="spell-picks-available"
                        >
                          <strong>
                            {used} of {rule.selectionCount} selected
                          </strong>
                        </span>
                      }
                      action={liveCasters.length === 0 ? addSpellAction() : null}
                    />
                  ) : (
                    <p className="fcb-empty-copy">
                      Pick a spell choice from the list to browse its spells.
                    </p>
                  )}
                </div>
              </section>
            );
          })()}

          {activeCaster && (
            <>
              <section className="fcb-panel">
                <header className="fcb-panel-header">
                  <div>
                    <h2 className="fcb-panel-title">
                      {activeCaster.requiresPreparation
                        ? 'Prepared spells'
                        : 'Known spells'}
                    </h2>
                  </div>
                  {addSpellAction()}
                </header>
                <div className="fcb-scroll-panel fcb-mobile-list-panel">
                  <table className="fcb-table fcb-mobile-list-table">
                    <thead>
                      <tr>
                        <th>Spell</th>
                        <th>School</th>
                        <th>Source</th>
                        {activeCaster.requiresPreparation && (
                          <th className="text-right">Prepared</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {activeCaster.knownSpells
                        .filter(
                          (s) => s.level === activeSpellLevel(activeCaster),
                        )
                        .map((spell) => {
                          const isDmGranted = dmSpellIds.has(spell.id);
                          return (
                            <tr
                              key={spell.id}
                              className={
                                flashSpells.has(spell.id) ? 'is-flash' : ''
                              }
                            >
                              <td data-label="Spell">
                                <span className="inline-flex items-center gap-1">
                                  <InformationButton
                                    elementId={spell.id}
                                    label={spell.name}
                                    onInspect={inspectKnownSpell(spell)}
                                  />
                                  <InspectableItemButton
                                    elementId={spell.id}
                                    onInspect={inspectKnownSpell(spell)}
                                    className="font-semibold text-left"
                                  >
                                    {spell.name}
                                  </InspectableItemButton>
                                  {(() => {
                                    const cast = castingTimeBadge(
                                      spell.castingTime,
                                    );
                                    return (
                                      cast && (
                                        <span
                                          className="fcb-cast-badge"
                                          data-cast={cast.kind}
                                          title={`Casting time: ${cast.label}`}
                                        >
                                          {cast.short}
                                        </span>
                                      )
                                    );
                                  })()}
                                  {spell.isRitual && (
                                    <span
                                      className="fcb-spell-flag"
                                      title="Ritual"
                                    >
                                      R
                                    </span>
                                  )}
                                  {spell.isConcentration && (
                                    <span
                                      className="fcb-spell-flag"
                                      title="Concentration"
                                    >
                                      C
                                    </span>
                                  )}
                                  {isDmGranted && (
                                    <button
                                      type="button"
                                      className="fcb-icon-button fcb-button-danger"
                                      title="Remove this granted spell"
                                      aria-label={`Remove ${spell.name}`}
                                      disabled={busy}
                                      onClick={() =>
                                        removeGrantedSpell(activeCaster, spell)
                                      }
                                    >
                                      <Icon name="close" />
                                    </button>
                                  )}
                                </span>
                              </td>
                              <td
                                className="text-xs text-[var(--fcb-text-muted)]"
                                data-label="School"
                              >
                                {spell.school}
                              </td>
                              <td
                                className="text-xs text-[var(--fcb-text-muted)]"
                                data-label="Source"
                              >
                                {spell.source}
                              </td>
                              {activeCaster.requiresPreparation && (
                                <td
                                  className="text-right fcb-mobile-list-actions"
                                  data-label="Prepared"
                                >
                                  {spell.level === 0 ? (
                                    <span
                                      className="fcb-status-badge"
                                      title="Cantrips are always ready to cast"
                                    >
                                      Always ready
                                    </span>
                                  ) : spell.isAlwaysPrepared ? (
                                    <span
                                      className="fcb-status-badge fcb-status-complete"
                                      title="Granted as always prepared"
                                    >
                                      Always prepared
                                    </span>
                                  ) : (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        togglePrepared(activeCaster, spell)
                                      }
                                      className={`fcb-button ${spell.isPrepared ? 'fcb-status-complete' : ''}`}
                                    >
                                      {spell.isPrepared
                                        ? 'Prepared'
                                        : 'Prepare'}
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {activeCaster.knownSpells.length === 0 && (
                    <p className="fcb-empty-copy p-4">
                      {spellRules.length > 0
                        ? 'No spells yet — make a choice on the Choose spells tab.'
                        : 'No spells yet.'}
                    </p>
                  )}
                </div>
              </section>
            </>
          )}

          {activeTab === 'companion' && (
            <CompanionSection rules={companionRules} onInspect={inspectSpell} />
          )}
        </div>

        {inspectedSpell ? (
          <SpellDetails spell={inspectedSpell} panelProps={descriptionPanelProps} />
        ) : (
          <DescriptionPanel
            {...descriptionPanelProps}
            elementId={inspected}
            placeholder="Spellcasting"
            returnLabel="Back to spell list"
            detailsLabel="Spell details"
          />
        )}
      </div>

      <Modal
        open={Boolean(preparePopup)}
        title={
          preparePopup?.kind === 'limit'
            ? 'Prepared spell limit reached'
            : preparePopup?.kind === 'cantrip'
              ? 'Cantrips are always ready'
              : 'Always prepared'
        }
        onClose={() => setPreparePopup(null)}
      >
        {preparePopup?.kind === 'limit' && (
          <p data-testid="prepare-limit-popup">
            <strong>{preparePopup.caster.name}</strong> can prepare at most{' '}
            <strong>{preparePopup.caster.prepareCount}</strong> spells right
            now, and all {preparePopup.caster.currentPreparedCount} are in use.
            Unprepare another spell to make room for{' '}
            <strong>{preparePopup.spell.name}</strong>.
          </p>
        )}
        {preparePopup?.kind === 'cantrip' && (
          <p>
            <strong>{preparePopup.spell.name}</strong> is a cantrip — it is
            always ready to cast and never needs to be prepared.
          </p>
        )}
        {preparePopup?.kind === 'always' && (
          <p>
            <strong>{preparePopup.spell.name}</strong> is always prepared for
            you — it was granted by a feature and doesn’t count against your
            prepared spells.
          </p>
        )}
      </Modal>

      {addSpellOpen && (
        <AddSpellModal
          id={id}
          casters={casters}
          defaultCaster={activeCaster?.name}
          open
          onClose={() => setAddSpellOpen(false)}
          onAdded={() => refresh(true)}
        />
      )}
    </WorkspaceTabLayout>
  );
}
