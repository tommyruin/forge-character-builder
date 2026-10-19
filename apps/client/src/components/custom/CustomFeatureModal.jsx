// The "Custom feature" dialog behind Build's [+] Custom: one form that makes (or edits) a
// rule for a character without XML. The author names it, says where it shows, writes its text
// and adds effects from chips; every effect is one of the shared blocks, and the draft that
// results is what the engine stores in the character file and compiles to an ordinary element.
//
// Saving an edit first asks the engine whether any choice would lose the picks already made
// under it (a choice is remembered by its name, type, level and count) and says so before it
// writes anything.

import { useEffect, useMemo, useState } from 'react';
import {
  CUSTOM_FEAT_TAGS,
  CUSTOM_SHOWS_UNDER,
  CUSTOM_TEMPLATE_OPTIONS,
  createCustomDraft,
  customDraftIssues,
} from '@forge-cb/engine/custom';
import Modal from '../Modal';
import ChoiceBlock from './ChoiceBlock';
import GrantBlock from './GrantBlock';
import ModifierBlock from './ModifierBlock';
import RequirementsBuilder from './RequirementsBuilder';
import SheetPresentation from './SheetPresentation';
import TagPicker from './TagPicker';
import { Field, Issues, NumberInput, RemoveButton, Segmented, SelectInput } from './fields';
import {
  ABILITY_TARGET_GROUPS,
  RECHARGES,
  castAbilityIssues,
  compactGates,
  defaultCastAbility,
  makeChoice,
  makeGrant,
  makeModifier,
  parseUsage,
  sheetPreview,
  showsUnderLabel,
  summarizeDraft,
  targetGroups,
  typeLabel,
  usageText,
} from './draftModel';

const SHOWS_UNDER_OPTIONS = CUSTOM_SHOWS_UNDER.map((option) => ({ id: option.id, label: option.label }));

const OTHER_GROUPS = targetGroups()
  .map((group) => group.label)
  .filter((label) => !ABILITY_TARGET_GROUPS.includes(label));

const isAbilityTarget = (target) =>
  targetGroups(ABILITY_TARGET_GROUPS).some((group) => group.targets.some((entry) => entry.id === target));

function blockTitle(block) {
  if (block.kind === 'modifier') return isAbilityTarget(block.target) ? 'Ability score' : 'Bonus';
  if (block.kind === 'grant') return typeLabel(block.target.type);
  return 'Player picks';
}

// The switch a draft's modifiers share, if any: "Only while active" is one name applied to all
// of them, so the row can show and edit it.
function sharedSwitch(blocks) {
  return blocks.find((block) => block.kind === 'modifier' && block.gates?.switch)?.gates.switch;
}

function withSwitch(blocks, name) {
  return blocks.map((block) => {
    if (block.kind !== 'modifier') return block;
    const gates = compactGates({ ...block.gates, switch: name });
    const { gates: _gates, ...rest } = block;
    return gates ? { ...rest, gates } : rest;
  });
}

function identityMessage(change) {
  const what = change.change === 'removed' ? 'is being removed' : `changes its ${change.fields.join(', ')}`;
  const picks = change.picks.map((pick) => pick.elementName).join(', ');
  return `"${change.name}" ${what}. These picks would be cleared: ${picks}.`;
}

