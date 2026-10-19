/**
 * The builder's own block in a character file.
 *
 * ```xml
 * <forge-builder version="1">
 *   <custom-pack schema="1"><![CDATA[ … ]]></custom-pack>
 *   <spell-aliases schema="1"><![CDATA[ … ]]></spell-aliases>
 * </forge-builder>
 * ```
 *
 * `forge-builder` is the single element name the builder reserves at the root
 * of a character file; every builder-only datum (the custom pack, spell
 * aliases, later resource trackers) is a child of it rather than a new root
 * element. A file that uses none of them has no block and keeps its original
 * bytes: adding the first child inserts the block before the root's closing
 * tag, and removing the last one removes the block again.
 */

import { child, childElements, textContent, type Dnd5eDocument, type Dnd5eNode } from "./document.js";

export const BUILDER_BLOCK = "forge-builder";
export const BUILDER_BLOCK_VERSION = 1;

/** The node of a child of the builder block, or null. */
export function builderChild(document: Dnd5eDocument, name: string): Dnd5eNode | null {
  const block = child(document.root.node, BUILDER_BLOCK);
  return block === null ? null : child(block, name);
}

/** The decoded text of a builder child; null when the block or the child is absent. */
export function builderChildText(document: Dnd5eDocument, name: string): string | null {
  const node = builderChild(document, name);
  return node === null ? null : textContent(node);
}

/** CDATA cannot contain its own terminator; split it across two sections. */
export function cdata(text: string): string {
  return `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

interface RawEditLike {
  start: number;
  end: number;
  replacement: string;
}

/** Removes a node together with the whitespace that indents it. */
function removeNode(raw: string, node: Dnd5eNode): RawEditLike {
  let start = node.start;
  while (start > 0 && (raw[start - 1] === "\t" || raw[start - 1] === " ")) start--;
  if (start > 0 && raw[start - 1] === "\n") start--;
  if (start > 0 && raw[start - 1] === "\r") start--;
  return { start, end: node.end, replacement: "" };
}

/**
 * Byte edits that make the builder block carry `element` as its child `name`
 * (the child's whole serialized element), or carry none when `element` is
 * null. Other children of the block are never touched.
 */
export function planBuilderChildEdits(document: Dnd5eDocument, name: string, element: string | null): RawEditLike[] {
  const block = child(document.root.node, BUILDER_BLOCK);
  const existing = block === null ? null : child(block, name);
  const eol = document.raw.includes("\r\n") ? "\r\n" : "\n";
  if (element === null) {
    if (block === null || existing === null) return [];
    const others = childElements(block).filter((node) => node !== existing);
    return [removeNode(document.raw, others.length === 0 ? block : existing)];
  }
  if (block !== null && existing !== null) {
    return [{ start: existing.start, end: existing.end, replacement: element }];
  }
  if (block !== null) {
    const close = block.closeStart;
    if (close === null) {
      return [{
        start: block.start,
        end: block.end,
        replacement: `<${BUILDER_BLOCK} version="${BUILDER_BLOCK_VERSION}">${eol}\t\t${element}${eol}\t</${BUILDER_BLOCK}>`,
      }];
    }
    return [{ start: close, end: close, replacement: `\t${element}${eol}\t` }];
  }
  const root = document.root.node;
  const close = root.closeStart ?? root.end;
  const created = `\t<${BUILDER_BLOCK} version="${BUILDER_BLOCK_VERSION}">${eol}\t\t${element}${eol}\t</${BUILDER_BLOCK}>${eol}`;
  return [{ start: close, end: close, replacement: created }];
}
