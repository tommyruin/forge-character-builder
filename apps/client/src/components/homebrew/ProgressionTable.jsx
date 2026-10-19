// B11, the level table of a class, a subclass or a species: one row per level that has something
// at it, with the features granted there, the picks offered there and one column per value (a die
// that grows, a count of uses). A cell adds to its level; a feature or a pick opens under the
// table to be edited with the same forms a single custom feature uses. Value columns are edited
// in their cells (type what the value becomes at that level) and named below the table.

import { useState } from 'react';
import ChoiceBlock from '../custom/ChoiceBlock';
import FeatureFields from '../custom/FeatureFields';
import ScaleBlock from '../custom/ScaleBlock';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from '../custom/fields';
import {
  addChoiceAt,
  addFeatureAt,
  addScaleColumn,
  describePick,
  milestonesAt,
  removeChoice,
  removeFeature,
  scaleValueAt,
  setChoice,
  setFeatureDraft,
  setFeatureLevel,
  setScaleAt,
  tableLevels,
} from './buildModel';

const LEVELS = Array.from({ length: 20 }, (_, index) => index + 1);

const levelWord = (owner) => (owner === 'species' ? 'Character level' : 'Level');

/**
 * `draft` is a class, subclass, species or subspecies draft; `setDraft` takes it or a function of it.
 * `services` is the form services (library lookup, casters). `issues` are the engine's, shown once
 * the author has tried to save.
 */
