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

/**
 * The label a base option shows in the picker. Two editions' "Shield" are two
 * options with one name, so a name that more than one option carries is
 * followed by its source.
 */
export function baseOptionLabel(option, options) {
  const shared = options.filter((other) => other.name === option.name).length > 1;
  return shared && option.source ? `${option.name} (${option.source})` : option.name;
}
