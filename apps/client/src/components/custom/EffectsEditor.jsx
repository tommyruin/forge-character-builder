// "What it does": the list of effect blocks a feature, a catalogue entry or an addition holds,
// with the chips that add more. Every effect is one of the shared blocks; the draft this edits is
// the same shape the character's pack stores, so a pack element and a character's entry are made
// with the same controls.
//
// The "only while active" switch is one name applied to every modifier, so its state lives here
// next to the rows that show it.

import { useEffect, useState } from 'react';
import ChoiceBlock from './ChoiceBlock';
import GrantBlock from './GrantBlock';
import ModifierBlock from './ModifierBlock';
import ScaleBlock from './ScaleBlock';
import TrackerBlock from './TrackerBlock';
import { Field, RemoveButton } from './fields';
import {
  ABILITY_TARGET_GROUPS,
  compactGates,
  defaultCastAbility,
  makeChoice,
  makeGrant,
  makeModifier,
  targetGroups,
  typeLabel,
} from './draftModel';
import { makeScale, makeTracker, switchNamesIn } from './trackerModel';

const OTHER_GROUPS = targetGroups()
  .map((group) => group.label)
  .filter((label) => !ABILITY_TARGET_GROUPS.includes(label));

const isAbilityTarget = (target) =>
  targetGroups(ABILITY_TARGET_GROUPS).some((group) => group.targets.some((entry) => entry.id === target));

function blockTitle(block) {
  if (block.kind === 'modifier') return isAbilityTarget(block.target) ? 'Ability score' : 'Bonus';
  if (block.kind === 'grant') return typeLabel(block.target.type);
  return 'Player picks';
}

// The switch a draft's modifiers share, if any: "Only while active" is one name applied to all
// of them, so the row can show and edit it.
export function sharedSwitch(blocks) {
  return blocks.find((block) => block.kind === 'modifier' && block.gates?.switch)?.gates.switch;
}

export function withSwitch(blocks, name) {
  return blocks.map((block) => {
    if (block.kind !== 'modifier') return block;
    const gates = compactGates({ ...block.gates, switch: name });
    const { gates: _gates, ...rest } = block;
    return gates ? { ...rest, gates } : rest;
  });
}

/**
 * `draft` and `setDraft` are the draft and a state setter for it (a function of the current draft
 * or a new draft). `features` adds the chips that only make sense on a feature: spells, uses,
 * scale values and the switch. `startWithSwitch` shows the switch row open on a draft that has
 * no gated modifier yet (a transformation).
 */
