// The one-file pack share format.
//
// A shared pack is the same `<elements>` file the pack loads from (a Source element and the
// pack's elements), so a reader that knows only Aurora-style content files loads it as it is. One
// more child rides at the end of `<elements>`, in the builder's own namespace, holding the pack
// as the builder keeps it (drafts, details, ids). Other readers ignore a child they do not know;
// the builder reads it to open the pack editable on another device.
//
//   <fcb:pack xmlns:fcb="urn:forge-cb:pack:1" format="1" id="..." name="..." version="...">
//     <fcb:data>{ the pack as JSON, with & < > escaped }</fcb:data>
//   </fcb:pack>
//
// The pack id is what ties a later copy of the pack to the earlier one, and `version` says which of
// two copies is newer. Nothing device-specific travels: not whether the pack is loaded here, not
// the editor's remembered versions of its elements.

import { packVersion, portablePack } from './portablePack.js';
import { buildCollectionXml, escapeXml } from './xmlBuilder.js';

export { packVersion, portablePack };

export const PACK_FILE_NAMESPACE = 'urn:forge-cb:pack:1';
export const PACK_FILE_FORMAT = 1;

// A comment right after the XML declaration names the format, so a file can be recognised from
// its first few hundred bytes without reading a content file of several megabytes.
const HEAD_MARK = `<!-- Character Builder pack file (${PACK_FILE_NAMESPACE}) -->`;

/** Whether the start of a file says it is a pack file. */
export const hasPackFileHead = (head) => typeof head === 'string' && head.includes(HEAD_MARK);

/** Reads only the start of a file to tell a pack file from any other content file. */
export async function sniffPackFile(file) {
  if (!/\.xml$/i.test(file?.name ?? '')) return false;
  const head = typeof file.slice === 'function' ? file.slice(0, 600) : file;
  return hasPackFileHead(await head.text());
}

/** The share file for a pack: its loadable XML plus the builder's own record of it. */
export function buildPackFile(pack, { exportedAt = new Date() } = {}) {
  const portable = portablePack(pack);
  const attrs = [
    `xmlns:fcb="${PACK_FILE_NAMESPACE}"`,
    `format="${PACK_FILE_FORMAT}"`,
    `id="${escapeXml(portable.id)}"`,
    `name="${escapeXml(portable.name)}"`,
    ...(portable.author?.trim() ? [`author="${escapeXml(portable.author.trim())}"`] : []),
    `version="${portable.version}"`,
    `exported="${exportedAt.toISOString()}"`,
  ].join(' ');
  const carrier = [
    '  <!-- The fcb:pack block lets the Character Builder open this pack for editing. Other tools read the elements above and ignore it. -->',
    `  <fcb:pack ${attrs}>`,
    `    <fcb:data>${escapeText(JSON.stringify(portable))}</fcb:data>`,
    '  </fcb:pack>',
  ].join('\n');
  const xml = buildCollectionXml(pack).replace('\n<elements>', `\n${HEAD_MARK}\n<elements>`);
  const close = xml.lastIndexOf('</elements>');
  return `${xml.slice(0, close)}${carrier}\n${xml.slice(close)}`;
}

// Text, not an attribute: quotes stay as they are, so the JSON stays readable.
const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescapeXml = (text) =>
  text.replace(/&(lt|gt|amp|quot|apos);/g, (_, name) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[name]);

const CARRIER = /<fcb:pack\b([^>]*)>\s*<fcb:data>([\s\S]*?)<\/fcb:data>\s*<\/fcb:pack>/;

/** Whether a text is a pack file the builder wrote (a cheap check, before reading it). */
export function isPackFile(text) {
  return typeof text === 'string' && text.includes(PACK_FILE_NAMESPACE) && CARRIER.test(text);
}

function attribute(attrs, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? unescapeXml(match[1]) : '';
}

/**
 * Reads a pack file. `{ pack, manifest }` on success; `{ error }` when the text is a pack file that
 * cannot be read. A text that is not a pack file at all is `{ notPack: true }`.
 */
export function readPackFile(text) {
  const match = typeof text === 'string' ? CARRIER.exec(text) : null;
  if (!match || !match[1].includes(PACK_FILE_NAMESPACE)) return { notPack: true };
  const format = Number(attribute(match[1], 'format'));
  if (!Number.isInteger(format) || format < 1) return { error: 'This pack file does not say which format it uses.' };
  if (format > PACK_FILE_FORMAT) return { error: 'This pack file was made by a newer version of the builder. Update the builder to open it.' };
  let pack;
  try {
    pack = JSON.parse(unescapeXml(match[2]));
  } catch {
    return { error: 'The pack inside this file is damaged and could not be read.' };
  }
  if (!pack || typeof pack !== 'object' || typeof pack.id !== 'string' || pack.id === '' || typeof pack.name !== 'string' || !Array.isArray(pack.elements)) {
    return { error: 'The pack inside this file is missing its name, id or elements.' };
  }
  const elements = pack.elements
    .filter((element) => element && typeof element === 'object')
    .map((element) => ({ ...element, localId: element.localId || crypto.randomUUID() }));
  const portable = portablePack({ ...pack, elements });
  return {
    pack: portable,
    manifest: {
      id: portable.id,
      name: portable.name,
      author: portable.author ?? '',
      version: portable.version,
      exported: attribute(match[1], 'exported'),
      elementCount: elements.length,
    },
  };
}
