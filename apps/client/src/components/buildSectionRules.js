/**
 * Build section routing. The engine flags every selection rule that resolves
 * to an ability score bump (`allocatesAbilityScores`), wherever the content
 * authored the choice — class, background, feat or racial trait. Those rules
 * belong with the Ability Scores editor; everything else keeps its authored
 * type's section. The ASI-or-feat "Improvement Option" is authored as a Class
 * Feature but belongs with feats (picking ASI surfaces the allocation under
 * Ability Scores; picking Feat surfaces the feat here).
 */

export function isImprovementOptionRule(rule) {
  return rule?.type === 'Class Feature' && /^Improvement Option\b/.test(rule?.name ?? '');
}

export function buildSectionRules(section, rules) {
  const allocatesAbilityScores = (rule) => rule?.allocatesAbilityScores === true;
  if (section.key === 'abilities') {
    return rules.filter(
      (rule) =>
        allocatesAbilityScores(rule) || section.types.includes(rule.type),
    );
  }
  if (section.key === 'feats') {
    return rules.filter(
      (rule) =>
        !allocatesAbilityScores(rule) &&
        (section.types.includes(rule.type) || isImprovementOptionRule(rule)),
    );
  }
  if (section.key === 'class') {
    return rules.filter(
      (rule) =>
        !allocatesAbilityScores(rule) &&
        section.types.includes(rule.type) &&
        !isImprovementOptionRule(rule),
    );
  }
  return rules.filter(
    (rule) =>
      !allocatesAbilityScores(rule) && section.types.includes(rule.type),
  );
}
