import Icon from './Icon';
import UtilityBadge from './UtilityBadge';

// Header utility: shows whether edits are written as you go, and flips it.
// The corner badge is a tick while autosave is on and a slash while it is off.
export default function AutosaveToggle({ enabled, onToggle }) {
  const label = enabled ? 'Autosave on' : 'Autosave off';
  return (
    <button
      aria-label={enabled ? 'Turn autosave off' : 'Turn autosave on'}
      aria-pressed={enabled}
      className={`fcb-topbar-utility fcb-autosave-utility ${
        enabled ? 'is-on' : 'is-off'
      }`}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <Icon name="autosave" />
      <UtilityBadge state={enabled ? 'on' : 'off'} />
    </button>
  );
}
