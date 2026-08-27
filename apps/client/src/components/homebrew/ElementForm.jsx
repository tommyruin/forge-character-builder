import { useEffect, useState } from "react";
import { api } from "../../api";
import Icon from '../Icon';
import {
  ARMOR_CATEGORIES,
  ELEMENT_RULESET_OPTIONS,
  GRANT_TYPES,
  STAT_NAMES,
  TYPE_SPECS,
  WEAPON_CATEGORIES,
  WEAPON_PROPERTIES,
  buildElementXml,
  resolveElementId,
  normalizeElementRuleset,
  validateHtmlFragment,
} from "./xmlBuilder";

// Normalise spec options: entries are either 'value' or ['value', 'Label'].
const optionPair = (option) =>
  Array.isArray(option) ? option : [option, option];

const WEAPON_CATEGORY_IDS = new Set(WEAPON_CATEGORIES.map(([id]) => id));

// Schema-driven form for one homebrew element. Fully controlled by the parent (the
// collection draft is the single source of truth so the shared XML inspector and the
// debounce-persisted draft always agree); mount with key={element.localId}.
export default function ElementForm({
  element,
  collection,
  disabled,
  onChange,
}) {
  const [supportsText, setSupportsText] = useState(
    (element.supports ?? []).join(", "),
  );

  const spec = TYPE_SPECS[element.type] ?? {};
  const setters = element.setters ?? {};
  const rawMode = element.rawXml != null;
  const elementId = resolveElementId(element, collection);

  const set = (patch) => onChange({ ...element, ...patch });
  const setSetter = (key, value) =>
    set({ setters: { ...setters, [key]: value } });

  const descriptionError = rawMode
    ? null
    : validateHtmlFragment(element.description);
  const rawError = rawMode ? validateRawXml(element.rawXml) : null;

  const toggleRawMode = () => {
    if (rawMode) {
      if (
        !window.confirm(
          "Leave raw XML mode? The raw XML is discarded and the form fields (kept from before you switched) take over again.",
        )
      )
        return;
      set({ rawXml: null });
    } else {
      set({ rawXml: buildElementXml(element, collection) });
    }
  };

  const changeSupportsText = (text) => {
    setSupportsText(text);
    set({
      supports: text
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    });
  };

  const visibleFields = (spec.fields ?? []).filter(
    (field) => field.fixed == null && (!field.showIf || field.showIf(setters)),
  );

  return (
    <section className="fcb-panel min-w-0">
      <header className="fcb-panel-header">
        <div className="min-w-0">
          <h2 className="fcb-panel-title">
            {element.name || `New ${element.type}`}
          </h2>
          <p className="fcb-panel-subtitle">{element.type}</p>
        </div>
        <button
          type="button"
          className="fcb-button"
          onClick={toggleRawMode}
          disabled={disabled}
        >
          {rawMode ? "Back to form" : "Edit raw XML"}
        </button>
      </header>

      <div className="fcb-panel-body space-y-4">
        <section className="fcb-homebrew-form-section">
          <h3>Basics</h3>
          <label className="fcb-field-label">
            Name
            <input
              data-testid="hb-element-name"
              className="fcb-input normal-case"
              value={element.name}
              onChange={(e) => set({ name: e.target.value })}
              disabled={disabled || rawMode}
            />
          </label>
          <details className="fcb-homebrew-advanced">
            <summary>Advanced element settings</summary>
            <p className="fcb-homebrew-element-id">
              Element id: <code>{elementId}</code>
              {element.idLocked
                ? " (locked so existing characters keep using it)"
                : " (generated from the name and locked after the first load)"}
            </p>
            {!rawMode ? (
              <label className="fcb-field-label mt-3">
                Rules version override
                <select
                  data-testid="hb-element-ruleset"
                  className="fcb-select"
                  value={normalizeElementRuleset(element.ruleset)}
                  onChange={(e) => set({ ruleset: e.target.value })}
                  disabled={disabled}
                >
                  {ELEMENT_RULESET_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mt-3 text-xs normal-case tracking-normal text-[var(--fcb-text-faint)]">
                Rules-version overrides must be edited in raw XML while raw
                mode is active.
              </p>
            )}
          </details>
        </section>

        {rawMode && (
          <section className="fcb-homebrew-form-section">
            <h3>Advanced / raw XML</h3>
            <label className="fcb-field-label">
              Raw element XML
              <textarea
                rows={18}
                className="fcb-textarea normal-case font-mono text-xs"
                value={element.rawXml}
                onChange={(e) => set({ rawXml: e.target.value })}
                disabled={disabled}
                spellCheck={false}
              />
            </label>
            {rawError && <p className="fcb-alert">{rawError}</p>}
            <p className="text-xs text-[var(--fcb-text-faint)]">
              Advanced mode: this XML is emitted verbatim (selects,
              spellcasting, and anything the form does not cover). It is
              engine-validated when you load or update the collection — parse
              errors and missing setters come back as diagnostics.
            </p>
          </section>
        )}

        {!rawMode && (
          <>
            <section className="fcb-homebrew-form-section">
              <h3>Type-specific properties</h3>
              {spec.prerequisite && (
                <label className="fcb-field-label">
                  Prerequisite (optional)
                  <input
                    className="fcb-input normal-case"
                    value={element.prerequisite ?? ""}
                    onChange={(e) => set({ prerequisite: e.target.value })}
                    disabled={disabled}
                    placeholder="Strength 13 or higher"
                  />
                </label>
              )}

              <SupportsControl
                spec={spec.supports}
                element={element}
                supportsText={supportsText}
                onText={changeSupportsText}
                onSupports={(supports) => set({ supports })}
                disabled={disabled}
              />

              {visibleFields.length > 0 && (
                <div className="fcb-homebrew-field-grid">
                  {visibleFields.map((field) => (
                    <SetterField
                      key={field.key}
                      field={field}
                      value={setters[field.key] ?? ""}
                      onChange={(value) => setSetter(field.key, value)}
                      disabled={disabled}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="fcb-homebrew-form-section">
              <h3>Description and sheet text</h3>
              <label className="fcb-field-label">
                Description
                <textarea
                  rows={7}
                  className="fcb-textarea normal-case"
                  value={element.description}
                  onChange={(e) => set({ description: e.target.value })}
                  disabled={disabled}
                  placeholder={
                    "Plain text (blank line = new paragraph) or HTML: <p>, <ul><li>, <b>, <i>"
                  }
                />
              </label>
              {descriptionError && (
                <p className="fcb-alert">{descriptionError}</p>
              )}

              <label className="fcb-field-label">
                Sheet text (optional)
                <input
                  className="fcb-input normal-case"
                  value={element.sheetText}
                  onChange={(e) => set({ sheetText: e.target.value })}
                  disabled={disabled}
                  placeholder="Short text printed on the character sheet"
                />
              </label>
            </section>

            <section className="fcb-homebrew-form-section">
              <h3>Stat bonuses and grants</h3>
              <StatRows
                stats={element.stats ?? []}
                onChange={(stats) => set({ stats })}
                disabled={disabled}
              />
              <GrantRows
                grants={element.grants ?? []}
                onChange={(grants) => set({ grants })}
                disabled={disabled}
              />
            </section>
          </>
        )}
      </div>

      <datalist id="hb-stat-name-options">
        {STAT_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </section>
  );
}

function validateRawXml(rawXml) {
  const value = String(rawXml ?? "").trim();
  if (!value)
    return "Raw XML is empty — paste an <element> or switch back to the form.";
  const doc = new DOMParser().parseFromString(value, "application/xml");
  if (doc.querySelector("parsererror")) return "Raw XML is not well-formed.";
  if (doc.documentElement.tagName !== "element")
    return "Raw XML must be a single <element> node.";
  return null;
}

// One setter field, rendered from its spec entry.
function SetterField({ field, value, onChange, disabled }) {
  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 self-end pb-1 text-sm text-[var(--fcb-text-muted)]">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          disabled={disabled}
        />
        {field.label}
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="fcb-field-label">
        {field.label}
        <select
          className="fcb-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          {(field.options ?? []).map((option) => {
            const [optionValue, optionLabel] = optionPair(option);
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      </label>
    );
  }
  return (
    <label className="fcb-field-label">
      {field.label}
      <input
        type={field.kind === "number" ? "number" : "text"}
        className="fcb-input normal-case"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={field.placeholder}
      />
    </label>
  );
}

// The <supports> editor: free text, a single-category select (armor), or the structured
// weapon picker (category + properties; the damage-type id is derived at build time).
function SupportsControl({
  spec,
  element,
  supportsText,
  onText,
  onSupports,
  disabled,
}) {
  if (!spec) return null;
  const supports = element.supports ?? [];

  if (spec.mode === "text") {
    return (
      <label className="fcb-field-label">
        {spec.label}
        <input
          className="fcb-input normal-case"
          value={supportsText}
          onChange={(e) => onText(e.target.value)}
          disabled={disabled}
          placeholder={spec.placeholder}
        />
        {spec.hint && (
          <span className="text-xs normal-case tracking-normal text-[var(--fcb-text-faint)]">
            {spec.hint}
          </span>
        )}
      </label>
    );
  }

  if (spec.mode === "select") {
    return (
      <label className="fcb-field-label">
        {spec.label}
        <select
          className="fcb-select"
          value={supports[0] ?? ""}
          onChange={(e) => onSupports(e.target.value ? [e.target.value] : [])}
          disabled={disabled}
        >
          {(spec.options ?? ARMOR_CATEGORIES).map(
            ([optionValue, optionLabel]) => (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            ),
          )}
        </select>
      </label>
    );
  }

  // spec.mode === 'weapon'
  const category = supports.find((id) => WEAPON_CATEGORY_IDS.has(id)) ?? "";
  const properties = supports.filter((id) => !WEAPON_CATEGORY_IDS.has(id));
  return (
    <div className="space-y-2">
      <label className="fcb-field-label">
        Weapon Category
        <select
          className="fcb-select"
          value={category}
          onChange={(e) =>
            onSupports([e.target.value, ...properties].filter(Boolean))
          }
          disabled={disabled}
        >
          {WEAPON_CATEGORIES.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
      </label>
      <div>
        <p className="fcb-field-label">Properties</p>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {WEAPON_PROPERTIES.map(([id, label]) => (
            <label
              key={id}
              className="flex items-center gap-2 text-sm text-[var(--fcb-text-muted)]"
            >
              <input
                type="checkbox"
                checked={properties.includes(id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...properties, id]
                    : properties.filter((p) => p !== id);
                  onSupports([category, ...next].filter(Boolean));
                }}
                disabled={disabled}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// <stat name value/> rows: dropdown of common stat names (via datalist) with free-text override.
function StatRows({ stats, onChange, disabled }) {
  const update = (index, patch) =>
    onChange(
      stats.map((stat, i) => (i === index ? { ...stat, ...patch } : stat)),
    );
  return (
    <div>
      <p className="fcb-field-label">Stat bonuses</p>
      <div className="mt-1 space-y-2">
        {stats.map((stat, index) => (
          <div key={index} className="fcb-homebrew-stat-row">
            <label className="fcb-field-label">
              Stat name
              <input
                list="hb-stat-name-options"
                className="fcb-input normal-case"
                value={stat.name}
                onChange={(e) => update(index, { name: e.target.value })}
                disabled={disabled}
                placeholder="Strength, HP, AC or a skill"
              />
            </label>
            <label className="fcb-field-label">
              Bonus value
              <input
                type="number"
                className="fcb-input"
                value={stat.value}
                onChange={(e) => update(index, { value: e.target.value })}
                disabled={disabled}
                placeholder="+N"
              />
            </label>
            <button
              type="button"
              className="fcb-button fcb-homebrew-row-remove"
              onClick={() => onChange(stats.filter((_, i) => i !== index))}
              disabled={disabled}
              aria-label="Remove stat bonus"
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="fcb-button"
          onClick={() => onChange([...stats, { name: "", value: "" }])}
          disabled={disabled}
        >
          Add stat bonus
        </button>
      </div>
    </div>
  );
}

// <grant type id/> rows with a searchable element picker over the loaded content library.
function GrantRows({ grants, onChange, disabled }) {
  const update = (index, next) =>
    onChange(grants.map((grant, i) => (i === index ? next : grant)));
  return (
    <div>
      <p className="fcb-field-label">
        Grants (other elements this one gives)
      </p>
      <div className="mt-1 space-y-3">
        {grants.map((grant, index) => (
          <GrantRow
            key={index}
            grant={grant}
            disabled={disabled}
            onChange={(next) => update(index, next)}
            onRemove={() => onChange(grants.filter((_, i) => i !== index))}
          />
        ))}
        <button
          type="button"
          className="fcb-button"
          onClick={() =>
            onChange([...grants, { type: "Language", id: "", name: "" }])
          }
          disabled={disabled}
        >
          Add grant
        </button>
      </div>
    </div>
  );
}

function GrantRow({ grant, disabled, onChange, onRemove }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState(null);

  useEffect(() => {
    const query = search.trim();
    if (!query) return undefined;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      api.content
        .elements(
          { type: grant.type, search: query, take: 25 },
          { signal: controller.signal },
        )
        .then((page) => setResults(page.items ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [search, grant.type]);

  const changeSearch = (value) => {
    setSearch(value);
    if (!value.trim()) setResults(null);
  };

  const pick = (item) => {
    onChange({ ...grant, id: item.id, name: item.name });
    setSearch("");
    setResults(null);
  };

  return (
    <div className="rounded border border-[var(--fcb-border-soft)] p-2">
      <div className="fcb-homebrew-grant-fields">
        <label className="fcb-field-label">
          Granted element type
          <select
            className="fcb-select"
            value={grant.type}
            onChange={(e) =>
              onChange({ ...grant, type: e.target.value, id: "", name: "" })
            }
            disabled={disabled}
          >
            {GRANT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="fcb-field-label">
          Search loaded elements
          <input
            type="search"
            className="fcb-input normal-case"
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            disabled={disabled}
            placeholder={`Search ${grant.type}s by name`}
          />
        </label>
        <button
          type="button"
          className="fcb-button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove grant"
        >
          <Icon name="close" />
        </button>
      </div>
      {results && (
        <div className="mt-2 max-h-40 overflow-auto rounded border border-[var(--fcb-border-soft)]">
          {results.length === 0 && (
            <p className="p-2 text-xs text-[var(--fcb-text-faint)]">
              No matches in the loaded content.
            </p>
          )}
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="block w-full px-2 py-1.5 text-left text-sm hover:bg-[var(--fcb-surface-3)]"
              onClick={() => pick(item)}
            >
              {item.name}
              <span className="ml-2 text-xs text-[var(--fcb-text-faint)]">
                {item.source}
              </span>
            </button>
          ))}
        </div>
      )}
      <label className="fcb-field-label mt-2">
        Selected element ID
        <input
          className="fcb-input normal-case text-xs"
          value={grant.id}
          onChange={(e) =>
            onChange({ ...grant, id: e.target.value.trim(), name: "" })
          }
          disabled={disabled}
          placeholder="Pick from search above or paste an ID_…"
        />
      </label>
      <p className="mt-1 text-xs text-[var(--fcb-text-faint)]">
        {grant.id ? (
          <>
            Grants <strong>{grant.name || grant.id}</strong>
          </>
        ) : (
          "No element selected yet."
        )}
      </p>
    </div>
  );
}
