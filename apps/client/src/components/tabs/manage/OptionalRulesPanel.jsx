import { useCallback, useEffect, useState } from "react";
import { api } from "../../../api";
import { useWorkspace } from "../../WorkspaceContext";
import DescriptionPanel from "../../DescriptionPanel";
import useMobileDescriptionNavigation from "../../../hooks/useMobileDescriptionNavigation";
import {
  InformationButton,
  InspectableItemButton,
} from "../../InspectableItemControls";

export function RuleList({
  title,
  rules,
  busy,
  pendingKey,
  onToggle,
  onInspect,
}) {
  if (!rules.length) return null;
  return (
    <section className="fcb-panel">
      <header className="fcb-panel-header">
        <div>
          <h2 className="fcb-panel-title">{title}</h2>
          <p className="fcb-panel-subtitle">
            Changes are saved to this character only.
          </p>
        </div>
      </header>
      <div className="fcb-panel-body space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.key}
            className="fcb-card flex flex-wrap items-center gap-3 p-3"
          >
            <InformationButton
              elementId={rule.elementId}
              label={rule.name}
              onInspect={onInspect}
            />
            <InspectableItemButton
              elementId={rule.elementId}
              onInspect={onInspect}
              className="min-w-0 flex-1 text-left"
            >
              <div className="font-semibold">{rule.name}</div>
              <div className="fcb-muted-copy text-xs">
                {rule.source}
                {rule.unavailableReason ? ` · ${rule.unavailableReason}` : ""}
              </div>
            </InspectableItemButton>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={
                  busy ||
                  pendingKey === rule.key ||
                  (!rule.eligible && !rule.enabled)
                }
                onChange={() => onToggle(rule)}
              />
              <span>{rule.enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}

const RULESET_LABELS = {
  all: "All content",
  2014: "2014",
  2024: "2024",
};

export function RulesetSelector({ ruleset, busy, switching, onChange }) {
  if (!ruleset) return null;
  const selectedCount =
    ruleset.mode === "2014"
      ? ruleset.rules2014Count
      : ruleset.mode === "2024"
        ? ruleset.rules2024Count
        : null;

  return (
    <section
      className="fcb-panel"
      aria-labelledby="ruleset-title"
      aria-busy={switching}
    >
      <header className="fcb-panel-header">
        <div>
          <h2 id="ruleset-title" className="fcb-panel-title">
            Rules version
          </h2>
          <p className="fcb-panel-subtitle">
            Show only the selected rules version while building this character.
            The Content library stays unfiltered.
          </p>
        </div>
      </header>
      <div className="fcb-panel-body space-y-3">
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">
            Dungeons & Dragons rules version
          </legend>
          {ruleset.availableModes.map((mode) => (
            <label
              key={mode}
              className={`fcb-card flex cursor-pointer items-center gap-2 p-3 ${
                ruleset.mode === mode ? "border-[var(--fcb-accent)]" : ""
              }`}
            >
              <input
                type="radio"
                name="ruleset-mode"
                value={mode}
                checked={ruleset.mode === mode}
                disabled={busy || switching}
                onChange={() => onChange(mode)}
              />
              <span className="font-semibold">{RULESET_LABELS[mode]}</span>
            </label>
          ))}
        </fieldset>
        {switching && (
          <p
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--fcb-accent)]"
            role="status"
            aria-live="polite"
          >
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
              aria-hidden="true"
            />
            Changing rules version…
          </p>
        )}
        <p className="fcb-muted-copy text-xs">
          All content allows for all versions to be used simultaneously.
          Unmarked homebrew stays available in every mode.
        </p>
        {selectedCount === 0 && (
          <p className="fcb-alert" role="status">
            This character still uses {RULESET_LABELS[ruleset.mode]} mode, but
            no matching content is currently loaded. Add that content or choose
            another mode to recover.
          </p>
        )}
      </div>
    </section>
  );
}

