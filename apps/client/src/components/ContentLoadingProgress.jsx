function normalizedPercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

const PHASE_MESSAGES = {
  character: "Refreshing the open character…",
  finalizing: "Finishing content update…",
  waiting: "Preparing content update…",
};

export default function ContentLoadingProgress({
  phase = "content",
  progress,
  fallbackMessage = "Preparing content update…",
}) {
  const value = progress?.active
    ? normalizedPercentage(progress.percentage)
    : null;
  const message =
    PHASE_MESSAGES[phase] ??
    (progress?.active && progress.message ? progress.message : fallbackMessage);

  return (
    <div
      className="fcb-content-loading-progress"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <progress
        className="dmf-sr-only"
        aria-label="Content update progress"
        max="100"
        value={value ?? undefined}
      >
        {value == null ? message : `${value}%`}
      </progress>
      <div
        className={`fcb-character-loading-track ${
          value == null ? "is-indeterminate" : ""
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
    </div>
  );
}
