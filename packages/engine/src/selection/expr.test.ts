import { describe, expect, it } from "vitest";
import { evaluateRequirements, type RequirementContext } from "./expr.js";

function ctx(
  options: Partial<{
    ids: string[];
    ability: Record<string, number>;
    level: number;
  }> = {},
): RequirementContext {
  const ids = new Set(options.ids ?? []);
  return {
    hasElement: (id) => ids.has(id),
    ability: (name) => options.ability?.[name] ?? 0,
    level: options.level ?? 1,
  };
}

describe("requirement expression evaluator (corpus grammar)", () => {
  it("evaluates the defensive duelist truth table", () => {
    const expr = "([dex:13],!ID_WOTC_PHB24_FEAT_DEFENSIVE_DUELIST)||ID_WOTC_PHB_GRANTS_FEAT_UNLOCKER";
    expect(evaluateRequirements(expr, ctx({ ability: { dex: 14 } }))).toBe(true);
    expect(evaluateRequirements(expr, ctx({ ability: { dex: 8 } }))).toBe(false);
    expect(
      evaluateRequirements(expr, ctx({ ability: { dex: 14 }, ids: ["ID_WOTC_PHB24_FEAT_DEFENSIVE_DUELIST"] })),
    ).toBe(false);
    expect(
      evaluateRequirements(expr, ctx({ ability: { dex: 8 }, ids: ["ID_WOTC_PHB_GRANTS_FEAT_UNLOCKER"] })),
    ).toBe(true);
  });

  it("evaluates the ritual caster expression with nested or-groups", () => {
    const expr =
      "(([int:13]||[wis:13]),!ID_WOTC_PHB24_FEAT_RITUAL_CASTER)||ID_WOTC_PHB_GRANTS_FEAT_UNLOCKER";
    expect(evaluateRequirements(expr, ctx({ ability: { int: 13 } }))).toBe(true);
    expect(evaluateRequirements(expr, ctx({ ability: { wis: 16 } }))).toBe(true);
    expect(evaluateRequirements(expr, ctx({ ability: { int: 12, wis: 12 } }))).toBe(false);
  });

  it("treats element-id atoms as hasElement checks", () => {
    expect(evaluateRequirements("ID_A", ctx({ ids: ["ID_A"] }))).toBe(true);
    expect(evaluateRequirements("ID_A", ctx())).toBe(false);
    expect(evaluateRequirements("ID_A||ID_B", ctx({ ids: ["ID_B"] }))).toBe(true);
    expect(evaluateRequirements("ID_A,ID_B", ctx({ ids: ["ID_A", "ID_B"] }))).toBe(true);
    expect(evaluateRequirements("ID_A,ID_B", ctx({ ids: ["ID_A"] }))).toBe(false);
    expect(evaluateRequirements("ID_A&&ID_B", ctx({ ids: ["ID_A", "ID_B"] }))).toBe(true);
    expect(evaluateRequirements("ID_A&&ID_B", ctx({ ids: ["ID_B"] }))).toBe(false);
  });

  it("evaluates negated groups and negated atoms", () => {
    expect(evaluateRequirements("!ID_A", ctx())).toBe(true);
    expect(evaluateRequirements("!ID_A", ctx({ ids: ["ID_A"] }))).toBe(false);
    expect(evaluateRequirements("!(ID_A||ID_B)", ctx())).toBe(true);
    expect(evaluateRequirements("!(ID_A||ID_B)", ctx({ ids: ["ID_A"] }))).toBe(false);
    expect(evaluateRequirements("!(ID_A||ID_B)", ctx({ ids: ["ID_B"] }))).toBe(false);
    expect(evaluateRequirements("ID_A,!ID_B", ctx({ ids: ["ID_A"] }))).toBe(true);
    expect(evaluateRequirements("ID_A,!ID_B", ctx({ ids: ["ID_A", "ID_B"] }))).toBe(false);
  });

  it("evaluates the gnome stat requirements expression", () => {
    const expr = "!(ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI||ID_INTERNAL_GRANTS_BACKGROUND_ASI)";
    expect(evaluateRequirements(expr, ctx())).toBe(true);
    expect(evaluateRequirements(expr, ctx({ ids: ["ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI"] }))).toBe(false);
    expect(evaluateRequirements(expr, ctx({ ids: ["ID_INTERNAL_GRANTS_BACKGROUND_ASI"] }))).toBe(false);
  });

  it("evaluates the custom race language select requirements", () => {
    const expr = "ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE,!ID_INTERNAL_GRANTS_BACKGROUND_ASI";
    expect(evaluateRequirements(expr, ctx({ ids: ["ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE"] }))).toBe(true);
    expect(
      evaluateRequirements(
        expr,
        ctx({ ids: ["ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE", "ID_INTERNAL_GRANTS_BACKGROUND_ASI"] }),
      ),
    ).toBe(false);
  });

  it("evaluates level checks", () => {
    expect(evaluateRequirements("[level:4]", ctx({ level: 4 }))).toBe(true);
    expect(evaluateRequirements("[level:4]", ctx({ level: 1 }))).toBe(false);
    expect(evaluateRequirements("level:4", ctx({ level: 6 }))).toBe(true);
  });

  it("treats unresolvable bracket atoms as false", () => {
    expect(evaluateRequirements("[level:barbarian:10]", ctx())).toBe(false);
    expect(evaluateRequirements("[innate speed:climb:1]", ctx())).toBe(false);
    expect(evaluateRequirements("[charisma:max:extra:9]", ctx({ ability: { charisma: 18 } }))).toBe(false);
  });

  it("handles whitespace around operators", () => {
    expect(evaluateRequirements("[level:4], ID_WOTC_SCOC_FEAT_STRIXHAVEN_INITIATE", ctx({ level: 4, ids: ["ID_WOTC_SCOC_FEAT_STRIXHAVEN_INITIATE"] }))).toBe(true);
    expect(evaluateRequirements("ID_A || ID_B", ctx({ ids: ["ID_B"] }))).toBe(true);
  });

  // The corpus writes a handful of requirement expressions with a single `|`
  // (and the same happens for `&`). The reference engine normalised those to
  // `||` / `&&` before parsing, so they have to mean or/and here too --- a
  // parse failure would silently read as false and turn the rule off.
  it("reads a lone | as or and a lone & as and", () => {
    expect(evaluateRequirements("ID_A|ID_B", ctx({ ids: ["ID_B"] }))).toBe(true);
    expect(evaluateRequirements("ID_A|ID_B", ctx())).toBe(false);
    expect(evaluateRequirements("ID_A&ID_B", ctx({ ids: ["ID_A", "ID_B"] }))).toBe(true);
    expect(evaluateRequirements("ID_A&ID_B", ctx({ ids: ["ID_A"] }))).toBe(false);
  });

  it("evaluates the lone-pipe expressions the corpus actually ships", () => {
    // Tiefling Infernal (players-handbook/races/race-tiefling.xml).
    const infernal = "!(ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE|ID_INTERNAL_LANGUAGE_REPLACEMENT_TIEFLING_INFERNAL)";
    expect(evaluateRequirements(infernal, ctx())).toBe(true);
    expect(evaluateRequirements(infernal, ctx({ ids: ["ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE"] }))).toBe(false);
    expect(
      evaluateRequirements(infernal, ctx({ ids: ["ID_INTERNAL_LANGUAGE_REPLACEMENT_TIEFLING_INFERNAL"] })),
    ).toBe(false);

    // Eldritch Adept's non-warlock invocation list (tashas.../feats.xml).
    const adept = "!(ID_WOTC_PHB_CLASS_WARLOCK|ID_WOTC_PHB_MULTICLASS_WARLOCK)";
    expect(evaluateRequirements(adept, ctx())).toBe(true);
    expect(evaluateRequirements(adept, ctx({ ids: ["ID_WOTC_PHB_CLASS_WARLOCK"] }))).toBe(false);
    expect(evaluateRequirements(adept, ctx({ ids: ["ID_WOTC_PHB_MULTICLASS_WARLOCK"] }))).toBe(false);

    // An evil-alignment gate (dnd-beyond/monstrous-compendium-2.xml).
    const evil = "ID_ALIGNMENT_LAWFUL_EVIL|ID_ALIGNMENT_NEUTRAL_EVIL|ID_ALIGNMENT_CHAOTIC_EVIL";
    expect(evaluateRequirements(evil, ctx({ ids: ["ID_ALIGNMENT_NEUTRAL_EVIL"] }))).toBe(true);
    expect(evaluateRequirements(evil, ctx({ ids: ["ID_ALIGNMENT_LAWFUL_GOOD"] }))).toBe(false);
  });

  it("returns true for empty or absent requirements", () => {
    expect(evaluateRequirements(undefined, ctx())).toBe(true);
    expect(evaluateRequirements("", ctx())).toBe(true);
    expect(evaluateRequirements("   ", ctx())).toBe(true);
  });

  it("never throws on malformed input; malformed means false", () => {
    for (const bad of ["(", "ID_A||", "!", "!!!", "[dex:13", "ID_A,,ID_B", "&&ID_A", "((ID_A)", "ID_A||ID_B||", "[dex:13]||", "ID_A,", "()"]) {
      expect(() => evaluateRequirements(bad, ctx({ ability: { dex: 15 } }))).not.toThrow();
      expect(evaluateRequirements(bad, ctx({ ability: { dex: 15 } }))).toBe(false);
    }
  });
});