function RulesetChangeSummary({ result }) {
  if (!result) return null;
  const rows = [
    ["Repaired automatically", result.repaired],
    ["Needs a new choice", result.unresolved],
  ].filter(([, items]) => items?.length);
  if (!rows.length) {
    return (
      <p className="fcb-alert" role="status">
        Rules version changed. No active choices needed repair.
      </p>
    );
  }
  return (
    <section className="fcb-alert space-y-3" aria-live="polite">
      <h3 className="font-semibold">Rules version changed</h3>
      {rows.map(([title, items]) => (
        <div key={title}>
          <h4 className="text-sm font-semibold">{title}</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {items.map((item) => (
              <li key={`${title}:${item.ruleName}:${item.previousElementId}`}>
                {item.ruleName}: {item.previousElementName}
                {item.newElementName ? ` → ${item.newElementName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {result.unresolved?.length > 0 && (
        <p className="text-xs">
          Unresolved choices were also added to Content changes so they can be
          reviewed later.
        </p>
      )}
    </section>
  );
}

export default function OptionalRulesPanel() {
  const { id, busy, run, mutationTick, registerDetailsScroll } = useWorkspace();
  const [rules, setRules] = useState(null);
  const [ruleset, setRuleset] = useState(null);
  const [rulesetResult, setRulesetResult] = useState(null);
  const [error, setError] = useState(null);
  const [pendingKey, setPendingKey] = useState(null);
  const [switchingRuleset, setSwitchingRuleset] = useState(false);
  const [inspected, setInspected] = useState(null);
  const { inspect: inspectItem, descriptionPanelProps } =
    useMobileDescriptionNavigation({
      onInspect: setInspected,
      registerDetailsScroll,
    });

  const refresh = useCallback(() => {
    return Promise.all([
      api.characters.optionalRules(id),
      api.characters.ruleset(id),
    ])
      .then(([nextRules, nextRuleset]) => {
        setRules(nextRules);
        setRuleset(nextRuleset);
        setError(null);
      })
      .catch((caught) => setError(caught.message));
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh, mutationTick]);

  const toggle = async (rule) => {
    setPendingKey(rule.key);
    try {
      await run(() =>
        api.characters.setCharacterControl(id, rule.key, !rule.enabled),
      );
      await refresh();
    } catch {
      // The workspace banner owns mutation errors; the unchanged row remains truthful.
    } finally {
      setPendingKey(null);
    }
  };

  const changeRuleset = async (mode) => {
    if (!ruleset || mode === ruleset.mode) return;
    const incompatible =
      mode === "2014"
        ? ruleset.incompatibleWith2014
        : mode === "2024"
          ? ruleset.incompatibleWith2024
          : [];
    const preview = incompatible?.length
      ? `\n\nActive choices to check:\n${incompatible
          .map((item) => `• ${item.ruleName}: ${item.previousElementName}`)
          .join("\n")}`
      : "";
    const confirmed = window.confirm(
      `Switch this character to ${RULESET_LABELS[mode]}? ` +
        "Exact 2014/2024 equivalents will be repaired automatically. " +
        "Choices without one exact match will be removed and listed for review." +
        preview,
    );
    if (!confirmed) return;
    setRulesetResult(null);
    setSwitchingRuleset(true);
    try {
      await new Promise((resolve) => {
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => resolve());
          return;
        }
        window.setTimeout(resolve, 0);
      });
      const result = await run(() => api.characters.setRuleset(id, mode));
      setRulesetResult(result);
      await refresh();
    } catch {
      // The workspace banner owns mutation errors and the saved mode is unchanged.
    } finally {
      setSwitchingRuleset(false);
    }
  };

  const options = rules?.filter((rule) => rule.kind === "option") ?? [];
  const classFeatures =
    rules?.filter((rule) => rule.kind === "optional-class-feature") ?? [];

  return (
    <div className="fcb-two-panel-grid">
      <div className="space-y-4">
        {error && <p className="fcb-alert">{error}</p>}
        <RulesetSelector
          ruleset={ruleset}
          busy={busy}
          switching={switchingRuleset}
          onChange={changeRuleset}
        />
        <RulesetChangeSummary result={rulesetResult} />
        {!rules && !error && (
          <p className="fcb-empty-copy">Loading rules…</p>
        )}
        <RuleList
          title="Rules"
          rules={options}
          busy={busy}
          pendingKey={pendingKey}
          onToggle={toggle}
          onInspect={inspectItem}
        />
        <RuleList
          title="Optional Class Features"
          rules={classFeatures}
          busy={busy}
          pendingKey={pendingKey}
          onToggle={toggle}
          onInspect={inspectItem}
        />
        {rules && options.length === 0 && classFeatures.length === 0 && (
          <p className="fcb-empty-copy">No optional rules are loaded.</p>
        )}
      </div>
      <DescriptionPanel
        {...descriptionPanelProps}
        elementId={inspected}
        placeholder="Select a rule to read its description."
        returnLabel="Back to optional rules"
        detailsLabel="Optional rule details"
      />
    </div>
  );
}
