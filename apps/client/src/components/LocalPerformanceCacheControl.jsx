import { useState } from 'react';
import { api } from '../api.js';
import { resetLocalPerformanceCache } from '../transport/localPerformanceCache.js';

export default function LocalPerformanceCacheControl({
  fastStart = api.fastStart,
}) {
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const reset = async () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Reset only the local performance cache? Characters, imported content, homebrew, sources, and cloud backups will remain.',
      )
    ) {
      return;
    }
    setResetting(true);
    setMessage(null);
    setError(null);
    try {
      await resetLocalPerformanceCache(fastStart);
      setMessage('The local performance cache was rebuilt.');
    } catch (resetError) {
      setError(String(resetError?.message ?? resetError));
    } finally {
      setResetting(false);
    }
  };

  return (
    <details className="fcb-local-cache-control">
      <summary>Advanced local storage</summary>
      <div className="fcb-local-cache-control-body">
        <p>
          Fast Start is automatic. DM Forge rebuilds its local performance
          cache after rules or imported content changes.
        </p>
        <button
          className="fcb-button"
          disabled={resetting}
          onClick={() => void reset()}
          type="button"
        >
          {resetting ? 'Resetting…' : 'Reset local performance cache'}
        </button>
        <p className="fcb-local-cache-note">
          This affects only optimized browser data. It does not remove
          characters, imported content, homebrew, sources, or cloud backups.
        </p>
        {message && (
          <p aria-live="polite" className="fcb-local-cache-message" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="fcb-alert" role="alert">
            {error} Normal rules loading remains available.
          </p>
        )}
      </div>
    </details>
  );
}
