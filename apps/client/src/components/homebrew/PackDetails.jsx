// A pack's own details: what the library shows for its Source (name, text, abbreviation, author,
// release date, playtest flag) and the rules version its elements default to. The file slug is the
// path the pack is stored under, so it is locked once the pack has been loaded.

import { RULESET_OPTIONS, collectionFileName, normalizeCollectionRuleset } from './xmlBuilder';

export default function PackDetails({ pack, busy, onFieldChange, onOpenContent }) {
  return (
    <section className="fcb-panel" data-testid="hb-pack-details">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">Pack details</h2>
          <p className="fcb-panel-subtitle">The source information shared by every element in the pack.</p>
        </div>
      </header>
      <div className="fcb-panel-body space-y-4">
        <label className="fcb-field-label">
          Name
          <input
            data-testid="hb-pack-name"
            className="fcb-input normal-case"
            value={pack.name}
            onChange={(event) => onFieldChange('name', event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="fcb-field-label">
          Description
          <textarea
            rows={5}
            className="fcb-textarea normal-case"
            value={pack.description}
            onChange={(event) => onFieldChange('description', event.target.value)}
            disabled={busy}
            placeholder="What this pack contains (shown on its Source element)"
          />
        </label>
        <div className="fcb-homebrew-advanced-grid">
          <label className="fcb-field-label">
            Abbreviation
            <input
              data-testid="hb-pack-abbreviation"
              className="fcb-input"
              value={pack.abbreviation}
              onChange={(event) => onFieldChange('abbreviation', event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="fcb-field-label">
            Author
            <input
              data-testid="hb-pack-author"
              className="fcb-input normal-case"
              value={pack.author ?? ''}
              onChange={(event) => onFieldChange('author', event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="fcb-field-label">
            Release date
            <input
              data-testid="hb-pack-release"
              className="fcb-input"
              type="date"
              value={pack.release ?? ''}
              onChange={(event) => onFieldChange('release', event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="fcb-field-label">
            Rules version
            <select
              data-testid="hb-pack-ruleset"
              className="fcb-select"
              value={normalizeCollectionRuleset(pack.ruleset)}
              onChange={(event) => onFieldChange('ruleset', event.target.value)}
              disabled={busy}
            >
              {RULESET_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="text-xs normal-case tracking-normal text-[var(--fcb-text-faint)]">
          The rules version is the default for the pack&apos;s elements; any element can ask for another.
        </span>
        <label className="flex items-center gap-2 text-sm">
          <input
            data-testid="hb-pack-playtest"
            type="checkbox"
            checked={pack.playtest === true}
            onChange={(event) => onFieldChange('playtest', event.target.checked)}
            disabled={busy}
          />
          Playtest material (listed after finished sources)
        </label>
        <details className="fcb-homebrew-advanced">
          <summary>Advanced</summary>
          <div className="fcb-homebrew-advanced-grid">
            <label className="fcb-field-label">
              File slug
              <input
                className="fcb-input"
                value={pack.slug}
                onChange={(event) => onFieldChange('slug', event.target.value)}
                disabled={busy || Boolean(pack.ingestedAt)}
                title={pack.ingestedAt ? 'Locked after the first load: the slug is the upload path.' : undefined}
              />
            </label>
            <p className="fcb-homebrew-file-path">
              Download file: <code>{collectionFileName(pack)}</code>
            </p>
            <div>
              <p className="text-sm">A content file you already have (XML, ZIP, a folder, a web address) is added from Content.</p>
              {onOpenContent && (
                <button type="button" className="fcb-button mt-2" data-testid="hb-open-manage-files" onClick={onOpenContent}>
                  Content › Manage files
                </button>
              )}
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
