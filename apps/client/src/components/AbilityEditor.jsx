import { useEffect, useMemo, useState } from 'react';
import {
  POINT_BUY_EDIT_MAX,
  POINT_BUY_EDIT_MIN,
  isBeyondEditableRange,
  pointBuyCost,
  pointBuyRemaining,
} from '../pointBuy.js';

const ORDER = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
const MODES = [
  ['custom', 'Custom'],
  ['pointBuy', 'Point Buy'],
  ['bestOfRolls', 'Best of Rolls'],
];

// The .dnd5e <generationOption> enum: 0 Roll3D6, 1 Roll4D6DiscardLowest,
// 2 Array, 3 Points. Point Buy and Best of Rolls map onto their enum values;
// everything else (manual entry, plus methods this editor does not offer)
// lands on Custom.
const MODE_TO_GENERATION_OPTION = { custom: 2, pointBuy: 3, bestOfRolls: 1 };

export function modeFromGenerationOption(generationOption) {
  if (generationOption === 3) return 'pointBuy';
  if (generationOption === 1) return 'bestOfRolls';
  return 'custom';
}

function toScores(abilities) {
  return Object.fromEntries(abilities.map((ability) => [ability.name, ability.baseScore]));
}

function toPayload(scores) {
  return {
    strength: scores.Strength,
    dexterity: scores.Dexterity,
    constitution: scores.Constitution,
    intelligence: scores.Intelligence,
    wisdom: scores.Wisdom,
    charisma: scores.Charisma,
  };
}

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function rollAbilityScore(index) {
  const dice = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort((a, b) => a - b);
  return {
    id: `roll-${Date.now()}-${index}`,
    label: `R${index + 1}`,
    dice,
    value: dice.slice(1).reduce((total, value) => total + value, 0),
  };
}

function modifierLabel(value) {
  const modifier = value < 10 ? Math.trunc((value - 11) / 2) : Math.trunc((value - 10) / 2);
  return `${modifier >= 0 ? '+' : ''}${modifier}`;
}

function signedLabel(value) {
  return `${value >= 0 ? '+' : ''}${value}`;
}

// The saved score comes from the engine, which applies every maximum; an
// edited, not yet applied score is previewed against the ability's maximum,
// which features such as Primal Champion raise above 20.
export function previewFinalScore(ability, baseScore) {
  if (baseScore === ability.baseScore && typeof ability.finalScore === 'number') {
    return ability.finalScore;
  }
  const total = baseScore + ability.additionalScore;
  return Math.min(total, ability.maximum ?? 20);
}

function bonusSourcesFor(ability) {
  if (Array.isArray(ability.bonusSources) && ability.bonusSources.length > 0) {
    return ability.bonusSources
      .map((source) => ({
        source: source.source ?? source.Source ?? '',
        value: source.value ?? source.Value ?? 0,
      }))
      .filter((source) => source.value !== 0 || source.source);
  }
  if (ability.additionalSummary) {
    return ability.additionalSummary.split(', ').filter(Boolean).map((source) => ({ source, value: 0 }));
  }
  return ability.additionalScore === 0
    ? []
    : [{ source: 'Character options', value: ability.additionalScore }];
}

