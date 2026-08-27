import type { ElementLibrary } from "./library.js";

/**
 * Description reference expansion.
 *
 * Content descriptions reference other elements' descriptions instead of
 * repeating them: `<div element="ID_X" />` embeds the referenced element's
 * description under a small heading (the draconic ancestry options embed the
 * shared ancestry table this way), and `<p element="ID_X" />` embeds it as a
 * lead-in paragraph. Expansion is cycle-guarded; unknown ids expand to
 * nothing.
 */

const REFERENCE_PATTERN = /<(div|p)\s+element="(ID_[A-Za-z0-9_]+)"\s*\/>|<(div|p)\s+element="(ID_[A-Za-z0-9_]+)"\s*>\s*<\/(?:div|p)>/g;

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function expandDescriptionReferences(
  library: ElementLibrary,
  descriptionXml: string | undefined,
  seen?: ReadonlySet<string>,
): string {
  if (descriptionXml === undefined || descriptionXml === "" || !descriptionXml.includes("element=")) {
    return descriptionXml ?? "";
  }
  const guard = new Set(seen ?? []);
  return descriptionXml.replace(REFERENCE_PATTERN, (match, tagA, idA, tagB, idB) => {
    const tag = (tagA ?? tagB) as string;
    const id = (idA ?? idB) as string;
    if (guard.has(id)) return "";
    const referenced = library.byId.get(id);
    if (referenced === undefined) return "";
    const inner = expandDescriptionReferences(library, referenced.descriptionXml, new Set([...guard, id]));
    const name = escapeHtml(referenced.identity.name);
    if (tag === "p") {
      return `<p class="indent"><strong><em>${name}. </em></strong></p>${inner}`;
    }
    return `<h5>${name.toUpperCase()}</h5>${inner}`;
  });
}
