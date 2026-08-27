import { humanizeElementIdentifier } from './requirementPresentation';

export function selectedElementLabel({
  elementId,
  slotIndex,
  options,
  selectedElementNames,
}) {
  const currentOption = options?.find((option) => option.id === elementId);
  return (
    currentOption?.name ||
    selectedElementNames?.[slotIndex] ||
    humanizeElementIdentifier(elementId)
  );
}
