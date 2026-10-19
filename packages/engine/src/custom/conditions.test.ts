/**
 * Requirement and filter trees compile to the engine's own expression
 * syntaxes, and the expressions mean what the tree says when evaluated.
 */

import { describe, expect, it } from "vitest";
import { evaluateRequirements, requirementsSyntaxError } from "../selection/expr.js";
import { evaluateSupportsExpression } from "../selection/selection.js";
import {
  compileFilter,
  compileRequirements,
  describeFilter,
  describeRequirements,
  filterIssues,
  requirementIssues,
} from "./conditions.js";
import type { FilterNode, RequirementNode } from "./schema.js";

const context = (have: string[], scores: Record<string, number> = {}, level = 5) => ({
  hasElement: (id: string) => have.includes(id),
  hasType: (type: string) => have.includes(`type:${type.toLowerCase()}`),
  ability: (name: string) => scores[name] ?? Number.NaN,
  level,
  classLevel: (name: string) => (name === "wizard" ? 3 : 0),
});

describe("requirement trees", () => {
  it("compiles every leaf kind to an atom the engine evaluates", () => {
    const tree: RequirementNode = {
      kind: "group",
      op: "all",
      items: [
        { kind: "element", id: "ID_TEST_A" },
        { kind: "element", id: "ID_TEST_B", negate: true },
        { kind: "ability", ability: "strength", min: 13 },
        { kind: "level", min: 5 },
        { kind: "classLevel", className: "Wizard", min: 3 },
        { kind: "elementType", type: "Class" },
        { kind: "stat", key: "speed:misc", min: 10 },
      ],
    };
    const expression = compileRequirements(tree);
    expect(expression).toBe("ID_TEST_A,!ID_TEST_B,[str:13],[level:5],[level:wizard:3],[type:Class],[speed:misc:10]");
    expect(requirementsSyntaxError(expression)).toBeNull();
    const ok = context(["ID_TEST_A", "type:class"], { str: 14, "speed:misc": 10 });
    expect(evaluateRequirements(expression, ok)).toBe(true);
    expect(evaluateRequirements(expression, context(["ID_TEST_A", "ID_TEST_B", "type:class"], { str: 14, "speed:misc": 10 }))).toBe(false);
    expect(evaluateRequirements(expression, context(["ID_TEST_A", "type:class"], { str: 12, "speed:misc": 10 }))).toBe(false);
  });

  it("keeps ANY OF, ALL OF and NONE OF distinct when nested", () => {
    const tree: RequirementNode = {
      kind: "group",
      op: "all",
      items: [
        { kind: "group", op: "any", items: [{ kind: "element", id: "ID_TEST_A" }, { kind: "element", id: "ID_TEST_B" }] },
        { kind: "group", op: "none", items: [{ kind: "element", id: "ID_TEST_C" }, { kind: "element", id: "ID_TEST_D" }] },
      ],
    };
    const expression = compileRequirements(tree);
    expect(expression).toBe("(ID_TEST_A||ID_TEST_B),!(ID_TEST_C||ID_TEST_D)");
    expect(evaluateRequirements(expression, context(["ID_TEST_B"]))).toBe(true);
    expect(evaluateRequirements(expression, context([]))).toBe(false);
    expect(evaluateRequirements(expression, context(["ID_TEST_A", "ID_TEST_D"]))).toBe(false);
  });

  it("returns no expression for no tree", () => {
    expect(compileRequirements(undefined)).toBe("");
  });

  it("names the field of every malformed node", () => {
    const issues = requirementIssues({
      kind: "group",
      op: "all",
      items: [{ kind: "ability", ability: "luck", min: 99 }, { kind: "group", op: "any", items: [] }, { kind: "element", id: "nope" }],
    });
    expect(issues.map((issue) => issue.path)).toEqual(["items[0].ability", "items[0].min", "items[1].items", "items[2].id"]);
  });

  it("refuses a tree nested past the limit", () => {
    let node: unknown = { kind: "level", min: 1 };
    for (let i = 0; i < 12; i++) node = { kind: "group", op: "all", items: [node] };
    expect(requirementIssues(node).some((issue) => /deeper/.test(issue.message))).toBe(true);
  });

  it("reads the tree back as plain language", () => {
    const text = describeRequirements({
      kind: "group",
      op: "all",
      items: [
        { kind: "ability", ability: "wisdom", min: 13 },
        { kind: "element", id: "ID_TEST_A", label: "Ember Ward" },
        { kind: "group", op: "none", items: [{ kind: "level", min: 9 }] },
      ],
    });
    expect(text).toBe("Wisdom 13 or higher; Has Ember Ward; None of: Character level 9 or higher");
  });
});

describe("filter trees", () => {
  const tags = (...list: string[]) => new Set(list);

  it("compiles ALL OF and ANY OF over tags, levels, schools and ids", () => {
    const tree: FilterNode = {
      kind: "group",
      op: "all",
      items: [
        { kind: "tag", value: "Wizard" },
        { kind: "group", op: "any", items: [{ kind: "school", value: "Evocation" }, { kind: "level", value: 0 }] },
        { kind: "id", value: "ID_TEST_X" },
      ],
    };
    const expression = compileFilter(tree);
    expect(expression).toBe("Wizard,(Evocation||0),ID_TEST_X");
    expect(evaluateSupportsExpression(expression, tags("Wizard", "0", "ID_TEST_X"))).toBe(true);
    expect(evaluateSupportsExpression(expression, tags("Wizard", "Abjuration", "ID_TEST_X"))).toBe(false);
  });

  it("pushes NONE OF to the leaves, since the expression only negates single tags", () => {
    const none: FilterNode = {
      kind: "group",
      op: "none",
      items: [{ kind: "tag", value: "Ritual" }, { kind: "group", op: "all", items: [{ kind: "tag", value: "A" }, { kind: "tag", value: "B" }] }],
    };
    const expression = compileFilter(none);
    expect(expression).toBe("!Ritual,(!A||!B)");
    expect(evaluateSupportsExpression(expression, tags("A"))).toBe(true);
    expect(evaluateSupportsExpression(expression, tags("A", "B"))).toBe(false);
    expect(evaluateSupportsExpression(expression, tags("Ritual"))).toBe(false);
  });

  it("rejects tags the supports tokenizer would split", () => {
    expect(filterIssues({ kind: "tag", value: "a,b" })).toHaveLength(1);
    expect(filterIssues({ kind: "tag", value: "!a" })).toHaveLength(1);
    expect(filterIssues({ kind: "level", value: 12 })).toHaveLength(1);
    expect(filterIssues({ kind: "tag", value: "Origin" })).toEqual([]);
  });

  it("describes a filter for the form", () => {
    expect(
      describeFilter({ kind: "group", op: "any", items: [{ kind: "level", value: 0 }, { kind: "tag", value: "Wizard" }] }),
    ).toBe("any of cantrips, Wizard");
  });
});
