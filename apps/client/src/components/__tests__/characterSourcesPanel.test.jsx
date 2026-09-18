import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  formatSourceReleaseDate,
  getNewlyDisabledOverrideSources,
  getSourceGroupState,
  getToggleableSourceIds,
  getVisibleSourceGroups,
} from "../tabs/manage/characterSources.js";
import {
  OverrideDisableDialog,
  SourceActionsFooter,
  SourceGroupList,
} from "../tabs/manage/CharacterSourcesPanel.jsx";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const panelSource = readFileSync(
  new URL("../tabs/manage/CharacterSourcesPanel.jsx", import.meta.url),
  "utf8",
);

const groups = [
  {
    name: "Wizards of the Coast",
    canToggle: true,
    sources: [
      {
        id: "core",
        name: "Core Rules",
        author: "Community",
        canToggle: false,
        isPlaytest: false,
        isIncomplete: true,
        information:
          "This core source contains content limited to the System Reference Document.",
        hasElements: true,
      },
      {
        id: "supplement",
        name: "Supplement Rules",
        author: "Community",
        canToggle: true,
        isPlaytest: false,
        hasElements: true,
      },
    ],
  },
  {
    name: "Playtest",
    canToggle: true,
    sources: [
      {
        id: "playtest",
        name: "Unearthed Arcana",
        author: "Wizards",
        canToggle: true,
        isPlaytest: true,
        hasElements: false,
      },
    ],
  },
];

