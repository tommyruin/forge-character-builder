// @vitest-environment happy-dom
// Every "show more" section in the custom-content and Homebrew screens is the one Disclosure: a
// native details element with the same summary class, so they look and behave alike.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import Disclosure from '../Disclosure';
import { $, mount } from '../custom/__tests__/harness';

const root = ['src/components', 'apps/client/src/components'].map((path) => resolve(process.cwd(), path)).find((path) => {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
});
const sources = (folder) =>
  readdirSync(resolve(root, folder))
    .filter((name) => name.endsWith('.jsx'))
    .map((name) => [name, readFileSync(resolve(root, folder, name), 'utf8')]);

describe('Disclosure', () => {
  it('renders a closed details with one summary and its body', async () => {
    await mount(
      <Disclosure summary="More effects" data-testid="more">
        <p>Body</p>
      </Disclosure>,
    );
    const details = $('[data-testid="more"]');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.className).toBe('fcb-disclosure fcb-disclosure--inline');
    expect(details.querySelector('summary').textContent).toBe('More effects');
    expect(details.querySelector('.fcb-disclosure-body').textContent).toBe('Body');
  });

  it('is the only show-more section in the custom-content and Homebrew screens', () => {
    for (const folder of ['custom', 'homebrew']) {
      for (const [name, text] of sources(folder)) expect(text, `${folder}/${name}`).not.toContain('<details');
    }
  });
});