export default function EffectsEditor({
  draft,
  setDraft,
  services,
  issues = [],
  attempted = false,
  features = true,
  startWithSwitch = false,
}) {
  const [casters, setCasters] = useState([]);
  // The character's own spellcasting ability, offered for a new spell effect; null when it has none.
  const [characterAbility, setCharacterAbility] = useState(null);
  const initialSwitch = sharedSwitch(draft.blocks);
  const [switchName, setSwitchName] = useState(() => initialSwitch ?? (startWithSwitch ? draft.name.trim() || 'Active' : ''));
  const [switchOn, setSwitchOn] = useState(() => initialSwitch !== undefined || startWithSwitch);
  // The switches the character's other entries already use, so a second feature reuses a name
  // instead of misspelling it.
  const [knownSwitches, setKnownSwitches] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.resolve(services.casters?.())
      .then((names) => {
        if (alive) setCasters(names ?? []);
      })
      .catch(() => {});
    Promise.resolve(services.list?.())
      .then((content) => {
        if (alive) setKnownSwitches(switchNamesIn(content?.entries));
      })
      .catch(() => {});
    Promise.resolve(services.defaultCastAbility?.())
      .then((ability) => {
        if (alive) setCharacterAbility(ability ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [services]);

  const castDefault = defaultCastAbility(draft, characterAbility);
  const blockIssues = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`blocks[${index}]`)) : []);
  const trackers = draft.trackers ?? [];
  const scales = draft.scales ?? [];
  const switchChoices = [...new Set([...knownSwitches, ...(switchOn && switchName.trim() ? [switchName.trim()] : [])])];
  const trackerIssuesAt = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`trackers[${index}]`)) : []);
  const scaleIssuesAt = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`scales[${index}]`)) : []);

  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const setBlocks = (blocks) => patch({ blocks });
  const setBlock = (index, block) => setBlocks(draft.blocks.map((entryBlock, at) => (at === index ? block : entryBlock)));
  const removeBlock = (index) => setBlocks(draft.blocks.filter((_, at) => at !== index));
  const addBlock = (block) =>
    setBlocks([...draft.blocks, switchOn && switchName.trim() !== '' && block.kind === 'modifier' ? withSwitch([block], switchName)[0] : block]);
  const setTrackers = (next) => patch({ trackers: next.length > 0 ? next : undefined });
  const setScales = (next) => patch({ scales: next.length > 0 ? next : undefined });

  const chips = [
    { id: 'ability', label: 'Ability score', add: () => addBlock(makeModifier()) },
    ...(features
      ? [
          {
            id: 'spell',
            label: 'Spell',
            add: () => addBlock(makeGrant('Spell', { spell: { usage: '1/Long Rest', ...(castDefault ? { castAbility: castDefault } : {}) } })),
          },
        ]
      : []),
    { id: 'proficiency', label: 'Proficiency', add: () => addBlock(makeGrant('Proficiency')) },
    { id: 'language', label: 'Language', add: () => addBlock(makeGrant('Language')) },
    { id: 'choice', label: 'Player picks', add: () => addBlock(makeChoice()) },
    { id: 'bonus', label: 'Other bonus', add: () => addBlock(makeModifier({ target: 'ac:misc' })) },
    ...(features
      ? [
          {
            id: 'uses',
            label: 'Limited uses',
            add: () => setTrackers([...trackers, makeTracker({ label: trackers.length === 0 ? draft.name.trim() : '' })]),
          },
          { id: 'scale', label: 'Scale value', add: () => setScales([...scales, makeScale()]) },
        ]
      : []),
    ...(!features || switchOn
      ? []
      : [
          {
            id: 'active',
            label: 'Only while active',
            add: () => {
              const name = switchName.trim() || draft.name.trim() || 'Active';
              setSwitchOn(true);
              setSwitchName(name);
              setBlocks(withSwitch(draft.blocks, name));
            },
          },
        ]),
  ];

  return (
    <div>
      <h4 className="fcb-field-label mb-2">What it does</h4>
      <div className="space-y-3">
        {draft.blocks.map((block, index) => {
          const shared = {
            onRemove: () => removeBlock(index),
            lookup: services.lookup,
            issues: blockIssues(index),
            ariaLabel: blockTitle(block),
            block,
            onChange: (next) => setBlock(index, next),
          };
          if (block.kind === 'modifier') {
            return (
              <ModifierBlock
                key={block.id}
                {...shared}
                allowedGroups={isAbilityTarget(block.target) ? ABILITY_TARGET_GROUPS : OTHER_GROUPS}
                scales={scales}
                switches={switchChoices}
              />
            );
          }
          if (block.kind === 'grant') {
            return <GrantBlock key={block.id} {...shared} casters={casters} defaultCastAbility={castDefault} />;
          }
          return <ChoiceBlock key={block.id} {...shared} casters={casters} defaultCastAbility={castDefault} />;
        })}

        {scales.map((scale, index) => (
          <ScaleBlock
            key={scale.id}
            scale={scale}
            issues={scaleIssuesAt(index)}
            onChange={(next) => setScales(scales.map((entryScale, at) => (at === index ? next : entryScale)))}
            onRemove={() => setScales(scales.filter((_, at) => at !== index))}
          />
        ))}

        {trackers.map((tracker, index) => (
          <TrackerBlock
            key={tracker.id}
            tracker={tracker}
            scales={scales}
            switches={switchOn && switchName.trim() ? [switchName.trim()] : []}
            issues={trackerIssuesAt(index)}
            ariaLabel={trackers.length > 1 ? `Limited uses ${index + 1}` : 'Limited uses'}
            onChange={(next) => setTrackers(trackers.map((entryTracker, at) => (at === index ? next : entryTracker)))}
            onRemove={() => setTrackers(trackers.filter((_, at) => at !== index))}
          />
        ))}

        {features && switchOn && (
          <div className="fcb-custom-block" role="group" aria-label="Only while active">
            <div className="fcb-custom-row">
              <Field label="Switch name">
                <input
                  className="fcb-input"
                  aria-label="Switch name"
                  list="custom-switch-names"
                  value={switchName}
                  onChange={(event) => {
                    setSwitchName(event.target.value);
                    setBlocks(withSwitch(draft.blocks, event.target.value));
                  }}
                />
                <datalist id="custom-switch-names">
                  {knownSwitches.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              <RemoveButton
                label="Remove only while active"
                onClick={() => {
                  setSwitchOn(false);
                  setBlocks(withSwitch(draft.blocks, undefined));
                }}
              />
            </div>
            <p className="fcb-muted-copy text-xs">
              The bonuses above apply only while this switch is on. It starts off; turn it on from Manage › Resources.
              {knownSwitches.length > 0 ? ' Pick a switch another entry uses, or name a new one.' : ''}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Add an effect">
        {chips.map((chip) => (
          <button key={chip.id} type="button" className="fcb-mode-button" onClick={chip.add}>
            + {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
