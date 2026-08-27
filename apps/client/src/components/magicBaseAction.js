export function resolveMagicBaseAction(result) {
  const options = result?.options ?? [];
  return {
    requiresSelection: options.length > 1,
    options,
    slot: result?.slot ?? null,
    baseElementId: options.length === 1 ? options[0].id : null,
    baseName: options.length === 1 ? options[0].name : null,
  };
}