export default function AbilityEditor({ abilities, generationOption, disabled, onSave }) {
  const [mode, setMode] = useState(() => modeFromGenerationOption(generationOption));
  const [draftScores, setDraftScores] = useState({});
  const [rolls, setRolls] = useState([]);
  const [rollAssignments, setRollAssignments] = useState({});

  // Follow the persisted method when it changes underneath us (character
  // switch, apply); an unsaved local mode switch keeps the dependency stable
  // and is left alone.
  useEffect(() => {
    setMode(modeFromGenerationOption(generationOption));
    setDraftScores({});
  }, [generationOption]);

  const byName = useMemo(() => Object.fromEntries(abilities.map((a) => [a.name, a])), [abilities]);
  const baseScores = useMemo(() => toScores(abilities), [abilities]);
  const activeScores = { ...baseScores, ...draftScores };
  const dirty = ORDER.some((name) => activeScores[name] !== baseScores[name]);
  const pointsRemaining = pointBuyRemaining(activeScores);
  // Scores another tool bought on the extended curve (16+, or below 8) are
  // priced honestly but not editable here: Custom mode is the way to change them.
  const importedPointBuy = mode === 'pointBuy'
    && ORDER.some((name) => isBeyondEditableRange(baseScores[name]));
  const pointBuyValid = importedPointBuy
    || (ORDER.every((name) => !isBeyondEditableRange(activeScores[name])) && pointsRemaining >= 0);
  const scoreRangeValid = ORDER.every((name) => Number.isInteger(activeScores[name]) && activeScores[name] >= 3 && activeScores[name] <= 20);
  const showPointCost = mode === 'pointBuy';
  const canApply = !disabled
    && dirty
    && scoreRangeValid
    && (mode !== 'pointBuy' || (pointBuyValid && !importedPointBuy))
    && (mode !== 'bestOfRolls' || rolls.length === ORDER.length);

  const setScore = (name, value) => {
    setDraftScores((scores) => ({ ...scores, [name]: value }));
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    if (nextMode === 'pointBuy') {
      setDraftScores(Object.fromEntries(ORDER.map((name) => [name, 8])));
      return;
    }
    if (nextMode === 'bestOfRolls') {
      if (rolls.length === ORDER.length) {
        const nextScores = Object.fromEntries(ORDER.map((name) => {
          const roll = rolls.find((item) => item.id === rollAssignments[name]);
          return [name, roll?.value ?? baseScores[name]];
        }));
        setDraftScores(nextScores);
      } else {
        setDraftScores({});
      }
      return;
    }
    setDraftScores({});
  };

  const generateRolls = () => {
    const nextRolls = ORDER.map((_, index) => rollAbilityScore(index));
    setRolls(nextRolls);
    setRollAssignments(Object.fromEntries(ORDER.map((name, index) => [name, nextRolls[index].id])));
    setDraftScores(Object.fromEntries(ORDER.map((name, index) => [name, nextRolls[index].value])));
  };

  const setRollAssignment = (name, rollId) => {
    const roll = rolls.find((item) => item.id === rollId);
    setRollAssignments((assignments) => {
      const previousRollId = assignments[name];
      const otherAbility = ORDER.find((abilityName) => assignments[abilityName] === rollId);
      const nextAssignments = { ...assignments, [name]: rollId };
      if (otherAbility && previousRollId) nextAssignments[otherAbility] = previousRollId;
      return nextAssignments;
    });
    if (roll) setScore(name, roll.value);
    const swappedAbility = ORDER.find((abilityName) => abilityName !== name && rollAssignments[abilityName] === rollId);
    const previousRoll = rolls.find((item) => item.id === rollAssignments[name]);
    if (swappedAbility && previousRoll) setScore(swappedAbility, previousRoll.value);
  };

  const save = () => {
    if (!canApply) return;
    onSave({ ...toPayload(activeScores), generationOption: MODE_TO_GENERATION_OPTION[mode] });
    setDraftScores({});
  };

  // No frame or heading of its own: BuildTab's "Ability Scores" section panel
  // already provides both.
  return (
    <div>
      <div className="fcb-ability-methods" role="tablist" aria-label="Ability score entry method">
        {MODES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`fcb-mode-button ${mode === key ? 'is-active' : ''}`}
            onClick={() => switchMode(key)}
            disabled={disabled}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'pointBuy' && (
        <div className={`fcb-ability-summary ${pointBuyValid ? '' : 'is-warning'}`}>
          <span>Points remaining</span>
          <strong>{pointsRemaining}</strong>
        </div>
      )}

      {mode === 'bestOfRolls' && (
        <div className="fcb-roll-controls">
          <button
            type="button"
            onClick={generateRolls}
            disabled={disabled}
            className="fcb-button"
          >
            Generate scores
          </button>
          {rolls.length > 0 && (
            <div className="fcb-roll-pool" aria-label="Generated scores">
              {rolls.map((roll, index) => (
                <span
                  key={roll.id}
                  className="fcb-meta-pill"
                  aria-label={`Roll ${index + 1}: ${roll.value}`}
                >
                  {roll.label}: {roll.value}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`fcb-ability-grid ${showPointCost ? 'has-point-cost' : ''}`}>
        <div className="fcb-ability-row fcb-ability-row-header">
          <span className="fcb-ability-column-name">Ability</span>
          <span className="fcb-ability-column-score">
            {mode === 'bestOfRolls' ? 'Roll' : 'Score'}
          </span>
          <span className="fcb-ability-column-bonus">Bonus</span>
          <span className="fcb-ability-column-total">Total</span>
          {showPointCost && (
            <span className="fcb-ability-column-cost">
              <span className="fcb-ability-label-full">Point Cost</span>
              <span className="fcb-ability-label-compact">Cost</span>
            </span>
          )}
        </div>
        {ORDER.map((name) => {
          const ability = byName[name];
          if (!ability) return null;
          const value = activeScores[name] ?? 0;
          const finalPreview = previewFinalScore(ability, value);
          const sources = bonusSourcesFor(ability);

          return (
            <div key={name} className="fcb-ability-row">
              <span className="fcb-ability-name">
                <strong>{name}</strong>
                <span>{ability.abbreviation}</span>
              </span>
              {mode === 'bestOfRolls' && rolls.length === 0 && (
                <span
                  className="fcb-meta-pill"
                  aria-label={`${name} saved score`}
                >
                  {value}
                </span>
              )}
              {mode === 'bestOfRolls' && rolls.length > 0 && (
                <select
                  className="fcb-input"
                  value={rollAssignments[name] ?? ''}
                  onChange={(e) => setRollAssignment(name, e.target.value)}
                  disabled={disabled}
                  aria-label={`${name} generated score`}
                >
                  {rolls.map((roll) => {
                    return <option key={roll.id} value={roll.id}>{roll.value}</option>;
                  })}
                </select>
              )}
              {mode !== 'bestOfRolls' && (
                <input
                  type="number"
                  min={mode === 'pointBuy' ? POINT_BUY_EDIT_MIN : 3}
                  max={mode === 'pointBuy' ? POINT_BUY_EDIT_MAX : 20}
                  className="fcb-input"
                  value={value}
                  onChange={(e) => setScore(name, parseInt(e.target.value, 10) || 0)}
                  disabled={disabled}
                  readOnly={importedPointBuy}
                  aria-label={`${name} base score`}
                />
              )}
              <span className="fcb-ability-bonus">
                <span className={`fcb-meta-pill ${ability.additionalScore === 0 ? 'is-muted' : ''}`}>
                  {ability.additionalScore === 0 ? '0' : signedLabel(ability.additionalScore)}
                </span>
                {sources.length > 0 ? (
                  <span className="fcb-ability-source-list">
                    {sources.map((source, index) => (
                      <span key={`${source.source}-${index}`}>
                        {source.source}{source.value !== 0 ? ` ${signedLabel(source.value)}` : ''}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="fcb-ability-source-list is-empty">No bonuses</span>
                )}
              </span>
              <span className="fcb-meta-pill fcb-ability-preview">
                {finalPreview} ({modifierLabel(finalPreview)})
              </span>
              {mode === 'pointBuy' && (
                <span className="fcb-ability-cost">{pointBuyCost(value)}</span>
              )}
            </div>
          );
        })}
      </div>

      {mode === 'pointBuy' && importedPointBuy && (
        <p className="fcb-empty-copy mt-4">
          These scores were bought on the extended point-buy table; switch to Custom to change them.
        </p>
      )}
      {mode === 'pointBuy' && !pointBuyValid && (
        <p className="fcb-alert mt-4">Point Buy scores must stay between 8 and 15 and within 27 points.</p>
      )}
      {mode === 'bestOfRolls' && rolls.length === 0 && (
        <p className="fcb-empty-copy mt-4">Generate scores to assign them.</p>
      )}
      {!scoreRangeValid && mode !== 'pointBuy' && (
        <p className="fcb-alert mt-4">Scores must stay between 3 and 20.</p>
      )}

      <button
        onClick={save}
        disabled={!canApply}
        className="fcb-button fcb-button-primary mt-4 w-full"
      >
        Apply scores
      </button>
    </div>
  );
}
