import Icon from './Icon';

// The manual save control shown in the workspace toolbar while autosave is
// off. Icon-only like its neighbours; the unsaved state is the amber dot.
export default function SaveButton({
  dirty,
  saving = false,
  disabled = false,
  onSave,
}) {
  const title = saving
    ? 'Saving…'
    : dirty
      ? 'Save (unsaved changes)'
      : 'Save (all changes saved)';
  return (
    <button
      aria-label="Save character"
      className="fcb-icon-button fcb-manual-save-button"
      data-unsaved={dirty ? 'true' : 'false'}
      disabled={disabled || saving || !dirty}
      onClick={onSave}
      title={title}
      type="button"
    >
      <Icon name="save" />
      <span className="fcb-manual-save-dot" aria-hidden="true" />
    </button>
  );
}
