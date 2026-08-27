import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
}));

import { cleanupPdfDocument } from '../PdfCanvasViewer.jsx';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PdfCanvasViewer.jsx', import.meta.url), 'utf8');

describe('PdfCanvasViewer cleanup', () => {
  it('cleans up a loaded document when destroy is available', () => {
    const document = { destroy: vi.fn() };

    expect(() => cleanupPdfDocument(document)).not.toThrow();
    expect(document.destroy).toHaveBeenCalledTimes(1);
  });

  it('tolerates stale and unmount cleanup for documents without destroy', () => {
    const staleDocument = { numPages: 3 };
    const unmountedDocument = { numPages: 3 };

    expect(() => {
      cleanupPdfDocument(staleDocument);
      cleanupPdfDocument(unmountedDocument);
    }).not.toThrow();
  });

  it('gives PDF.js the locally hosted standard fonts the sheet templates use', () => {
    expect(source).toContain('standardFontDataUrl');
    expect(source).toContain('pdfjs-standard-fonts/');
  });

  it('swaps a multi-page render in place and restores the viewer scroll position', () => {
    expect(source).toMatch(
      /for \(let pageNumber = 1; pageNumber <= loadedDoc\.numPages; pageNumber\+\+\)/,
    );
    expect(source).toMatch(
      /const scrollTop = container\.scrollTop;[\s\S]*container\.replaceChildren\([\s\S]*container\.scrollTop = scrollTop;/,
    );
  });

  it('rasterizes visible pages before the swap and cancels superseded renders', () => {
    // Visible-first: pages in the scroll window paint before replaceChildren;
    // offscreen pages fill in afterwards where a newer sheet can cancel them.
    expect(source).toContain('const visible = [];');
    expect(source).toMatch(/for \(const entry of visible\)[\s\S]*replaceChildren/);
    // In-flight page rasterization is cancelled on supersession/unmount.
    expect(source).toContain('renderTask.cancel()');
    expect(source).toContain('cancelRenderTask();');
    // Raster density is bounded; beyond 2x is invisible on vector art.
    expect(source).toContain('Math.min(window.devicePixelRatio || 1, 2)');
  });
});
