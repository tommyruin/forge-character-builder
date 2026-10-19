// What adding a pack file shows: the confirm before an existing pack is replaced, and the result.

const RELATION_TEXT = {
  newer: 'This file is a newer copy of a pack that is already on this device.',
  same: 'This file is the same version as the pack on this device.',
  older: 'This file is an older copy than the pack on this device.',
};

export default function PackImportPanel({ plan, outcome, busy, onApply, onCancel, onDismiss }) {
  return (
    <div className="space-y-2" data-testid="hb-pack-import">
      {plan && plan.kind === 'update' && (
        <div role="alert" className="fcb-warning-note space-y-2" data-testid="hb-import-confirm">
          <p className="font-semibold">Update &ldquo;{plan.existing.name}&rdquo; from this file?</p>
          <p className="text-sm">
            {RELATION_TEXT[plan.relation]} Updating replaces the pack in place. Its elements keep their ids, so characters that use it keep
            their picks and reload with the new rules.
          </p>
          {plan.added.length > 0 && <p className="text-sm">Adds: {plan.added.join(', ')}.</p>}
          {plan.removed.length > 0 && (
            <p className="text-sm">
              Removes: {plan.removed.join(', ')}. Characters that use these lose them.
            </p>
          )}
          {plan.relation !== 'newer' && <p className="text-sm">Changes you made on this device since that version are replaced.</p>}
          <div className="fcb-toolbar">
            <button type="button" className="fcb-button" onClick={onCancel} disabled={busy}>
              Keep my copy
            </button>
            <button type="button" className="fcb-button fcb-button-primary" data-testid="hb-import-apply" onClick={onApply} disabled={busy}>
              {plan.relation === 'newer' ? 'Update pack' : 'Replace with this file'}
            </button>
          </div>
        </div>
      )}
      {outcome?.ok && (
        <p role="status" className="fcb-status-badge fcb-status-complete" data-testid="hb-import-done">
          {outcome.kind === 'update' ? 'Updated' : 'Imported'} {outcome.name}
          {outcome.count != null ? ` — ${outcome.count} elements available` : ''}
        </p>
      )}
      {outcome && !outcome.ok && (
        <div role="alert" className="fcb-alert" data-testid="hb-import-failed">
          <p className="font-semibold">
            {outcome.stored ? `${outcome.name} was added but could not be loaded into the builder yet:` : 'Could not import this file:'}
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {(outcome.errors ?? []).map((error, index) => (
              <li key={`e${index}`}>
                {error.where}: {error.message}
              </li>
            ))}
            {(outcome.diagnostics ?? []).map((diagnostic, index) => (
              <li key={`d${index}`}>
                [{diagnostic.kind}] {diagnostic.message}
              </li>
            ))}
            {(outcome.rejected ?? []).map((file, index) => (
              <li key={`r${index}`}>
                {file.fileName}: {file.error ?? 'rejected'}
              </li>
            ))}
          </ul>
          {outcome.stored && <p className="mt-1 text-sm">Open the pack under Homebrew to fix it.</p>}
        </div>
      )}
      {outcome && onDismiss && (
        <button type="button" className="fcb-button px-2 py-1 text-xs" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
