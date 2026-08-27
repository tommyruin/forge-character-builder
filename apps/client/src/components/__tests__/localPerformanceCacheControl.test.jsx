import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fastStartActivityFor } from '../../fastStartActivity.js';
import { resetLocalPerformanceCache } from '../../transport/localPerformanceCache.js';
import LocalPerformanceCacheControl from '../LocalPerformanceCacheControl.jsx';

const contentManagerSource = readFileSync(
  new URL('../ContentManager.jsx', import.meta.url),
  'utf8',
);
const drivePanelSource = readFileSync(
  new URL('../cloud/DriveSyncPanel.jsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../App.jsx', import.meta.url),
  'utf8',
);

describe('automatic local performance cache', () => {
  it('keeps the recovery control compact and outside Storage & Sync', () => {
    const markup = renderToStaticMarkup(
      createElement(LocalPerformanceCacheControl, {
        fastStart: {
          remove: vi.fn(),
          rebuild: vi.fn(),
        },
      }),
    );

    expect(markup).toContain('<details');
    expect(markup).toContain('Advanced local storage');
    expect(markup).toContain('Reset local performance cache');
    expect(contentManagerSource).toContain('<LocalPerformanceCacheControl');
    expect(drivePanelSource).not.toContain('FastStartPanel');
    expect(drivePanelSource).not.toContain('Manage local Fast Start');
  });

  it('clears and recreates only the local performance cache', async () => {
    const operations = [];
    const fastStart = {
      remove: vi.fn(async () => operations.push('remove')),
      rebuild: vi.fn(async () => operations.push('rebuild')),
    };

    await resetLocalPerformanceCache(fastStart);

    expect(operations).toEqual(['remove', 'rebuild']);
  });

  it('keeps automatic snapshot work visible without restoring the prominent panel', () => {
    expect(appSource).toContain('<FastStartActivityNotice');
    expect(drivePanelSource).not.toContain('FastStartActivityNotice');
    expect(
      fastStartActivityFor({
        enabled: true,
        supported: true,
        readiness: 'building',
        bootMode: 'normal',
      }),
    ).toEqual({
      kind: 'building',
      message:
        'Updating Fast Start… Keep this tab open for a faster next launch.',
    });
    expect(
      fastStartActivityFor(
        {
          enabled: true,
          supported: true,
          readiness: 'ready',
          bootMode: 'normal',
        },
        true,
      ),
    ).toEqual({
      kind: 'ready',
      message: 'Fast Start is ready for the next launch.',
    });
  });
});
