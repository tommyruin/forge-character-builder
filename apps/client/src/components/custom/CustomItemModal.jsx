// The "Custom item" dialog behind Equipment's [+] Custom item: one form that makes (or edits) an
// item for a character without XML. It starts from something real in the library (a weapon, an
// armor or shield) or from a worn item or plain gear, then asks only for what differs: a bonus,
// extra damage, the ability its attacks use, attunement, and what it does while it is wielded,
// worn or attuned. The draft that results is stored in the character file and compiled to an
// ordinary item, so adding, equipping and attuning are the usual inventory actions.
//
// A weapon shows its attack row as the engine would print it (the engine computes it on a scratch
// copy of the character), so the numbers are never a second implementation in the browser.

import { useEffect, useMemo, useState } from 'react';
import { customEntryIssues } from '@forge-cb/engine/custom';
import Modal from '../Modal';
import BasePicker from './BasePicker';
import DamageResponseBlock from './DamageResponseBlock';
import EffectChip from './EffectChip';
import GrantBlock, { GRANT_TYPE_OPTIONS } from './GrantBlock';
import ModifierBlock from './ModifierBlock';
import TrackerBlock from './TrackerBlock';
import { makeTracker } from './trackerModel';
import { Field, Issues, NumberInput, RemoveButton, Segmented, SelectInput } from './fields';
import {
  DAMAGE_TYPE_OPTIONS,
  ITEM_TEMPLATE_OPTIONS,
  RARITY_OPTIONS,
  WEAPON_PROPERTY_OPTIONS,
  WORN_SLOT_OPTIONS,
  PROMOTE_LABEL,
  abilityOptions,
  castAbilityIssues,
  defaultCastAbility,
  isShieldOption,
  damageResponseGrant,
  damageResponseOf,
  makeGrant,
  makeItemDraft,
  makeModifier,
  summarizeItem,
  targetGroups,
} from './draftModel';

const ALL_TARGET_GROUPS = targetGroups().map((group) => group.label);
const CURRENCIES = [
  { id: 'cp', label: 'cp' },
  { id: 'sp', label: 'sp' },
  { id: 'gp', label: 'gp' },
];

const blockTitle = (block) => {
  if (block.kind === 'modifier') return 'Bonus to another stat';
  if (damageResponseOf(block)) return 'Damage resistance';
  if (block.target.type === 'Spell') return 'Spell';
  return 'Other feature';
};

// Drops the keys a form leaves empty, so a draft that was only opened compares equal to what the
// engine stores. The JSON round trip removes keys holding `undefined`.
function tidy(draft) {
  const next = JSON.parse(JSON.stringify(draft));
  for (const key of ['cameFrom', 'uses', 'weight', 'cost', 'rarity', 'bonus']) {
    const value = next[key];
    if (value === undefined || value === '' || (typeof value === 'string' && value.trim() === '')) delete next[key];
  }
  if (next.bonus === 0) delete next.bonus;
  if (Array.isArray(next.trackers) && next.trackers.length === 0) delete next.trackers;
  if (next.attunement !== true) delete next.attunement;
  if (next.stackable !== true) delete next.stackable;
  if (next.weapon) {
    const weapon = next.weapon;
    if (!weapon.extraDamage?.length) delete weapon.extraDamage;
    for (const key of ['versatile', 'range']) {
      if ((weapon[key] ?? '').trim() === '') delete weapon[key];
    }
    if (Object.keys(weapon).length === 0) delete next.weapon;
  }
  return next;
}

