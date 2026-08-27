import { describe, expect, it } from 'vitest';
import { contentTypeFor, selectPrecompressedEncoding } from '../precompressedAssets.js';

describe('precompressed asset negotiation', () => {
  it('prefers Brotli and falls back to gzip', () => {
    expect(selectPrecompressedEncoding('gzip, deflate, br', { br: true, gzip: true })).toBe('br');
    expect(selectPrecompressedEncoding('gzip, deflate', { br: true, gzip: true })).toBe('gzip');
    expect(selectPrecompressedEncoding('br', { br: false, gzip: true })).toBeNull();
  });

  it('retains the MIME type of the uncompressed resource', () => {
    expect(contentTypeFor('/assets/module.wasm')).toBe('application/wasm');
    expect(contentTypeFor('/assets/data.dat')).toBe('application/octet-stream');
    expect(contentTypeFor('/assets/engine-worker.js')).toBe('text/javascript; charset=utf-8');
  });
});

describe('compressed sibling emission', () => {
  it('emits .br and .gz siblings for large compressible files only, byte-identical on decompression', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { brotliDecompressSync, gunzipSync } = await import('node:zlib');
    const { emitCompressedSiblings } = await import('../precompressedAssets.js');

    const dir = mkdtempSync(join(tmpdir(), 'fcb-compress-'));
    const bigXml = `<elements>${'<element id="ID_X" name="X" type="Item" source="H" />'.repeat(500)}</elements>`;
    writeFileSync(join(dir, 'content.xml'), bigXml);
    writeFileSync(join(dir, 'entry.js'), `export const x = ${JSON.stringify('y'.repeat(4000))};`);
    writeFileSync(join(dir, 'tiny.css'), 'body{}');
    writeFileSync(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));

    const result = await emitCompressedSiblings(dir);

    expect(existsSync(join(dir, 'content.xml.br'))).toBe(true);
    expect(existsSync(join(dir, 'content.xml.gz'))).toBe(true);
    expect(existsSync(join(dir, 'entry.js.br'))).toBe(true);
    expect(existsSync(join(dir, 'tiny.css.br'))).toBe(false);
    expect(existsSync(join(dir, 'image.png.br'))).toBe(false);
    expect(brotliDecompressSync(readFileSync(join(dir, 'content.xml.br'))).toString()).toBe(bigXml);
    expect(gunzipSync(readFileSync(join(dir, 'content.xml.gz'))).toString()).toBe(bigXml);
    expect(result.compressed).toBeGreaterThanOrEqual(2);
  });
});
