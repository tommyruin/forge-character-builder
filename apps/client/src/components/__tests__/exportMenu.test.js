import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../ExportMenu.jsx', import.meta.url),
  'utf8',
);

describe('ExportMenu items', () => {
  it('offers both the plain character file and the content-bundling package', () => {
    expect(source).toContain('Character file (.dnd5e)');
    expect(source).toContain('Character + custom content (.dnd5e-pkg)');
    expect(source).toContain('api.characters.exportPackage');
  });

  it('lists no VTT converters until they are tested end-to-end', () => {
    expect(source).not.toContain('exportFoundry');
    expect(source).not.toContain('exportRoll20');
    expect(source).not.toContain('Foundry VTT');
    expect(source).not.toContain('Roll20 VTTES');
  });
});
