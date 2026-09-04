import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, MANAGE_RULE_TYPES } from '../../api';
import { useWorkspace } from '../WorkspaceContext';
import SectionNav from '../SectionNav';
import WorkspaceTabLayout from '../WorkspaceTabLayout';
import SelectionRuleCard from '../SelectionRuleCard';
import DescriptionPanel from '../DescriptionPanel';
import useMobileDescriptionNavigation from '../../hooks/useMobileDescriptionNavigation';
import Modal from '../Modal';
import OptionalRulesPanel from './manage/OptionalRulesPanel';
import CharacterSourcesPanel from './manage/CharacterSourcesPanel';
import CharacterAdjustments from './manage/CharacterAdjustments';
import AttackEditorModal from './manage/AttackEditorModal';
import AttackComputationDetails from './manage/AttackComputationDetails';
import Icon from '../Icon';
import { isExplicitDevelopmentMode } from '../clientMode.js';
import SheetSettingsPanel from './manage/SheetSettingsPanel';

const SUB_TABS = [
  ['character', 'Character'],
  ['optional-rules', 'Optional rules'],
  ['sources', 'Sources'],
  ['backstory', 'Backstory'],
  ['notes', 'Notes'],
  ['allies', 'Allies & Organizations'],
  ['attacks', 'Attacks'],
  ['sheet', 'Sheet'],
];

// Randomize scopes: which editable fields each Randomize button previews/overwrites.
const RANDOMIZE_FIELDS = {
  details: ['name'],
  appearance: ['age', 'height', 'weight', 'eyes', 'skin', 'hair'],
  alignment: [],
  all: ['name', 'age', 'height', 'weight', 'eyes', 'skin', 'hair'],
};

const RANDOMIZE_TITLES = {
  details: 'Randomize character details',
  appearance: 'Randomize appearance',
  alignment: 'Randomize alignment',
  all: 'Randomize all',
};

const FIELD_LABELS = {
  name: 'Character name',
  age: 'Age',
  height: 'Height',
  weight: 'Weight',
  eyes: 'Eyes',
  skin: 'Skin',
  hair: 'Hair',
};

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const showInternalControls = isExplicitDevelopmentMode(import.meta.env);

