import { useEffect, useMemo, useState } from 'react';
import {
  api,
  BUILD_SECTIONS,
  MANAGE_RULE_TYPES,
  MAGIC_RULE_TYPES,
  COMPANION_RULE_TYPES,
} from '../../api';
import { buildSectionRules } from '../buildSectionRules';
import { useWorkspace } from '../WorkspaceContext';
import { ruleNeedsRepick } from '../../hooks/useMigrationIssues';
import SectionNav from '../SectionNav';
import WorkspaceTabLayout from '../WorkspaceTabLayout';
import Icon from '../Icon';
import SelectionRuleCard from '../SelectionRuleCard';
import { hasIncompleteRequiredSelection } from '../selectionRulePresentation';
import AbilityEditor from '../AbilityEditor';
import DescriptionPanel from '../DescriptionPanel';
import useMobileDescriptionNavigation from '../../hooks/useMobileDescriptionNavigation';
import {
  InformationButton,
  InspectableItemButton,
} from '../InspectableItemControls';
import AddFeatModal from './feats/AddFeatModal';
import AddAsiModal from './feats/AddAsiModal';
import CompanionSection from './CompanionSection';
import CustomFeatureModal from '../custom/CustomFeatureModal';
import {
  CustomEntryList,
  CustomEntryRows,
  useCustomContent,
} from '../custom/CustomEntries';
import { makeCustomServices } from '../custom/customServices';
import { localStore } from '../../transport/localStore';

// DM/homebrew grants are a local-engine-only capability.
const canGrant = typeof api.characters.addFeat === 'function';
// Custom features are the same capability: they are granted to the character.
const canCustom = typeof api.characters.saveCustomDraft === 'function';

// Where a new custom entry shows when it is started from a section: its own where that is one
// of the four a custom entry can show under, else Other.
const showsUnderFor = (sectionKey) =>
  ['race', 'class', 'feats'].includes(sectionKey) ? sectionKey : 'other';

