// Deterministic id generation for VTT documents. Deterministic (not random) so exporting the
// same character twice yields byte-identical files and snapshot tests are stable.

// FNV-1a 32-bit hash of a string.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A short base62 string derived from a seed, of the requested length. Uses a small LCG seeded
// by the hash so distinct seeds give distinct, well-spread ids without collisions in practice.
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function base62FromSeed(seed, length) {
  let state = fnv1a(seed) || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += ALPHANUM[state % ALPHANUM.length];
  }
  return out;
}

// Foundry embedded-document _id: 16-char alphanumeric.
export function foundryId(seed) {
  return base62FromSeed(`foundry:${seed}`, 16);
}

// Roll20 / VTTES repeating-row id: a Firebase-push-style id beginning with '-'.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
export function roll20RowId(seed) {
  let state = fnv1a(`roll20:${seed}`) || 1;
  let out = '-';
  for (let i = 0; i < 19; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += PUSH_CHARS[state % PUSH_CHARS.length];
  }
  return out;
}

// VTTES attribute id: a 20-char id from the same push alphabet (no leading '-').
export function roll20AttrId(seed) {
  let state = fnv1a(`attr:${seed}`) || 1;
  let out = '';
  for (let i = 0; i < 20; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += PUSH_CHARS[state % PUSH_CHARS.length];
  }
  return out;
}
