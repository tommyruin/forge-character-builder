// The editor for one element of a pack. What it shows depends on how the element is made:
//
//  - a form: the same blocks a character's custom feature uses (features, reference entries,
//    additions, replacements), or the spell and item forms in their own dialog;
//  - raw XML: an element of a type the forms do not cover yet, or one chosen to be edited as XML;
//  - the earlier structured editor: the forms cannot represent every field that editor had, so the
//    element opens as its XML with a notice, and nothing it holds is dropped.
//
// Every change is handed up as a new element; the editor keeps no copy of its own.

import { useEffect, useMemo, useRef, useState } from 'react';
import { customPackDraftIssues } from '@forge-cb/engine/custom';
import CustomItemModal from '../custom/CustomItemModal';
import CustomSpellModal from '../custom/CustomSpellModal';
import FeatureFields from '../custom/FeatureFields';
import { Field, Issues, SelectInput } from '../custom/fields';
import { castAbilityIssues, summarizeItem, summarizeSpell, tidySpell } from '../custom/draftModel';
import AppendFields from './AppendFields';
import BuildFields from './BuildFields';
import CatalogFields from './CatalogFields';
import OverrideFields from './OverrideFields';
import RawXmlEditor, { readElementXml } from './RawXmlEditor';
import { makePackFormServices } from './packServices';
import { draftFamily, elementIdOf, elementKind, elementMeta, legacyXml, updateElementDraft } from './packModel';
import { ELEMENT_RULESET_OPTIONS, normalizeElementRuleset } from './xmlBuilder';

function IdentityWarning({ report }) {
  const changes = (report?.changes ?? []).filter((change) => change.picks.length > 0);
  if (changes.length === 0) return null;
  return (
    <div role="alert" className="fcb-alert space-y-1" data-testid="hb-identity-warning">
      <p className="font-semibold">Characters have made picks under this element&apos;s choices.</p>
      <ul className="list-disc pl-5 text-sm">
        {changes.map((change) => (
          <li key={change.blockId}>
            &ldquo;{change.name}&rdquo; {change.change === 'removed' ? 'is being removed' : `changes its ${change.fields.join(', ')}`}.
            Updating the builder would clear: {change.picks.map((pick) => pick.elementName).join(', ')}.
          </li>
        ))}
      </ul>
    </div>
  );
}

