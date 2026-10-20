// The template picker behind "+ Element": what is being made decides the type, the tags that put it
// in the right pickers and the blocks it usually needs. A template with a form starts that form; a
// subclass or subspecies first asks which class or species it is for; a change to a book element
// first asks which element; "Custom type or raw XML" starts any other element as XML.

import { useMemo, useState } from 'react';
import Modal from '../Modal';
import CustomItemModal from '../custom/CustomItemModal';
import CustomSpellModal from '../custom/CustomSpellModal';
import LibraryPicker from '../custom/LibraryPicker';
import { Field, SelectInput } from '../custom/fields';
import ParentPicker from './ParentPicker';
import {
  NEW_ELEMENT_GROUPS,
  appendElement,
  createBuildDraft,
  createTemplateDraft,
  elementForDraft,
  overrideElement,
  rawElement,
  templateById,
} from './packModel';
import { makePackFormServices, makePackLookup } from './packServices';
import { ELEMENT_RULESET_OPTIONS, normalizeCollectionRuleset } from './xmlBuilder';

const RULES_LABEL = { '2014': '2014', '2024': '2024', shared: 'both 2014 and 2024' };

function BookElementStep({ route, api, onBack, onPicked }) {
  const lookup = useMemo(() => makePackLookup(api, { elements: [] }), [api]);
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsXml = route.kind !== 'append';

  const pick = async (item) => {
    setPicked(item);
    setError(null);
    if (!needsXml) {
      onPicked({ id: item.id, name: item.name });
      return;
    }
    setBusy(true);
    try {
      const source = await api.content.elementSource(item.id);
      if (!source) setError('That element is not loaded any more.');
      else if (!source.xml) setError(source.reason ?? 'That element cannot be copied without losing parts of it.');
      else onPicked(source);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const prompt =
    route.kind === 'append' ? 'Which element does this add to?' : route.kind === 'reflavour' ? 'Which element do you want to rename?' : 'Which element do you want to change?';
  return (
    <div className="space-y-3" data-testid="hb-book-step">
      <p className="text-sm">{prompt}</p>
      <LibraryPicker lookup={lookup} value={picked?.id ?? ''} valueLabel={picked?.name} label="Find a book element" onPick={pick} />
      {busy && <p className="fcb-muted-copy text-xs">Copying it…</p>}
      {error && (
        <p role="alert" className="fcb-alert">
          {error}
        </p>
      )}
      <div className="fcb-toolbar fcb-dialog-footer justify-end">
        <button type="button" className="fcb-button mr-auto" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function RawTypeStep({ onBack, onCreate }) {
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  return (
    <form
      className="space-y-3"
      data-testid="hb-raw-step"
      onSubmit={(event) => {
        event.preventDefault();
        if (type.trim() !== '' && name.trim() !== '') onCreate({ type: type.trim(), name: name.trim() });
      }}
    >
      <p className="text-sm">Name the element type to write as XML. Use this for anything the forms cannot express yet.</p>
      <div className="fcb-custom-row">
        <Field label="Element type">
          <input className="fcb-input" aria-label="Element type" placeholder="Race Variant" value={type} onChange={(event) => setType(event.target.value)} />
        </Field>
        <Field label="Name">
          <input className="fcb-input" aria-label="Element name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>
      <div className="fcb-toolbar fcb-dialog-footer justify-end">
        <button type="button" className="fcb-button mr-auto" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="fcb-button fcb-status-complete" disabled={type.trim() === '' || name.trim() === ''}>
          Add element
        </button>
      </div>
    </form>
  );
}

export default function NewElementDialog({ pack, api, startAt, onClose, onCreate }) {
  // `startAt="raw"` goes straight to naming an element written as XML.
  const [templateId, setTemplateId] = useState(startAt === 'raw' ? 'raw' : null);
  const [step, setStep] = useState(startAt === 'raw' ? 'raw' : 'pick');
  const [ruleset, setRuleset] = useState('inherit');
  const template = templateId ? templateById(templateId) : null;
  const route = template?.route ?? null;
  // A template that needs nothing more is added at once; the others go on to ask for it.
  const makesNow = route !== null && (['feature', 'catalog', 'build'].includes(route.kind) || (route.kind === 'raw' && route.type !== ''));

  const finish = (element) => {
    onCreate(element);
    onClose();
  };

  const create = () => {
    if (!route) return;
    if (route.kind === 'feature' || route.kind === 'catalog' || route.kind === 'build') {
      const draft = { ...createTemplateDraft(templateId, { ruleset }), name: `New ${template.label.toLowerCase()}` };
      finish(elementForDraft(draft, pack));
    } else if (route.kind === 'raw' && route.type !== '') {
      finish(rawElement({ type: route.type, name: `New ${template.label.toLowerCase()}`, pack, ruleset }));
    } else {
      setStep(route.kind === 'raw' ? 'raw' : route.kind === 'parent' ? 'parent' : route.kind === 'spell' || route.kind === 'item' ? 'form' : 'book');
    }
  };

  const createForParent = (parent) => {
    const made = { ...createBuildDraft(route.template, parent), name: `New ${template.label.toLowerCase()}` };
    finish(elementForDraft(ruleset === 'inherit' ? made : { ...made, ruleset }, pack));
  };

  const parentLookup = useMemo(() => makePackLookup(api, pack), [api, pack]);
  const formServices = useMemo(
    () => makePackFormServices({ api, pack, kind: route?.kind === 'spell' ? 'spell' : 'item', onSave: async (draft) => finish(elementForDraft(ruleset === 'inherit' ? draft : { ...draft, ruleset }, pack)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish only calls the parent's handlers
    [api, pack, route?.kind, ruleset],
  );

  if (step === 'form' && route?.kind === 'spell') {
    const initial = createTemplateDraft(templateId, { ruleset });
    return (
      <CustomSpellModal
        services={formServices}
        characterName={pack.name}
        pack={{ name: pack.name }}
        initialDraft={{ name: '', id: initial.id }}
        onClose={() => setStep('pick')}
      />
    );
  }
  if (step === 'form' && route?.kind === 'item') {
    return (
      <CustomItemModal
        services={formServices}
        characterName={pack.name}
        pack={{ name: pack.name }}
        initialTemplate={route.template}
        onClose={() => setStep('pick')}
      />
    );
  }

  const packRules = RULES_LABEL[normalizeCollectionRuleset(pack.ruleset)];

  return (
    <Modal open title={`New element in ${pack.name}`} onClose={onClose} size="wide">
      {step === 'pick' && (
        <div className="space-y-4" data-testid="hb-new-element">
          <p className="fcb-muted-copy text-xs">
            Pick what you are making. Each template sets the type, the tags that make it show up in the right pickers, and the blocks it
            usually needs.
          </p>
          <Field label="Rules version">
            <SelectInput
              label="Rules version for the new element"
              value={ruleset}
              onChange={setRuleset}
              options={ELEMENT_RULESET_OPTIONS.map(([id, label]) => ({
                id,
                label: id === 'inherit' ? `Pack default (${packRules})` : label,
              }))}
            />
          </Field>
          <div role="radiogroup" aria-label="Template" className="space-y-4">
            {NEW_ELEMENT_GROUPS.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h4 className="fcb-field-label mb-2">{group.label}</h4>
                <div className="fcb-template-grid">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={templateId === item.id}
                      data-testid={`hb-template-${item.id}`}
                      className={`fcb-template-card${templateId === item.id ? ' is-selected' : ''}`}
                      onClick={() => setTemplateId(item.id)}
                    >
                      <span className="fcb-template-card-title">{item.label}</span>
                      <span className="fcb-template-card-summary">{item.summary}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="fcb-toolbar fcb-dialog-footer justify-end">
            <button type="button" className="fcb-button mr-auto" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="fcb-button fcb-status-complete" data-testid="hb-template-create" disabled={!route} onClick={create}>
              {makesNow ? 'Add element' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {step === 'book' && route && (
        <BookElementStep
          route={route}
          api={api}
          onBack={() => setStep('pick')}
          onPicked={(picked) => {
            if (route.kind === 'append') finish(appendElement(picked, pack));
            else finish(overrideElement(picked, pack, { reflavour: route.kind === 'reflavour', ruleset }));
          }}
        />
      )}

      {step === 'parent' && route && (
        <div className="space-y-3" data-testid="hb-parent-step">
          <ParentPicker kind={route.template} pack={pack} api={api} lookup={parentLookup} value={null} onPick={createForParent} />
          <div className="fcb-toolbar fcb-dialog-footer justify-end">
            <button type="button" className="fcb-button mr-auto" onClick={() => setStep('pick')}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === 'raw' && <RawTypeStep onBack={() => setStep('pick')} onCreate={({ type, name }) => finish(rawElement({ type, name, pack, ruleset }))} />}
    </Modal>
  );
}
