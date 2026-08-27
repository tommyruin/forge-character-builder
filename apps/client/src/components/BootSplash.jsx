import { useEffect, useState } from "react";
import { shell } from "@shell";
import { api, ENGINE_TRANSPORT } from "../api";

// Boot splash for the in-browser engine. The rules engine boots in a Web Worker and loads the
// rules content: a few seconds before the library is usable.
// This overlay makes that wait legible and clears only when the complete library is ready.
// Split/core-first mode remains an explicit diagnostic opt-in.
// Transports without a boot phase render nothing.
const STEPS = [
  ["runtime", "Rules engine"],
  ["core", "Rules content"],
  ["ready", "Ready to build"],
];

// Phase -> progress rank (which step is active/done). ready/supplements/complete all sit at
// the final rank; the overlay itself is gone by then (state.interactive is true).
const PHASE_RANK = {
  idle: 0,
  runtime: 1,
  core: 2,
  content: 2,
  "user-content": 2,
  ready: 3,
  supplements: 2,
  complete: 3,
  "supplements-error": 3,
  error: 1,
};

export default function BootSplash() {
  const enabled =
    ENGINE_TRANSPORT === "worker" && typeof api.onBootProgress === "function";
  const [state, setState] = useState(() =>
    enabled
      ? api.getBootState()
      : { phase: "complete", interactive: true, supplementsLoaded: true },
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const unsubscribe = api.onBootProgress(setState);
    api.startBoot(); // kick the otherwise-lazy boot so the splash shows at app load
    return unsubscribe;
  }, [enabled]);

  if (!enabled) {
    return (
      <span
        className="fcb-engine-state-marker"
        aria-hidden="true"
        data-fcb-engine-ready="true"
        data-fcb-engine-progress="100"
      />
    );
  }

  const rank = PHASE_RANK[state.phase] ?? 0;
  const isError = state.phase === "error";
  const percentage = Number.isFinite(state.percentage)
    ? Math.min(100, Math.max(0, Math.round(state.percentage)))
    : null;
  const progressMessage =
    state.message ||
    (state.cachedFileCount
      ? `Preparing ${state.cachedFileCount.toLocaleString()} custom content files…`
      : "Preparing rules content…");
  const cachedContentMessage = state.cachedFileCount
    ? `Preparing ${state.cachedFileCount.toLocaleString()} custom content files…`
    : null;

  return (
    <>
      <span
        className="fcb-engine-state-marker"
        aria-hidden="true"
        data-fcb-engine-ready={state.interactive ? "true" : "false"}
        data-fcb-engine-progress={percentage == null ? "" : String(percentage)}
      />
      {!state.interactive && (
        <div className="fcb-boot-splash" role="status" aria-live="polite">
          <div className="fcb-boot-card">
            <shell.Logo className="fcb-boot-logo" size={64} />
            <h1 className="dmf-sr-only">{shell.appName}</h1>
            {isError ? (
              <>
                <p className="fcb-boot-sub fcb-boot-error">
                  The rules engine failed to load.
                </p>
                {state.error && (
                  <p className="fcb-boot-detail">{state.error}</p>
                )}
                <p className="fcb-boot-detail">
                  Your saved characters and content remain safely on this device.
                </p>
                <button
                  type="button"
                  className="fcb-button fcb-boot-retry"
                  onClick={() => api.retryBoot?.()}
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <p className="fcb-boot-sub">
                  Starting the D&D rules engine in your browser…
                </p>
                <ol className="fcb-boot-steps">
                  {STEPS.map(([key, label], i) => {
                    const stepRank = i + 1;
                    const status =
                      rank > stepRank
                        ? "done"
                        : rank === stepRank
                          ? "active"
                          : "pending";
                    return (
                      <li key={key} className={`fcb-boot-step is-${status}`}>
                        <span
                          className="fcb-boot-step-dot"
                          aria-hidden="true"
                        />
                        {label}
                      </li>
                    );
                  })}
                </ol>
                <progress
                  className="dmf-sr-only"
                  aria-label="Loading rules engine"
                  max="100"
                  value={percentage ?? undefined}
                >
                  {percentage == null ? progressMessage : `${percentage}%`}
                </progress>
                <div
                  className={`fcb-character-loading-track ${
                    percentage == null ? "is-indeterminate" : ""
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className="fcb-character-loading-value"
                    style={
                      percentage == null
                        ? undefined
                        : { width: `${percentage}%` }
                    }
                  />
                </div>
                <div className="fcb-boot-progress-detail">
                  <span>{progressMessage}</span>
                  {percentage != null && <strong>{percentage}%</strong>}
                </div>
                {cachedContentMessage &&
                  progressMessage !== cachedContentMessage && (
                    <p className="fcb-boot-detail">
                      {cachedContentMessage}
                    </p>
                  )}
                <p className="fcb-boot-detail">
                  First load takes a few seconds. Large custom libraries can take
                  longer.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {state.interactive && state.phase === "supplements-error" && (
        <div className="fcb-boot-pill is-warn" role="status">
          Some supplemental content didn’t load.
        </div>
      )}
    </>
  );
}
