// The form for a reference entry a pack adds: a language, a proficiency, a sense or damage type, a
// deity, an optional rule, an alignment, a weapon property, or a new base weapon or armor. The
// fields each template reads come from the engine's catalogue; a weapon or armor adds the few
// things its attack row or armor class needs.

import { CUSTOM_CATALOG_OPTIONS } from '@forge-cb/engine/custom';
import EffectsEditor from '../custom/EffectsEditor';
import LibraryPicker from '../custom/LibraryPicker';
import TagPicker from '../custom/TagPicker';
import { Field, Issues, NumberInput, RemoveButton, SelectInput } from '../custom/fields';
import { DAMAGE_TYPE_OPTIONS, WEAPON_PROPERTY_OPTIONS } from '../custom/draftModel';


const WEAPON_CATEGORY_OPTIONS = [
  { id: 'simpleMelee', label: 'Simple melee' },
  { id: 'simpleRanged', label: 'Simple ranged' },
  { id: 'martialMelee', label: 'Martial melee' },
  { id: 'martialRanged', label: 'Martial ranged' },
];

const HANDS_OPTIONS = [
  { id: 'onehand', label: 'One-handed' },
  { id: 'twohand', label: 'Two-handed' },
];

const ARMOR_GROUP_OPTIONS = [
  { id: 'light', label: 'Light armor' },
  { id: 'medium', label: 'Medium armor' },
  { id: 'heavy', label: 'Heavy armor' },
  { id: 'shield', label: 'Shield' },
];

// The 2024 weapon masteries the rules ship; each is a weapon property element.
const MASTERY_OPTIONS = ['Cleave', 'Graze', 'Nick', 'Push', 'Sap', 'Slow', 'Topple', 'Vex'].map((name) => ({
  id: `ID_WOTC_PHB24_WEAPON_PROPERTY_${name.toUpperCase()}`,
  label: name,
}));

const CURRENCIES = [
  { id: 'cp', label: 'cp' },
  { id: 'sp', label: 'sp' },
  { id: 'gp', label: 'gp' },
];

const optionalNumber = (text) => (text === '' ? undefined : Number(text));

function PriceFields({ item, onChange, label }) {
  return (
    <div className="fcb-custom-row">
      <Field label="Weight (lb)">
        <input
          className="fcb-input"
          type="number"
          min="0"
          step="any"
          aria-label={`${label} weight`}
          value={item.weight ?? ''}
          onChange={(event) => onChange({ weight: optionalNumber(event.target.value) })}
        />
      </Field>
      <Field label="Cost">
        <input
          className="fcb-input"
          type="number"
          min="0"
          step="any"
          aria-label={`${label} cost`}
          value={item.cost?.amount ?? ''}
          onChange={(event) =>
            onChange({ cost: event.target.value === '' ? undefined : { amount: Number(event.target.value), currency: item.cost?.currency ?? 'gp' } })
          }
        />
      </Field>
      <Field label="Currency">
        <SelectInput
          label={`${label} currency`}
          value={item.cost?.currency ?? 'gp'}
          options={CURRENCIES}
          disabled={!item.cost}
          onChange={(currency) => item.cost && onChange({ cost: { ...item.cost, currency } })}
        />
      </Field>
    </div>
  );
}

function WeaponSection({ weapon, onChange, lookup }) {
  const properties = weapon.properties ?? [];
  const known = new Set(WEAPON_PROPERTY_OPTIONS.map((option) => option.id));
  const toggle = (id) => {
    const next = properties.includes(id) ? properties.filter((entry) => entry !== id) : [...properties, id];
    onChange({ properties: next.length > 0 ? next : undefined });
  };
  return (
    <div className="space-y-3" role="group" aria-label="Weapon">
      <div className="fcb-custom-row">
        <Field label="Category">
          <SelectInput label="Weapon category" value={weapon.category} options={WEAPON_CATEGORY_OPTIONS} onChange={(category) => onChange({ category })} />
        </Field>
        <Field label="Hands">
          <SelectInput label="Weapon hands" value={weapon.hands} options={HANDS_OPTIONS} onChange={(hands) => onChange({ hands })} />
        </Field>
      </div>
      <div className="fcb-custom-row">
        <Field label="Damage">
          <input
            className="fcb-input"
            aria-label="Weapon damage dice"
            placeholder="1d8"
            value={weapon.damage?.dice ?? ''}
            onChange={(event) => onChange({ damage: { ...weapon.damage, dice: event.target.value.trim() } })}
          />
        </Field>
        <Field label="Damage type">
          <SelectInput
            label="Weapon damage type"
            value={weapon.damage?.type ?? 'slashing'}
            options={DAMAGE_TYPE_OPTIONS}
            onChange={(type) => onChange({ damage: { ...weapon.damage, type } })}
          />
        </Field>
        <Field label="Two-handed damage">
          <input
            className="fcb-input"
            aria-label="Weapon versatile damage"
            placeholder="1d10"
            value={weapon.versatile ?? ''}
            onChange={(event) => onChange({ versatile: event.target.value.trim() === '' ? undefined : event.target.value.trim() })}
          />
        </Field>
        <Field label="Range">
          <input
            className="fcb-input"
            aria-label="Weapon range"
            placeholder="20/60"
            value={weapon.range ?? ''}
            onChange={(event) => onChange({ range: event.target.value.trim() === '' ? undefined : event.target.value.trim() })}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="fcb-field-label">Properties</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {WEAPON_PROPERTY_OPTIONS.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={properties.includes(option.id)} onChange={() => toggle(option.id)} />
              {option.label}
            </label>
          ))}
        </div>
        {properties
          .filter((id) => !known.has(id))
          .map((id) => (
            <div key={id} className="fcb-custom-picked mt-2">
              <span className="font-semibold">{id}</span>
              <RemoveButton label={`Remove property ${id}`} onClick={() => toggle(id)} />
            </div>
          ))}
        <div className="mt-2">
          <span className="fcb-field-label">Another property from the library or this pack</span>
          <LibraryPicker
            lookup={lookup}
            type="Weapon Property"
            label="Add a weapon property"
            onPick={(item) => !properties.includes(item.id) && onChange({ properties: [...properties, item.id] })}
          />
        </div>
      </fieldset>
      <Field label="Weapon mastery (2024 rules)">
        <SelectInput
          label="Weapon mastery"
          value={weapon.mastery ?? ''}
          placeholder="None"
          options={MASTERY_OPTIONS}
          onChange={(mastery) => onChange({ mastery: mastery === '' ? undefined : mastery })}
        />
      </Field>
      <PriceFields item={weapon} onChange={onChange} label="Weapon" />
    </div>
  );
}

