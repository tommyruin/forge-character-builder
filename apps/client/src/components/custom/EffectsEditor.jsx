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
import EffectChip from './EffectChip';
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
  if (block.kind === 'modifier') return isAbilityTarget(block.target) ? 'Ability score' : 'Bonus to another stat';
  if (block.kind === 'grant') return typeLabel(block.target.type);
  return 'Player choice';
}

// The switch a draft's modifiers and grants share, if any: "Only while active" is one name applied
// to all of them, so the row can show and edit it. A grant carries it as `switch`, a modifier as
// `gates.switch`; player picks have no gate, so a choice never holds one.
export function sharedSwitch(blocks) {
  for (const block of blocks) {
    const name = block.kind === 'modifier' ? block.gates?.switch : block.kind === 'grant' ? block.switch : undefined;
    if (name?.trim()) return name;
  }
  return undefined;
}

export function withSwitch(blocks, name) {
  return blocks.map((block) => {
    if (block.kind === 'grant') {
      const { switch: _switch, ...rest } = block;
      return name?.trim() ? { ...rest, switch: name } : rest;
    }
    if (block.kind !== 'modifier') return block;
    const gates = compactGates({ ...block.gates, switch: name });
    const { gates: _gates, ...rest } = block;
    return gates ? { ...rest, gates } : rest;
  });
}

const takesSwitch = (block) => block.kind === 'modifier' || block.kind === 'grant';

/**
 * `draft` and `setDraft` are the draft and a state setter for it (a function of the current draft
 * or a new draft). `features` adds the chips that only make sense on a feature: spells, uses,
 * scale values and the switch. `startWithSwitch` shows the switch row open on a draft that has
 * no gated modifier yet (a transformation). `inheritedScales` are the value columns of the class
 * or species a feature sits in: its bonuses and limited uses may read them, but they are edited
 * where they belong. `only` narrows the chips to the ones named (a class' starting proficiencies
 * offer proficiencies, languages and picks, not ability scores).
 */
export default function EffectsEditor(props) {
  // The switch row and the caster list belong to one entry. Editors that show several entries one
  // after another (a class table's features) reuse this component, so a new entry starts clean.
  return <EffectsEditorBody key={props.draft.id} {...props} />;
}

function EffectsEditorBody({
  draft,
  setDraft,
  services,
  issues = [],
  attempted = false,
  features = true,
  startWithSwitch = false,
  inheritedScales = [],
  only = null,
}) {
  const [casters, setCasters] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);
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
  const readable = inheritedScales.length === 0 ? scales : [...inheritedScales, ...scales];
  const switchChoices = [...new Set([...knownSwitches, ...(switchOn && switchName.trim() ? [switchName.trim()] : [])])];
  const trackerIssuesAt = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`trackers[${index}]`)) : []);
  const scaleIssuesAt = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`scales[${index}]`)) : []);

  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const setBlocks = (blocks) => patch({ blocks });
  const setBlock = (index, block) => setBlocks(draft.blocks.map((entryBlock, at) => (at === index ? block : entryBlock)));
  const removeBlock = (index) => setBlocks(draft.blocks.filter((_, at) => at !== index));
  const addBlock = (block) =>
    setBlocks([...draft.blocks, switchOn && switchName.trim() !== '' && takesSwitch(block) ? withSwitch([block], switchName)[0] : block]);
  const setTrackers = (next) => patch({ trackers: next.length > 0 ? next : undefined });
  const setScales = (next) => patch({ scales: next.length > 0 ? next : undefined });

  const chips = [
    {
      id: 'ability',
      label: 'Ability score',
      hint: 'Raise a score, or set a minimum. Example: +2 Strength, or Strength 19.',
      add: () => addBlock(makeModifier()),
    },
    ...(features
      ? [
          {
            id: 'spell',
            label: 'Spell',
            hint: 'Grant a spell the character can cast. Example: Misty Step once per long rest.',
            add: () => addBlock(makeGrant('Spell', { spell: { usage: '1/Long Rest', ...(castDefault ? { castAbility: castDefault } : {}) } })),
          },
        ]
      : []),
    {
      id: 'proficiency',
      label: 'Proficiency',
      hint: 'Grant a skill, tool, weapon, armor or saving throw proficiency.',
      add: () => addBlock(makeGrant('Proficiency')),
    },
    { id: 'language', label: 'Language', hint: 'Grant a language the character can speak.', add: () => addBlock(makeGrant('Language')) },
    {
      id: 'choice',
      label: 'Player choice',
      hint: 'Let the player choose. Example: pick 2 skills from a list.',
      add: () => addBlock(makeChoice()),
    },
    ...(features
      ? [
          {
            id: 'uses',
            label: 'Uses per rest',
            hint: 'A pool of uses that refills on a short rest, a long rest or at dawn. Example: 3 uses per long rest.',
            add: () => setTrackers([...trackers, makeTracker({ label: trackers.length === 0 ? draft.name.trim() : '' })]),
          },
        ]
      : []),
  ];

  const moreChips = [
    {
      id: 'bonus',
      label: 'Bonus to another stat',
      hint: 'A bonus to another stat: AC, speed, initiative, attack rolls, saving throws and so on.',
      add: () => addBlock(makeModifier({ target: 'ac:misc' })),
    },
    ...(features
      ? [
          {
            id: 'scale',
            label: 'Grows with level',
            hint: 'A die or number that changes at set levels. Example: 1d6 at level 1, 2d6 at level 5.',
            add: () => setScales([...scales, makeScale()]),
          },
        ]
      : []),
    ...(!features || switchOn
      ? []
      : [
          {
            id: 'active',
            label: 'Only while active',
            hint: 'The bonuses and spells apply only while you turn a switch on in Manage, Resources. Example: a rage or a transformation.',
            add: () => {
              const name = switchName.trim() || draft.name.trim() || 'Active';
              setSwitchOn(true);
              setSwitchName(name);
              setBlocks(withSwitch(draft.blocks, name));
            },
          },
        ]),
  ];

  const shownChips = only === null ? chips : chips.filter((chip) => only.includes(chip.id));
  const shownMore = only === null ? moreChips : moreChips.filter((chip) => only.includes(chip.id));

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
                scales={readable}
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
            scales={readable}
            switches={switchOn && switchName.trim() ? [switchName.trim()] : []}
            issues={trackerIssuesAt(index)}
            ariaLabel={trackers.length > 1 ? `Uses per rest ${index + 1}` : 'Uses per rest'}
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
              The bonuses and spells above apply only while this switch is on. It starts off; turn it on from Manage › Resources.
              {knownSwitches.length > 0 ? ' Pick a switch another entry uses, or name a new one.' : ''}
            </p>
          </div>
        )}
      </div>

      <div className="fcb-effect-chips mt-3" role="group" aria-label="Add an effect">
        {shownChips.map((chip) => (
          <EffectChip key={chip.id} chip={chip} />
        ))}
        {shownMore.length > 0 && (
          <button
            type="button"
            className="fcb-mode-button fcb-effect-more"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            More effects {moreOpen ? '\u25BE' : '\u25B8'}
          </button>
        )}
        {moreOpen && shownMore.map((chip) => <EffectChip key={chip.id} chip={chip} />)}
      </div>
    </div>
  );
}
