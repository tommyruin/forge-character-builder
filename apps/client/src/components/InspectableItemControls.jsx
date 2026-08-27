import Icon from './Icon';

export function InspectableItemButton({
  elementId,
  onInspect,
  onActivate,
  activationDisabled = false,
  children,
  type = 'button',
  ...buttonProps
}) {
  const handleClick = () => {
    if (elementId && onInspect) onInspect(elementId);
    if (!activationDisabled && onActivate) onActivate();
  };

  return (
    <button type={type} {...buttonProps} onClick={handleClick}>
      {children}
    </button>
  );
}

export function InformationButton({
  elementId,
  label,
  onInspect,
  className = '',
  ...buttonProps
}) {
  if (!elementId || !onInspect) return null;

  return (
    <button
      type="button"
      {...buttonProps}
      className={`fcb-icon-button ${className}`.trim()}
      title="Read description"
      aria-label={`About ${label}`}
      onClick={(event) => onInspect(elementId, event.currentTarget)}
    >
      <Icon name="info" />
    </button>
  );
}
