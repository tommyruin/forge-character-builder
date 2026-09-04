import { useEffect } from 'react';
import useSheetTemplateSetting from './useSheetTemplateSetting.js';

/**
 * Keeps the sheet layout on the edition the open character is built against,
 * until the reader picks a layout themselves. A character on the "all" ruleset
 * names no edition, so it keeps whatever set is current.
 */
export default function useFollowRulesetTemplate(detail) {
  const mode = detail?.rulesetMode;
  const { hasExplicitChoice, followTemplateSet } = useSheetTemplateSetting();
  useEffect(() => {
    if (hasExplicitChoice || (mode !== '2014' && mode !== '2024')) return;
    followTemplateSet(mode);
  }, [followTemplateSet, hasExplicitChoice, mode]);
}
