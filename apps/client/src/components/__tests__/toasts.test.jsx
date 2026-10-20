// @vitest-environment happy-dom
// Confirmation messages: the live region is in the page before the first message, each message can
// be dismissed and waits while the pointer rests on it, and a sticky one stays until dismissed.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastStack, useToasts } from '../Toasts';
import { $, $$, click, mount } from '../custom/__tests__/harness';

let api = null;
function Host() {
  const state = useToasts();
  api = state;
  return <ToastStack {...state} />;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const messages = () => $$('.fcb-toast-message').map((node) => node.textContent);

describe('toasts', () => {
  it('keeps the live region in the page before any message arrives', async () => {
    await mount(<Host />);
    const region = $('.fcb-toast-stack');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.children).toHaveLength(0);
  });

  it('times a message out, holds it while the pointer rests on it, and lets it be dismissed', async () => {
    await mount(<Host />);
    await act(async () => api.notify('Added Rope'));
    await act(async () => $('.fcb-toast').dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(messages()).toEqual(['Added Rope']);
    await act(async () => $('.fcb-toast').dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(3000));
    expect(messages()).toEqual([]);

    await act(async () => api.notify('Added Torch'));
    await click($('.fcb-toast [aria-label="Dismiss"]'));
    expect(messages()).toEqual([]);
  });

  it('keeps a sticky message until it is dismissed', async () => {
    await mount(<Host />);
    await act(async () => api.notify('Saved moon.pack.xml', { sticky: true }));
    await act(async () => vi.advanceTimersByTime(60000));
    expect(messages()).toEqual(['Saved moon.pack.xml']);
    await click($('.fcb-toast [aria-label="Dismiss"]'));
    expect(messages()).toEqual([]);
  });
});
