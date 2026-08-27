// The sheet typefaces as browser fonts, so the settings panel can show each
// face in itself. One @font-face rule per face is injected on first use,
// pointing at the same files the sheet writer embeds.
import { SHEET_FONT_FACES } from '@forge-cb/engine/sheet-contract';

const FAMILY_PREFIX = 'fcb-sheet-face-';
let injected = false;

function fontsBase() {
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}sheets/fonts/`;
}

export function ensureSheetFontFaces(target = globalThis.document) {
  if (injected || !target?.head) return;
  const rules = Object.entries(SHEET_FONT_FACES)
    .filter(([, face]) => face.files)
    .map(([name, face]) =>
      `@font-face{font-family:"${FAMILY_PREFIX}${name}";src:url("${fontsBase()}${face.files.regular}") format("truetype");font-display:swap;}`,
    );
  const style = target.createElement('style');
  style.setAttribute('data-fcb-sheet-fonts', '');
  style.textContent = rules.join('\n');
  target.head.appendChild(style);
  injected = true;
}

/** The CSS font stack that shows `name` in its own face. */
export function sheetFaceFontFamily(name) {
  const face = SHEET_FONT_FACES[name];
  if (!face) return undefined;
  if (!face.files) return 'Helvetica, Arial, sans-serif';
  return `"${FAMILY_PREFIX}${name}", ${['spectral', 'almendra'].includes(name) ? 'serif' : 'sans-serif'}`;
}
