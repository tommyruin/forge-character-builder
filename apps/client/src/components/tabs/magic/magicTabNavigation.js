function usedChoices(rule) {
  return (rule.selectedElementIds ?? []).filter(Boolean).length;
}

export function hasIncompleteRequiredSpellChoices(spellRules) {
  return spellRules.some(
    (rule) =>
      !rule.isOptional && usedChoices(rule) < Math.max(0, rule.selectionCount),
  );
}

export function buildMagicTabs({
  spellRules = [],
  casters = [],
  hasCompanion = false,
}) {
  // `compactLabel` is the phone-width label, swapped in by the segmented strip
  // the same way the global tabs do it (see appNavigation.js). Three full
  // labels cannot share a 390px row without one of them painting outside its
  // own button, so each tab carries a short form that fits.
  const tabs = [];
  if (spellRules.length > 0) {
    tabs.push({
      key: 'choose',
      label: 'Choose spells',
      compactLabel: 'Choose',
      ariaLabel: 'Choose spells',
    });
  }

  const singleCaster = casters.length === 1;
  for (const caster of casters) {
    const action = caster.requiresPreparation ? 'Prepare' : 'Known';
    tabs.push({
      key: caster.identifier,
      label: singleCaster ? `${action} spells` : `${action}: ${caster.name}`,
      compactLabel: singleCaster ? action : `${action}: ${caster.name}`,
      ariaLabel: caster.requiresPreparation
        ? `Prepare ${caster.name} spells`
        : `Review ${caster.name} known spells`,
    });
  }

  if (hasCompanion) {
    tabs.push({
      key: 'companion',
      label: 'Familiar & Companion',
      compactLabel: 'Familiar',
      ariaLabel: 'Familiar and companion',
    });
  }

  return tabs;
}

export function resolveMagicTabKey({
  requestedKey,
  tabs = [],
  spellRules = [],
  casters = [],
}) {
  if (requestedKey && tabs.some((tab) => tab.key === requestedKey)) {
    return requestedKey;
  }

  if (
    tabs.some((tab) => tab.key === 'choose') &&
    hasIncompleteRequiredSpellChoices(spellRules)
  ) {
    return 'choose';
  }

  const firstCaster = casters.find((caster) =>
    tabs.some((tab) => tab.key === caster.identifier),
  );
  if (firstCaster) return firstCaster.identifier;
  if (tabs.some((tab) => tab.key === 'choose')) return 'choose';
  return tabs[0]?.key;
}
