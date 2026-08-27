// Live sheet generation occupies the same single-worker queue as character edits. Preserve a
// user's explicit choice, while keeping new workspaces responsive by default.
export function splitViewPreference(storedValue) {
  return storedValue === '1';
}
