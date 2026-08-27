import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

describe('App library change contract', () => {
  it('keeps cloud deletion checks ahead of any open-character restore', () => {
    expect(appSource).toContain(
      'source === \'cloud\' ? null : openCharacterId',
    );
    expect(appSource).toContain(
      "if (source === 'cloud' && openCharacterId)",
    );
    expect(appSource).toContain(
      "const replayRequired = source === 'cloud' ? false : reloadRequired",
    );
  });
});
