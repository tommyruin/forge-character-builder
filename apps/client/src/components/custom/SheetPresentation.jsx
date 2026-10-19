// B6: how the entry prints on the character sheet: whether it shows, the title it prints under,
// the action type (None, Action, Bonus Action, Reaction, Attack), a usage line, the text (the
// description unless overridden) and text that takes over from a level on. The block emits the
// draft's `CustomSheet`, or undefined when everything is at its default.

import { SHEET_ACTION_OPTIONS } from '@forge-cb/engine/custom';
import { compact } from './draftModel';
import { Field, NumberInput, RemoveButton, SelectInput } from './fields';

const ACTIONS = SHEET_ACTION_OPTIONS.map((option) => ({ id: option.id, label: option.label }));

// Removes the keys that match the compiler's defaults, so a form that was only opened leaves
// the draft untouched.
export function tidySheet(sheet) {
  const next = compact({
    show: sheet.show === false ? false : undefined,
    title: sheet.title?.trim() ? sheet.title : undefined,
    action: sheet.action && sheet.action !== 'none' ? sheet.action : undefined,
    usage: sheet.usage?.trim() ? sheet.usage : undefined,
    text: sheet.text?.trim() ? sheet.text : undefined,
    tiers: sheet.tiers?.length ? sheet.tiers : undefined,
  });
  return Object.keys(next).length > 0 ? next : undefined;
}

export default function SheetPresentation({ value = {}, onChange, placeholderTitle = '', placeholderText = '' }) {
  const emit = (patch) => onChange(tidySheet({ ...value, ...patch }));
  const tiers = value.tiers ?? [];
  const setTier = (index, patch) => emit({ tiers: tiers.map((tier, at) => (at === index ? { ...tier, ...patch } : tier)) });

  return (
    <div className="fcb-custom-block" role="group" aria-label="Sheet presentation">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.show !== false}
          onChange={(event) => emit({ show: event.target.checked })}
        />
        Show on the character sheet
      </label>
      {value.show !== false && (
        <>
          <div className="fcb-custom-row">
            <Field label="Printed title">
              <input
                className="fcb-input"
                aria-label="Printed title"
                placeholder={placeholderTitle || 'The name of the entry'}
                value={value.title ?? ''}
                onChange={(event) => emit({ title: event.target.value })}
              />
            </Field>
            <Field label="Action type">
              <SelectInput
                label="Action type"
                value={value.action ?? 'none'}
                options={ACTIONS}
                onChange={(action) => emit({ action })}
              />
            </Field>
            <Field label="Usage">
              <input
                className="fcb-input"
                aria-label="Usage"
                placeholder="2/Long Rest"
                value={value.usage ?? ''}
                onChange={(event) => emit({ usage: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Sheet text">
            <textarea
              className="fcb-textarea"
              aria-label="Sheet text"
              rows={3}
              placeholder={placeholderText || 'Prints the description unless you write something shorter here'}
              value={value.text ?? ''}
              onChange={(event) => emit({ text: event.target.value })}
            />
          </Field>
          <div className="space-y-2">
            <span className="fcb-field-label">Text that takes over at a level</span>
            {tiers.map((tier, index) => (
              <div key={index} className="flex items-start gap-2" role="group" aria-label={`Level text ${index + 1}`}>
                <div className="w-24 shrink-0">
                  <NumberInput
                    label={`Level for text ${index + 1}`}
                    min={1}
                    max={20}
                    value={tier.level}
                    onChange={(level) => setTier(index, { level: level ?? 1 })}
                  />
                </div>
                <textarea
                  className="fcb-textarea"
                  aria-label={`Text from that level ${index + 1}`}
                  rows={2}
                  value={tier.text}
                  onChange={(event) => setTier(index, { text: event.target.value })}
                />
                <RemoveButton
                  label={`Remove level text ${index + 1}`}
                  onClick={() => emit({ tiers: tiers.filter((_, at) => at !== index) })}
                />
              </div>
            ))}
            <button
              type="button"
              className="fcb-button"
              onClick={() => {
                const used = new Set(tiers.map((tier) => tier.level));
                let level = 2;
                while (used.has(level) && level < 20) level += 1;
                emit({ tiers: [...tiers, { level, text: '' }] });
              }}
            >
              Add level text
            </button>
          </div>
        </>
      )}
    </div>
  );
}
