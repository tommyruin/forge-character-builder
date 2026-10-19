// The fields of a custom feature, with no dialog around them: name, where it shows, text, what it
// does, the optional requirements, tags and sheet line, and the plain-words summary. The "Custom
// feature" dialog on a character and the Homebrew pack's element editor both render this, so a
// feature is made with the same controls and the same draft wherever it is made.

import { CUSTOM_FEAT_TAGS, CUSTOM_SHOWS_UNDER, CUSTOM_TEMPLATE_OPTIONS } from '@forge-cb/engine/custom';
import EffectsEditor from './EffectsEditor';
import RequirementsBuilder from './RequirementsBuilder';
import SheetPresentation from './SheetPresentation';
import TagPicker from './TagPicker';
import { Field, Issues, Segmented } from './fields';
import { showsUnderLabel, sheetPreview, summarizeDraft } from './draftModel';

const SHOWS_UNDER_OPTIONS = CUSTOM_SHOWS_UNDER.map((option) => ({ id: option.id, label: option.label }));

// `placed` fixes where the feature shows (a class feature inside a class table); `inheritedScales`
// are the table's value columns, which the feature's bonuses may read.
export default function FeatureFields({
  draft,
  setDraft,
  services,
  issues = [],
  attempted = false,
  autoFocus = false,
  placed = false,
  inheritedScales = [],
}) {
  const topIssues = attempted
    ? issues.filter((issue) => !issue.path.startsWith('blocks[') && !issue.path.startsWith('trackers[') && !issue.path.startsWith('scales['))
    : [];
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));

  const setShowsUnder = (showsUnder) => {
    const allowed = CUSTOM_TEMPLATE_OPTIONS.find((option) => option.id === draft.template)?.showsUnder ?? [];
    patch({ showsUnder, template: allowed.includes(showsUnder) ? draft.template : 'feature' });
  };

  const summary = summarizeDraft(draft);
  const preview = sheetPreview(draft);

  return (
    <>
      <div className="fcb-custom-row">
        <Field label="Name">
          <input
            className="fcb-input"
            aria-label="Name"
            autoFocus={autoFocus}
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>
        <Field label="Where it came from">
          <input
            className="fcb-input"
            aria-label="Where it came from"
            placeholder="A campaign or a DM"
            value={draft.cameFrom ?? ''}
            onChange={(event) => patch({ cameFrom: event.target.value === '' ? undefined : event.target.value })}
          />
        </Field>
      </div>

      {!placed && (
        <div>
          <span className="fcb-field-label">Shows under</span>
          <Segmented label="Shows under" value={draft.showsUnder} options={SHOWS_UNDER_OPTIONS} onChange={setShowsUnder} className="mt-1" />
        </div>
      )}

      <Field label="Text">
        <textarea
          className="fcb-textarea"
          aria-label="Text"
          rows={4}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>

      <EffectsEditor
        draft={draft}
        setDraft={setDraft}
        services={services}
        issues={issues}
        attempted={attempted}
        startWithSwitch={draft.template === 'transformation'}
        inheritedScales={inheritedScales}
      />

      <details className="fcb-custom-gates">
        <summary>More options</summary>
        <div className="fcb-custom-gates-body">
          <div>
            <span className="fcb-field-label">Requirements to take it</span>
            <RequirementsBuilder
              label="Prerequisites"
              lookup={services.lookup}
              value={draft.requirements}
              onChange={(requirements) => patch({ requirements })}
            />
          </div>
          <div>
            <span className="fcb-field-label">Tags</span>
            <TagPicker
              label="Tags"
              value={draft.tags ?? []}
              suggestions={draft.showsUnder === 'feats' ? [...CUSTOM_FEAT_TAGS] : []}
              onChange={(tags) => patch({ tags: tags.length > 0 ? tags : undefined })}
            />
          </div>
          <div>
            <span className="fcb-field-label">On the sheet</span>
            <SheetPresentation value={draft.sheet} placeholderTitle={draft.name} onChange={(sheet) => patch({ sheet })} />
          </div>
        </div>
      </details>

      <div className="fcb-custom-summary" aria-live="polite">
        <div>
          <h4 className="fcb-field-label">In plain words</h4>
          {summary.length === 0 ? (
            <p className="fcb-muted-copy text-xs">Text only.</p>
          ) : (
            <ul className="fcb-custom-summary-list" data-testid="custom-summary">
              {summary.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        <div data-testid="custom-sheet-preview">
          <h4 className="fcb-field-label">On the sheet · {showsUnderLabel(draft.showsUnder)}</h4>
          {preview.hidden ? (
            <p className="fcb-muted-copy text-xs">Hidden from the sheet.</p>
          ) : (
            <p className="text-sm">
              <strong>{preview.title}.</strong>
              {preview.meta.length > 0 && <em> {preview.meta.join(' · ')}.</em>} {preview.text}
            </p>
          )}
        </div>
      </div>

      <Issues issues={topIssues} />
    </>
  );
}
