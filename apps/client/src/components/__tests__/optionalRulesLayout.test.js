import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RuleList,
  RulesetSelector,
} from "../tabs/manage/OptionalRulesPanel.jsx";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manage = read("../tabs/ManageTab.jsx");
const build = read("../tabs/BuildTab.jsx");
const magic = read("../tabs/MagicTab.jsx");
const levelUp = read("../LevelUpFlyout.jsx");
const transport = read("../../transport/engineTransport.ts");

const renderRule = ({ eligible, enabled }) =>
  renderToStaticMarkup(
    createElement(RuleList, {
      title: "Optional Class Features",
      rules: [
        {
          key: "item:test-rule",
          elementId: "ID_TEST_OPTIONAL_RULE",
          name: "Test optional feature",
          source: "Test source",
          eligible,
          enabled,
          unavailableReason: eligible ? null : "Does not apply.",
        },
      ],
      busy: false,
      pendingKey: null,
      onToggle: () => {},
      onInspect: () => {},
    }),
  );

describe("shared optional rules hub", () => {
  it("adds Optional Rules immediately after Character in Manage", () => {
    expect(manage).toMatch(
      /\['character', 'Character'\],\s*\['optional-rules', 'Optional rules'\]/,
    );
    expect(manage).toContain("<OptionalRulesPanel");
  });

  it("offers a per-character all, 2014, or 2024 rules version", () => {
    const markup = renderToStaticMarkup(
      createElement(RulesetSelector, {
        ruleset: {
          mode: "2014",
          availableModes: ["all", "2014", "2024"],
          rules2014Count: 120,
          rules2024Count: 90,
          sharedCount: 30,
        },
        busy: false,
        onChange: () => {},
      }),
    );

    expect(markup).toContain("Rules version");
    expect(markup).toContain("All content");
    expect(markup).toMatch(/checked="" value="2014"/);
    expect(markup).toContain('value="2024"');
    expect(markup).toContain(
      "Show only the selected rules version while building this character. The Content library stays unfiltered.",
    );
    expect(markup).toContain(
      "All content allows for all versions to be used simultaneously. Unmarked homebrew stays available in every mode.",
    );
  });

  it("shows an accessible loading state while changing rules version", () => {
    const markup = renderToStaticMarkup(
      createElement(RulesetSelector, {
        ruleset: {
          mode: "2014",
          availableModes: ["all", "2014", "2024"],
          rules2014Count: 120,
          rules2024Count: 90,
          sharedCount: 30,
        },
        busy: true,
        switching: true,
        onChange: () => {},
      }),
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Changing rules version…");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("keeps grant actions but removes duplicate rule toggles", () => {
    expect(build).toContain("Feat");
    expect(build).not.toContain("Feats (optional rule)");
    expect(magic).not.toContain('data-testid="spell-points-toggle"');
  });

  it("does not silently force multiclassing on while loading characters", () => {
    expect(transport).not.toContain("ensureMulticlassEnabled");
    expect(transport).not.toContain("normalizeAndPersist");
  });

  it("distinguishes a disabled multiclass rule from unmet prerequisites", () => {
    expect(levelUp).toContain("progression.multiclassRuleEnabled");
    expect(levelUp).toContain(
      "Enable Multiclassing under Manage / Optional rules",
    );
  });

  it("renders eligible, unavailable, and stale-enabled controls truthfully", () => {
    const eligible = renderRule({ eligible: true, enabled: false });
    expect(eligible).toContain('type="checkbox"');
    expect(eligible).not.toContain('disabled=""');
    expect(eligible).not.toContain('checked=""');
    expect(eligible).toContain("<span>Disabled</span>");

    const unavailable = renderRule({ eligible: false, enabled: false });
    expect(unavailable).toContain('type="checkbox"');
    expect(unavailable).toContain('disabled=""');
    expect(unavailable).not.toContain('checked=""');
    expect(unavailable).toContain("Does not apply.");

    const staleEnabled = renderRule({ eligible: false, enabled: true });
    expect(staleEnabled).toContain('type="checkbox"');
    expect(staleEnabled).not.toContain('disabled=""');
    expect(staleEnabled).toContain('checked=""');
    expect(staleEnabled).toContain("<span>Enabled</span>");
  });
});