function ExtraDamage({ terms, onChange }) {
  const set = (index, patch) => onChange(terms.map((term, at) => (at === index ? { ...term, ...patch } : term)));
  return (
    <div className="space-y-2" role="group" aria-label="Extra damage">
      {terms.map((term, index) => (
        <div key={index} className="fcb-custom-row">
          <Field label="Extra damage">
            <input
              className="fcb-input"
              aria-label={`Extra damage dice ${index + 1}`}
              placeholder="1d6"
              value={term.dice}
              onChange={(event) => set(index, { dice: event.target.value.trim() })}
            />
          </Field>
          <Field label="Damage type">
            <SelectInput
              label={`Damage type ${index + 1}`}
              value={term.type}
              options={DAMAGE_TYPE_OPTIONS}
              onChange={(type) => set(index, { type })}
            />
          </Field>
          <RemoveButton label={`Remove extra damage ${index + 1}`} onClick={() => onChange(terms.filter((_, at) => at !== index))} />
        </div>
      ))}
      {terms.length < 4 && (
        <button type="button" className="fcb-mode-button" onClick={() => onChange([...terms, { dice: '', type: 'fire' }])}>
          + Extra damage
        </button>
      )}
    </div>
  );
}

function WeaponShape({ weapon, onChange }) {
  const properties = weapon.properties;
  const toggle = (id) => {
    const current = properties ?? [];
    onChange({ properties: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] });
  };
  return (
    <div className="fcb-custom-gates-body">
      <p className="fcb-muted-copy text-xs">
        Only fill in what is different from the base weapon. These apply while you are attuned, if the item needs it.
      </p>
      <div className="fcb-custom-row">
        <Field label="Damage dice">
          <input
            className="fcb-input"
            aria-label="Damage dice"
            placeholder="Same as the base"
            value={weapon.damage?.dice ?? ''}
            onChange={(event) => {
              const dice = event.target.value.trim();
              onChange({ damage: dice === '' ? undefined : { dice, type: weapon.damage?.type ?? 'slashing' } });
            }}
          />
        </Field>
        <Field label="Damage type">
          <SelectInput
            label="Damage dice type"
            value={weapon.damage?.type ?? 'slashing'}
            options={DAMAGE_TYPE_OPTIONS}
            disabled={!weapon.damage}
            onChange={(type) => weapon.damage && onChange({ damage: { ...weapon.damage, type } })}
          />
        </Field>
        <Field label="Two-handed dice">
          <input
            className="fcb-input"
            aria-label="Two-handed dice"
            placeholder="Same as the base"
            value={weapon.versatile ?? ''}
            onChange={(event) => onChange({ versatile: event.target.value.trim() })}
          />
        </Field>
        <Field label="Range">
          <input
            className="fcb-input"
            aria-label="Range"
            placeholder="20/60"
            value={weapon.range ?? ''}
            onChange={(event) => onChange({ range: event.target.value.trim() })}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="fcb-field-label">Properties</legend>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={properties !== undefined}
            onChange={(event) => onChange({ properties: event.target.checked ? [] : undefined })}
          />
          Replace the base weapon's properties
        </label>
        {properties !== undefined && (
          <div className="mt-2 flex flex-wrap gap-3">
            {WEAPON_PROPERTY_OPTIONS.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={properties.includes(option.id)} onChange={() => toggle(option.id)} />
                {option.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

export default function CustomItemModal({
  services,
  characterName,
  entry = null,
  initialTemplate = 'weapon',
  pack = null,
  onClose,
  onSaved,
}) {
  const editing = entry !== null;
  const [draft, setDraft] = useState(() => (entry ? structuredClone(entry.draft) : makeItemDraft(initialTemplate)));
  const [bases, setBases] = useState({ template: null, list: [] });
  const [casters, setCasters] = useState([]);
  const [characterAbility, setCharacterAbility] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [promote, setPromote] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [preview, setPreview] = useState({ key: null, attack: null, error: null });

  const template = draft.template;
  const onBase = template === 'weapon' || template === 'armor';
  const magic = template !== 'gear';
  const carried = editing && entry.granted === true;

  useEffect(() => {
    if (!onBase) return undefined;
    let alive = true;
    services
      .itemBases(template)
      .then((list) => {
        if (alive) setBases({ template, list: list ?? [] });
      })
      .catch(() => {
        if (alive) setBases({ template, list: [] });
      });
    return () => {
      alive = false;
    };
  }, [services, template, onBase]);

  useEffect(() => {
    let alive = true;
    services
      .casters()
      .then((names) => {
        if (alive) setCasters(names ?? []);
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

  const tidied = useMemo(() => tidy(draft), [draft]);
  const issues = useMemo(() => [...customEntryIssues(tidied), ...castAbilityIssues(tidied)], [tidied]);
  const castDefault = defaultCastAbility(tidied, characterAbility);
  const blockIssues = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`blocks[${index}]`)) : []);
  const topIssues = attempted ? issues.filter((issue) => !issue.path.startsWith('blocks[') && !issue.path.startsWith('trackers[')) : [];
  const summary = summarizeItem(tidied);

  // The attack row waits for the author to pause, and only runs for a draft the engine accepts.
  const previewKey = template === 'weapon' && issues.length === 0 ? JSON.stringify(tidied) : null;
  useEffect(() => {
    if (previewKey === null) return undefined;
    let alive = true;
    const handle = setTimeout(() => {
      Promise.resolve(services.previewItem?.(tidied))
        .then((result) => {
          if (alive) setPreview({ key: previewKey, attack: result?.attack ?? null, error: null });
        })
        .catch((e) => {
          if (alive) setPreview({ key: previewKey, attack: null, error: e?.message ?? 'The preview failed.' });
        });
    }, services.previewDelayMs ?? 400);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
    // `tidied` is the parsed form of `previewKey`; the key alone says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, services]);

  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const patchWeapon = (next) => setDraft((current) => ({ ...current, weapon: { ...current.weapon, ...next } }));
  const setBlocks = (blocks) => patch({ blocks });
  const setBlock = (index, block) => setBlocks(draft.blocks.map((entryBlock, at) => (at === index ? block : entryBlock)));
  const removeBlock = (index) => setBlocks(draft.blocks.filter((_, at) => at !== index));
  const addBlock = (block) => setBlocks([...draft.blocks, block]);

  const switchTemplate = (next) => {
    if (next === template) return;
    const fresh = makeItemDraft(next);
    setDraft({ ...fresh, name: draft.name, description: draft.description, cameFrom: draft.cameFrom });
  };

  const baseList = bases.template === template ? bases.list : [];
  const basesLoading = onBase && bases.template !== template;

  const chooseBase = (baseId) => {
    const option = baseList.find((candidate) => candidate.id === baseId);
    if (!option) {
      patch({ base: undefined });
      return;
    }
    patch({ base: { id: option.id, name: option.name, ...(isShieldOption(option) ? { shield: true } : {}) } });
  };

  const trackers = draft.trackers ?? [];
  const setTrackers = (next) => patch({ trackers: next.length > 0 ? next : undefined });

  const chips = [
    {
      id: 'bonus',
      label: 'Bonus to another stat',
      hint: 'A bonus to a stat: AC, speed, initiative, attack rolls, saving throws and so on.',
      add: () => addBlock(makeModifier({ target: 'ac:misc' })),
    },
    {
      id: 'resistance',
      label: 'Damage resistance',
      hint: 'Resistance, immunity or vulnerability to a damage type. Example: resistance to cold.',
      add: () => addBlock(damageResponseGrant('resistance', 'cold', makeGrant('Condition'))),
    },
    {
      id: 'spell',
      label: 'Spell',
      hint: 'Grant a spell the wearer can cast. Example: Misty Step once per long rest.',
      add: () =>
        addBlock(makeGrant('Spell', { spell: { usage: '1/Long Rest', ...(castDefault ? { castAbility: castDefault } : {}) } })),
    },
    {
      id: 'feature',
      label: 'Other feature',
      hint: 'Give a feature or trait that already exists in your library.',
      add: () => addBlock(makeGrant('Custom Feature')),
    },
    {
      id: 'uses',
      label: 'Uses per rest',
      hint: 'A pool of charges or uses that refills at dawn or on a rest. Example: 7 charges, regained at dawn.',
      add: () =>
        setTrackers([
          ...trackers,
          makeTracker({ label: trackers.length === 0 ? 'Charges' : '', unit: 'charges', max: { kind: 'number', value: 7 }, recharge: 'dawn' }),
        ]),
    },
  ];

  const write = async () => {
    setSaving(true);
    setError(null);
    let result;
    try {
      const options = {};
      if (!editing && template === 'gear' && pack === null) {
        options.amount = quantity;
        if (notes.trim() !== '') options.notes = notes;
      }
      result = await services.save(tidied, options);
    } catch (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    if (promote) {
      try {
        await services.promote(tidied);
      } catch (e) {
        setError(`Saved to ${characterName}, but could not copy it to a homebrew pack: ${e.message}`);
        setSaving(false);
        onSaved?.(result?.entry ?? null);
        return;
      }
    }
    setSaving(false);
    onSaved?.(result?.entry ?? null);
    onClose();
  };

  const submit = async () => {
    setAttempted(true);
    if (issues.length > 0) return;
    await write();
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await services.remove(draft.id);
    } catch (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved?.(null);
    onClose();
  };

  const title = editing ? 'Edit custom item' : 'Custom item';
  const attack = preview.key === previewKey ? preview.attack : null;
  const previewPending = previewKey !== null && preview.key !== previewKey;

  return (
    <Modal open title={title} onClose={onClose} size="wide">
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="fcb-muted-copy text-xs">Start from something in the book, then say what is different.</p>
        {editing ? (
          <p className="text-sm">
            <span className="fcb-field-label">Kind</span>{' '}
            <strong>{ITEM_TEMPLATE_OPTIONS.find((option) => option.id === template)?.label}</strong>
          </p>
        ) : (
          <div>
            <span className="fcb-field-label">Start from</span>
            <Segmented label="Start from" value={template} options={ITEM_TEMPLATE_OPTIONS} onChange={switchTemplate} className="mt-1" />
          </div>
        )}

        {onBase && (
          <div>
            <span className="fcb-field-label">{template === 'weapon' ? 'Base weapon' : 'Base armor'}</span>
            <BasePicker
              kind={template}
              bases={baseList}
              loading={basesLoading}
              value={draft.base}
              disabled={carried}
              onPick={chooseBase}
            />
            {carried && (
              <span className="fcb-muted-copy text-xs">
                This item is already in the inventory on this base, so the base cannot change. Delete the item from the inventory to start it on another.
              </span>
            )}
          </div>
        )}

        <div className="fcb-custom-row">
          <Field label="Name">
            <input
              className="fcb-input"
              aria-label="Name"
              autoFocus
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field label="Where it came from">
            <input
              className="fcb-input"
              aria-label="Where it came from"
              placeholder="A campaign or a DM"
              value={draft.cameFrom ?? ''}
              onChange={(event) => patch({ cameFrom: event.target.value })}
            />
          </Field>
        </div>

        {template === 'weapon' && (
          <>
            <div className="fcb-custom-row">
              <Field label="Bonus to hit and damage">
                <NumberInput label="Bonus to hit and damage" min={0} max={10} value={draft.bonus ?? 0} onChange={(bonus) => patch({ bonus: bonus ?? 0 })} />
              </Field>
              <Field label="Attack and damage with">
                <SelectInput
                  label="Attack and damage with"
                  value={draft.weapon?.attackAbility ?? ''}
                  placeholder="The weapon's own"
                  options={abilityOptions}
                  onChange={(attackAbility) => patchWeapon({ attackAbility: attackAbility === '' ? undefined : attackAbility })}
                />
              </Field>
            </div>
            <ExtraDamage terms={draft.weapon?.extraDamage ?? []} onChange={(extraDamage) => patchWeapon({ extraDamage })} />
            <details className="fcb-custom-gates">
              <summary>Different damage, range or properties</summary>
              <WeaponShape weapon={draft.weapon ?? {}} onChange={patchWeapon} />
            </details>
          </>
        )}

        {template === 'armor' && (
          <Field label="Bonus to armor class">
            <NumberInput label="Bonus to armor class" min={0} max={10} value={draft.bonus ?? 0} onChange={(bonus) => patch({ bonus: bonus ?? 0 })} />
          </Field>
        )}

        {template === 'worn' && (
          <Field label="Worn on">
            <SelectInput label="Worn on" value={draft.slot ?? 'neck'} options={WORN_SLOT_OPTIONS} onChange={(slot) => patch({ slot })} />
          </Field>
        )}

        {magic && (
          <div className="fcb-custom-row">
            <Field label="Rarity">
              <SelectInput
                label="Rarity"
                value={draft.rarity ?? ''}
                placeholder="Not set"
                options={RARITY_OPTIONS}
                onChange={(rarity) => patch({ rarity: rarity === '' ? undefined : rarity })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.attunement === true}
                onChange={(event) => patch({ attunement: event.target.checked })}
              />
              Requires attunement
            </label>
          </div>
        )}

        {template === 'gear' && (
          <>
            <div className="fcb-custom-row">
              {!editing && pack === null && (
                <Field label="Quantity">
                  <NumberInput label="Quantity" min={1} max={999} value={quantity} onChange={(next) => setQuantity(next ?? 1)} />
                </Field>
              )}
              <Field label="Weight (lb)">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="fcb-input"
                  aria-label="Weight in pounds"
                  value={draft.weight ?? ''}
                  onChange={(event) => patch({ weight: event.target.value === '' ? undefined : Number(event.target.value) })}
                />
              </Field>
              <Field label="Cost">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="fcb-input"
                  aria-label="Cost"
                  value={draft.cost?.amount ?? ''}
                  onChange={(event) =>
                    patch({
                      cost: event.target.value === '' ? undefined : { amount: Number(event.target.value), currency: draft.cost?.currency ?? 'gp' },
                    })
                  }
                />
              </Field>
              <Field label="Currency">
                <SelectInput
                  label="Currency"
                  value={draft.cost?.currency ?? 'gp'}
                  options={CURRENCIES}
                  disabled={!draft.cost}
                  onChange={(currency) => draft.cost && patch({ cost: { ...draft.cost, currency } })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.stackable === true} onChange={(event) => patch({ stackable: event.target.checked })} />
              Copies stack into one line
            </label>
            {!editing && pack === null && (
              <Field label="Notes">
                <input className="fcb-input" aria-label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            )}
          </>
        )}

        {magic && (
          <div>
            <h4 className="fcb-field-label mb-2">{`${draft.attunement ? 'While attuned' : template === 'worn' ? 'While worn' : 'While wielded'}, also`}</h4>
            <div className="space-y-3">
              {draft.blocks.map((block, index) => {
                const shared = {
                  block,
                  onChange: (next) => setBlock(index, next),
                  onRemove: () => removeBlock(index),
                  lookup: services.lookup,
                  issues: blockIssues(index),
                  ariaLabel: blockTitle(block),
                };
                if (block.kind === 'modifier') return <ModifierBlock key={block.id} {...shared} allowedGroups={ALL_TARGET_GROUPS} />;
                if (damageResponseOf(block)) return <DamageResponseBlock key={block.id} {...shared} />;
                return <GrantBlock key={block.id} {...shared} casters={casters} defaultCastAbility={castDefault} typeOptions={GRANT_TYPE_OPTIONS} />;
              })}
            </div>
            <div className="fcb-effect-chips mt-3" role="group" aria-label="Add an effect">
              {chips.map((chip) => (
                <EffectChip key={chip.id} chip={chip} />
              ))}
            </div>
            <div className="mt-3 space-y-3">
              {trackers.map((tracker, index) => (
                <TrackerBlock
                  key={tracker.id}
                  tracker={tracker}
                  literalOnly
                  ariaLabel={trackers.length > 1 ? `Charges ${index + 1}` : 'Charges'}
                  issues={attempted ? issues.filter((issue) => issue.path.startsWith(`trackers[${index}]`)) : []}
                  onChange={(next) => setTrackers(trackers.map((entry, at) => (at === index ? next : entry)))}
                  onRemove={() => setTrackers(trackers.filter((_, at) => at !== index))}
                />
              ))}
              {trackers.length === 0 && draft.uses?.trim() && (
                <Field label="Uses per rest (text only)">
                  <input
                    className="fcb-input"
                    aria-label="Uses per rest as text"
                    value={draft.uses ?? ''}
                    onChange={(event) => patch({ uses: event.target.value })}
                  />
                </Field>
              )}
            </div>
          </div>
        )}

        <Field label="Text">
          <textarea
            className="fcb-textarea"
            aria-label="Text"
            rows={3}
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>

        <div className="fcb-custom-summary" aria-live="polite">
          <div>
            <h4 className="fcb-field-label">In plain words</h4>
            {summary.length === 0 ? (
              <p className="fcb-muted-copy text-xs">Text only.</p>
            ) : (
              <ul className="fcb-custom-summary-list" data-testid="item-summary">
                {summary.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          {template === 'weapon' && (
            <div data-testid="item-attack-preview">
              <h4 className="fcb-field-label">Attack row{draft.attunement ? ' (attuned)' : ''}</h4>
              {attack ? (
                <p className="text-sm">
                  <strong>{attack.name}</strong> {attack.bonus.replace(' vs AC', '')} · {attack.damage}
                  {attack.range ? ` · ${attack.range}` : ''}
                </p>
              ) : preview.key === previewKey && preview.error ? (
                <p className="fcb-muted-copy text-xs">{preview.error}</p>
              ) : (
                <p className="fcb-muted-copy text-xs">
                  {previewPending ? 'Working it out…' : 'Choose a base and a name to see the row.'}
                </p>
              )}
            </div>
          )}
        </div>

        {pack !== null && (
          <p className="fcb-muted-copy text-xs">
            This item is saved to the {pack.name} pack, so every character that uses the pack can have it.
          </p>
        )}
        {!editing && pack === null && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={promote} onChange={(event) => setPromote(event.target.checked)} />
            <span>{PROMOTE_LABEL}</span>
          </label>
        )}

        <Issues issues={topIssues} />
        {error && <p role="alert" className="fcb-alert">{error}</p>}

        {confirmRemove && (
          <div role="alert" className="fcb-alert space-y-2" data-testid="remove-confirm">
            <p className="font-semibold">
              Delete {draft.name || 'this item'} from {characterName}? Every copy in the inventory goes too.
            </p>
            <div className="fcb-toolbar">
              <button type="button" className="fcb-button" onClick={() => setConfirmRemove(false)}>
                Keep it
              </button>
              <button type="button" className="fcb-button fcb-button-danger" disabled={saving} onClick={() => void remove()}>
                Delete custom item
              </button>
            </div>
          </div>
        )}

        <div className="fcb-toolbar justify-end">
          {editing && pack === null && (
            <button type="button" className="fcb-button fcb-button-danger mr-auto" disabled={saving} onClick={() => setConfirmRemove(true)}>
              Delete custom item
            </button>
          )}
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={saving}>
            {saving
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : pack
                  ? `Add to ${pack.name}`
                  : template === 'gear'
                    ? `Add ${quantity > 1 ? `${quantity} ` : ''}to inventory`
                    : 'Add to inventory'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
