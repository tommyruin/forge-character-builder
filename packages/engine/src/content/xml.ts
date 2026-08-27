/**
 * Minimal XML tokenizer for corpus files.
 *
 * Hand-rolled (no dependency) for byte fidelity: description/rules blocks are
 * kept as RAW source slices so nothing is lost or re-encoded. Handles the
 * constructs present in the corpus: elements, attributes (single/double
 * quotes), comments, CDATA, processing instructions, text, entities (kept
 * verbatim in raw text; attribute values are entity-decoded for the small
 * set of entities the corpus uses).
 */

export interface XmlNode {
  name: string;
  /** Decoded attribute values. */
  attrs: Record<string, string>;
  /** Child nodes in document order (text/comments/cdata included as RawNode). */
  children: XmlChild[];
}

export type XmlChild =
  | { kind: "element"; node: XmlNode }
  | { kind: "raw"; raw: string; cdata?: boolean };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? match;
  });
}

function parseAttrs(source: string, start: number, end: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source.slice(start, end))) !== null) {
    const name = match[1]!;
    const value = (match[2] ?? match[3] ?? "")!;
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/**
 * Parse one XML document into a tree. Raw text, comments, and CDATA are
 * captured verbatim between element nodes so callers can re-serialize blocks
 * byte-exactly.
 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [] };
  let pos = 0;

  function parseInto(parent: XmlNode): void {
    let textStart = pos;
    const flushText = (until: number) => {
      const raw = source.slice(textStart, until);
      // Whitespace-only runs are kept when they separate sibling elements:
      // dropping them fuses words across inline markup ("</em> <em>" would
      // re-serialize with no space). Leading indentation before the first
      // child is still discarded so pretty-printed structure stays out of the
      // tree.
      if (raw.trim() !== "" || (/[ \t\r\n]/.test(raw) && parent.children.length > 0)) {
        parent.children.push({ kind: "raw", raw });
      }
      textStart = pos;
    };

    while (pos < source.length) {
      const lt = source.indexOf("<", pos);
      if (lt < 0) break;

      if (source.startsWith("<!--", lt)) {
        flushText(lt);
        const end = source.indexOf("-->", lt + 4);
        pos = end < 0 ? source.length : end + 3;
        parent.children.push({ kind: "raw", raw: source.slice(lt, pos) });
        textStart = pos;
        continue;
      }
      if (source.startsWith("<![CDATA[", lt)) {
        flushText(lt);
        const end = source.indexOf("]]>", lt + 9);
        pos = end < 0 ? source.length : end + 3;
        parent.children.push({ kind: "raw", raw: source.slice(lt, pos), cdata: true });
        textStart = pos;
        continue;
      }
      if (source.startsWith("<?", lt)) {
        flushText(lt);
        const end = source.indexOf("?>", lt + 2);
        pos = end < 0 ? source.length : end + 2;
        parent.children.push({ kind: "raw", raw: source.slice(lt, pos) });
        textStart = pos;
        continue;
      }
      if (source.startsWith("</", lt)) {
        flushText(lt);
        const gt = source.indexOf(">", lt + 2);
        pos = gt < 0 ? source.length : gt + 1;
        return; // close tag consumed; pop back to the caller's level
      }

      // opening tag
      const tagEnd = findTagEnd(source, lt);
      const inner = source.slice(lt + 1, tagEnd);
      const selfClosing = inner.endsWith("/");
      const nameEnd = inner.search(/[\s/>]/);
      const name = inner.slice(0, nameEnd < 0 ? inner.length : nameEnd);
      const attrsStart = nameEnd < 0 ? inner.length : nameEnd + 1;
      const attrsEnd = selfClosing ? inner.length - 1 : inner.length;
      const node: XmlNode = { name, attrs: parseAttrs(inner, attrsStart, attrsEnd), children: [] };
      flushText(lt);
      parent.children.push({ kind: "element", node });
      pos = tagEnd + 1;
      textStart = pos;

      if (!selfClosing && !VOID_TAGS.has(name)) {
        parseInto(node); // consumes through this node's close tag
        textStart = pos;
      }
    }
  }

  parseInto(root);
  return root;
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return source.length - 1;
}

// Only HTML voids that actually appear unclosed in description markup. The
// content grammar uses <source>, <link>-like names as ordinary paired elements; listing
// them here made their close tags terminate the ENCLOSING element early,
// silently dropping everything after them in that element.
const VOID_TAGS = new Set(["br", "hr", "img", "wbr"]);

/** Direct child elements with an optional name filter. */
export function childElements(node: XmlNode, name?: string): XmlNode[] {
  return node.children
    .filter((child): child is { kind: "element"; node: XmlNode } => child.kind === "element")
    .map((child) => child.node)
    .filter((child) => name === undefined || child.name === name);
}

function encodeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Re-serialize a node tree (attribute order preserved; not byte-identical to source). */
export function serializeXml(node: XmlNode): string {
  if (node.name === "#document") {
    return node.children.map((child) => (child.kind === "raw" ? child.raw : serializeXml(child.node))).join("");
  }
  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${encodeAttr(value)}"`)
    .join("");
  const inner = node.children
    .map((child) => (child.kind === "raw" ? child.raw : serializeXml(child.node)))
    .join("");
  // Empty non-void elements serialize as an explicit open/close pair: this
  // output is later fed to HTML parsers, where "<div/>" is an OPEN tag that
  // swallows every following sibling into a phantom element.
  if (inner === "") {
    return VOID_TAGS.has(node.name)
      ? `<${node.name}${attrs} />`
      : `<${node.name}${attrs}></${node.name}>`;
  }
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/**
 * Decoded text content of a node (CDATA kept literal, entities decoded,
 * surrounding whitespace trimmed).
 */
export function textContent(node: XmlNode): string {
  let out = "";
  for (const child of node.children) {
    if (child.kind === "raw") out += child.cdata ? child.raw : decodeEntities(child.raw);
    else out += textContent(child.node);
  }
  return out.trim();
}
