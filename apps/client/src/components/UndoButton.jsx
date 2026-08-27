import Icon from './Icon';

// Steps back through the recent edits, one at a time, in either autosave mode.
export default function UndoButton({ available, disabled = false, onUndo }) {
  return (
    <button
      aria-label="Undo last change"
      className="fcb-icon-button fcb-manual-undo-button"
      disabled={disabled || !available}
      onClick={onUndo}
      title={available ? 'Undo last change' : 'Nothing to undo'}
      type="button"
    >
      <Icon name="undo" />
    </button>
  );
}
