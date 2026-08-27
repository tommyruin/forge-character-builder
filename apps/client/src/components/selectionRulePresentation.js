function normalizeLabel(value) {
  return (value ?? "").trim().toLowerCase();
}

export function suppressesIncompleteSelectionReminder(
  rule,
  { sectionKey } = {},
) {
  return Boolean(
    rule.isOptional ||
      rule.hasAvailableOptions === false ||
      sectionKey === "other",
  );
}

export function hasIncompleteRequiredSelection(rules, options = {}) {
  return rules.some(
    (rule) =>
      !suppressesIncompleteSelectionReminder(rule, options) &&
      !rule.hasSelection,
  );
}

export function shouldShowSelectionOptionsLoading({ isMulti, options, error }) {
  return !isMulti && options == null && !error;
}

export function getSelectionRulePresentation(
  rule,
  { sectionLabel, showRuleType = true } = {},
) {
  const count = Math.max(1, rule.selectionCount ?? 1);
  const isMulti = count > 1;
  const title = rule.name || rule.type || "Choice";
  const duplicatesSection =
    normalizeLabel(title) === normalizeLabel(sectionLabel) &&
    normalizeLabel(rule.type) === normalizeLabel(sectionLabel);
  const displayTitle = duplicatesSection ? "Choose one" : title;
  const includeRuleType =
    showRuleType &&
    rule.type &&
    !duplicatesSection &&
    normalizeLabel(rule.type) !== normalizeLabel(displayTitle);

  return {
    count,
    isMulti,
    displayTitle,
    // "Choose one" is an instruction standing in for a name the surrounding
    // section already shows, not a label for the rule. Callers that can show
    // the answer instead should drop it once there is one.
    isPlaceholderTitle: duplicatesSection,
    metaParts: [
      ...(includeRuleType ? [rule.type] : []),
      ...(rule.requiredLevel > 1 ? [`Level ${rule.requiredLevel}`] : []),
      ...(rule.isOptional ? ["Optional"] : []),
      ...(isMulti ? [`Pick ${count}`] : []),
    ],
  };
}