// MANAGE tab: the character-details surfaces. Alignment and Deity are engine
// selection rules and live here; the free-text fields map to Character
// properties saved to .dnd5e.
export default function ManageTab() {
  const {
    id,
    detail,
    busy,
    run,
    notify,
    mutationTick,
    getCachedResource,
    setCachedResource,
    libraryRevision,
    registerPrimaryScroll,
    registerDetailsScroll,
    resetPrimaryScroll,
  } = useWorkspace();
  const [subTab, setSubTab] = useState('character');
  const [draft, setDraft] = useState({});
  const [inspected, setInspected] = useState(null);
  const [randomize, setRandomize] = useState(null); // { scope, suggestion, alignment }
  const [randomizeBusy, setRandomizeBusy] = useState(false);
  const {
    inspect: inspectItem,
    dismiss: dismissMobileDescription,
    descriptionPanelProps,
  } = useMobileDescriptionNavigation({
    onInspect: setInspected,
    registerDetailsScroll,
  });

  const baseForm = useMemo(
    () => ({
      name: detail.name,
      playerName: detail.playerName,
      gender: detail.gender,
      experience: detail.experience,
      age: detail.age,
      height: detail.height,
      weight: detail.weight,
      eyes: detail.eyes,
      skin: detail.skin,
      hair: detail.hair,
      backstory: detail.backstory,
      additionalFeatures: detail.additionalFeatures,
      allies: detail.allies,
      organisationName: detail.organisationName,
      notes1: detail.notes1,
      notes2: detail.notes2,
    }),
    [detail],
  );

  const form = { ...baseForm, ...draft };
  const dirty = Object.keys(draft).length > 0;

  const set = (key, value) => {
    setDraft((values) => ({ ...values, [key]: value }));
  };

  const save = () =>
    run(() => api.characters.updateDetails(id, form)).then(() => setDraft({}));

  const patchHomebrew = async () => {
    try {
      await api.content.reload?.();
      notify('Homebrew content patched.');
    } catch (error) {
      notify(`Homebrew patch failed: ${error.message}`);
    }
  };

  const removeHomebrew = async () => {
    try {
      // The content manager owns source-level deletion. This control provides the
      // character workspace handoff while preserving that atomic removal path.
      await api.content.reload?.();
      notify('Homebrew content removal is available from Content.');
    } catch (error) {
      notify(`Homebrew refresh failed: ${error.message}`);
    }
  };

  const manageRules = detail.selectionRules.filter((r) =>
    MANAGE_RULE_TYPES.includes(r.type),
  );
  const alignmentRule = manageRules.find((r) => r.type === 'Alignment');

  // --- Randomize (per-section + whole-sheet) --------------------------------------
  // Fetch engine suggestions (race height/weight tables, racial names, description age
  // ranges) and/or a random legal Alignment option, then preview in a confirm modal —
  // nothing is overwritten until the user applies.

  const loadRandomize = async (scope) => {
    const suggestion =
      scope === 'alignment'
        ? null
        : await api.characters.appearanceSuggestions(id);
    let alignment = null;
    if ((scope === 'alignment' || scope === 'all') && alignmentRule) {
      const key = `selection-options:${id}:${alignmentRule.identifier}`;
      const options = await getCachedResource(key, () =>
        api.characters.selectionOptions(id, alignmentRule.identifier),
      );
      if (options?.length) {
        alignment = {
          rule: alignmentRule,
          option: pickRandom(options),
          currentName:
            options.find((o) =>
              alignmentRule.selectedElementIds?.includes(o.id),
            )?.name ?? '',
        };
      }
    }
    return { scope, suggestion, alignment };
  };

  const openRandomize = async (scope) => {
    setRandomizeBusy(true);
    try {
      const data = await loadRandomize(scope);
      if (scope === 'alignment' && !data.alignment) {
        notify('No alignment options are available for this character.');
        return;
      }
      setRandomize(data);
    } catch (e) {
      notify(`Randomize failed: ${e.message}`);
    } finally {
      setRandomizeBusy(false);
    }
  };

  const rerollRandomize = async () => {
    if (!randomize) return;
    setRandomizeBusy(true);
    try {
      setRandomize(await loadRandomize(randomize.scope));
    } catch (e) {
      notify(`Randomize failed: ${e.message}`);
    } finally {
      setRandomizeBusy(false);
    }
  };

  // Height/weight are null when the race has no roll table — those stay untouched.
  const randomizeRows = randomize
    ? RANDOMIZE_FIELDS[randomize.scope]
        .filter((key) => randomize.suggestion?.[key] != null)
        .map((key) => ({
          key,
          label: FIELD_LABELS[key],
          current: form[key] ?? '',
          suggested: randomize.suggestion[key],
        }))
    : [];

  const applyRandomize = async () => {
    const { scope, suggestion, alignment } = randomize;
    const rows = randomizeRows;
    setRandomize(null);
    try {
      if (rows.length) {
        const payload = { ...form };
        rows.forEach(({ key }) => {
          payload[key] = suggestion[key];
        });
        await run(() => api.characters.updateDetails(id, payload));
        setDraft({});
      }
      if (alignment) {
        await run(() =>
          api.characters.setSelection(
            id,
            alignment.rule.identifier,
            alignment.option.id,
          ),
        );
      }
      notify(
        `${RANDOMIZE_TITLES[scope].replace('Randomize', 'Randomized')} — saved`,
      );
    } catch {
      // run() already surfaced the failure via the workspace error banner.
    }
  };

  const randomizeButton = (scope, testId, label = 'Randomize') => (
    <button
      className="fcb-button"
      onClick={() => openRandomize(scope)}
      disabled={busy || randomizeBusy}
      aria-label={RANDOMIZE_TITLES[scope]}
      data-testid={testId}
    >
      <Icon name="randomize" />
      {label}
    </button>
  );

  const field = (key, label, type = 'text') => (
    <label className="fcb-field-label">
      {label}
      <input
        type={type}
        className="fcb-input normal-case"
        value={form[key] ?? ''}
        onChange={(e) =>
          set(
            key,
            type === 'number'
              ? parseInt(e.target.value, 10) || 0
              : e.target.value,
          )
        }
        disabled={busy}
      />
    </label>
  );

  const textArea = (key, label, rows = 10) => (
    <label className="fcb-field-label">
      {label}
      <textarea
        rows={rows}
        className="fcb-textarea normal-case"
        value={form[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
        disabled={busy}
      />
    </label>
  );

  return (
    <WorkspaceTabLayout
      className="fcb-manage-layout"
      shape="stack"
      rail={
        <SectionNav
          ariaLabel="Manage sections"
          items={SUB_TABS.map(([key, label]) => ({ key, label }))}
          activeKey={subTab}
          onSelect={(key) => {
            setSubTab(key);
            dismissMobileDescription();
            resetPrimaryScroll();
          }}
        />
      }
    >
      {showInternalControls && (
        <section className="fcb-panel fcb-homebrew-transport-panel">
          <header className="fcb-panel-header">
            <div>
              <h2 className="fcb-panel-title">Homebrew content</h2>
              <p className="fcb-panel-subtitle">
                Refresh or remove locally staged homebrew from Content.
              </p>
            </div>
            <div className="fcb-toolbar">
              <button
                type="button"
                className="fcb-button"
                data-testid="homebrew-patch"
                onClick={() => void patchHomebrew()}
              >
                Patch
              </button>
              <button
                type="button"
                className="fcb-button"
                data-testid="homebrew-remove"
                onClick={() => void removeHomebrew()}
              >
                <Icon name="delete" />
                Remove
              </button>
              <button
                type="button"
                className="fcb-button"
                data-testid="ruleset-control"
                onClick={() => setSubTab('optional-rules')}
              >
                Ruleset
              </button>
              <button
                type="button"
                className="fcb-button"
                data-testid="source-control"
                onClick={() => setSubTab('sources')}
              >
                Sources
              </button>
              <button
                type="button"
                className="fcb-button"
                data-testid="migration"
                onClick={() => notify('Migration review is available after a content change.')}
              >
                Migration
              </button>
            </div>
          </header>
        </section>
      )}

      {subTab === 'character' && (
        <div className="fcb-two-panel-grid">
          <div
            className="fcb-editor-primary space-y-4"
            ref={registerPrimaryScroll}
          >
            <section className="fcb-panel">
              <header className="fcb-panel-header">
                <div>
                  <h2 className="fcb-panel-title">Character details</h2>
                </div>
                {randomizeButton('details', 'randomize-details')}
              </header>
              <div className="fcb-panel-body">
                <div className="grid gap-4 md:grid-cols-3">
                  {field('name', 'Character name')}
                  {field('playerName', 'Player name')}
                  {field('gender', 'Gender')}
                  {field('experience', 'Current Experience', 'number')}
                </div>
              </div>
            </section>

            {manageRules.length > 0 && (
              <section className="fcb-panel">
                <header className="fcb-panel-header">
                  <div>
                    <h2 className="fcb-panel-title">Campaign choices</h2>
                  </div>
                  {alignmentRule &&
                    randomizeButton('alignment', 'randomize-alignment')}
                </header>
                <div className="fcb-panel-body fcb-rule-list">
                  {manageRules.map((rule) => (
                    <SelectionRuleCard
                      key={`${rule.identifier}:${libraryRevision}`}
                      characterId={id}
                      rule={rule}
                      disabled={busy}
                      onInspect={inspectItem}
                      onSelect={(elementId) =>
                        run(() =>
                          api.characters.setSelection(
                            id,
                            rule.identifier,
                            elementId,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="fcb-panel">
              <header className="fcb-panel-header">
                <div>
                  <h2 className="fcb-panel-title">Appearance</h2>
                </div>
                {randomizeButton('appearance', 'randomize-appearance')}
              </header>
              <div className="fcb-panel-body">
                <div className="grid gap-4 md:grid-cols-3">
                  {field('age', 'Age')}
                  {field('height', 'Height')}
                  {field('weight', 'Weight')}
                  {field('eyes', 'Eyes')}
                  {field('skin', 'Skin')}
                  {field('hair', 'Hair')}
                </div>
              </div>
            </section>

            <section className="fcb-panel">
              <header className="fcb-panel-header">
                <div>
                  <h2 className="fcb-panel-title">Additional features</h2>
                </div>
              </header>
              <div className="fcb-panel-body">
                {textArea(
                  'additionalFeatures',
                  'Additional features & Traits',
                  5,
                )}
                <CharacterAdjustments id={id} busy={busy} run={run} />
              </div>
            </section>

            <div className="fcb-manage-character-save mt-6">
              <button
                onClick={save}
                disabled={busy || !dirty}
                className="fcb-button fcb-button-primary"
              >
                Save details
              </button>
            </div>
          </div>
          <DescriptionPanel
            {...descriptionPanelProps}
            elementId={inspected}
            placeholder="Select an alignment or deity to inspect."
            returnLabel="Back to campaign choices"
            detailsLabel="Campaign choice details"
          />
        </div>
      )}

      {subTab !== 'character' && (
        <div
          className={`fcb-manage-single-primary${
            subTab === 'sources' ? ' fcb-manage-sources-primary' : ''
          }`}
          ref={registerPrimaryScroll}
        >
          {subTab === 'optional-rules' && <OptionalRulesPanel />}

          {subTab === 'sources' && <CharacterSourcesPanel />}

          {subTab === 'backstory' && (
            <section className="fcb-panel">
              <div className="fcb-panel-body">
                {textArea('backstory', 'Backstory', 18)}
              </div>
            </section>
          )}
          {subTab === 'notes' && (
            <section className="fcb-panel">
              <div className="fcb-panel-body space-y-4">
                {textArea('notes1', 'Notes', 10)}
                {textArea('notes2', 'More notes', 10)}
              </div>
            </section>
          )}
          {subTab === 'allies' && (
            <section className="fcb-panel">
              <div className="fcb-panel-body space-y-4">
                {field('organisationName', 'Organization name')}
                {textArea('allies', 'Allies & Organizations', 12)}
              </div>
            </section>
          )}
          {subTab === 'sheet' && <SheetSettingsPanel />}

          {subTab === 'attacks' && (
            <AttacksManager
              id={id}
              detail={detail}
              busy={busy}
              run={run}
              mutationTick={mutationTick}
              getCachedResource={getCachedResource}
              setCachedResource={setCachedResource}
            />
          )}

          {subTab !== 'attacks' &&
            subTab !== 'optional-rules' &&
            subTab !== 'sources' &&
            subTab !== 'sheet' && (
            <div className="mt-6">
              <button
                onClick={save}
                disabled={busy || !dirty}
                className="fcb-button fcb-button-primary"
              >
                Save details
              </button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={Boolean(randomize)}
        title={randomize ? RANDOMIZE_TITLES[randomize.scope] : ''}
        onClose={() => setRandomize(null)}
      >
        {randomize && (
          <div data-testid="randomize-preview">
            <p className="text-sm text-[var(--fcb-text-muted)]">
              Applying replaces the values below and saves immediately —
              anything already entered in these fields is overwritten.
            </p>
            {(randomizeRows.length > 0 || randomize.alignment) && (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-[var(--fcb-text-faint)]">
                    <th className="py-1 pr-2 font-semibold">Field</th>
                    <th className="py-1 pr-2 font-semibold">Current</th>
                    <th className="py-1 font-semibold">Suggested</th>
                  </tr>
                </thead>
                <tbody>
                  {randomizeRows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-t border-[var(--fcb-border-soft)]"
                    >
                      <td className="py-1 pr-2 text-[var(--fcb-text-muted)]">
                        {row.label}
                      </td>
                      <td className="py-1 pr-2">
                        {row.current || (
                          <span className="text-[var(--fcb-text-faint)]">
                            empty
                          </span>
                        )}
                      </td>
                      <td className="py-1 font-semibold normal-case">
                        {row.suggested}
                      </td>
                    </tr>
                  ))}
                  {randomize.alignment && (
                    <tr className="border-t border-[var(--fcb-border-soft)]">
                      <td className="py-1 pr-2 text-[var(--fcb-text-muted)]">
                        Alignment
                      </td>
                      <td className="py-1 pr-2">
                        {randomize.alignment.currentName || (
                          <span className="text-[var(--fcb-text-faint)]">
                            empty
                          </span>
                        )}
                      </td>
                      <td className="py-1 font-semibold">
                        {randomize.alignment.option.name}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {randomize.suggestion && (
              <p className="mt-3 text-xs text-[var(--fcb-text-faint)]">
                {randomize.scope !== 'alignment' &&
                  randomize.scope !== 'details' &&
                  (randomize.suggestion.heightWeightFromRace
                    ? `Height and weight are rolled on the ${randomize.suggestion.raceName} table. `
                    : 'This race has no height/weight table, so height and weight stay unchanged. ')}
                {randomize.scope !== 'alignment' &&
                  randomize.scope !== 'details' &&
                  (randomize.suggestion.ageFromRace
                    ? 'Age uses the range from the race description. '
                    : 'Age uses a generic adult range. ')}
                {randomize.scope !== 'appearance' &&
                  randomize.scope !== 'alignment' &&
                  (randomize.suggestion.nameFromRace
                    ? `Names are drawn from the ${randomize.suggestion.raceName ?? 'race'} name lists.`
                    : 'This race has no name lists, so a placeholder name is offered.')}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="fcb-button"
                onClick={rerollRandomize}
                disabled={randomizeBusy}
                data-testid="randomize-reroll"
              >
                Reroll
              </button>
              <button
                className="fcb-button"
                onClick={() => setRandomize(null)}
              >
                Cancel
              </button>
              <button
                className="fcb-button fcb-button-primary"
                onClick={applyRandomize}
                disabled={busy || randomizeBusy}
                data-testid="randomize-apply"
              >
                Apply & save
              </button>
            </div>
          </div>
        )}
      </Modal>
    </WorkspaceTabLayout>
  );
}

function attackStatus(attack) {
  if (!attack.isDisplayed) return 'Hidden from sheet';
  if (attack.sheetPosition >= 1 && attack.sheetPosition <= 4)
    return `Sheet row ${attack.sheetPosition}`;
  return 'Visible overflow';
}

function attackKindLabel(attack) {
  const kind = attack.kind ?? (attack.isAutomatic ? 'weapon' : 'manual');
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function abilityAbbreviation(ability) {
  return ability?.slice(0, 3).toUpperCase() ?? '';
}

/* The engine appends "Mastery: <Name>" to a weapon's description so the
   printed sheet carries it (packages/engine/src/attacks/attacks.ts). The card
   now names the mastery on its own line, so the trailing clause is dropped
   here. This is display only: the stored row, the export and the sheet keep
   the full description. */
function attackDescriptionText(attack) {
  const description = attack.description ?? '';
  const name = attack.mastery?.active ? attack.mastery.name : '';
  if (!description || !name) return description;
  const clause = `Mastery: ${name}`;
  if (description === clause) return '';
  return description.endsWith(`, ${clause}`)
    ? description.slice(0, -(clause.length + 2))
    : description;
}

function AttacksManager({
  id,
  detail,
  busy,
  run,
  mutationTick,
  getCachedResource,
  setCachedResource,
}) {
  const [attacks, setAttacks] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(undefined);
  const cacheKey = `attacks:${id}`;

  const refresh = useCallback(
    (force = false) => {
      getCachedResource(cacheKey, () => api.characters.attacks(id), { force })
        .then((data) => {
          setError(null);
          setAttacks(data);
        })
        .catch((e) => {
          // Never leave another character's rows rendered beside the error.
          setAttacks(null);
          setError(e.message);
        });
    },
    [cacheKey, getCachedResource, id],
  );

  // Attack rows recompute from the character, so a mutation elsewhere -- a
  // level-up raising the proficiency bonus or a monk's Martial Arts die, an
  // ability change, a new magic item -- changes them without touching a row.
  useEffect(() => {
    refresh();
  }, [refresh, mutationTick]);

  useEffect(() => {
    api.characters
      .attackOptions(id)
      .then(setOptions)
      .catch((caught) => setError(caught.message));
  }, [id, mutationTick]);

  const mutate = async (operation) => {
    const updated = await run(operation, {
      refreshDetail: false,
      invalidateSelectionOptions: false,
    });
    if (Array.isArray(updated)) {
      setCachedResource(cacheKey, updated);
      setAttacks(updated);
    } else {
      refresh(true);
    }
  };

  const saveAttack = async (draft) => {
    await mutate(() =>
      editor
        ? api.characters.updateAttack(id, editor.id, draft)
        : api.characters.createAttack(id, draft),
    );
    setEditor(undefined);
  };

  const openEditor = async (attack) => {
    try {
      const liveOptions = await api.characters.attackOptions(id);
      setOptions(liveOptions);
      setError(null);
      setEditor(attack);
    } catch (caught) {
      setError(caught.message);
    }
  };

  // The sheet prints four rows, so attack cantrips are offered rather than
  // added automatically: one click for a known attack spell with no row yet.
  const linkedSpellIds = new Set(
    (attacks ?? [])
      .filter((attack) => attack.kind === 'spell')
      .map((attack) => attack.source?.spellId)
      .filter(Boolean),
  );
  const suggestedSpells = (options?.spells ?? []).filter(
    (spell) => !linkedSpellIds.has(spell.spellId),
  );

  if (!attacks && !error)
    return <p className="fcb-empty-copy">Loading attacks…</p>;

  return (
    <section className="fcb-panel">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">Attacks</h2>
          <p className="fcb-panel-subtitle">
            The first four visible attacks fill the sheet rows.
          </p>
        </div>
        <button
          className="fcb-button fcb-button-primary"
          disabled={busy || !options}
          onClick={() => openEditor(null)}
        >
          <Icon name="add" />
          Attack
        </button>
      </header>
      <div className="fcb-panel-body">
        {error && <p className="fcb-alert mb-4">{error}</p>}
        {suggestedSpells.length > 0 && (
          <div className="mb-4">
            <p className="fcb-field-label">Suggested</p>
            <div className="fcb-toolbar mt-2 flex-wrap">
              {suggestedSpells.map((spell) => (
                <button
                  key={`${spell.casterIdentifier}:${spell.spellId}`}
                  type="button"
                  className="fcb-button px-2 py-1 text-xs"
                  disabled={busy}
                  title={`Add ${spell.spellName} (${spell.casterName}) as an attack`}
                  onClick={() =>
                    mutate(() =>
                      api.characters.createAttack(id, {
                        mode: 'spell',
                        casterIdentifier: spell.casterIdentifier,
                        spellId: spell.spellId,
                      }),
                    )
                  }
                >
                  <Icon name="add" />
                  {spell.spellName}
                </button>
              ))}
            </div>
          </div>
        )}
        {attacks?.length === 0 ? (
          <p className="fcb-empty-copy">
            No attacks yet. Equip a weapon to add its attack here, or choose
            Attack to add an owned weapon, an unarmed strike, a spell, or a
            custom row.
          </p>
        ) : (
          <div className="space-y-3">
            {attacks?.map((attack, index) => {
              const deleteBlocked =
                attack.isAutomatic && attack.isCurrentlyEquipped;
              return (
                <article
                  key={attack.id}
                  aria-label={`${attack.name}: ${attackKindLabel(attack)} attack`}
                  className="relative rounded-[var(--fcb-radius)] border border-[var(--fcb-border-soft)] bg-[var(--fcb-surface-2)] p-4"
                >
                  <div>
                    <div className="min-w-0">
                      <div className="fcb-attack-heading flex flex-wrap items-center gap-2">
                        <h3 className="fcb-card-title">{attack.name}</h3>
                        <span
                          className="fcb-attack-meta-item"
                          aria-label={attackStatus(attack)}
                          title={attackStatus(attack)}
                        >
                          <span aria-hidden="true">
                            {attack.isDisplayed
                              ? (attack.sheetPosition ?? '+')
                              : '—'}
                          </span>
                        </span>
                        {attack.isCurrentlyEquipped && (
                          <span
                            className="fcb-attack-meta-item"
                            aria-label="Equipped"
                            title="Equipped"
                          >
                            <Icon name="check" />
                          </span>
                        )}
                        {attack.ability && (
                          <span
                            className="fcb-attack-meta-item"
                            aria-label={`${
                              attack.abilityMode === 'default'
                                ? 'Weapon default'
                                : 'Attack'
                            } ability: ${attack.ability}`}
                            title={`${
                              attack.abilityMode === 'default'
                                ? 'Weapon default'
                                : 'Attack ability'
                            }: ${attack.ability}`}
                          >
                            <span aria-hidden="true">
                              {abilityAbbreviation(attack.ability)}
                            </span>
                          </span>
                        )}
                        {attack.overriddenFields?.length > 0 && (
                          <span
                            className="fcb-attack-meta-item"
                            aria-label={`${attack.overriddenFields.length} overridden field${
                              attack.overriddenFields.length === 1 ? '' : 's'
                            }`}
                            title={`${attack.overriddenFields.length} overridden field${
                              attack.overriddenFields.length === 1 ? '' : 's'
                            }`}
                          >
                            <Icon name="override" />
                            <span aria-hidden="true">
                              {attack.overriddenFields.length}
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-[var(--fcb-text-muted)]">
                        {[attack.range, attack.bonus, attack.damage]
                          .filter(
                            (value) =>
                              value !== null &&
                              value !== undefined &&
                              value !== '',
                          )
                          .join(' · ') || 'No attack details'}
                      </p>
                      {attackDescriptionText(attack) && (
                        <p className="mt-1 text-xs text-[var(--fcb-text-faint)]">
                          {attackDescriptionText(attack)}
                        </p>
                      )}
                      {attack.mastery?.active && (
                        <p
                          className="fcb-attack-mastery mt-2"
                          title={`Weapon mastery: ${attack.mastery.name}`}
                        >
                          <span className="fcb-field-label">
                            Weapon mastery
                          </span>
                          <span className="fcb-attack-mastery-name">
                            {attack.mastery.name}
                          </span>
                        </p>
                      )}
                      {attack.source?.warning && (
                        <p className="fcb-alert mt-2 text-xs">
                          {attack.source.warning}
                        </p>
                      )}
                      <AttackComputationDetails
                        attack={attack}
                        computation={attack.computation}
                        compact
                      />
                    </div>
                    <div
                      className="fcb-toolbar fcb-attack-actions absolute right-4 top-4"
                      aria-label={`${attack.name} actions`}
                    >
                      <button
                        className="fcb-icon-button"
                        disabled={busy || !options}
                        onClick={() => openEditor(attack)}
                        aria-label={`Edit ${attack.name}`}
                        title={`Edit ${attack.name}`}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        className="fcb-icon-button"
                        disabled={busy || index === 0}
                        onClick={() =>
                          mutate(() =>
                            api.characters.moveAttack(id, attack.id, 'up'),
                          )
                        }
                        aria-label={`Move ${attack.name} up`}
                        title={`Move ${attack.name} up`}
                      >
                        <Icon name="move-up" />
                      </button>
                      <button
                        className="fcb-icon-button"
                        disabled={busy || index === attacks.length - 1}
                        onClick={() =>
                          mutate(() =>
                            api.characters.moveAttack(id, attack.id, 'down'),
                          )
                        }
                        aria-label={`Move ${attack.name} down`}
                        title={`Move ${attack.name} down`}
                      >
                        <Icon name="move-down" />
                      </button>
                      <button
                        className="fcb-icon-button"
                        disabled={busy}
                        onClick={() =>
                          mutate(() =>
                            api.characters.setAttackVisibility(
                              id,
                              attack.id,
                              !attack.isDisplayed,
                            ),
                          )
                        }
                        aria-label={
                          attack.isDisplayed
                            ? `Hide ${attack.name} from sheet`
                            : `Show ${attack.name} on sheet`
                        }
                        title={
                          attack.isDisplayed
                            ? `Hide ${attack.name} from sheet`
                            : `Show ${attack.name} on sheet`
                        }
                      >
                        <Icon
                          name={attack.isDisplayed ? 'hide' : 'show'}
                        />
                      </button>
                      <button
                        className="fcb-icon-button fcb-button-danger"
                        disabled={busy || deleteBlocked}
                        aria-label={`Delete ${attack.name}`}
                        title={
                          deleteBlocked
                            ? 'Unequip this weapon before deleting its automatic attack.'
                            : `Delete ${attack.name}`
                        }
                        onClick={() =>
                          mutate(() =>
                            api.characters.deleteAttack(id, attack.id),
                          )
                        }
                      >
                        <Icon name="delete" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <AttackEditorModal
        key={editor?.id ?? (editor === null ? 'new' : 'closed')}
        open={editor !== undefined}
        attack={editor || null}
        options={options}
        detail={detail}
        busy={busy}
        onClose={() => setEditor(undefined)}
        onSave={saveAttack}
      />
    </section>
  );
}
