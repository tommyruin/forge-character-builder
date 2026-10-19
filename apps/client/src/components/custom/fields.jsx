// Small controlled form pieces the custom-content blocks share. They are plain labelled
// elements, so every control has a name a screen reader announces and a tab stop.

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
