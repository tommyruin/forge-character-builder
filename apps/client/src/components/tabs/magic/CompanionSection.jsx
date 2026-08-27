import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { useWorkspace } from '../../WorkspaceContext';
import {
  InformationButton,
  InspectableItemButton,
} from '../../InspectableItemControls';
import SelectionRuleCard from '../../SelectionRuleCard';
import PortraitControls from '../../PortraitControls';
import Icon from '../../Icon';

function signed(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function speedLine(companion) {
  const parts = [`${companion.speed} ft.`];
  if (companion.speedFly > 0) parts.push(`fly ${companion.speedFly} ft.`);
  if (companion.speedClimb > 0) parts.push(`climb ${companion.speedClimb} ft.`);
  if (companion.speedSwim > 0) parts.push(`swim ${companion.speedSwim} ft.`);
  if (companion.speedBurrow > 0) parts.push(`burrow ${companion.speedBurrow} ft.`);
  return parts.join(', ');
}

// Familiar & Companion UI: the pick itself is a normal engine selection rule
// (type="Companion", e.g. Ranger's Companion / Pact of the Chain familiar); once
// registered, the engine's live companion model supplies the stat block below,
// including class overrides like the Beast Master's proficiency-based AC/HP.
export default function CompanionSection({ rules, onInspect }) {
  const {
    id,
    busy,
    run,
    notify,
    getCachedResource,
    mutationTick,
    libraryRevision,
  } = useWorkspace();
  const [companion, setCompanion] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [nameError, setNameError] = useState(null);

  const refresh = useCallback(() => {
    getCachedResource(`companion:${id}`, () => api.characters.companion(id))
      .then((data) => {
        setError(null);
        setCompanion(data);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [getCachedResource, id]);

  useEffect(() => { refresh(); }, [refresh, mutationTick]);

  const pick = async (rule, elementId) => {
    await run(() => api.characters.setSelection(id, rule.identifier, elementId));
    notify(<>Companion selected</>);
  };

  const beginRename = () => {
    setDraftName(companion?.name ?? '');
    setNameError(null);
    setEditingName(true);
  };

  const cancelRename = () => {
    setNameError(null);
    setEditingName(false);
  };

  const saveName = async (event) => {
    event.preventDefault();
    setNameError(null);
    try {
      await run(() => api.characters.setCompanionName(id, draftName));
      setEditingName(false);
      notify(<>Companion renamed</>);
    } catch (e) {
      setNameError(e.message);
    }
  };

  const statLine = (label, value) =>
    value ? (
      <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  const uploadPortrait = (base64) =>
    run(() => api.characters.setCompanionPortrait(id, base64));
  const clearPortrait = () => run(() => api.characters.removeCompanionPortrait(id));

  return (
    <div className="space-y-4">
      {error && <p className="fcb-alert">{error}</p>}

      {rules.length > 0 && (
        <section className="fcb-panel">
          <header className="fcb-panel-header">
            <div>
              <h2 className="fcb-panel-title">Companion choices</h2>
            </div>
          </header>
          <div className="fcb-panel-body fcb-rule-list">
            {rules.map((rule) => (
              <SelectionRuleCard
                key={`${rule.identifier}:${libraryRevision}`}
                characterId={id}
                rule={rule}
                disabled={busy}
                onInspect={onInspect}
                onSelect={(elementId) => pick(rule, elementId)}
              />
            ))}
          </div>
        </section>
      )}

      {loaded && !companion && (
        <p className="fcb-empty-copy">
          {rules.length > 0
            ? 'No companion chosen yet — pick one above to see its stat block.'
            : 'No feature on this character grants a companion or familiar.'}
        </p>
      )}

      {companion && (
        <section className="fcb-panel" data-testid="companion-statblock">
          <header className="fcb-panel-header">
            <div className="fcb-companion-identity">
              <PortraitControls
                characterId={id}
                characterName={companion.name}
                portraitBase64={companion.portrait}
                size="lg"
                onUpload={uploadPortrait}
                onRemove={clearPortrait}
                onError={setError}
              />
              <div>
              {editingName ? (
                <form onSubmit={saveName} className="space-y-2">
                  <label className="sr-only" htmlFor="companion-name-input">
                    Companion name
                  </label>
                  <input
                    id="companion-name-input"
                    className="fcb-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') cancelRename();
                    }}
                    autoFocus
                    disabled={busy}
                    aria-label="Companion name"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      className="fcb-button fcb-button-primary"
                      disabled={busy}
                      aria-label="Save companion name"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="fcb-button"
                      onClick={cancelRename}
                      disabled={busy}
                      aria-label="Cancel companion rename"
                    >
                      Cancel
                    </button>
                  </div>
                  {nameError && <p className="fcb-alert">{nameError}</p>}
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="fcb-panel-title">{companion.name}</h2>
                  <button
                    type="button"
                    className="fcb-icon-button"
                    onClick={beginRename}
                    disabled={busy}
                    aria-label={`Rename ${companion.name}`}
                    title="Rename companion"
                  >
                    <Icon name="edit" />
                  </button>
                </div>
              )}
              <p className="fcb-panel-subtitle">
                {[companion.kind, companion.owner].filter(Boolean).join(' · ') ||
                  companion.build}
              </p>
              </div>
            </div>
            <InformationButton
              elementId={companion.elementId}
              label={companion.name}
              onInspect={onInspect}
            />
          </header>
          <div className="fcb-panel-body fcb-companion-body">
            <div className="fcb-meta-strip">
              <span className="fcb-stat-pill">AC <strong>{companion.armorClass}</strong></span>
              <span className="fcb-stat-pill">HP <strong>{companion.maxHp}</strong></span>
              <span className="fcb-stat-pill">INIT <strong>{signed(companion.initiative)}</strong></span>
              <span className="fcb-stat-pill">Speed <strong>{speedLine(companion)}</strong></span>
              {companion.attackBonus !== 0 && (
                <span className="fcb-stat-pill">Attack <strong>{signed(companion.attackBonus)}</strong></span>
              )}
              {companion.damageBonus !== 0 && (
                <span className="fcb-stat-pill">Damage <strong>{signed(companion.damageBonus)}</strong></span>
              )}
            </div>

            <div className="fcb-companion-abilities">
              {companion.abilities.map((a) => (
                <div key={a.name} className="fcb-companion-ability">
                  <div className="fcb-companion-ability-name">{a.name.slice(0, 3).toUpperCase()}</div>
                  <div className="fcb-companion-ability-score">{a.score}</div>
                  <div className="fcb-companion-ability-mod">{signed(a.modifier)}</div>
                </div>
              ))}
            </div>

            <dl className="fcb-detail-list">
              {statLine('Hit Points', companion.hitPointsText && companion.hitPointsText !== `${companion.maxHp}` ? companion.hitPointsText : null)}
              {statLine('Saving Throws', companion.savingThrows)}
              {statLine('Skills', companion.skills)}
              {statLine('Vulnerabilities', companion.damageVulnerabilities)}
              {statLine('Resistances', companion.damageResistances)}
              {statLine('Immunities', companion.damageImmunities)}
              {statLine('Condition Immunities', companion.conditionImmunities)}
              {statLine('Senses', companion.senses)}
              {statLine('Languages', companion.languages)}
              {statLine('Challenge', companion.challenge)}
              {statLine('Proficiency', signed(companion.proficiency))}
              {statLine('Build', companion.build)}
            </dl>

            {[['Traits', companion.traits], ['Actions', companion.actions], ['Reactions', companion.reactions]]
              .filter(([, features]) => features.length > 0)
              .map(([label, features]) => (
                <section key={label} className="fcb-companion-feature-group">
                  <h3 className="fcb-card-title">{label}</h3>
                  {features.map((feature) => (
                    <article key={feature.id} className="fcb-companion-feature">
                      {/* The rules text prints below, so the name alone carries
                          the inspect affordance — an information button here
                          would only reopen the same words in a panel. */}
                      <InspectableItemButton
                        elementId={feature.id}
                        onInspect={onInspect}
                        className="fcb-companion-feature-name"
                        title="Read description"
                      >
                        {feature.name}
                      </InspectableItemButton>
                      {feature.description ? (
                        <p className="fcb-companion-feature-text">{feature.description}</p>
                      ) : null}
                    </article>
                  ))}
                </section>
              ))}

            <p className="fcb-companion-source">{companion.source}</p>
          </div>
        </section>
      )}
    </div>
  );
}
