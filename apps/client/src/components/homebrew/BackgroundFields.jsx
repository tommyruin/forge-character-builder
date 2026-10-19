// A background's tabs. Basics: the proficiencies, languages and picks it gives (B2 grants and B3
// choices), its equipment, and, for the 2024 rules, the three abilities it raises and its origin
// feat. Feature: the background feature, written here because it cannot be added on its own.
// Personality: the lists of traits, ideals, bonds and flaws the sheet fills its boxes from.

import { PERSONALITY_LIST_NAMES, createProgressionFeature } from '@forge-cb/engine/custom';
import FeatureFields from '../custom/FeatureFields';
import LibraryPicker from '../custom/LibraryPicker';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from '../custom/fields';
import { abilityOptions } from '../custom/draftModel';
import { StartingProficiencies } from './ClassFields';
import LinesInput from './LinesInput';

const LIST_HELP = {
  'Personality Trait': 'The player picks this many; the sheet joins them.',
  Ideal: 'One ideal, printed in the Ideals box.',
  Bond: 'One bond, printed in the Bonds box.',
  Flaw: 'One flaw, printed in the Flaws box.',
};

export function BackgroundBasics({ draft, setDraft, services, issues = [], attempted = false }) {
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const ability = draft.abilityChoice;
  const shown = attempted ? issues.filter((issue) => /^(equipment|abilityChoice|originFeat)/.test(issue.path)) : [];
  return (
    <div className="space-y-4" data-testid="hb-background-basics">
      <StartingProficiencies
        ownerName={draft.name}
        blocks={draft.starting}
        onChange={(starting) => patch({ starting })}
        services={services}
        issues={issues}
        attempted={attempted}
        path="starting"
      />
      <Field label="Equipment, one item per line">
        <LinesInput label="Equipment" value={draft.equipment} onChange={(equipment) => patch({ equipment })} placeholder="A brass lantern" />
      </Field>

      <details className="fcb-custom-gates" open={Boolean(ability || draft.originFeat)}>
        <summary>2024 rules: ability increase and origin feat</summary>
        <div className="fcb-custom-gates-body space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(ability)}
              onChange={(event) => patch({ abilityChoice: event.target.checked ? ['strength', 'dexterity', 'constitution'] : undefined })}
            />
            The background raises three abilities
          </label>
          {ability && (
            <div className="fcb-custom-row">
              {ability.map((current, index) => (
                <Field key={index} label={`Ability ${index + 1}`}>
                  <SelectInput
                    label={`Background ability ${index + 1}`}
                    value={current}
                    options={abilityOptions.filter((option) => option.id === current || !ability.includes(option.id))}
                    onChange={(next) => patch({ abilityChoice: ability.map((entry, at) => (at === index ? next : entry)) })}
                  />
                </Field>
              ))}
            </div>
          )}
          {ability && <p className="fcb-muted-copy text-xs">The player assigns three points among these abilities, no more than two to one. It replaces the species' own ability increase.</p>}
          <div>
            <span className="fcb-field-label">Origin feat</span>
            <LibraryPicker
              lookup={services.lookup}
              type="Feat"
              label="Find the origin feat"
              value={draft.originFeat?.id ?? ''}
              valueLabel={draft.originFeat?.label}
              onPick={(item) => patch({ originFeat: { id: item.id, label: item.name } })}
            />
            {draft.originFeat && (
              <button type="button" className="fcb-button mt-2" onClick={() => patch({ originFeat: undefined })}>
                No origin feat
              </button>
            )}
          </div>
        </div>
      </details>
      <Issues issues={shown} />
    </div>
  );
}

export function BackgroundFeature({ draft, setDraft, services, issues = [], attempted = false }) {
  const feature = draft.feature;
  if (!feature) {
    return (
      <div className="space-y-2" data-testid="hb-background-feature">
        <p className="fcb-muted-copy text-sm">A background feature is optional (2024 backgrounds have none). It is part of this background and cannot be added on its own.</p>
        <button
          type="button"
          className="fcb-button"
          onClick={() => setDraft((current) => ({ ...current, feature: createProgressionFeature('background', 1, `Feature: ${current.name.trim() || 'New background'}`).draft }))}
        >
          Add a background feature
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="hb-background-feature">
      <FeatureFields
        draft={feature}
        setDraft={(updater) => setDraft((current) => ({ ...current, feature: typeof updater === 'function' ? updater(current.feature) : updater }))}
        services={services}
        issues={issues.filter((issue) => issue.path.startsWith('feature.')).map((issue) => ({ ...issue, path: issue.path.replace(/^feature\./, '') }))}
        attempted={attempted}
        placed
      />
      <button type="button" className="fcb-button fcb-button-danger" onClick={() => setDraft((current) => ({ ...current, feature: undefined }))}>
        Remove the feature
      </button>
    </div>
  );
}

export function BackgroundLists({ draft, setDraft, issues = [], attempted = false }) {
  const lists = draft.lists;
  const set = (name, next) =>
    setDraft((current) => {
      const others = current.lists.filter((list) => list.name !== name);
      const ordered = next ? [...others, next] : others;
      return { ...current, lists: PERSONALITY_LIST_NAMES.flatMap((listName) => ordered.filter((list) => list.name === listName)) };
    });
  const shown = attempted ? issues.filter((issue) => issue.path.startsWith('lists')) : [];
  return (
    <div className="space-y-4" data-testid="hb-background-lists">
      <p className="fcb-muted-copy text-xs">
        The player picks from these lists and the picks fill the character sheet&apos;s personality, ideals, bonds and flaws boxes.
      </p>
      {PERSONALITY_LIST_NAMES.map((name) => {
        const list = lists.find((entry) => entry.name === name);
        if (!list) {
          return (
            <div key={name}>
              <button type="button" className="fcb-mode-button" onClick={() => set(name, { name, count: name === 'Personality Trait' ? 2 : 1, items: [] })}>
                + {name} list
              </button>
            </div>
          );
        }
        return (
          <section key={name} className="fcb-custom-block" role="group" aria-label={`${name} list`}>
            <div className="fcb-custom-row">
              <h4 className="fcb-field-label">{name}</h4>
              <Field label="The player picks">
                <NumberInput label={`${name} picks`} min={1} max={4} value={list.count} onChange={(count) => set(name, { ...list, count: count ?? 1 })} />
              </Field>
              <RemoveButton label={`Remove the ${name} list`} onClick={() => set(name, undefined)} />
            </div>
            <Field label="One entry per line">
              <LinesInput label={`${name} entries`} value={list.items} onChange={(items) => set(name, { ...list, items })} rows={5} />
            </Field>
            <p className="fcb-muted-copy text-xs">{LIST_HELP[name]}</p>
          </section>
        );
      })}
      <Issues issues={shown} />
    </div>
  );
}
