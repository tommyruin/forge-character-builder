// The source a user reads for an entry. "Internal" is the content's name for the rules the builder
// ships for its own bookkeeping (levels, base grants, expertise options); it is not a book, so it is
// shown as nothing, or as `fallback` where a heading cannot be empty.
export const isInternalSource = (source) => /^internal$/i.test(String(source ?? '').trim());

export const sourceLabel = (source, fallback = '') => {
  if (source == null || String(source).trim() === '') return '';
  return isInternalSource(source) ? fallback : source;
};
