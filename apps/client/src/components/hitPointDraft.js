export function parseHitPointDraft(draft, maximum) {
  const value = Number(draft);
  if (
    !String(draft).trim() ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    return {
      error: `Enter a whole number from 1 to ${maximum}.`,
    };
  }
  return { value };
}

export async function commitHitPointDraft({
  draft,
  maximum,
  savedValue,
  classId,
  classLevel,
  setDraft,
  onSave,
  onValidationError,
}) {
  const parsed = parseHitPointDraft(draft, maximum);
  if (parsed.error) {
    setDraft(String(savedValue));
    onValidationError(parsed.error);
    return false;
  }

  onValidationError(null);
  if (parsed.value === savedValue) return true;

  const saved = await onSave(classId, classLevel, parsed.value);
  if (saved === false) setDraft(String(savedValue));
  return saved !== false;
}
