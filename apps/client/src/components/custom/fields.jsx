// Small controlled form pieces the custom-content blocks share. They are plain labelled
// elements, so every control has a name a screen reader announces and a tab stop.

import { useId, useState } from 'react';
import Icon from '../Icon';

export function Field({ label, children, className = '' }) {
  return (
    <label className={`fcb-field-label ${className}`.trim()}>
      {label}
      {children}
    </label>
  );
}

// A whole number the author types; an empty box reads as "not set" (undefined).
export function NumberInput({ value, onChange, min, max, label, className = '', ...rest }) {
  return (
    <input
      type="number"
      className={`fcb-input ${className}`.trim()}
      aria-label={label}
      min={min}
      max={max}
      value={value ?? ''}
      onChange={(event) => {
        const text = event.target.value;
        onChange(text === '' ? undefined : Math.trunc(Number(text)));
      }}
      {...rest}
    />
  );
}

// A menu that always lists the value it holds. A <select> whose value is missing from its options
// silently shows the first option, which reads as a different choice than the one stored.
export function withCurrent(options, value, label = value) {
  return value === undefined || value === '' || options.some((option) => option.id === value) ? options : [...options, { id: value, label }];
}

export function SelectInput({ value, onChange, options, label, className = '', placeholder, children, ...rest }) {
  return (
    <select
      className={`fcb-select ${className}`.trim()}
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {children ??
        options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
    </select>
  );
}

// One choice out of a few, as a row of buttons: the role is a radio group so the state is
// announced, and each option is a real button the keyboard reaches.
export function Segmented({ value, onChange, options, label, className = '' }) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={`fcb-mode-button${value === option.id ? ' is-active' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RemoveButton({ onClick, label }) {
  return (
    <button type="button" className="fcb-icon-button" aria-label={label} title={label} onClick={onClick}>
      <Icon name="close" />
    </button>
  );
}

export function Issues({ issues }) {
  if (!issues || issues.length === 0) return null;
  return (
    <ul role="alert" className="fcb-custom-issues">
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

// What a dialog's held-back Add (or Save changes) button is waiting for: the first thing missing, in
// the author's words, and how many more. The button names this note as its description.
export function HeldBackNote({ id, issues, editing = false }) {
  if (issues.length === 0) return null;
  const first = issues[0].message;
  return (
    <p id={id} className="fcb-custom-needs mr-auto" data-testid="add-needs">
      {editing ? 'To save: ' : 'To add it: '}
      {first.charAt(0).toLowerCase() + first.slice(1)}
      {issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}
    </p>
  );
}

// A small (i) button that explains the control beside it. The text shows on hover, on keyboard
// focus and when the button is pressed (so it works on touch too); it is placed against the
// viewport, so a dialog's scroll area never clips it.
export function InfoTip({ label, text }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState(null);
  const open = (target) => {
    const box = target.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 24);
    setPlace({ top: box.bottom + 6, left: Math.max(12, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 12)), width });
    setShown(true);
  };
  const close = () => {
    setShown(false);
    setPinned(false);
  };
  return (
    <span className="fcb-info-button-wrap">
      <button
        type="button"
        className="fcb-info-button"
        aria-label={`About ${label}`}
        aria-describedby={shown ? id : undefined}
        aria-expanded={shown}
        onMouseEnter={(event) => open(event.currentTarget)}
        onMouseLeave={() => !pinned && setShown(false)}
        onFocus={(event) => open(event.currentTarget)}
        onBlur={close}
        onKeyDown={(event) => event.key === 'Escape' && shown && (event.stopPropagation(), close())}
        onClick={(event) => {
          setPinned(!pinned);
          if (pinned) setShown(false);
          else open(event.currentTarget);
        }}
      >
        <Icon name="info" className="fcb-info-tip-icon" />
      </button>
      {shown && place && (
        <span id={id} role="tooltip" className="fcb-info-popover" style={{ top: place.top, left: place.left, width: place.width }}>
          {text}
        </span>
      )}
    </span>
  );
}