function FormDialogCard({ element, family, api, pack, onChange }) {
  const [open, setOpen] = useState(false);
  const draft = element.customDraft;
  const services = useMemo(
    () =>
      makePackFormServices({
        api,
        pack,
        kind: family,
        onSave: async (saved) => onChange(updateElementDraft(element, saved, pack)),
      }),
    [api, pack, family, element, onChange],
  );
  const lines = family === 'spell' ? summarizeSpell(tidySpell(draft)) : summarizeItem(draft);
  const noun = family === 'spell' ? 'spell' : 'item';
  return (
    <div className="fcb-panel" data-testid="hb-form-card">
      <div className="fcb-panel-body space-y-3">
        <p className="fcb-muted-copy text-xs">
          A {noun} has its own form. It saves into this pack, so every character that uses the pack can have it.
        </p>
        <h3 className="text-base font-semibold">{draft.name || `Untitled ${noun}`}</h3>
        {lines.length > 0 && (
          <ul className="fcb-custom-summary-list" data-testid="hb-form-summary">
            {lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
        <button type="button" className="fcb-button fcb-button-primary" onClick={() => setOpen(true)}>
          Edit {noun}
        </button>
      </div>
      {open && family === 'spell' && (
        <CustomSpellModal
          services={services}
          characterName={pack.name}
          pack={{ name: pack.name }}
          entry={{ kind: 'spell', draft: structuredClone(draft), elementId: draft.id }}
          onClose={() => setOpen(false)}
        />
      )}
      {open && family === 'item' && (
        <CustomItemModal
          services={services}
          characterName={pack.name}
          pack={{ name: pack.name }}
          entry={{ kind: 'item', draft: structuredClone(draft), elementId: draft.id }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function ElementEditor({ element, pack, api, disabled = false, showIssues = false, identityReport = null, onChange, onCopyToPack }) {
  const kind = elementKind(element);
  const latest = useRef(element);
  useEffect(() => {
    latest.current = element;
  }, [element]);
  const [confirmDetach, setConfirmDetach] = useState(false);

  const family = kind === 'form' ? draftFamily(element.customDraft) : null;
  const services = useMemo(
    () => makePackFormServices({ api, pack, kind: family ?? 'feature', onSave: async () => {} }),
    [api, pack, family],
  );

  // A form's setter takes the draft or a function of it; successive calls in one event each see the
  // result of the one before, because the latest element is kept here.
  const setDraft = (updater) => {
    const current = latest.current.customDraft;
    const next = typeof updater === 'function' ? updater(current) : updater;
    latest.current = updateElementDraft(latest.current, next, pack);
    onChange(latest.current);
  };

  const issues = useMemo(() => {
    if (kind !== 'form') return [];
    const found = customPackDraftIssues(element.customDraft);
    return family === 'feature' ? [...found, ...castAbilityIssues(element.customDraft)] : found;
  }, [kind, family, element.customDraft]);

  const setRaw = (rawXml) => {
    const read = readElementXml(rawXml);
    const named = read.error ? {} : { name: read.name || latest.current.name, type: read.type || latest.current.type, id: read.id || latest.current.id };
    onChange({ ...latest.current, ...named, rawXml });
  };

  const detach = () => {
    const { customDraft: _draft, loadedDraft: _loaded, ...rest } = latest.current;
    setConfirmDetach(false);
    onChange({ ...rest, rawXml: latest.current.rawXml || '' });
  };

  const setRuleset = (value) =>
    setDraft((draft) => {
      const next = { ...draft };
      if (value === 'inherit') delete next.ruleset;
      else next.ruleset = value;
      return next;
    });

  return (
    <section className="fcb-panel" data-testid="hb-element-editor">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">{element.name || `New ${element.type}`}</h2>
          <p className="fcb-panel-subtitle">{elementMeta(element)} · {pack.name}</p>
        </div>
        {onCopyToPack && (
          <button type="button" className="fcb-button" data-testid="hb-copy-to-pack" disabled={disabled} onClick={onCopyToPack}>
            Copy to a pack…
          </button>
        )}
      </header>
      <div className="fcb-panel-body space-y-4">
        <IdentityWarning report={identityReport} />

        {kind === 'legacy' && (
          <>
            <p className="fcb-warning-note text-sm" data-testid="hb-legacy-notice">
              This element was made with the earlier editor, which has fields the forms cannot show. It opens as its XML so nothing it holds
              is lost; change it here.
            </p>
            <RawXmlEditor value={legacyXml(element, pack)} disabled={disabled} onChange={setRaw} />
          </>
        )}

        {kind === 'raw' && (
          <>
            <RawXmlEditor value={element.rawXml} disabled={disabled} onChange={setRaw} />
          </>
        )}

        {kind === 'form' && (family === 'spell' || family === 'item') && (
          <FormDialogCard element={element} family={family} api={api} pack={pack} onChange={onChange} />
        )}
        {kind === 'form' && family === 'feature' && (
          <div className="fcb-custom-form">
            <FeatureFields draft={element.customDraft} setDraft={setDraft} services={services} issues={issues} attempted={showIssues} />
          </div>
        )}
        {kind === 'form' && family === 'build' && (
          <div className="fcb-custom-form">
            <BuildFields draft={element.customDraft} setDraft={setDraft} services={services} issues={issues} attempted={showIssues} pack={pack} api={api} />
          </div>
        )}
        {kind === 'form' && family === 'catalog' && (
          <div className="fcb-custom-form">
            <CatalogFields draft={element.customDraft} setDraft={setDraft} services={services} issues={issues} attempted={showIssues} />
          </div>
        )}
        {kind === 'form' && family === 'append' && (
          <div className="fcb-custom-form">
            <AppendFields draft={element.customDraft} setDraft={setDraft} services={services} issues={issues} attempted={showIssues} />
          </div>
        )}
        {kind === 'form' && family === 'override' && (
          <div className="fcb-custom-form">
            <OverrideFields draft={element.customDraft} setDraft={setDraft} issues={issues} attempted={showIssues} />
          </div>
        )}
        {kind === 'form' && (family === 'spell' || family === 'item') && <Issues issues={showIssues ? issues : []} />}

        <details className="fcb-homebrew-advanced" data-testid="hb-element-advanced">
          <summary>Advanced</summary>
          <div className="fcb-homebrew-advanced-grid">
            <p className="fcb-homebrew-element-id">
              Element id: <code>{elementIdOf(element, pack)}</code>
            </p>
            {kind === 'form' && (
              <Field label="Rules version">
                <SelectInput
                  label="Rules version"
                  data-testid="hb-element-ruleset"
                  value={normalizeElementRuleset(element.customDraft.ruleset)}
                  options={ELEMENT_RULESET_OPTIONS.map(([id, label]) => ({ id, label }))}
                  onChange={setRuleset}
                />
              </Field>
            )}
            {kind === 'form' && (
              <div>
                <button type="button" className="fcb-button" disabled={disabled} onClick={() => setConfirmDetach(true)}>
                  Edit raw XML
                </button>
                {confirmDetach && (
                  <div role="alert" className="fcb-alert mt-2 space-y-2" data-testid="hb-detach-confirm">
                    <p>
                      The element is kept as the XML it has now, and the form no longer opens it. Rules you add by hand stay. You cannot
                      turn it back into a form.
                    </p>
                    <div className="fcb-toolbar">
                      <button type="button" className="fcb-button" onClick={() => setConfirmDetach(false)}>
                        Keep the form
                      </button>
                      <button type="button" className="fcb-button fcb-button-danger" onClick={detach}>
                        Edit as XML
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
