/**
 * Ingest-time check that every reference a rule makes resolves to an element.
 *
 * The engine drops a grant whose target is absent without a word
 * (`resolveGrant` returns undefined and the caller moves on), so a homebrew
 * pack that grants a spell the library lacks looks fine and does nothing. This
 * reports each such reference once, against the file that wrote it.
 *
 * What counts as present is what the engine itself resolves: the library, plus
 * the engine-internal elements it synthesizes (sizes, the multiclass marker,
 * the base character grants) and elements defined inline inside another.
 */

import type { ElementLibrary, ContentDiagnostic } from "./library.js";
import { appendedRuleFile } from "./library.js";
import type { ParsedElement, Rule } from "./parser.js";
import { ENGINE_INTERNAL_ELEMENTS } from "../selection/selection.js";

/** Elements the engine generates; they have no authored file to blame. */
function authoredFile(element: ParsedElement): string | undefined {
  const declared = element.declaredBy.split("#")[0] ?? "";
  if (declared === "" || declared.startsWith("system/generated")) return undefined;
  return declared;
}

function inlineIds(element: ParsedElement, into: Set<string>): void {
  for (const child of element.children) {
    if (child.identity.id !== "") into.add(child.identity.id);
    inlineIds(child, into);
  }
}

function describe(element: ParsedElement): string {
  return `${element.identity.name} (${element.identity.id})`;
}

/**
 * The findings for the whole library, or for `only` when a caller checks a
 * handful of entries (a character's own pack) without scanning every element.
 * Inline elements are collected from the entries checked.
 */
export function missingGrantDiagnostics(
  library: ElementLibrary,
  only?: readonly ParsedElement[],
  options: {
    /** Elements that count as present though the library does not hold them yet: a pack checked before it is loaded. */
    extra?: readonly ParsedElement[];
    /** A file whose library copies do not count: the pack being checked replaces them. */
    excludeFile?: string;
  } = {},
): ContentDiagnostic[] {
  const extra = options.extra ?? [];
  const defined = (id: string): boolean => {
    const element = library.byId.get(id);
    return element !== undefined && element.declaredBy !== options.excludeFile;
  };
  const checked = only ?? [...library.byId.values()];
  const inline = new Set<string>();
  for (const element of checked) inlineIds(element, inline);
  for (const element of extra) {
    if (element.identity.id !== "") inline.add(element.identity.id);
    inlineIds(element, inline);
  }
  const present = (id: string): boolean =>
    defined(id) || ENGINE_INTERNAL_ELEMENTS.has(id) || inline.has(id);

  const out: ContentDiagnostic[] = [];
  const reported = new Set<string>();
  const report = (
    element: ParsedElement,
    rule: Rule | undefined,
    role: string,
    missingId: string,
    missingType?: string,
  ): void => {
    const file = (rule === undefined ? undefined : appendedRuleFile(rule)) ?? authoredFile(element);
    if (file === undefined) return;
    const key = `${file}\u0000${element.identity.id}\u0000${role}\u0000${missingId}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push({
      kind: "missing-grant",
      file,
      message: `${describe(element)} ${role} ${missingId}, which no loaded content defines`,
      detail: "the reference is skipped until a pack that defines it is loaded",
      elementId: element.identity.id,
      elementName: element.identity.name,
      missingId,
      ...(missingType === undefined || missingType === "" ? {} : { missingType }),
    });
  };

  const scan = (element: ParsedElement): void => {
    for (const rule of element.rules) {
      if (rule.kind === "grant") {
        const id = rule.id?.trim() ?? "";
        if (id !== "") {
          if (!present(id)) report(element, rule, "grants", id, rule.type);
        } else if (rule.type !== undefined && rule.name !== undefined) {
          const found =
            (library.byType.get(rule.type) ?? []).some(
              (candidate) => candidate.identity.name === rule.name && candidate.declaredBy !== options.excludeFile,
            ) ||
            extra.some((candidate) => candidate.identity.type === rule.type && candidate.identity.name === rule.name);
          if (!found) report(element, rule, "grants", `${rule.type} "${rule.name}"`, rule.type);
        }
      } else if (rule.kind === "select") {
        const fallback = rule.default?.trim() ?? "";
        if (fallback !== "" && !present(fallback)) report(element, rule, "defaults a choice to", fallback, rule.type);
        for (const item of rule.items ?? []) {
          // Items with text are an inline list of options; only a bare id is a reference.
          if (item.text.trim() === "" && item.id.startsWith("ID_") && !present(item.id)) {
            report(element, rule, "offers", item.id, rule.type);
          }
        }
      }
    }
    for (const child of element.children) scan(child);
  };
  for (const element of checked) scan(element);
  return out;
}