// BUILD tab: selection rules grouped into sections by rule type (Race / Class /
// Background / Ability Scores / Languages / Proficiencies / Feats). Rules
// whose type belongs to no section fall into
// "Other" so the engine's choices are never hidden.
export default function BuildTab() {
  const {
    id,
    detail,
    busy,
    selectionBusy,
    run,
    pendingMigration,
    libraryRevision,
    registerPrimaryScroll,
    registerDetailsScroll,
    resetPrimaryScroll,
  } = useWorkspace();
  const [section, setSection] = useState('race');
  const [inspected, setInspected] = useState(null);
  const [addFeatOpen, setAddFeatOpen] = useState(false);
  const [addAsiOpen, setAddAsiOpen] = useState(false);
  // The custom-feature dialog: null when closed, else the entry being edited (or null to make
  // a new one) and the section the entry starts under.
  const [customDialog, setCustomDialog] = useState(null);
  const {
    inspect: inspectItem,
    dismiss: dismissMobileDescription,
    descriptionPanelProps,
  } = useMobileDescriptionNavigation({
    onInspect: setInspected,
    registerDetailsScroll,
  });

  const rulesetMode = detail.rulesetMode;
  const customServices = useMemo(
    () =>
      canCustom
        ? makeCustomServices({
            api,
            store: localStore,
            id,
            run,
            ruleset: rulesetMode,
          })
        : null,
    [id, run, rulesetMode],
  );
  const { entries: customEntries } = useCustomContent(customServices, detail);
  const customIn = (key) => customEntries.filter((e) => e.section === key);
  const customIds = new Set(customEntries.map((e) => e.elementId));

  const groups = useMemo(() => {
    const known = new Set([
      ...BUILD_SECTIONS.flatMap((s) => s.types),
      ...MANAGE_RULE_TYPES,
      ...MAGIC_RULE_TYPES,
      ...COMPANION_RULE_TYPES,
    ]);
    const other = detail.selectionRules.filter((r) => !known.has(r.type));
    const companion = detail.selectionRules.filter((r) =>
      COMPANION_RULE_TYPES.includes(r.type),
    );
    return { other, companion };
  }, [detail]);

  const sections = useMemo(() => {
    const list = BUILD_SECTIONS.map((s) => ({
      ...s,
      rules: buildSectionRules(s, detail.selectionRules),
    }));
    // Familiar & Companion sits after the named sections, and only appears for
    // a character whose features grant a companion or who already has one.
    if (
      groups.companion.length > 0 ||
      detail.registeredElements.some((e) => e.type === 'Companion')
    )
      list.push({
        key: 'companion',
        label: 'Familiar & Companion',
        types: COMPANION_RULE_TYPES,
        rules: groups.companion,
      });
    if (groups.other.length > 0 || customEntries.some((e) => e.section === 'other'))
      list.push({
        key: 'other',
        label: 'Other',
        types: [],
        rules: groups.other,
      });
    return list;
  }, [detail, groups, customEntries]);

  const active = sections.find((s) => s.key === section) ?? sections[0];

  // A custom feat is listed with the other custom entries (Edit and Remove delete its draft),
  // not as a DM grant, whose Remove would only take it off the character.
  const grantedFeats = detail.registeredElements.filter(
    (e) => e.type === 'Feat' && !customIds.has(e.id),
  );

  // DM/homebrew grants (local engine only) — refetched whenever the character changes so add/remove
  // reflect immediately. Used to mark which feats are DM-granted (removable, vs. rule-selected)
  // and to list the added ability-score improvements (which have no rule-driven UI of their own).
  const [dmGrants, setDmGrants] = useState([]);
  useEffect(() => {
    if (!canGrant) return undefined;
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
  }, [id, detail]);
  const dmFeatIds = new Set(
    dmGrants.filter((g) => g.kind === 'feat').map((g) => g.id),
  );
  const dmAsis = useMemo(() => {
    const byId = new Map();
    for (const g of dmGrants) {
      if (g.kind !== 'ability') continue;
      const cur = byId.get(g.id) ?? {
        elementId: g.id,
        name: g.name,
        count: 0,
      };
      cur.count += 1;
      byId.set(g.id, cur);
    }
    return [...byId.values()];
  }, [dmGrants]);
  const removeFeat = (featId) =>
    run(() => api.characters.removeFeat(id, featId));
  const removeAsi = (abilityElementId) =>
    run(() => api.characters.removeAbilityScore(id, abilityElementId));
  const removeCustom = (entry) => customServices.remove(entry.elementId);
  const customRows = {
    onInspect: inspectItem,
    onEdit: (entry) =>
      setCustomDialog({ entry, showsUnder: entry.draft.showsUnder }),
    onRemove: removeCustom,
    disabled: busy,
  };

  return (
    <WorkspaceTabLayout
      className="fcb-build-tab"
      shape="split"
      rail={
        <SectionNav
          ariaLabel="Build sections"
          items={sections.map((s) => ({
            key: s.key,
            label: s.label,
            detail: `${s.rules.length} choices`,
            /* A rule invalidated by a content update outranks the plain
               "incomplete" dot: red instead of the standard amber. */
            badge: s.rules.some((r) => ruleNeedsRepick(r, pendingMigration)) ? (
              <span className="fcb-tab-dot fcb-tab-dot-repick" />
            ) : (
              hasIncompleteRequiredSelection(s.rules, {
                sectionKey: s.key,
              }) && <span className="fcb-tab-dot" />
            ),
          }))}
          activeKey={active.key}
          onSelect={(key) => {
            setSection(key);
            dismissMobileDescription();
            resetPrimaryScroll();
          }}
        />
      }
    >
        <section className="fcb-panel">
          <header className="fcb-panel-header">
            <div>
              <h2 className="fcb-panel-title">{active.label}</h2>
            </div>
            <div className="fcb-panel-actions">
              {active.key === 'abilities' && canGrant && (
                <button
                  type="button"
                  className="fcb-button"
                  onClick={() => setAddAsiOpen(true)}
                  title="Grant an ability score improvement (DM / homebrew) — outside the level-up ASIs"
                >
                  <Icon name="add" />
                  ASI
                </button>
              )}
              {active.key === 'feats' && canGrant && (
                <button
                  type="button"
                  className="fcb-button"
                  onClick={() => setAddFeatOpen(true)}
                  title="Grant a feat (DM / homebrew) — outside the normal ASI/feat choice"
                >
                  <Icon name="add" />
                  Feat
                </button>
              )}
              {active.key !== 'companion' && canCustom && (
                <button
                  type="button"
                  className="fcb-button"
                  onClick={() =>
                    setCustomDialog({
                      entry: null,
                      showsUnder: showsUnderFor(active.key),
                    })
                  }
                  title="Make a feature of your own (a boon, a trait, a gift) without writing XML"
                >
                  <Icon name="add" />
                  Custom
                </button>
              )}
            </div>
          </header>
          <div
            className="fcb-panel-body fcb-editor-primary"
            ref={registerPrimaryScroll}
          >
            {active.key === 'abilities' && (
              <div className="mb-4 space-y-3">
                <AbilityEditor
                  abilities={detail.abilities}
                  generationOption={detail.generationOption}
                  disabled={busy}
                  onSave={(scores) =>
                    run(() => api.characters.setAbilities(id, scores))
                  }
                />

                {dmAsis.length > 0 && (
                  <div className="fcb-card p-3">
                    <div className="mb-2 text-sm font-semibold">
                      Added ability score improvements
                    </div>
                    <ul className="space-y-1">
                      {dmAsis.map((asi) => (
                        <li
                          key={asi.elementId}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span>
                            {asi.name}
                            {asi.count > 1 ? ` ×${asi.count}` : ''}
                          </span>
                          <button
                            type="button"
                            className="fcb-button fcb-button-danger ml-auto px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => removeAsi(asi.elementId)}
                            title="Remove this added ability score improvement"
                          >
                            <Icon name="delete" />
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {active.key === 'feats' && (
              <div className="mb-4 space-y-3">
                {(grantedFeats.length > 0 || customIn('feats').length > 0) && (
                  <div className="fcb-card p-3">
                    <div className="mb-2 text-sm font-semibold">Your feats</div>
                    <ul className="space-y-1">
                      <CustomEntryRows
                        entries={customIn('feats')}
                        {...customRows}
                      />
                      {grantedFeats.map((feat) => (
                        <li
                          key={feat.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <InformationButton
                            elementId={feat.id}
                            label={feat.name}
                            onInspect={inspectItem}
                          />
                          <InspectableItemButton
                            elementId={feat.id}
                            onInspect={inspectItem}
                            className="min-w-0 flex-1 text-left"
                          >
                            {feat.name}
                          </InspectableItemButton>
                          {dmFeatIds.has(feat.id) && (
                            <button
                              type="button"
                              className="fcb-button fcb-button-danger ml-auto px-2 py-1 text-xs"
                              disabled={busy}
                              onClick={() => removeFeat(feat.id)}
                              title="Remove this DM-granted feat"
                            >
                              <Icon name="delete" />
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {['race', 'class', 'other'].includes(active.key) && (
              <div className="mb-4">
                <CustomEntryList
                  entries={customIn(active.key)}
                  {...customRows}
                />
              </div>
            )}

            <div className="fcb-rule-list">
              {active.key === 'companion' && (
                <CompanionSection
                  rules={active.rules}
                  onInspect={inspectItem}
                />
              )}
              {(active.key === 'companion' ? [] : active.rules).map((rule) => (
                <SelectionRuleCard
                  key={`${rule.identifier}:${libraryRevision}`}
                  characterId={id}
                  rule={rule}
                  disabled={selectionBusy ?? busy}
                  sectionKey={active.key}
                  sectionLabel={active.label}
                  showRuleType={active.key === 'other'}
                  onInspect={inspectItem}
                  onSelect={(elementId, number = 1) =>
                    run(() =>
                      api.characters.setSelection(
                        id,
                        rule.identifier,
                        elementId,
                        number,
                      ),
                    )
                  }
                  onClear={(number = 1) =>
                    run(() =>
                      api.characters.clearSelection(
                        id,
                        rule.identifier,
                        number,
                      ),
                    )
                  }
                />
              ))}
              {active.rules.length === 0 &&
                active.key !== 'companion' &&
                active.key !== 'abilities' &&
                active.key !== 'feats' &&
                customIn(active.key).length === 0 && (
                  <p className="fcb-empty-copy">
                    No open choices in this section.
                  </p>
                )}
            </div>
          </div>
        </section>

        <DescriptionPanel
          {...descriptionPanelProps}
          elementId={inspected}
          placeholder={`Choosing: ${active.label}`}
          hideEmptyOnMobile
          returnLabel="Back to choices"
          detailsLabel={`${active.label} details`}
        />

      {addFeatOpen && (
        <AddFeatModal id={id} open onClose={() => setAddFeatOpen(false)} />
      )}
      <AddAsiModal
        id={id}
        open={addAsiOpen}
        onClose={() => setAddAsiOpen(false)}
      />
      {customDialog && customServices && (
        <CustomFeatureModal
          key={customDialog.entry?.elementId ?? 'new'}
          services={customServices}
          characterName={detail.name || 'your character'}
          entry={customDialog.entry}
          initialShowsUnder={customDialog.showsUnder}
          onClose={() => setCustomDialog(null)}
          onSaved={(saved) => {
            // Show the entry where it landed, so adding one never looks like nothing happened.
            if (saved?.section) setSection(saved.section);
          }}
        />
      )}
    </WorkspaceTabLayout>
  );
}
