function normalizedPercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export default function CharacterLoadingState({
  characterName,
  message = 'Preparing character data…',
  percentage,
  error,
  onRetry,
}) {
  const value = normalizedPercentage(percentage);
  const label = `Loading ${characterName || 'character'}`;

  return (
    <section
      className={`fcb-character-loading ${error ? 'is-error' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!error}
    >
      <div className="fcb-character-loading-heading">
        <span className="fcb-character-loading-kicker">
          Character Builder
        </span>
        <h2>{error ? 'Character could not be loaded' : label}</h2>
      </div>

      {error ? (
        <>
          <p className="fcb-character-loading-error">{error}</p>
          {onRetry && (
            <button
              type="button"
              className="fcb-button"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </>
      ) : (
        <>
          <progress
            className="dmf-sr-only"
            aria-label={label}
            max="100"
            value={value ?? undefined}
          >
            {value == null ? message : `${value}%`}
          </progress>
          <div
            className={`fcb-character-loading-track ${
              value == null ? 'is-indeterminate' : ''
            }`}
            aria-hidden="true"
          >
            <span
              className="fcb-character-loading-value"
              style={value == null ? undefined : { width: `${value}%` }}
            />
          </div>
          <div className="fcb-character-loading-detail">
            <p>{message}</p>
            {value != null && <strong>{value}%</strong>}
          </div>
        </>
      )}
    </section>
  );
}
