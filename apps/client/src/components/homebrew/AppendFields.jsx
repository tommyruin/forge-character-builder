// The form for an addition to an element another file defines: the rules and tags it adds join the
// target's, which stays where it is. The usual use is a spell added to a class list, by adding the
// class's name as a tag.

import EffectsEditor from '../custom/EffectsEditor';
import LibraryPicker from '../custom/LibraryPicker';
import TagPicker from '../custom/TagPicker';
import { Field, Issues } from '../custom/fields';

const CLASS_TAGS = ['Artificer', 'Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];

export default function AppendFields({ draft, setDraft, services, issues = [], attempted = false }) {
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const topIssues = attempted ? issues.filter((issue) => !issue.path.startsWith('blocks[')) : [];
  return (
    <>
      <p className="fcb-muted-copy text-xs">Adds rules or tags to an element another file defines. The element itself stays as it is.</p>
      <Field label="What this addition is called">
        <input className="fcb-input" aria-label="Name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </Field>
      <div>
        <span className="fcb-field-label">Adds to</span>
        <LibraryPicker
          lookup={services.lookup}
          value={draft.targetId}
          valueLabel={draft.targetName || draft.targetId}
          label="Find the element to add to"
          onPick={(item) => patch({ targetId: item.id, targetName: item.name })}
        />
      </div>
      <div>
        <span className="fcb-field-label">Tags to add</span>
        <TagPicker
          label="Tags to add"
          value={draft.tags ?? []}
          suggestions={CLASS_TAGS}
          onChange={(tags) => patch({ tags: tags.length > 0 ? tags : undefined })}
        />
      </div>
      <EffectsEditor draft={draft} setDraft={setDraft} services={services} issues={issues} attempted={attempted} features={false} />
      <Issues issues={topIssues} />
    </>
  );
}
