// Small controlled form pieces the custom-content blocks share. They are plain labelled
// elements, so every control has a name a screen reader announces and a tab stop.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from '../Icon';
import { plainIssueMessage } from './issueWords';

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
        <li key={`${issue.path}:${issue.message}`}>{plainIssueMessage(issue)}</li>
      ))}
    </ul>
  );
}

// What a dialog's held-back Add (or Save changes) button is waiting for: the first thing missing, in
// the author's words, and how many more. The button names this note as its description.
export function HeldBackNote({ id, issues, editing = false, draft = null }) {
  if (issues.length === 0) return null;
  const first = plainIssueMessage(issues[0], draft).replace(/\.$/, '');
  return (
    <p id={id} className="fcb-custom-needs mr-auto" data-testid="add-needs">
      {editing ? 'To save: ' : 'To add it: '}
      {first.charAt(0).toLowerCase() + first.slice(1)}
      {issues.length > 1 ? ` (and ${issues.length - 1} more)` : '.'}
    </p>
  );
}

// Only one (i) tip is open at a time: opening one closes the last.
let closeOpenTip = null;

// A small (i) button that explains the control beside it. Its text is the button's description, so a
// screen reader reads it with the button whether or not the visible tip is open. The visible tip
// shows on hover, on keyboard focus and when the button is pressed (so it works on touch too); the
// pointer can move onto it without it vanishing; it closes on Escape, on a tap elsewhere, and when
// the page or the dialog scrolls. It is placed against the viewport, so a dialog's scroll area never
// clips it, and it opens above the button when there is no room below.
export function InfoTip({ label, text }) {
  const id = useId();
  const [place, setPlace] = useState(null);
  const pinned = useRef(false);
  const leaveTimer = useRef(null);
  const wrap = useRef(null);
  const close = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    pinned.current = false;
    setPlace(null);
  }, []);
  const open = (target) => {
    window.clearTimeout(leaveTimer.current);
    if (closeOpenTip && closeOpenTip !== close) closeOpenTip();
    closeOpenTip = close;
    const box = target.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 24);
    const left = Math.max(12, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 12));
    const roomBelow = window.innerHeight - box.bottom;
    setPlace(roomBelow > 120 ? { top: box.bottom + 6, left, width } : { bottom: window.innerHeight - box.top + 6, left, width });
  };
  // Leaving for the tip itself (or back) within a moment keeps it open.
  const leaveSoon = () => {
    if (pinned.current) return;
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(close, 150);
  };
  useEffect(() => {
    if (!place) return undefined;
    const onDown = (event) => {
      if (wrap.current && !wrap.current.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [place, close]);
  useEffect(
    () => () => {
      window.clearTimeout(leaveTimer.current);
      if (closeOpenTip === close) closeOpenTip = null;
    },
    [close],
  );
  return (
    <span className="fcb-info-button-wrap" ref={wrap}>
      <button
        type="button"
        className="fcb-info-button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        onMouseEnter={(event) => open(event.currentTarget)}
        onMouseLeave={leaveSoon}
        onFocus={(event) => open(event.currentTarget)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && place) {
            // Escape closes the tip only; the dialog stays open.
            event.stopPropagation();
            close();
          }
        }}
        onClick={(event) => {
          if (pinned.current) {
            close();
            return;
          }
          open(event.currentTarget);
          pinned.current = true;
        }}
      >
        <Icon name="info" className="fcb-info-tip-icon" />
      </button>
      <span id={id} className="sr-only">
        {text}
      </span>
      {place && (
        <span
          aria-hidden="true"
          className="fcb-info-popover"
          data-testid="info-tip"
          style={place}
          onMouseEnter={() => window.clearTimeout(leaveTimer.current)}
          onMouseLeave={leaveSoon}
        >
          {text}
        </span>
      )}
    </span>
  );
}
