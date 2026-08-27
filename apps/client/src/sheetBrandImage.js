// The host's sheet logo, as base64 image data for the PDF writer. The shell
// gives a URL (or a data: URL); it is fetched once per session and reused,
// and any failure simply leaves the templates' own die mark showing.
import { shell } from '@shell';

const BASE64_PREFIX = /^data:image\/(png|jpeg|jpg);base64,/i;

let pending;

/** The configured logo as base64, or "" when the host sets none or it cannot be read. */
export function loadSheetBrandImage(source = shell.sheet?.logo) {
  if (typeof source !== 'string' || source.trim() === '') return Promise.resolve('');
  const match = BASE64_PREFIX.exec(source);
  if (match) return Promise.resolve(source.slice(match[0].length));
  pending ??= (async () => {
    try {
      const response = await fetch(source);
      if (!response.ok) return '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      return btoa(binary);
    } catch {
      return '';
    }
  })();
  return pending;
}