export default function CustomFeatureModal({
  services,
  characterName,
  entry = null,
  initialShowsUnder = 'feats',
  onClose,
  onSaved,
}) {
  const editing = entry !== null;
  const [draft, setDraft] = useState(() => {
    if (entry) return structuredClone(entry.draft);
    const fresh = createCustomDraft('feature', '');
    return { ...fresh, showsUnder: initialShowsUnder };
  });
  const [casters, setCasters] = useState([]);
  // The character's own spellcasting ability, offered for a new spell effect; null when it has none.
  const [characterAbility, setCharacterAbility] = useState(null);
  const [promote, setPromote] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [partial, setPartial] = useState(null);
  const [switchName, setSwitchName] = useState(() => sharedSwitch(entry?.draft.blocks ?? []) ?? '');
  const [switchOn, setSwitchOn] = useState(() => sharedSwitch(entry?.draft.blocks ?? []) !== undefined);
  const [usesOn, setUsesOn] = useState(() => Boolean(entry?.draft.sheet?.usage));

  useEffect(() => {
    let alive = true;
    services
      .casters()
      .then((names) => {
        if (alive) setCasters(names ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [services]);

  useEffect(() => {
    let alive = true;
    Promise.resolve(services.defaultCastAbility?.())
      .then((ability) => {
        if (alive) setCharacterAbility(ability ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [services]);

  const issues = useMemo(() => [...customDraftIssues(draft), ...castAbilityIssues(draft)], [draft]);
  const castDefault = defaultCastAbility(draft, characterAbility);
  const blockIssues = (index) => (attempted ? issues.filter((issue) => issue.path.startsWith(`blocks[${index}]`)) : []);
  const topIssues = attempted ? issues.filter((issue) => !issue.path.startsWith('blocks[')) : [];
  const usage = draft.sheet?.usage ?? '';
  const parsedUsage = parseUsage(usage);

  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const setBlocks = (blocks) => patch({ blocks });
  const setBlock = (index, block) => setBlocks(draft.blocks.map((entryBlock, at) => (at === index ? block : entryBlock)));
  const removeBlock = (index) => setBlocks(draft.blocks.filter((_, at) => at !== index));
  const addBlock = (block) =>
    setBlocks([...draft.blocks, switchOn && switchName.trim() !== '' && block.kind === 'modifier' ? withSwitch([block], switchName)[0] : block]);

  const setShowsUnder = (showsUnder) => {
    const allowed = CUSTOM_TEMPLATE_OPTIONS.find((option) => option.id === draft.template)?.showsUnder ?? [];
    patch({ showsUnder, template: allowed.includes(showsUnder) ? draft.template : 'feature' });
  };

  const setSheet = (sheet) => patch({ sheet });
  const setUsage = (text) => {
    const sheet = { ...draft.sheet };
    if (text.trim() === '') delete sheet.usage;
    else sheet.usage = text;
    setSheet(Object.keys(sheet).length > 0 ? sheet : undefined);
  };

  const chips = [
    { id: 'ability', label: 'Ability score', add: () => addBlock(makeModifier()) },
    {
      id: 'spell',
      label: 'Spell',
      add: () => addBlock(makeGrant('Spell', { spell: { usage: '1/Long Rest', ...(castDefault ? { castAbility: castDefault } : {}) } })),
    },
    { id: 'proficiency', label: 'Proficiency', add: () => addBlock(makeGrant('Proficiency')) },
    { id: 'language', label: 'Language', add: () => addBlock(makeGrant('Language')) },
    { id: 'choice', label: 'Player picks', add: () => addBlock(makeChoice()) },
    { id: 'bonus', label: 'Other bonus', add: () => addBlock(makeModifier({ target: 'ac:misc' })) },
    ...(usesOn
      ? []
      : [{ id: 'uses', label: 'Limited uses', add: () => { setUsesOn(true); setUsage(usageText(1, 'Long Rest')); } }]),
    ...(switchOn
      ? []
      : [{
          id: 'active',
          label: 'Only while active',
          add: () => {
            const name = switchName.trim() || draft.name.trim() || 'Active';
            setSwitchOn(true);
            setSwitchName(name);
            setBlocks(withSwitch(draft.blocks, name));
          },
        }]),
  ];

  const summary = summarizeDraft(draft);
  const preview = sheetPreview(draft);

  const finish = async (saved) => {
    onSaved?.(saved);
    onClose();
  };

  const write = async () => {
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await services.save(draft);
    } catch (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    if (promote) {
      try {
        await services.promote(draft);
      } catch (e) {
        setPartial({ entry: result?.entry ?? null, message: `Added to ${characterName}, but could not copy it to a homebrew pack: ${e.message}` });
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    await finish(result?.entry ?? null);
  };

  const submit = async () => {
    setAttempted(true);
    setWarning(null);
    if (issues.length > 0) return;
    if (editing) {
      setSaving(true);
      try {
        const report = await services.impact(draft);
        if (report?.hasPicks) {
          setWarning(report.changes.filter((change) => change.picks.length > 0));
          setSaving(false);
          return;
        }
      } catch (e) {
        setError(e.message);
        setSaving(false);
        return;
      }
    }
    await write();
  };

  const title = editing ? 'Edit custom feature' : 'Custom feature';

  if (partial) {
    return (
      <Modal open title={title} onClose={() => finish(partial.entry)} size="wide">
        <p role="alert" className="fcb-alert">{partial.message}</p>
        <div className="fcb-toolbar mt-4 justify-end">
          <button type="button" className="fcb-button" onClick={() => finish(partial.entry)}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={title} onClose={onClose} size="wide">
      <form
        className="fcb-custom-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="fcb-custom-row">
          <Field label="Name">
            <input
              className="fcb-input"
              aria-label="Name"
              autoFocus
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

        <div>
          <span className="fcb-field-label">Shows under</span>
          <Segmented label="Shows under" value={draft.showsUnder} options={SHOWS_UNDER_OPTIONS} onChange={setShowsUnder} className="mt-1" />
        </div>

        <Field label="Text">
          <textarea
            className="fcb-textarea"
            aria-label="Text"
            rows={4}
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>

        <div>
          <h4 className="fcb-field-label mb-2">What it does</h4>
          <div className="space-y-3">
            {draft.blocks.map((block, index) => {
              const shared = {
                onRemove: () => removeBlock(index),
                lookup: services.lookup,
                issues: blockIssues(index),
                ariaLabel: blockTitle(block),
                block,
                onChange: (next) => setBlock(index, next),
              };
              if (block.kind === 'modifier') {
                return (
                  <ModifierBlock
                    key={block.id}
                    {...shared}
                    allowedGroups={isAbilityTarget(block.target) ? ABILITY_TARGET_GROUPS : OTHER_GROUPS}
                  />
                );
              }
              if (block.kind === 'grant') {
                return <GrantBlock key={block.id} {...shared} casters={casters} defaultCastAbility={castDefault} />;
              }
              return <ChoiceBlock key={block.id} {...shared} casters={casters} defaultCastAbility={castDefault} />;
            })}

            {usesOn && (
              <div className="fcb-custom-block" role="group" aria-label="Limited uses">
                <div className="fcb-custom-row">
                  {parsedUsage ? (
                    <>
                      <Field label="Uses">
                        <NumberInput
                          label="Uses"
                          min={1}
                          max={99}
                          value={parsedUsage.count}
                          onChange={(count) => setUsage(usageText(count ?? 1, parsedUsage.recharge))}
                        />
                      </Field>
                      <Field label="Recharges on">
                        <SelectInput
                          label="Recharges on"
                          value={parsedUsage.recharge}
                          options={RECHARGES}
                          onChange={(recharge) => setUsage(usageText(parsedUsage.count, recharge))}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field label="Usage text">
                      <input className="fcb-input" aria-label="Usage text" value={usage} onChange={(event) => setUsage(event.target.value)} />
                    </Field>
                  )}
                  <RemoveButton
                    label="Remove limited uses"
                    onClick={() => {
                      setUsesOn(false);
                      setUsage('');
                    }}
                  />
                </div>
                <p className="fcb-muted-copy text-xs">Printed on the sheet as the usage line. Tracking the uses comes later.</p>
              </div>
            )}

            {switchOn && (
              <div className="fcb-custom-block" role="group" aria-label="Only while active">
                <div className="fcb-custom-row">
                  <Field label="Switch name">
                    <input
                      className="fcb-input"
                      aria-label="Switch name"
                      value={switchName}
                      onChange={(event) => {
                        setSwitchName(event.target.value);
                        setBlocks(withSwitch(draft.blocks, event.target.value));
                      }}
                    />
                  </Field>
                  <RemoveButton
                    label="Remove only while active"
                    onClick={() => {
                      setSwitchOn(false);
                      setBlocks(withSwitch(draft.blocks, undefined));
                    }}
                  />
                </div>
                <p className="fcb-muted-copy text-xs">
                  The bonuses above apply only while this switch is on. Switches arrive with the Resources page; until then they stay off.
                </p>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Add an effect">
            {chips.map((chip) => (
              <button key={chip.id} type="button" className="fcb-mode-button" onClick={chip.add}>
                + {chip.label}
              </button>
            ))}
          </div>
        </div>

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
              <SheetPresentation
                value={draft.sheet}
                placeholderTitle={draft.name}
                onChange={setSheet}
              />
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

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={promote} onChange={(event) => setPromote(event.target.checked)} />
          <span>Also save to a homebrew pack, so it can be added to other characters</span>
        </label>

        <Issues issues={topIssues} />
        {error && <p role="alert" className="fcb-alert">{error}</p>}

        {warning && (
          <div role="alert" className="fcb-alert space-y-2" data-testid="identity-warning">
            <p className="font-semibold">Saving this would clear picks the character already made.</p>
            <ul className="list-disc pl-5">
              {warning.map((change) => (
                <li key={change.blockId}>{identityMessage(change)}</li>
              ))}
            </ul>
            <div className="fcb-toolbar">
              <button type="button" className="fcb-button" onClick={() => setWarning(null)}>
                Keep editing
              </button>
              <button type="button" className="fcb-button fcb-button-danger" disabled={saving} onClick={() => { setWarning(null); void write(); }}>
                Save and clear those picks
              </button>
            </div>
          </div>
        )}

        <div className="fcb-toolbar justify-end">
          <button type="button" className="fcb-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="fcb-button fcb-status-complete" disabled={saving || warning !== null}>
            {saving ? 'Saving…' : editing ? 'Save changes' : `Add to ${characterName}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