function ArmorSection({ armor, onChange }) {
  const shield = armor.group === 'shield';
  return (
    <div className="space-y-3" role="group" aria-label="Armor">
      <div className="fcb-custom-row">
        <Field label="Group">
          <SelectInput label="Armor group" value={armor.group} options={ARMOR_GROUP_OPTIONS} onChange={(group) => onChange({ group })} />
        </Field>
        <Field label={shield ? 'Armor class bonus' : 'Base armor class'}>
          <NumberInput label="Armor class" min={0} max={30} value={armor.ac} onChange={(ac) => onChange({ ac: ac ?? 0 })} />
        </Field>
        {!shield && (
          <Field label="Minimum Strength">
            <NumberInput label="Minimum Strength" min={1} max={30} value={armor.strength} onChange={(strength) => onChange({ strength })} />
          </Field>
        )}
      </div>
      {!shield && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={armor.stealthDisadvantage === true}
            onChange={(event) => onChange({ stealthDisadvantage: event.target.checked ? true : undefined })}
          />
          Disadvantage on Stealth checks
        </label>
      )}
      <PriceFields item={armor} onChange={onChange} label="Armor" />
    </div>
  );
}

export default function CatalogFields({ draft, setDraft, services, issues = [], attempted = false }) {
  const option = CUSTOM_CATALOG_OPTIONS.find((entry) => entry.id === draft.template);
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const setField = (key, value) =>
    setDraft((current) => {
      const fields = { ...(current.fields ?? {}) };
      if (value === '') delete fields[key];
      else fields[key] = value;
      return { ...current, fields: Object.keys(fields).length > 0 ? fields : undefined };
    });
  const topIssues = attempted ? issues.filter((issue) => !issue.path.startsWith('blocks[')) : [];

  return (
    <>
      <p className="fcb-muted-copy text-xs">{option?.summary}</p>
      <div className="fcb-custom-row">
        <Field label="Name">
          <input className="fcb-input" aria-label="Name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="Where it came from">
          <input
            className="fcb-input"
            aria-label="Where it came from"
            placeholder="A campaign or a DM"
            value={draft.cameFrom ?? ''}
            onChange={(event) => patch({ cameFrom: event.target.value === '' ? undefined : event.target.value })}
          />
        </Field>
      </div>
      <Field label="Text">
        <textarea
          className="fcb-textarea"
          aria-label="Text"
          rows={4}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>

      {(option?.fields ?? []).length > 0 && (
        <div className="fcb-custom-row">
          {option.fields.map((field) => (
            <Field key={field.key} label={field.label}>
              <input
                className="fcb-input"
                aria-label={field.label}
                placeholder={field.placeholder}
                value={draft.fields?.[field.key] ?? ''}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            </Field>
          ))}
        </div>
      )}

      {option?.tagLabel && (
        <div>
          <span className="fcb-field-label">{option.tagLabel}</span>
          <TagPicker
            label={option.tagLabel}
            value={draft.tags ?? []}
            suggestions={[...(option.tagSuggestions ?? [])]}
            onChange={(tags) => patch({ tags: tags.length > 0 ? tags : undefined })}
          />
        </div>
      )}

      {draft.template === 'baseWeapon' && draft.weapon && (
        <WeaponSection weapon={draft.weapon} lookup={services.lookup} onChange={(next) => patch({ weapon: { ...draft.weapon, ...next } })} />
      )}
      {draft.template === 'baseArmor' && draft.armor && (
        <ArmorSection armor={draft.armor} onChange={(next) => patch({ armor: { ...draft.armor, ...next } })} />
      )}

      <EffectsEditor draft={draft} setDraft={setDraft} services={services} issues={issues} attempted={attempted} features={false} />
      <Issues issues={topIssues} />
    </>
  );
}