export default function ProgressionTable({ draft, setDraft, services, issues = [], attempted = false, owner }) {
  const [open, setOpen] = useState(null);
  const [extraLevels, setExtraLevels] = useState([]);
  const levels = [...new Set([...tableLevels(draft), ...extraLevels])].sort((left, right) => left - right);
  const scales = draft.scales ?? [];
  const remaining = LEVELS.filter((level) => !levels.includes(level));

  const addFeature = (level) => {
    let id = null;
    setDraft((current) => {
      const made = addFeatureAt(current, level);
      id = made.id;
      return made.draft;
    });
    setOpen({ kind: 'feature', id });
  };
  const addChoice = (level) => {
    let id = null;
    setDraft((current) => {
      const made = addChoiceAt(current, level);
      id = made.id;
      return made.draft;
    });
    setOpen({ kind: 'choice', id });
  };
  const patchScale = (scaleId, apply) =>
    setDraft((current) => ({ ...current, scales: current.scales.map((scale) => (scale.id === scaleId ? apply(scale) : scale)) }));

  const openFeature = open?.kind === 'feature' ? draft.features.find((entry) => entry.draft.id === open.id) : undefined;
  const openChoice = open?.kind === 'choice' ? draft.choices.find((choice) => choice.id === open.id) : undefined;
  const featureIndex = openFeature ? draft.features.indexOf(openFeature) : -1;
  const choiceIndex = openChoice ? draft.choices.indexOf(openChoice) : -1;
  const issuesAt = (prefix) => (attempted ? issues.filter((issue) => issue.path.startsWith(prefix)) : []);
  const tableIssues = attempted ? issues.filter((issue) => ['features', 'choices', 'scales'].includes(issue.path)) : [];

  return (
    <div className="space-y-4" data-testid="hb-progression">
      <p className="fcb-muted-copy text-xs">
        {owner === 'species'
          ? 'Levels here are character levels. A trait at level 1 is part of the species from the start.'
          : 'Levels count class levels. Use a cell to add a feature, a choice or a value.'}
      </p>
      <div className="fcb-progression-scroll">
        <table className="fcb-progression-table" aria-label="Level table">
          <thead>
            <tr>
              <th scope="col">{levelWord(owner)}</th>
              <th scope="col">Features</th>
              <th scope="col">Player picks</th>
              {scales.map((scale) => (
                <th key={scale.id} scope="col">
                  {scale.name.trim() || 'Value'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {levels.length === 0 && (
              <tr>
                <td colSpan={3 + scales.length} className="fcb-muted-copy">
                  Nothing in the table yet. Add a level below.
                </td>
              </tr>
            )}
            {levels.map((level) => {
              const features = draft.features.filter((entry) => entry.level === level);
              const picks = draft.choices.filter((choice) => (choice.level ?? 1) === level);
              const notes = milestonesAt(draft, level);
              return (
                <tr key={level} data-level={level}>
                  <th scope="row">{level}</th>
                  <td>
                    <ul className="fcb-progression-cell">
                      {notes.map((note) => (
                        <li key={note} className="fcb-progression-note">
                          {note}
                        </li>
                      ))}
                      {features.map((entry) => (
                        <li key={entry.draft.id}>
                          <button
                            type="button"
                            className={`fcb-progression-chip${open?.id === entry.draft.id ? ' is-open' : ''}`}
                            aria-label={`Edit feature ${entry.draft.name || 'unnamed'}`}
                            onClick={() => setOpen({ kind: 'feature', id: entry.draft.id })}
                          >
                            {entry.draft.name || 'Unnamed feature'}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="fcb-progression-add" aria-label={`Add a feature at level ${level}`} onClick={() => addFeature(level)}>
                      + Feature
                    </button>
                  </td>
                  <td>
                    <ul className="fcb-progression-cell">
                      {picks.map((choice) => (
                        <li key={choice.id}>
                          <button
                            type="button"
                            className={`fcb-progression-chip${open?.id === choice.id ? ' is-open' : ''}`}
                            aria-label={`Edit choice ${choice.name || 'unnamed'}`}
                            onClick={() => setOpen({ kind: 'choice', id: choice.id })}
                          >
                            {describePick(choice)}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="fcb-progression-add" aria-label={`Add a choice at level ${level}`} onClick={() => addChoice(level)}>
                      + Choice
                    </button>
                  </td>
                  {scales.map((scale) => {
                    const here = scale.steps.find((step) => step.level === level);
                    const current = scaleValueAt(scale, level);
                    return (
                      <td key={scale.id}>
                        <input
                          className={`fcb-input fcb-progression-value${here ? ' is-step' : ''}`}
                          aria-label={`${scale.name.trim() || 'Value'} at level ${level}`}
                          value={current ?? ''}
                          placeholder="-"
                          onChange={(event) => patchScale(scale.id, (entry) => setScaleAt(entry, level, event.target.value))}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fcb-toolbar">
        <SelectInput
          label="Add a level"
          value=""
          placeholder="+ Level"
          options={remaining.map((level) => ({ id: String(level), label: `Level ${level}` }))}
          onChange={(value) => value !== '' && setExtraLevels((current) => [...current, Number(value)])}
        />
        <button type="button" className="fcb-button" onClick={() => setDraft((current) => addScaleColumn(current))}>
          + Value column
        </button>
      </div>

      {openFeature && (
        <section className="fcb-progression-detail" aria-label="Feature" data-testid="hb-progression-feature">
          <div className="fcb-custom-row">
            <Field label="Granted at level">
              <NumberInput
                label="Feature level"
                min={1}
                max={20}
                value={openFeature.level}
                onChange={(level) => setDraft((current) => setFeatureLevel(current, openFeature.draft.id, level ?? 1))}
              />
            </Field>
            <RemoveButton
              label="Remove this feature"
              onClick={() => {
                setDraft((current) => removeFeature(current, openFeature.draft.id));
                setOpen(null);
              }}
            />
          </div>
          <FeatureFields
            draft={openFeature.draft}
            setDraft={(updater) =>
              setDraft((current) => setFeatureDraft(current, openFeature.draft.id, (feature) => (typeof updater === 'function' ? updater(feature) : updater)))
            }
            services={services}
            issues={issuesAt(`features[${featureIndex}].draft`).map((issue) => ({ ...issue, path: issue.path.replace(`features[${featureIndex}].draft.`, '') }))}
            attempted={attempted}
            placed
            inheritedScales={scales}
          />
          <Issues issues={issuesAt(`features[${featureIndex}].level`)} />
        </section>
      )}

      {openChoice && (
        <section className="fcb-progression-detail" aria-label="Choice" data-testid="hb-progression-choice">
          <ChoiceBlock
            block={openChoice}
            ariaLabel="Player picks"
            lookup={services.lookup}
            casters={[]}
            issues={issuesAt(`choices[${choiceIndex}]`)}
            onChange={(next) => setDraft((current) => setChoice(current, openChoice.id, next))}
            onRemove={() => {
              setDraft((current) => removeChoice(current, openChoice.id));
              setOpen(null);
            }}
          />
        </section>
      )}

      {scales.length > 0 && (
        <section className="space-y-2" aria-label="Value columns">
          <h4 className="fcb-field-label">Value columns</h4>
          {scales.map((scale, index) => (
            <ScaleBlock
              key={scale.id}
              scale={scale}
              issues={issuesAt(`scales[${index}]`)}
              onChange={(next) => patchScale(scale.id, () => next)}
              onRemove={() => setDraft((current) => ({ ...current, scales: current.scales.filter((entry) => entry.id !== scale.id) }))}
            />
          ))}
        </section>
      )}
      <Issues issues={tableIssues} />
    </div>
  );
}
