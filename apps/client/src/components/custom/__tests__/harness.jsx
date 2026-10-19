// Mount-and-interact helpers for the custom-content component tests (happy-dom, no testing
// library): real React roots, real DOM events, every change inside act().

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const { root, host } = mounted.pop();
    await act(async () => root.unmount());
    host.remove();
  }
  document.body.innerHTML = '';
});

export async function mount(element) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(element));
  return { host, root };
}

// Modals render in place, so the whole document is the search scope.
export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export const byLabel = (label) => document.querySelector(`[aria-label="${label}"]`);
export const allByLabel = (label) => [...document.querySelectorAll(`[aria-label="${label}"]`)];
export const group = (label) => document.querySelector(`[role="group"][aria-label="${label}"]`);
export const buttonByText = (text, scope = document) =>
  [...scope.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
export const buttonStartingWith = (text, scope = document) =>
  [...scope.querySelectorAll('button')].find((button) => button.textContent.trim().startsWith(text));
export const radio = (label, scope = document) =>
  [...scope.querySelectorAll('[role="radio"]')].find((button) => button.textContent.trim() === label);

export async function click(element) {
  if (!element) throw new Error('click target not found');
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export async function type(element, value) {
  if (!element) throw new Error('type target not found');
  const proto = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

export async function choose(select, value) {
  if (!select) throw new Error('select target not found');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

export async function submit(form) {
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

// Lets promises the component started (a search, a save) settle and React re-render.
export async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// A controlled wrapper: holds the value a block edits and records every value it emits.
export function Controlled({ initial, children, emitted }) {
  const [value, setValue] = useState(initial);
  return children(value, (next) => {
    emitted?.push(next);
    setValue(next);
  });
}
