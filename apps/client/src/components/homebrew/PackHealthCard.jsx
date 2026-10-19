// The pack's health: every broken reference, duplicate id, element nothing can attach, addition to
// something that is not loaded and unreadable requirement the engine found in the pack's file, each
// with the element that carries it and the fix on offer.

import { findingTitle, fixFor, problemsIn, sourceNeedFor } from './packHealth';

export default function PackHealthCard({ pack, health, busy, onFix }) {
  const { status, findings } = health;
  const problems = problemsIn(findings);
  const replaced = findings.filter((finding) => finding.kind === 'overrides');
  return (
    <section className="fcb-panel" data-testid="hb-pack-health" aria-label="Pack health">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">Pack health</h2>
          <p className="fcb-panel-subtitle" role="status">
            {status === 'checking' && 'Checking the pack against your library…'}
            {status === 'error' && 'The check could not run.'}
            {status === 'ready' && (problems.length === 0 ? 'No problems found.' : `${problems.length} to fix`)}
          </p>
        </div>
      </header>
      {(problems.length > 0 || replaced.length > 0) && (
        <ul className="fcb-pack-health-list">
          {problems.map((finding, index) => {
            const fix = fixFor(finding, pack);
            const need = sourceNeedFor(finding);
            return (
              <li key={`${finding.kind}-${finding.elementId ?? ''}-${finding.missingId ?? ''}-${index}`} className="fcb-pack-health-item" data-kind={finding.kind}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{findingTitle(finding)}</p>
                  <p className="text-sm">{finding.message}</p>
                </div>
                <div className="fcb-toolbar">
                  {fix && fix.action !== 'open' && (
                    <button type="button" className="fcb-button fcb-button-primary" disabled={busy} onClick={() => onFix(finding, fix)}>
                      {fix.label}
                    </button>
                  )}
                  {need && (
                    <button
                      type="button"
                      className="fcb-button"
                      data-testid="hb-find-source"
                      onClick={() => onFix(finding, { action: 'find-source', label: 'Find a source', need })}
                    >
                      Find a source
                    </button>
                  )}
                  {fix?.element && (
                    <button
                      type="button"
                      className="fcb-button"
                      onClick={() => onFix(finding, { action: 'open', label: 'Open element', element: fix.element })}
                    >
                      Open element
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {replaced.map((finding, index) => (
            <li key={`overrides-${index}`} className="fcb-pack-health-item is-note" data-kind="overrides">
              <p className="text-sm">{finding.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
