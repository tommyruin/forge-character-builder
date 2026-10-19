/**
 * Small helpers the compilers share for writing XML: escaping, plain text as
 * paragraphs, and attribute lists that leave out what is empty.
 */

export function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Plain text as `<p>` paragraphs; blank lines separate them. */
export function paragraphs(text: string): string {
  const value = text.trim();
  if (value === "") return "";
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeText(paragraph.replace(/\s*\n\s*/g, " ").trim())}</p>`)
    .join("");
}

export function attributes(pairs: ReadonlyArray<readonly [string, string | number | undefined]>): string {
  return pairs
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join("");
}
