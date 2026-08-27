import Modal from './Modal';

// Asked before leaving a character whose edits have not been saved (autosave
// off). Save writes and continues; Discard drops the edits; Cancel stays.
export default function UnsavedChangesDialog({
  open,
  characterName,
  saving = false,
  error = null,
  onSave,
  onDiscard,
  onCancel,
}) {
  return (
    <Modal open={open} title="Unsaved changes" onClose={onCancel}>
      <div data-testid="unsaved-changes-dialog">
        <p>“{characterName}” has unsaved changes.</p>
        {error && (
          <p className="fcb-alert mt-3" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            className="fcb-button"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="fcb-button"
            disabled={saving}
            onClick={onDiscard}
            type="button"
          >
            Discard changes
          </button>
          <button
            className="fcb-button fcb-button-primary"
            disabled={saving}
            onClick={onSave}
            type="button"
          >
            {saving ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
