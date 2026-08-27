import Icon from './Icon';

// Header utility: shows whether edits are written as you go, and flips it.
export default function AutosaveToggle({ enabled, onToggle }) {
  const label = enabled ? 'Autosave on' : 'Autosave off';
  return (
    <button
      aria-label={enabled ? 'Turn autosave off' : 'Turn autosave on'}
      aria-pressed={enabled}
      className={`fcb-topbar-utility tcb-autosave-utility ${
        enabled ? 'is-on' : 'is-off'
      }`}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <Icon name="autosave" />
      <span className="tcb-autosave-utility-dot" aria-hidden="true" />
    </button>
  );
}
