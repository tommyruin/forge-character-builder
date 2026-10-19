// The form for a species, subspecies, class, subclass, background or companion in a pack: the name
// and text every option has, then the tabs that kind needs (Basics, Progression, Spellcasting,
// Multiclass, Sheet ...). One component per tab lives beside it; this one holds the shell, the
// parent a subclass or subspecies belongs to, and the plain-words summary.

import { useState } from 'react';
import EffectsEditor from '../custom/EffectsEditor';
import SheetPresentation from '../custom/SheetPresentation';
import { Field, Issues } from '../custom/fields';
import { BackgroundBasics, BackgroundFeature, BackgroundLists } from './BackgroundFields';
import { ClassBasics, MulticlassPanel } from './ClassFields';
import { CompanionBasics, CompanionEntries } from './CompanionFields';
import LineageFields from './LineageFields';
import ParentPicker from './ParentPicker';
import ProgressionTable from './ProgressionTable';
import SpellcastingPanel, { SubclassSpellsPanel } from './SpellcastingPanel';
import { TABS, summarizeBuild } from './buildModel';

const TITLES = {
  species: 'Species',
  subspecies: 'Subspecies or variant',
  class: 'Class',
  subclass: 'Subclass',
  background: 'Background',
  companion: 'Companion',
};

/** Effects the option has as a whole, beside its table: bonuses, grants and picks with their own levels. */
function OtherEffects({ draft, setDraft, services, issues, attempted }) {
  const view = { name: draft.name, blocks: draft.blocks };
  return (
    <details className="fcb-custom-gates" open={draft.blocks.length > 0}>
      <summary>Other effects of the {TITLES[draft.template].toLowerCase()}</summary>
      <div className="fcb-custom-gates-body">
        <EffectsEditor
          draft={view}
          setDraft={(updater) => setDraft((current) => ({ ...current, blocks: (typeof updater === 'function' ? updater({ ...view, blocks: current.blocks }) : updater).blocks }))}
          services={services}
          issues={issues.filter((issue) => issue.path.startsWith('blocks'))}
          attempted={attempted}
          features={false}
        />
      </div>
    </details>
  );
}

/** How each feature of the table prints on the sheet. */
function SheetTab({ draft, setDraft }) {
  if (draft.features.length === 0) {
    return <p className="fcb-muted-copy text-sm">Add features in the Progression tab, then set here how each prints.</p>;
  }
  return (
    <div className="space-y-4" data-testid="hb-build-sheet">
      <p className="fcb-muted-copy text-xs">
        A feature prints on the character sheet under its name, with its text. Hide one, give it another title, or add the action it takes.
      </p>
      {draft.features.map((entry) => (
        <section key={entry.draft.id} className="space-y-1" aria-label={`Sheet line of ${entry.draft.name || 'a feature'}`}>
          <h4 className="fcb-field-label">
            {entry.draft.name || 'Unnamed feature'} · level {entry.level}
          </h4>
          <SheetPresentation
            value={entry.draft.sheet}
            placeholderTitle={entry.draft.name}
            onChange={(sheet) =>
              setDraft((current) => ({
                ...current,
                features: current.features.map((other) => (other.draft.id === entry.draft.id ? { ...other, draft: { ...other.draft, sheet } } : other)),
              }))
            }
          />
        </section>
      ))}
    </div>
  );
}

export default function BuildFields({ draft, setDraft, services, issues = [], attempted = false, pack, api }) {
  const template = draft.template;
  const tabs = TABS[template];
  const [tab, setTab] = useState('basics');
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const topIssues = attempted ? issues.filter((issue) => /^(name|description|parent|template|id)/.test(issue.path)) : [];
  const hasParent = template === 'subclass' || template === 'subspecies';
  const summary = summarizeBuild(draft);
  const common = { draft, setDraft, services, issues, attempted };

  return (
    <div className="space-y-4" data-testid={`hb-build-${template}`}>
      <div className="fcb-custom-row">
        <Field label="Name">
          <input className="fcb-input" aria-label="Name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
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

      {hasParent && (
        <ParentPicker
          kind={template}
          pack={pack}
          api={api}
          lookup={services.lookup}
          value={draft.parent}
          onPick={(parent) => patch({ parent: { id: parent.id, name: parent.name, tag: parent.tag }, ...(template === 'subspecies' && parent.kind ? { kind: parent.kind } : {}) })}
        />
      )}

      <Field label="Text">
        <textarea className="fcb-textarea" aria-label="Text" rows={4} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
      </Field>

      <div role="tablist" aria-label={`${TITLES[template]} sections`} className="flex min-w-0 flex-wrap items-stretch gap-0.5">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`hb-tab-${id}`} aria-selected={tab === id} className={`fcb-tab px-[13px]${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-labelledby={`hb-tab-${tab}`} className="space-y-4">
        {tab === 'basics' && template === 'class' && (
          <>
            <ClassBasics {...common} />
            <OtherEffects {...common} />
          </>
        )}
        {tab === 'basics' && (template === 'species' || template === 'subspecies') && (
          <>
            <LineageFields {...common} />
            <OtherEffects {...common} />
          </>
        )}
        {tab === 'basics' && template === 'subclass' && <OtherEffects {...common} />}
        {tab === 'basics' && template === 'subclass' && !draft.parent?.id && <p className="fcb-muted-copy text-xs">Pick the class above so the subclass appears in its pick.</p>}
        {tab === 'basics' && template === 'background' && <BackgroundBasics {...common} />}
        {tab === 'basics' && template === 'companion' && <CompanionBasics {...common} />}

        {tab === 'progression' && <ProgressionTable {...common} owner={template === 'class' ? 'class' : template === 'subclass' ? 'subclass' : 'species'} />}

        {tab === 'spellcasting' && template === 'class' && (
          <SpellcastingPanel
            value={draft.spellcasting}
            ownerName={draft.name}
            subject="class"
            issues={issues.filter((issue) => issue.path.startsWith('spellcasting'))}
            attempted={attempted}
            onChange={(spellcasting) => patch({ spellcasting })}
          />
        )}
        {tab === 'spellcasting' && template === 'subclass' && <SubclassSpellsPanel {...common} lookup={services.lookup} />}
        {tab === 'multiclass' && <MulticlassPanel {...common} />}

        {tab === 'feature' && <BackgroundFeature {...common} />}
        {tab === 'lists' && <BackgroundLists {...common} />}
        {tab === 'entries' && <CompanionEntries {...common} />}
        {tab === 'sheet' && <SheetTab {...common} />}
      </div>

      <div className="fcb-custom-summary" aria-live="polite">
        <div>
          <h4 className="fcb-field-label">In plain words</h4>
          <ul className="fcb-custom-summary-list" data-testid="hb-build-summary">
            {summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <Issues issues={topIssues} />
    </div>
  );
}
