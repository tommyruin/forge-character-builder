import { describe, expect, it, vi } from 'vitest';
import {
  InformationButton,
  InspectableItemButton,
} from '../InspectableItemControls';

describe('inspectable item controls', () => {
  it('inspects before running the item activation', () => {
    const calls = [];
    const onInspect = vi.fn(() => calls.push('inspect'));
    const onActivate = vi.fn(() => calls.push('activate'));
    const control = InspectableItemButton({
      elementId: 'ID_OPTION',
      onInspect,
      onActivate,
      children: 'Option',
    });
    control.props.onClick();

    expect(onInspect).toHaveBeenCalledOnce();
    expect(onInspect).toHaveBeenCalledWith('ID_OPTION');
    expect(onActivate).toHaveBeenCalledOnce();
    expect(calls).toEqual(['inspect', 'activate']);
  });

  it('keeps inspection available while activation is disabled', () => {
    const onInspect = vi.fn();
    const onActivate = vi.fn();
    const control = InspectableItemButton({
      elementId: 'ID_OPTION',
      onInspect,
      onActivate,
      activationDisabled: true,
      children: 'Option',
    });
    control.props.onClick();

    expect(onInspect).toHaveBeenCalledWith('ID_OPTION');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('uses the information button for inspection only', () => {
    const onInspect = vi.fn();
    const onActivate = vi.fn();
    const control = InformationButton({
      elementId: 'ID_OTHER',
      label: 'Other option',
      onInspect,
      onActivate,
    });
    const sourceControl = {};

    control.props.onClick({ currentTarget: sourceControl });

    expect(onInspect).toHaveBeenCalledOnce();
    expect(onInspect).toHaveBeenCalledWith('ID_OTHER', sourceControl);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
