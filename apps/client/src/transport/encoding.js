// Byte and ordering helpers shared by the snapshot, content-pack and
// library-digest code paths. They are part of how digests are computed, so
// every caller must use the same definitions.

export const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Code-unit ordering, independent of locale. */
export function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
