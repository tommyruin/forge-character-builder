/**
 * A loaded element written back out as `<element>` XML, so a pack can change a
 * book element (same id) or reflavour it (new name and text, same rules)
 * starting from an exact copy.
 *
 * A copy is only made when nothing is lost: an element with nested elements, a
 * class's multiclass block, a spellcasting block or a pack's contents carries
 * structure this writer does not reproduce, and is refused with the reason
 * instead of copied badly.
 */

import type { ParsedElement, ParsedSheetEntry, Setter } from "../content/parser.js";
import { escapeAttribute, escapeText } from "./compile.js";

export interface SerializeOptions {
  /** The id to write; defaults to the element's own, which a same-id override keeps. */
  id?: string;
  name?: string;
  source?: string;
  /** Replacement description, as inner XML (`<p>…</p>`). */
  descriptionXml?: string;
}

export interface SerializedElement {
  xml: string | null;
  /** Why no copy was made. */
  reason?: string;
}

function attrs(pairs: ReadonlyArray<readonly [string, string | undefined]>): string {
  return pairs
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value!)}"`)
    .join("");
}

function setterXml(setter: Setter): string {
  const extra = Object.entries(setter.attrs ?? {}).map(([name, value]) => [name, value] as const);
  return `<set${attrs([["name", setter.name], ...extra])}>${escapeText(setter.value)}</set>`;
}

function sheetXml(sheet: ParsedSheetEntry): string {
  const open = `<sheet${attrs([
    ["display", sheet.display === undefined ? undefined : String(sheet.display)],
    ["action", sheet.action],
    ["usage", sheet.usage],
    ["alt", sheet.alt],
    ["name", sheet.name],
  ])}>`;
  const descriptions = sheet.descriptions.map(
    (description) =>
      `<description${attrs([
        ["level", description.level === undefined ? undefined : String(description.level)],
        ["usage", description.usage],
        ["action", description.action],
      ])}>${description.descriptionXml}</description>`,
  );
  return `${open}${descriptions.join("")}</sheet>`;
}

function unsupported(element: ParsedElement): string | undefined {
  if (element.children.length > 0) return "it holds nested elements";
  if (element.multiclass !== undefined) return "it is a class with a multiclass block";
  if (element.spellcasting !== undefined) return "it defines spellcasting";
  if (element.extract !== undefined || element.extras !== undefined) return "it is a pack with contents";
  return undefined;
}

/** The element as XML with the options applied, or the reason it cannot be copied. */
export function serializeElement(element: ParsedElement, options: SerializeOptions = {}): SerializedElement {
  const reason = unsupported(element);
  if (reason !== undefined) return { xml: null, reason };
  const children: string[] = [];
  if (element.supports.length > 0) children.push(`<supports>${escapeText(element.supports.join(", "))}</supports>`);
  if (element.prerequisite !== undefined) children.push(`<prerequisite>${escapeText(element.prerequisite)}</prerequisite>`);
  if (element.requirements !== undefined) children.push(`<requirements>${escapeText(element.requirements)}</requirements>`);
  if (element.compendiumHidden) children.push('<compendium display="false" />');
  children.push(`<description>${options.descriptionXml ?? element.descriptionXml ?? ""}</description>`);
  for (const sheet of element.sheets) children.push(sheetXml(sheet));
  if (element.setters.length > 0) children.push(`<setters>${element.setters.map(setterXml).join("")}</setters>`);
  if (element.rulesXml !== undefined && element.rulesXml.trim() !== "") children.push(`<rules>${element.rulesXml}</rules>`);
  const open = `<element${attrs([
    ["name", options.name ?? element.identity.name],
    ["type", element.identity.type],
    ["source", options.source ?? element.identity.source],
    ["id", options.id ?? element.identity.id],
  ])}>`;
  return { xml: [open, ...children.map((line) => `  ${line}`), "</element>"].join("\n") };
}