describe("character sources panel", () => {
  it("formats compact release dates for people and hides unknown dates", () => {
    expect(formatSourceReleaseDate("20210518")).toBe("18 May 2021");
    expect(formatSourceReleaseDate("00000000")).toBe("");
    expect(formatSourceReleaseDate("not-a-date")).toBe("not-a-date");
  });

  it("keeps required sources enabled while reporting a mixed group", () => {
    expect(getSourceGroupState(groups[0], ["supplement"])).toEqual({
      enabledCount: 1,
      totalCount: 2,
      allEnabled: false,
      noneEnabled: false,
      mixed: true,
    });
  });

  it("filters source groups by name, author, or ID", () => {
    expect(getVisibleSourceGroups(groups, "wizards")).toHaveLength(1);
    expect(getVisibleSourceGroups(groups, "playtest")[0].sources).toHaveLength(
      1,
    );
    expect(getVisibleSourceGroups(groups, "not-found")).toEqual([]);
  });

  it("renders individual toggles, required state, and playtest metadata", () => {
    const markup = renderToStaticMarkup(
      createElement(SourceGroupList, {
        groups,
        restrictedSourceIds: ["supplement"],
        search: "",
        disabled: false,
        onToggleGroup: vi.fn(),
        onToggleSource: vi.fn(),
      }),
    );
    expect(markup).toContain("Core Rules");
    expect(markup).toContain("Supplement Rules");
    expect(markup).toContain("Required");
    expect(markup).toContain("Playtest");
    expect(markup).toContain('aria-checked="mixed"');
  });

  it("renders a minimize control for every source group", () => {
    const markup = renderToStaticMarkup(
      createElement(SourceGroupList, {
        groups,
        restrictedSourceIds: [],
        search: "",
        disabled: false,
        onToggleGroup: vi.fn(),
        onToggleSource: vi.fn(),
      }),
    );
    expect(markup).toContain(
      'aria-label="Minimize Wizards of the Coast sources"',
    );
    expect(markup).toContain(
      'aria-controls="source-group-wizards-of-the-coast-content"',
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Minimize Playtest sources"');
  });

  it("keeps source actions in a sticky footer", () => {
    const markup = renderToStaticMarkup(
      createElement(SourceActionsFooter, {
        busy: false,
        saving: false,
        savingDefault: false,
        dirty: true,
        onApply: vi.fn(),
        onDiscard: vi.fn(),
        onSaveDefault: vi.fn(),
      }),
    );
    expect(markup).toContain('data-testid="source-actions-footer"');
    expect(markup).toContain("Apply changes");
    expect(markup).toContain("Discard");
    expect(markup).toContain("Save as default for new characters");
    expect(markup).toContain('aria-label="Apply changes"');
    expect(markup).toContain('aria-label="Save as default for new characters"');
    expect(markup).toContain("fcb-source-action-label--compact");
    expect(markup).toContain("Save default");
    expect(css).toMatch(
      /\.fcb-source-actions-footer\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/,
    );
  });

  it("gives the source catalogue its own scroll area above the footer", () => {
    expect(css).toMatch(
      /\.fcb-manage-content\s*>\s*\.fcb-manage-single-primary\.fcb-manage-sources-primary\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(css).toMatch(
      /\.fcb-sources-panel-top\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/,
    );
    expect(css).toMatch(
      /\.fcb-source-groups-scroll\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
  });

  it("keeps sticky source controls in their own card above the catalogue", () => {
    expect(panelSource).toMatch(
      /<section className="fcb-panel fcb-sources-panel-top">[\s\S]*?<\/section>\s*<section className="fcb-panel fcb-sources-panel">/,
    );
    expect(css).toMatch(
      /\.fcb-character-sources-panel\s*\{[\s\S]*?gap:\s*16px;/,
    );
    expect(css).toMatch(
      /\.fcb-source-groups-scroll\s*\{[\s\S]*?padding:\s*16px;/,
    );
  });

  it("navigates Manage sections through the shared builder-layout rail", () => {
    const manageSource = readFileSync(
      new URL("../tabs/ManageTab.jsx", import.meta.url),
      "utf8",
    );
    expect(manageSource).toContain("<SectionNav");
    // The rail goes through the shell's `rail` slot, which is what derives
    // the builder-layout class; Manage no longer spells it out itself.
    expect(manageSource).toContain("<WorkspaceTabLayout");
    expect(manageSource).toMatch(/rail=\{\s*<SectionNav/);
    expect(manageSource).not.toContain("fcb-builder-layout");
    expect(manageSource).not.toContain("fcb-has-subtabs");
    // The rail collapses through the generic builder-layout rules, so no
    // Manage-specific sub-tab sizing may remain.
    expect(css).not.toMatch(/\.fcb-manage-layout\.fcb-has-subtabs/);
    expect(css).not.toMatch(/\.fcb-manage-layout\s*>\s*\.fcb-subtab-bar/);
  });

  it("uses compact source cards for narrow or short viewports", () => {
    expect(panelSource).toContain("fcb-sources-intro");
    expect(panelSource).toContain("fcb-sources-count");
    expect(panelSource).toContain("fcb-sources-controls-row");
    expect(panelSource).toContain("fcb-sources-search-label");
    expect(panelSource).toContain("fcb-source-actions-help");
    expect(css).toMatch(
      /@media \(max-width:\s*820px\),\s*\(max-height:\s*700px\)\s*\{[\s\S]*?\.fcb-sources-header,[\s\S]*?\.fcb-sources-intro,[\s\S]*?\.fcb-source-actions-help,[\s\S]*?\{[\s\S]*?display:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*820px\),\s*\(max-height:\s*700px\)\s*\{[\s\S]*?\.fcb-character-sources-panel[\s\S]*?gap:\s*8px;[\s\S]*?\.fcb-source-groups-scroll[\s\S]*?padding:\s*8px;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*460px\)\s*\{[\s\S]*?\.fcb-sources-controls-row[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
  });

  it("presents unavailable saved restrictions as information, not an error", () => {
    // The notice is informational; the red alert style would read as a failure.
    expect(panelSource).not.toContain("fcb-alert fcb-sources-unavailable");
    expect(panelSource).toContain("fcb-sources-unavailable");
    expect(css).toMatch(
      /\.fcb-sources-unavailable\s*\{[^}]*border:[^}]*color-mix/s,
    );
    // Plain-language explanation of what the state means.
    expect(panelSource).toContain("imported on this device");
    expect(panelSource).toContain("re-apply automatically");
  });

  it("offers a route to forget the stale restrictions", () => {
    expect(panelSource).toContain("const forgetUnavailable");
    expect(panelSource).toMatch(
      /forgetUnavailable[\s\S]{0,400}unavailableRestrictedSourceIds/,
    );
    expect(panelSource).toContain('data-testid="forget-unavailable-sources"');
    expect(panelSource).toMatch(/Forget (them|these)/);
  });

  it("explains built-in book stubs with an (i) note and stays quiet elsewhere", () => {
    const markup = renderToStaticMarkup(
      createElement(SourceGroupList, {
        groups,
        restrictedSourceIds: [],
        search: "",
        disabled: false,
        onToggleGroup: vi.fn(),
        onToggleSource: vi.fn(),
      }),
    );
    expect(markup).toContain("About the built-in Wizards of the Coast sources");
    expect(markup).toContain("Built in: Core Rules.");
    expect(markup).toContain("System Reference Document 5.1");
    expect(markup).not.toContain("Additional Content");
    expect(markup).not.toContain("About the built-in Playtest sources");
    expect(css).toContain(".fcb-source-group-info-summary");
  });

  it("disables every switchable source and leaves required ones alone", () => {
    expect(getToggleableSourceIds(groups)).toEqual(["supplement", "playtest"]);
    expect(getToggleableSourceIds(undefined)).toEqual([]);
    expect(panelSource).toContain("Disable all");
  });

  it("detects only newly disabled sources that replace bundled content", () => {
    const overrideGroups = [
      {
        name: "Wizards of the Coast",
        canToggle: true,
        sources: [
          {
            id: "phb24",
            name: "Player’s Handbook (2024)",
            canToggle: true,
            overridesBundledCore: true,
          },
          { id: "supplement", name: "Supplement Rules", canToggle: true },
        ],
      },
    ];
    expect(
      getNewlyDisabledOverrideSources(overrideGroups, [], ["phb24"]),
    ).toHaveLength(1);
    expect(
      getNewlyDisabledOverrideSources(overrideGroups, ["phb24"], [
        "phb24",
        "supplement",
      ]),
    ).toHaveLength(0);
    expect(
      getNewlyDisabledOverrideSources(overrideGroups, [], ["supplement"]),
    ).toHaveLength(0);
    expect(getNewlyDisabledOverrideSources(undefined, [], ["phb24"])).toEqual(
      [],
    );
  });

  it("badges a source whose imported files replace bundled content", () => {
    const overrideGroups = [
      {
        name: "Wizards of the Coast",
        canToggle: true,
        sources: [
          {
            id: "phb24",
            name: "Player’s Handbook (2024)",
            author: "Wizards of the Coast",
            canToggle: true,
            isPlaytest: false,
            overridesBundledCore: true,
            hasElements: true,
          },
          {
            id: "supplement",
            name: "Supplement Rules",
            author: "Community",
            canToggle: true,
            isPlaytest: false,
            hasElements: true,
          },
        ],
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(SourceGroupList, {
        groups: overrideGroups,
        restrictedSourceIds: [],
        search: "",
        disabled: false,
        onToggleGroup: vi.fn(),
        onToggleSource: vi.fn(),
      }),
    );
    expect(markup).toContain("Replaces bundled content");
    expect(markup).toContain("fcb-badge-override");
    // The built-in note survives an import and says the imported copy
    // replaces the built-in one in place.
    expect(markup).toContain("Imported: Player’s Handbook (2024).");
    expect(markup).toContain("replaces the built-in one in place");
    expect(css).toMatch(
      /\.fcb-badge-override\s*\{[^}]*var\(--fcb-warning/s,
    );
  });

  it("asks yes or no before disabling a source that replaces bundled content", () => {
    const markup = renderToStaticMarkup(
      createElement(OverrideDisableDialog, {
        pending: {
          nextIds: ["phb24"],
          sources: [{ id: "phb24", name: "Player’s Handbook (2024)" }],
        },
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );
    expect(markup).toContain("Disable bundled content?");
    expect(markup).toContain("Player’s Handbook (2024)");
    expect(markup).toContain("its imported files replace");
    expect(markup).toContain("No, keep enabled");
    expect(markup).toContain("Yes, disable");

    const plural = renderToStaticMarkup(
      createElement(OverrideDisableDialog, {
        pending: {
          nextIds: ["a", "b"],
          sources: [
            { id: "a", name: "Book A" },
            { id: "b", name: "Book B" },
          ],
        },
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );
    expect(plural).toContain("their imported files replace");

    // Every draft change goes through the confirmation.
    expect(panelSource).toContain("getNewlyDisabledOverrideSources");
    expect(panelSource).toMatch(/requestDraftChange\(/);
    expect(panelSource).toMatch(/<OverrideDisableDialog/);
  });
});
